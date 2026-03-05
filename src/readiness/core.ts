/**
 * Pure readiness scanning core — no vscode dependency.
 *
 * This module contains all scoring, signal detection, penalty computation,
 * and roadmap generation logic. It works with pre-resolved file data,
 * making it usable from both VS Code and CLI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentFileType, PromptIssue } from '../types';
import { runLocalRules } from '../localRules';
import {
  ReadinessReport,
  ScannedFile,
  SectionCoverage,
  MaturityLevel,
  MaturityInfo,
  MATURITY_LEVELS,
  ReadinessSignal,
  ReadinessPenalty,
  RoadmapStep,
  ToolFitScore,
  FileIssues,
} from './types';
import { calculateTokenCost, estimateSavings } from './costCalculator';

// ── Section Detection ───────────────────────────────────────────────────────

function countNonEmpty(content: string): number {
  return content.split('\n').filter((l) => l.trim().length > 0).length;
}

export function detectSections(content: string): SectionCoverage {
  const lower = content.toLowerCase();
  return {
    hasProjectContext:
      /^#\s+\w+/m.test(content) &&
      content.split('\n').slice(0, 5).some((l) => l.trim().length > 20 && !/^#/.test(l.trim())),
    hasCommands:
      /##?\s*(commands?|build|test|scripts?)/im.test(content) ||
      /```(bash|sh|shell)/im.test(content) ||
      /\bnpm\s+(run\s+)?(test|build|lint)/im.test(content),
    hasArchitecture: /##?\s*(architecture|structure|directory|layout|organization)/im.test(content),
    hasCodeStyle: /##?\s*(code\s*style|style|conventions?|patterns?)/im.test(content),
    hasConstraints:
      /##?\s*(constraints?|rules?|prohibitions?|boundaries)/im.test(content) ||
      (/\bNEVER\b/.test(content) && /\bMUST NOT\b/.test(content)),
    hasGotchas: /##?\s*(gotchas?|caveats?|pitfalls?|warnings?|quirks?|watch\s*out)/im.test(content),
    hasVerification:
      /##?\s*(verification|verify|validation|check)/im.test(content) ||
      /\b(run tests|check types|verify|tsc --noEmit)\b/i.test(lower),
  };
}

/**
 * Merge section coverage across multiple files using OR logic.
 * If ANY file has commands, the overall coverage includes commands.
 */
function mergeSections(coverages: SectionCoverage[]): SectionCoverage {
  const merged: SectionCoverage = {
    hasProjectContext: false,
    hasCommands: false,
    hasArchitecture: false,
    hasCodeStyle: false,
    hasConstraints: false,
    hasGotchas: false,
    hasVerification: false,
  };
  for (const c of coverages) {
    for (const key of Object.keys(merged) as (keyof SectionCoverage)[]) {
      if (c[key]) merged[key] = true;
    }
  }
  return merged;
}

// ── Maturity Detection ──────────────────────────────────────────────────────

function detectMaturityLevel(report: {
  files: ScannedFile[];
  sections: SectionCoverage;
  hasRfc2119: boolean;
  hasPathScoping: boolean;
  hasSkills: boolean;
}): MaturityInfo {
  const { files, sections, hasRfc2119, hasPathScoping, hasSkills } = report;

  if (files.length === 0) return MATURITY_LEVELS[0];

  // L6: Autonomous
  if (hasSkills && hasPathScoping && hasRfc2119) return MATURITY_LEVELS[6];

  // L5: Optimized
  if (hasPathScoping && hasRfc2119 && files.length >= 3 && Object.values(sections).filter(Boolean).length >= 5) {
    return MATURITY_LEVELS[5];
  }

  // L4: Context-Aware
  if (hasPathScoping) return MATURITY_LEVELS[4];

  // L3: Organized
  if (files.length >= 2 && Object.values(sections).filter(Boolean).length >= 3) {
    return MATURITY_LEVELS[3];
  }

  // L2: Intentional
  if (hasRfc2119) return MATURITY_LEVELS[2];

  // L1: Foundation
  return MATURITY_LEVELS[1];
}

// ── Penalty Computation ─────────────────────────────────────────────────────

const PENALTY_CATALOG: Record<
  string,
  { label: string; perOccurrence: number; severity: 'error' | 'warning' | 'info'; reason: string; detail: string }
> = {
  SENSITIVE_DATA: {
    label: 'Sensitive data exposed',
    perOccurrence: 8,
    severity: 'error',
    reason: 'Secrets in agent files risk leaking credentials through AI-generated code or commits',
    detail:
      'Agent instruction files are loaded into the AI context on every message and may be committed to git. ' +
      'Any secrets (API keys, tokens, passwords) will be visible to the AI and could be inadvertently included ' +
      'in generated code, commit messages, or shared with third-party tools. Use environment variables or ' +
      'CLAUDE.local.md (gitignored) for sensitive configuration.',
  },
  SKILL_MISSING_FRONTMATTER: {
    label: 'Skill missing frontmatter',
    perOccurrence: 5,
    severity: 'error',
    reason: "Skill won't be discoverable without required name/description frontmatter",
    detail:
      'The Agent Skills spec (agentskills.io) requires YAML frontmatter with at minimum `name` and `description` fields. ' +
      'Without frontmatter, the skill cannot be registered or matched to tasks. The AI reads skill metadata (~100 tokens) ' +
      'at startup to build a catalog — missing metadata means the skill is invisible.',
  },
  SKILL_MISSING_NAME: {
    label: 'Skill missing name',
    perOccurrence: 4,
    severity: 'error',
    reason: 'Agent cannot register or invoke the skill without a valid name',
    detail:
      'Skill names must be 1-64 characters, lowercase alphanumeric with hyphens, and match the parent directory name. ' +
      'Without a name, the skill will fail to register and be completely unusable.',
  },
  SKILL_MISSING_DESCRIPTION: {
    label: 'Skill missing description',
    perOccurrence: 4,
    severity: 'error',
    reason: 'Agent cannot match tasks to the skill without a description',
    detail:
      'The description field (1-1024 chars) is how the AI decides when to activate a skill. Without it, the agent ' +
      'has no way to know when to use this skill, even if the instructions inside are perfect.',
  },
  SKILL_INVALID_NAME: {
    label: 'Skill invalid name format',
    perOccurrence: 3,
    severity: 'error',
    reason: 'Invalid skill name will cause registration failures',
    detail:
      'Skill names must follow strict rules: lowercase alphanumeric + hyphens, no starting/ending with hyphen, ' +
      'no consecutive hyphens, and must match the parent directory name. Invalid names cause silent registration failures.',
  },
  FILE_TOO_LONG: {
    label: 'File exceeds recommended length',
    perOccurrence: 6,
    severity: 'warning',
    reason: 'Instruction adherence degrades uniformly beyond 200 lines',
    detail:
      "Anthropic's official recommendation is <200 lines per file. Research (HumanLayer) shows LLMs can follow " +
      '~150-200 instructions consistently. Beyond that, compliance drops for ALL instructions uniformly — not just ' +
      'the ones at the end. Move specialized content to .claude/rules/ (loaded only for matching files) or Agent Skills ' +
      '(loaded on-demand). Keep the main file for universal project rules only.',
  },
  HEDGING_LANGUAGE: {
    label: 'Hedging language used',
    perOccurrence: 2,
    severity: 'warning',
    reason: '"Try to" and "consider" are treated as optional by the AI',
    detail:
      'LLMs interpret hedging language ("try to", "consider", "you might want to") as suggestions, not requirements. ' +
      'Instructions with hedging are skipped ~60% more often than imperative ones. Replace with RFC 2119 keywords: ' +
      'MUST, MUST NOT, NEVER, ALWAYS. AgentLint can auto-fix most of these (look for the lightbulb icon).',
  },
  VAGUE_INSTRUCTION: {
    label: 'Vague/redundant instruction',
    perOccurrence: 2,
    severity: 'warning',
    reason: 'Wastes token budget on instructions the AI already follows by default',
    detail:
      'Instructions like "Write clean code" or "Follow best practices" add tokens to every message but provide zero value — ' +
      'the AI already does these things. Each wasted token costs money across every message. ' +
      'ETH Zurich found auto-generated boilerplate actually decreases success rates by 2-3%.',
  },
  MISSING_COMMANDS: {
    label: 'No build/test commands',
    perOccurrence: 5,
    severity: 'warning',
    reason: 'The #1 most valuable content is missing',
    detail:
      'Build/test/lint commands are universally rated as the single most valuable content in agent instruction files. ' +
      'Without them, the AI has to guess how to build and test your project, leading to wasted attempts, wrong flags, ' +
      'and failed builds. Add exact copy-paste commands with all required flags.',
  },
  SKILL_DESCRIPTION_TOO_LONG: {
    label: 'Skill description too long',
    perOccurrence: 2,
    severity: 'warning',
    reason: 'Bloated description wastes tokens during skill matching for every agent turn',
    detail:
      'Skill descriptions are loaded into context for EVERY agent turn to enable task matching. The spec recommends ' +
      'keeping descriptions under 1024 characters (~250 tokens). Bloated descriptions waste tokens on every single message, ' +
      'not just when the skill is active.',
  },
  SKILL_WEAK_DESCRIPTION: {
    label: 'Skill description too brief',
    perOccurrence: 3,
    severity: 'warning',
    reason: "Agent won't reliably match tasks to this skill without descriptive keywords",
    detail:
      'Skill matching relies on semantic similarity between task descriptions and skill descriptions. A too-brief ' +
      'description (under ~20 words) lacks the keywords needed for reliable matching. Include key capabilities, ' +
      'file types handled, and common task patterns.',
  },
  SKILL_TOKEN_BUDGET: {
    label: 'Skill exceeds token budget',
    perOccurrence: 4,
    severity: 'warning',
    reason: 'Skill body loads entirely on activation — exceeding 5000 tokens wastes context window',
    detail:
      'The Agent Skills spec recommends <5000 tokens for skill instructions. When a skill activates, its entire body ' +
      'loads into context. Oversized skills waste the limited context window (200k tokens shared with code, conversation, ' +
      'and other tools). Move reference material to separate files in the skill directory.',
  },
  PROSE_PARAGRAPH: {
    label: 'Dense prose blocks',
    perOccurrence: 1,
    severity: 'info',
    reason: 'LLMs follow structured bullet points more reliably than dense paragraphs',
    detail:
      'Research shows LLMs extract and follow individual instructions more reliably from bullet-point lists than from ' +
      'prose paragraphs. Dense text also uses more tokens for the same information. Converting prose to structured ' +
      'bullets typically saves ~40% tokens while improving compliance.',
  },
  DISCOVERABLE_INFO: {
    label: 'Auto-discoverable information',
    perOccurrence: 1,
    severity: 'info',
    reason: 'File-by-file descriptions waste token budget — the AI reads your code directly',
    detail:
      'Claude and other AI tools read your code files directly. Describing your directory structure or listing what each ' +
      'file does wastes tokens on information the AI already has. ETH Zurich found that auto-generated boilerplate ' +
      '(which often includes discoverable info) decreases success rates by 2-3%. Only include information that CANNOT ' +
      'be discovered by reading the code.',
  },
  MISSING_NEGATIVE_CONSTRAINTS: {
    label: 'No negative constraints',
    perOccurrence: 2,
    severity: 'info',
    reason: "#2 most effective instruction type is missing — the AI won't know your prohibitions",
    detail:
      'Negative constraints (NEVER, MUST NOT, DO NOT) are the #2 most effective instruction type after build commands. ' +
      "They prevent the AI from making mistakes you've seen before. Without them, the AI will repeat common errors " +
      "specific to your project. Add a ## Constraints section listing things the AI should never do.",
  },
  CONTEXT_BLOAT: {
    label: 'Excessive context token budget',
    perOccurrence: 8,
    severity: 'warning',
    reason: 'Total agent file tokens exceed efficient threshold — increases cost 19-23% per ETH Zurich',
    detail:
      'ETH Zurich (Feb 2026) found that context files add 19-23% to inference cost regardless of quality. ' +
      'Chroma\'s Context Rot research shows performance degrades non-uniformly with longer input — even on simple tasks. ' +
      'LLM-generated context files reduced success rates in 5 of 8 settings tested. Keep total agent context under ~8,000 tokens. ' +
      'Move specialized content to Agent Skills (loaded on-demand) or .claude/rules/ (loaded per-file). ' +
      'Only include information the AI cannot discover by reading your code directly.',
  },
};

function computePenalties(fileIssueMap: FileIssues[]): ReadinessPenalty[] {
  const aggregated = new Map<string, { count: number; files: Set<string> }>();

  for (const { file, issues } of fileIssueMap) {
    for (const issue of issues) {
      const existing = aggregated.get(issue.code);
      if (existing) {
        existing.count++;
        existing.files.add(file.relativePath);
      } else {
        aggregated.set(issue.code, { count: 1, files: new Set([file.relativePath]) });
      }
    }
  }

  const penalties: ReadinessPenalty[] = [];

  for (const [code, { count, files }] of aggregated) {
    const catalog = PENALTY_CATALOG[code];
    if (!catalog) continue;

    const maxPenaltyPerCategory =
      catalog.severity === 'error' ? 20 : catalog.severity === 'warning' ? 12 : 6;
    const rawPenalty = count * catalog.perOccurrence;
    const cappedPenalty = Math.min(rawPenalty, maxPenaltyPerCategory);

    penalties.push({
      code,
      label: catalog.label,
      points: cappedPenalty,
      count,
      severity: catalog.severity,
      affectedFiles: Array.from(files),
      reason: catalog.reason,
      detail: catalog.detail,
    });
  }

  penalties.sort((a, b) => b.points - a.points);
  return penalties;
}

// ── AI Tool Fit ─────────────────────────────────────────────────────────────

function analyzeToolFit(
  files: ScannedFile[],
  checkResults: {
    hasClaudeDir: boolean;
    hasHooksConfig: boolean;
    hasMcpConfig: boolean;
    hasSubagents: boolean;
    hasCommands: boolean;
    hasPlugins: boolean;
    hasCursorIgnore: boolean;
  }
): ToolFitScore[] {
  const hasType = (type: AgentFileType) => files.some((f) => f.type === type);

  const claude: ToolFitScore = {
    tool: 'Claude Code',
    featuresAvailable: 10,
    featuresConfigured: 0,
    features: [
      { name: 'CLAUDE.md', configured: hasType('claude-md') || hasType('claude-local-md') },
      { name: '.claude/rules/', configured: hasType('claude-rules') },
      { name: 'Agent Skills', configured: hasType('skill-md') },
      { name: '.claude/ directory', configured: checkResults.hasClaudeDir },
      { name: 'Hooks', configured: checkResults.hasHooksConfig },
      { name: 'MCP servers', configured: checkResults.hasMcpConfig },
      { name: 'Subagents', configured: checkResults.hasSubagents },
      { name: 'Slash commands', configured: checkResults.hasCommands },
      { name: 'Plugins', configured: checkResults.hasPlugins },
      { name: 'CLAUDE.local.md', configured: hasType('claude-local-md') },
    ],
  };
  claude.featuresConfigured = claude.features.filter((f) => f.configured).length;

  const cursor: ToolFitScore = {
    tool: 'Cursor',
    featuresAvailable: 4,
    featuresConfigured: 0,
    features: [
      { name: '.cursorrules', configured: hasType('cursorrules') },
      { name: '.cursor/rules/', configured: files.some((f) => f.type === 'cursorrules' && f.relativePath.includes('.cursor/rules/')) },
      { name: '.cursorignore', configured: checkResults.hasCursorIgnore },
      { name: 'AGENTS.md', configured: hasType('agents-md') },
    ],
  };
  cursor.featuresConfigured = cursor.features.filter((f) => f.configured).length;

  const copilot: ToolFitScore = {
    tool: 'GitHub Copilot',
    featuresAvailable: 2,
    featuresConfigured: 0,
    features: [
      { name: 'copilot-instructions.md', configured: hasType('copilot-instructions') },
      { name: 'AGENTS.md', configured: hasType('agents-md') },
    ],
  };
  copilot.featuresConfigured = copilot.features.filter((f) => f.configured).length;

  return [claude, cursor, copilot].sort((a, b) => b.featuresConfigured - a.featuresConfigured);
}

// ── Roadmap Generator ───────────────────────────────────────────────────────

function generateRoadmap(
  signals: ReadinessSignal[],
  sections: SectionCoverage,
  files: ScannedFile[],
  maturityLevel: MaturityLevel,
  penalties: ReadinessPenalty[],
  context: { hasCursorRules: boolean } = { hasCursorRules: false }
): RoadmapStep[] {
  const steps: RoadmapStep[] = [];
  let priority = 0;
  const { hasCursorRules } = context;

  const missing = (name: string) => !signals.find((s) => s.name === name)?.found;

  // ── Tier 0: Fix critical issues FIRST ─────────────────────────────────────
  const errorPenalties = penalties.filter((p) => p.severity === 'error');
  const warningPenalties = penalties.filter((p) => p.severity === 'warning');

  if (errorPenalties.length > 0) {
    const totalErrorPts = errorPenalties.reduce((sum, p) => sum + p.points, 0);
    steps.push({
      priority: ++priority,
      title: 'Fix critical issues',
      description:
        `${errorPenalties.length} critical issue${errorPenalties.length > 1 ? 's' : ''} found:\n` +
        errorPenalties.map((p) => `- **${p.label}** (${p.count}x in ${p.affectedFiles.join(', ')})`).join('\n'),
      impact: 'high',
      effort: 'low',
      currentState: `${errorPenalties.reduce((sum, p) => sum + p.count, 0)} critical issues across ${new Set(errorPenalties.flatMap((p) => p.affectedFiles)).size} files`,
      targetState: 'Zero critical issues',
      pointsRecoverable: totalErrorPts,
    });
  }

  const quickFixPenalties = warningPenalties.filter((p) =>
    ['HEDGING_LANGUAGE', 'VAGUE_INSTRUCTION'].includes(p.code)
  );
  if (quickFixPenalties.length > 0) {
    const totalQfPts = quickFixPenalties.reduce((sum, p) => sum + p.points, 0);
    steps.push({
      priority: ++priority,
      title: 'Clean up weak instructions',
      description:
        `${quickFixPenalties.reduce((sum, p) => sum + p.count, 0)} weak instructions found. ` +
        'AgentLint offers quick-fixes for most of these.\n' +
        quickFixPenalties.map((p) => `- **${p.label}** (${p.count}x)`).join('\n'),
      impact: 'medium',
      effort: 'low',
      currentState: `${quickFixPenalties.reduce((sum, p) => sum + p.count, 0)} hedging/vague instructions`,
      targetState: 'All instructions use imperative RFC 2119 language',
      pointsRecoverable: totalQfPts,
    });
  }

  const bloatPenalties = warningPenalties.filter((p) =>
    ['FILE_TOO_LONG', 'SKILL_TOKEN_BUDGET'].includes(p.code)
  );
  if (bloatPenalties.length > 0) {
    const totalBloatPts = bloatPenalties.reduce((sum, p) => sum + p.points, 0);
    steps.push({
      priority: ++priority,
      title: 'Reduce file bloat',
      description:
        'Oversized files degrade instruction adherence for ALL rules.\n' +
        bloatPenalties.map((p) => `- **${p.label}** in ${p.affectedFiles.join(', ')}`).join('\n'),
      impact: 'high',
      effort: 'medium',
      currentState: bloatPenalties.map((p) => `${p.affectedFiles.join(', ')} exceeds limit`).join('; '),
      targetState: 'CLAUDE.md <200 lines, Skills <5000 tokens',
      pointsRecoverable: totalBloatPts,
    });
  }

  // ── Tier 1: Essentials ────────────────────────────────────────────────────
  if (missing('CLAUDE.md exists')) {
    steps.push({
      priority: ++priority,
      title: 'Create CLAUDE.md',
      description: 'The foundation of AI-assisted development. Run "AgentLint: Create CLAUDE.md from Template" or create manually.',
      impact: 'high',
      effort: 'low',
      currentState: 'No CLAUDE.md found',
      targetState: 'CLAUDE.md with best-practices skeleton',
      pointsRecoverable: 15,
    });
  }

  if (missing('Build/test commands')) {
    steps.push({
      priority: ++priority,
      title: 'Add build/test/lint commands',
      description: 'The #1 most valuable content. Add exact copy-paste commands with flags.',
      impact: 'high',
      effort: 'low',
      currentState: 'No commands found in agent files',
      targetState: '## Commands section with build, test, lint, dev commands',
      pointsRecoverable: 15,
    });
  }

  if (missing('Negative constraints')) {
    steps.push({
      priority: ++priority,
      title: 'Add NEVER/MUST NOT constraints',
      description: 'The #2 most effective instruction type. Add explicit rules about what the AI must not do.',
      impact: 'high',
      effort: 'low',
      currentState: 'No negative constraints found',
      targetState: '## Constraints section with NEVER, MUST NOT, DO NOT rules',
      pointsRecoverable: 10,
    });
  }

  if (missing('Verification instructions')) {
    steps.push({
      priority: ++priority,
      title: 'Add verification instructions',
      description: 'Tell the AI how to check its own work. Gives "2-3x quality improvement" per Boris Cherny (Claude Code creator).',
      impact: 'high',
      effort: 'low',
      currentState: 'No verification steps found',
      targetState: '"After changes, run npm test" or "Check types with tsc --noEmit"',
      pointsRecoverable: 8,
    });
  }

  // ── Tier 2: Optimization ──────────────────────────────────────────────────
  if (missing('RFC 2119 language')) {
    steps.push({
      priority: ++priority,
      title: 'Use imperative RFC 2119 language',
      description: 'Replace hedging ("try to", "consider") with MUST, MUST NOT, NEVER, ALWAYS.',
      impact: 'medium',
      effort: 'low',
      currentState: 'No RFC 2119 keywords detected',
      targetState: 'Instructions use MUST/NEVER/ALWAYS consistently',
      pointsRecoverable: 5,
    });
  }

  if (missing('Gotchas documented')) {
    steps.push({
      priority: ++priority,
      title: 'Document project gotchas',
      description:
        'The most uniquely valuable content — non-obvious behaviors the AI cannot discover by reading code. ' +
        'ETH Zurich: only content the AI can\'t infer on its own improves outcomes.',
      impact: 'high',
      effort: 'medium',
      currentState: 'No gotchas section found',
      targetState: '## Gotchas with project-specific traps and workarounds',
      pointsRecoverable: 10,
    });
  }

  if (missing('Under 200 lines') && files.some((f) => f.type === 'claude-md' && f.nonEmptyLineCount > 200)) {
    steps.push({
      priority: ++priority,
      title: 'Trim CLAUDE.md under 200 lines',
      description:
        'HumanLayer research: LLMs follow ~150-200 instructions consistently, then quality degrades linearly. ' +
        'Move specialized content to .claude/rules/ (per-file) or Agent Skills (on-demand).',
      impact: 'medium',
      effort: 'medium',
      currentState: `CLAUDE.md has ${files.find((f) => f.type === 'claude-md')?.nonEmptyLineCount ?? '?'} non-empty lines`,
      targetState: '<200 lines with specialized content in rules/skills',
      pointsRecoverable: 5,
    });
  }

  if (missing('Code examples in instructions')) {
    steps.push({
      priority: ++priority,
      title: 'Add code examples to agent files',
      description:
        'GitHub analysis of 2,500 repos: "One real code snippet showing your style beats three paragraphs describing it." ' +
        'Show the AI what good output looks like with ✅/❌ examples.',
      impact: 'medium',
      effort: 'low',
      currentState: 'No code examples (``` blocks) found in agent instruction files',
      targetState: 'Agent files include code snippets showing preferred patterns',
      pointsRecoverable: 4,
    });
  }

  if (missing('Agent persona defined')) {
    steps.push({
      priority: ++priority,
      title: 'Define an agent persona/role',
      description:
        'GitHub analysis: "You are a senior backend engineer who writes tests for React components" outperforms generic helpers. ' +
        'Give the AI a specific job description matching your project needs.',
      impact: 'medium',
      effort: 'low',
      currentState: 'No persona or role definition found in agent files',
      targetState: '"You are a [role] who [specializes in X]" at the top of your instructions',
      pointsRecoverable: 3,
    });
  }

  if (missing('Concise context (≤8k tokens)')) {
    const totalTokens = files.reduce((sum, f) => sum + f.estimatedTokens, 0);
    steps.push({
      priority: ++priority,
      title: 'Reduce total agent context size',
      description:
        'ETH Zurich (Feb 2026): all context files add 19-23% to inference cost. ' +
        'Chroma Context Rot: performance degrades with longer input, even on simple tasks. ' +
        'Move content to Skills (on-demand) or rules (per-file) to reduce always-loaded context.',
      impact: 'high',
      effort: 'medium',
      currentState: `~${totalTokens.toLocaleString()} tokens across ${files.length} agent files`,
      targetState: '≤8,000 tokens in always-loaded context, rest in skills/rules',
      pointsRecoverable: 4,
    });
  }

  // ── Tier 3: Advanced ──────────────────────────────────────────────────────
  if (missing('Path-scoped rules') && maturityLevel < 4) {
    steps.push({
      priority: ++priority,
      title: 'Add path-scoped rules',
      description: 'Create .claude/rules/ with glob-targeted rules. Different standards for different areas of your codebase.',
      impact: 'medium',
      effort: 'medium',
      currentState: 'No path-scoped rules',
      targetState: '.claude/rules/ with glob patterns for area-specific rules',
      pointsRecoverable: 7,
    });
  }

  if (missing('Hooks configured')) {
    steps.push({
      priority: ++priority,
      title: 'Set up hooks for automation',
      description:
        'Hooks are zero-cost (no tokens, no API calls) and deterministic. ' +
        'Boris Cherny\'s team relies heavily on hooks for auto-formatting, linting, and notifications. ' +
        'Anthropic positions hooks as a core best practice.',
      impact: 'medium',
      effort: 'medium',
      currentState: 'No hooks configured',
      targetState: 'PostToolUse hooks for auto-formatting, Notification hooks for alerts',
      pointsRecoverable: 6,
    });
  }

  if (missing('Agent Skills (SKILL.md)') && maturityLevel >= 3) {
    steps.push({
      priority: ++priority,
      title: 'Create Agent Skills for specialized workflows',
      description: 'Move specialized instructions to SKILL.md files. Skills load on-demand, saving tokens.',
      impact: 'medium',
      effort: 'high',
      currentState: 'No skills found',
      targetState: 'Specialized workflows as skills (progressive disclosure)',
      pointsRecoverable: 5,
    });
  }

  if (missing('.gitignore includes local') && !missing('CLAUDE.md exists')) {
    steps.push({
      priority: ++priority,
      title: 'Add CLAUDE.local.md to .gitignore',
      description: "CLAUDE.local.md is for personal overrides. Make sure it won't be committed.",
      impact: 'low',
      effort: 'low',
      currentState: 'CLAUDE.local.md not in .gitignore',
      targetState: '.gitignore includes CLAUDE.local.md',
      pointsRecoverable: 2,
    });
  }

  if (missing('Slash commands') && maturityLevel >= 3) {
    steps.push({
      priority: ++priority,
      title: 'Create custom slash commands',
      description: 'Define repeatable workflows in .claude/commands/ for common tasks.',
      impact: 'low',
      effort: 'medium',
      currentState: 'No custom commands',
      targetState: '.claude/commands/ with team workflow definitions',
      pointsRecoverable: 2,
    });
  }

  // ── Tier 4: Repository health ────────────────────────────────────────────
  if (missing('.editorconfig present')) {
    steps.push({
      priority: ++priority,
      title: 'Add .editorconfig',
      description: 'Ensures AI-generated code matches your formatting standards (indent style, line endings, charset).',
      impact: 'low',
      effort: 'low',
      currentState: 'No .editorconfig found',
      targetState: '.editorconfig with indent_style, indent_size, end_of_line, charset',
      pointsRecoverable: 2,
    });
  }

  if (missing('CONTRIBUTING.md exists')) {
    steps.push({
      priority: ++priority,
      title: 'Add CONTRIBUTING.md',
      description: 'Contribution guidelines help AI agents understand your project norms, PR process, and coding standards.',
      impact: 'low',
      effort: 'medium',
      currentState: 'No CONTRIBUTING.md found',
      targetState: 'CONTRIBUTING.md with coding standards, PR process, and setup instructions',
      pointsRecoverable: 3,
    });
  }

  if (missing('ARCHITECTURE.md standalone') && !sections.hasArchitecture) {
    steps.push({
      priority: ++priority,
      title: 'Create ARCHITECTURE.md',
      description: 'A standalone architecture document helps AI agents understand system design beyond what agent files cover.',
      impact: 'medium',
      effort: 'medium',
      currentState: 'No architecture documentation found',
      targetState: 'ARCHITECTURE.md with system overview, directory structure, key patterns',
      pointsRecoverable: 3,
    });
  }

  if (missing('README has setup instructions')) {
    steps.push({
      priority: ++priority,
      title: 'Add setup/install section to README',
      description: 'A setup section helps AI agents understand how to build, install, and run the project.',
      impact: 'low',
      effort: 'low',
      currentState: 'README missing setup/install/getting-started section',
      targetState: 'README with clear setup instructions and prerequisites',
      pointsRecoverable: 3,
    });
  }

  if (missing('.cursorignore configured') && hasCursorRules) {
    steps.push({
      priority: ++priority,
      title: 'Add .cursorignore',
      description: 'Controls which files Cursor indexes. Exclude build artifacts, node_modules, and generated files for faster indexing.',
      impact: 'low',
      effort: 'low',
      currentState: 'No .cursorignore found',
      targetState: '.cursorignore excluding build outputs, node_modules, dist/',
      pointsRecoverable: 3,
    });
  }

  return steps;
}

// ── Filesystem Helpers ──────────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function checkGitignoreHasLocal(rootPath: string): boolean {
  const gitignorePath = path.join(rootPath, '.gitignore');
  if (!fileExists(gitignorePath)) return false;
  const content = fs.readFileSync(gitignorePath, 'utf8');
  return /CLAUDE\.local\.md/i.test(content);
}

function checkHasHooks(rootPath: string): boolean {
  const settingsPath = path.join(rootPath, '.claude', 'settings.json');
  if (!fileExists(settingsPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return parsed.hooks && Object.keys(parsed.hooks).length > 0;
  } catch { return false; }
}

function checkHasMcp(rootPath: string): boolean {
  return (
    fs.existsSync(path.join(rootPath, '.mcp.json')) ||
    fs.existsSync(path.join(rootPath, '.claude', 'mcp.json'))
  );
}

function checkHasPlugins(rootPath: string): boolean {
  const settingsPath = path.join(rootPath, '.claude', 'settings.json');
  if (!fileExists(settingsPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return parsed.enabledPlugins && Object.keys(parsed.enabledPlugins).length > 0;
  } catch { return false; }
}

function checkHasCursorIgnore(rootPath: string): boolean {
  return fileExists(path.join(rootPath, '.cursorignore'));
}

function checkHasEditorConfig(rootPath: string): boolean {
  return fileExists(path.join(rootPath, '.editorconfig'));
}

function checkHasContributing(rootPath: string): boolean {
  // Check common locations: root, docs/, .github/
  return (
    fileExists(path.join(rootPath, 'CONTRIBUTING.md')) ||
    fileExists(path.join(rootPath, 'docs', 'CONTRIBUTING.md')) ||
    fileExists(path.join(rootPath, '.github', 'CONTRIBUTING.md'))
  );
}

function checkHasArchitectureMd(rootPath: string): boolean {
  // Standalone ARCHITECTURE.md (distinct from architecture section inside agent files)
  return (
    fileExists(path.join(rootPath, 'ARCHITECTURE.md')) ||
    fileExists(path.join(rootPath, 'docs', 'ARCHITECTURE.md'))
  );
}

interface ReadmeQuality {
  exists: boolean;
  hasSetupSection: boolean;
  hasCodeExamples: boolean;
  isSubstantial: boolean; // > 50 non-empty lines
}

function checkReadmeQuality(rootPath: string): ReadmeQuality {
  const readmePath = path.join(rootPath, 'README.md');
  if (!fileExists(readmePath)) {
    return { exists: false, hasSetupSection: false, hasCodeExamples: false, isSubstantial: false };
  }
  try {
    const content = fs.readFileSync(readmePath, 'utf8');
    const lower = content.toLowerCase();
    return {
      exists: true,
      hasSetupSection:
        /##?\s*(setup|install|getting\s*started|quick\s*start|usage)/im.test(content),
      hasCodeExamples:
        /```/.test(content),
      isSubstantial:
        countNonEmpty(content) > 50,
    };
  } catch {
    return { exists: false, hasSetupSection: false, hasCodeExamples: false, isSubstantial: false };
  }
}

// ── Content Quality Analysis ────────────────────────────────────────────────

/**
 * Check if any agent file defines a persona/role for the AI.
 * GitHub 2,500-repo analysis: specific personas beat generic helpers.
 */
function checkHasPersona(allContent: string): boolean {
  return (
    /\b(you are|act as|your role|you['']re a|as a .+ (engineer|developer|assistant))/i.test(allContent) ||
    /##?\s*(role|persona|identity|who you are)/im.test(allContent)
  );
}

/**
 * Check if agent files contain code examples (``` blocks).
 * GitHub: "One real code snippet showing your style beats three paragraphs describing it."
 */
function checkHasCodeExamplesInAgentFiles(allContents: Map<string, string>, agentTypes: Set<string>): boolean {
  for (const [absPath, content] of allContents) {
    // Only check agent instruction files, not README etc.
    if (agentTypes.has(absPath) && /```[\s\S]*?```/.test(content)) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate total estimated tokens across all agent instruction files.
 * ETH Zurich: context files add 19-23% inference cost regardless of quality.
 * Chroma Context Rot: performance degrades non-uniformly with longer input.
 */
function calculateTotalAgentTokens(scannedFiles: ScannedFile[]): number {
  return scannedFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);
}

// ── Main Scanner ────────────────────────────────────────────────────────────

export interface ScanInput {
  rootDir: string;
  files: Array<{ absPath: string; relativePath: string; type: AgentFileType }>;
  /** Whether an API key is configured (for deep analysis indicator) */
  hasApiKey?: boolean;
}

/**
 * Core readiness scanning — no vscode dependency.
 * Takes pre-resolved file list and returns a complete report.
 */
export function scanReadiness(input: ScanInput): ReadinessReport {
  const { rootDir, files: inputFiles, hasApiKey = false } = input;

  const scannedFiles: ScannedFile[] = [];
  const fileIssueMap: FileIssues[] = [];
  const allContents = new Map<string, string>();

  for (const f of inputFiles) {
    try {
      const content = fs.readFileSync(f.absPath, 'utf8');
      allContents.set(f.absPath, content);
      const issues = runLocalRules(content, f.type);
      const lineCount = content.split('\n').length;
      const charCount = content.length;
      const estimatedTokens = Math.ceil(charCount / 4);

      const scannedFile: ScannedFile = {
        path: f.absPath,
        relativePath: f.relativePath,
        type: f.type,
        lineCount,
        nonEmptyLineCount: countNonEmpty(content),
        charCount,
        estimatedTokens,
        issueCount: issues.length,
        errorCount: issues.filter((i) => i.severity === 'error').length,
        warningCount: issues.filter((i) => i.severity === 'warning').length,
        infoCount: issues.filter((i) => i.severity === 'info').length,
      };

      scannedFiles.push(scannedFile);
      fileIssueMap.push({ file: scannedFile, issues });
    } catch {
      // Skip unreadable files
    }
  }

  // Detect sections across ALL files (not just CLAUDE.md)
  const allSectionCoverages: SectionCoverage[] = [];
  for (const [, content] of allContents) {
    allSectionCoverages.push(detectSections(content));
  }
  const sections = mergeSections(allSectionCoverages);

  // Check for specific content patterns across all files
  const allContent = Array.from(allContents.values()).join('\n');
  const hasRfc2119 = /\b(MUST|MUST NOT|SHALL|SHALL NOT|NEVER|ALWAYS)\b/.test(allContent);
  const hasPathScoping = scannedFiles.some((f) => f.type === 'claude-rules');
  const hasSkills = scannedFiles.some((f) => f.type === 'skill-md');
  const hasLocalMd = scannedFiles.some((f) => f.type === 'claude-local-md');
  const hasGitignoreLocal = checkGitignoreHasLocal(rootDir);
  const hasClaudeDir = fs.existsSync(path.join(rootDir, '.claude'));
  const hasHooksConfig = checkHasHooks(rootDir);
  const hasMcpConfig = checkHasMcp(rootDir);
  const hasSubagents = fs.existsSync(path.join(rootDir, '.claude', 'agents'));
  const hasCommands = fs.existsSync(path.join(rootDir, '.claude', 'commands'));
  const hasPlugins = checkHasPlugins(rootDir);
  const hasCursorIgnore = checkHasCursorIgnore(rootDir);
  const hasEditorConfig = checkHasEditorConfig(rootDir);
  const hasContributing = checkHasContributing(rootDir);
  const hasArchitectureMd = checkHasArchitectureMd(rootDir);
  const readmeQuality = checkReadmeQuality(rootDir);

  // Content quality analysis across all agent files
  const hasPersona = checkHasPersona(allContent);
  const agentFilePaths = new Set(inputFiles.map((f) => f.absPath));
  const hasCodeExamplesInAgentFiles = checkHasCodeExamplesInAgentFiles(allContents, agentFilePaths);
  const totalAgentTokens = calculateTotalAgentTokens(scannedFiles);
  const isConciseContext = totalAgentTokens > 0 && totalAgentTokens <= 8000;

  // Primary CLAUDE.md (for signals that specifically track it)
  const primaryClaudeMd = scannedFiles.find(
    (f) => f.type === 'claude-md' && (f.relativePath === 'CLAUDE.md' || f.relativePath === '.claude/CLAUDE.md')
  );

  // Build signals — now includes Cursor/Copilot signals
  const hasCursorRules = scannedFiles.some((f) => f.type === 'cursorrules');
  const hasCursorScopedRules = scannedFiles.some(
    (f) => f.type === 'cursorrules' && f.relativePath.includes('.cursor/rules/')
  );
  const hasCopilotInstructions = scannedFiles.some((f) => f.type === 'copilot-instructions');

  // Count how many AI tools are configured
  const toolsConfigured = [
    primaryClaudeMd || hasClaudeDir,
    hasCursorRules,
    hasCopilotInstructions,
  ].filter(Boolean).length;

  const signals: ReadinessSignal[] = [
    // Core signals (tool-agnostic)
    { name: 'CLAUDE.md exists', found: !!primaryClaudeMd, points: 15, description: 'Foundation of AI-assisted development (Anthropic, HumanLayer, GitHub)' },
    { name: 'Project context', found: sections.hasProjectContext, points: 5, description: 'Brief one-liner orientation — what the AI cannot discover from code alone' },
    { name: 'Build/test commands', found: sections.hasCommands, points: 15, description: '#1 most valuable content (GitHub 2,500-repo analysis, ETH Zurich: 1.6x adoption)' },
    { name: 'Negative constraints', found: sections.hasConstraints, points: 10, description: '#2 most effective instruction type (GitHub: "never commit secrets" top constraint)' },
    { name: 'Architecture overview', found: sections.hasArchitecture, points: 3, description: 'Directory structure guide (ETH Zurich: minimal navigation help for agents)' },
    { name: 'Gotchas documented', found: sections.hasGotchas, points: 10, description: 'Non-obvious behaviors the AI cannot discover by reading code' },
    { name: 'Verification instructions', found: sections.hasVerification, points: 8, description: 'Boris Cherny: 2-3x quality improvement via feedback loops' },
    { name: 'RFC 2119 language', found: hasRfc2119, points: 5, description: 'Imperative MUST/NEVER/ALWAYS — reduces hedging skip rate' },
    { name: 'Agent persona defined', found: hasPersona, points: 3, description: 'GitHub: specific personas beat generic helpers across 2,500 repos' },
    { name: 'Code examples in instructions', found: hasCodeExamplesInAgentFiles, points: 4, description: 'GitHub: "one real snippet beats three paragraphs describing your style"' },

    // Claude-specific
    { name: 'Path-scoped rules', found: hasPathScoping, points: 7, description: '.claude/rules/ with glob patterns (top-tier per GitHub analysis)' },
    { name: 'Agent Skills (SKILL.md)', found: hasSkills, points: 5, description: 'Progressive disclosure — metadata ~100 tokens, body on-demand (Anthropic)' },
    { name: 'CLAUDE.local.md', found: hasLocalMd, points: 3, description: 'Personal per-project overrides' },
    { name: '.claude/ directory', found: hasClaudeDir, points: 2, description: 'Claude configuration directory' },
    { name: 'Hooks configured', found: hasHooksConfig, points: 6, description: 'Deterministic automation — zero tokens, zero cost (Anthropic best practice)' },
    { name: 'MCP servers', found: hasMcpConfig, points: 3, description: 'External tool integration' },
    { name: 'Subagents', found: hasSubagents, points: 3, description: 'Specialized agent definitions' },
    { name: 'Slash commands', found: hasCommands, points: 2, description: 'Custom workflow commands' },
    { name: 'Plugins', found: hasPlugins, points: 2, description: 'Plugin ecosystem integration' },
    { name: '.gitignore includes local', found: hasGitignoreLocal, points: 2, description: 'CLAUDE.local.md gitignored' },

    // Cursor/Copilot signals
    { name: '.cursorrules exists', found: hasCursorRules, points: 5, description: 'Cursor project configuration' },
    { name: '.cursor/rules/ scoped', found: hasCursorScopedRules, points: 5, description: 'Cursor path-scoped rules' },
    { name: 'copilot-instructions.md', found: hasCopilotInstructions, points: 3, description: 'GitHub Copilot setup' },
    { name: 'Multi-tool coverage', found: toolsConfigured >= 2, points: 5, description: 'Configured for 2+ AI tools' },

    // Repository health signals
    { name: '.cursorignore configured', found: hasCursorIgnore, points: 3, description: 'Controls what Cursor indexes' },
    { name: '.editorconfig present', found: hasEditorConfig, points: 2, description: 'Consistent formatting standards for AI-generated code' },
    { name: 'CONTRIBUTING.md exists', found: hasContributing, points: 2, description: 'Contribution guidelines (social/process context for agents)' },
    { name: 'ARCHITECTURE.md standalone', found: hasArchitectureMd, points: 3, description: 'Dedicated architecture docs beyond agent files' },
    { name: 'README has setup instructions', found: readmeQuality.hasSetupSection, points: 3, description: 'Setup/install section helps AI onboard' },
    { name: 'README has code examples', found: readmeQuality.hasCodeExamples, points: 2, description: 'Code examples teach AI project conventions' },
    { name: 'README is substantial', found: readmeQuality.isSubstantial, points: 2, description: 'Well-documented project (>50 lines)' },

    // Quality & cost efficiency
    { name: 'Under 200 lines', found: primaryClaudeMd ? primaryClaudeMd.nonEmptyLineCount <= 200 : false, points: 5, description: 'HumanLayer: LLMs follow ~150-200 instructions consistently, linear decay after' },
    { name: 'Concise context (≤8k tokens)', found: isConciseContext, points: 4, description: 'ETH Zurich: context files add 19-23% cost — less is more' },
  ];

  const bonusPoints = Math.min(100, signals.reduce((sum, s) => sum + (s.found ? s.points : 0), 0));
  const penalties = computePenalties(fileIssueMap);

  // Context bloat penalty — repo-wide metric, not per-issue
  if (totalAgentTokens > 12000) {
    const catalog = PENALTY_CATALOG.CONTEXT_BLOAT;
    penalties.push({
      code: 'CONTEXT_BLOAT',
      label: catalog.label,
      points: Math.min(catalog.perOccurrence, Math.floor((totalAgentTokens - 12000) / 2000) + 4),
      count: 1,
      severity: catalog.severity,
      affectedFiles: scannedFiles.map((f) => f.relativePath),
      reason: catalog.reason,
      detail: catalog.detail + ` Current total: ~${totalAgentTokens.toLocaleString()} tokens across ${scannedFiles.length} files.`,
    });
  }

  const penaltyPoints = penalties.reduce((sum, p) => sum + p.points, 0);
  const score = Math.max(0, Math.min(100, bonusPoints - penaltyPoints));

  const maturity = detectMaturityLevel({
    files: scannedFiles,
    sections,
    hasRfc2119,
    hasPathScoping,
    hasSkills,
  });

  const roadmap = generateRoadmap(signals, sections, scannedFiles, maturity.level, penalties, { hasCursorRules });

  // AI Tool Fit
  const toolFit = analyzeToolFit(scannedFiles, {
    hasClaudeDir,
    hasHooksConfig,
    hasMcpConfig,
    hasSubagents,
    hasCommands,
    hasPlugins,
    hasCursorIgnore,
  });

  // Cost calculation
  const cost = calculateTokenCost(scannedFiles);
  const savings = estimateSavings(fileIssueMap, cost);

  const totalIssues = scannedFiles.reduce((sum, f) => sum + f.issueCount, 0);
  const totalErrors = scannedFiles.reduce((sum, f) => sum + f.errorCount, 0);

  return {
    score,
    bonusPoints,
    penaltyPoints,
    maturity,
    files: scannedFiles,
    sections,
    signals,
    penalties,
    roadmap,
    toolFit,
    cost,
    savings,
    stats: {
      totalFiles: scannedFiles.length,
      totalLines: scannedFiles.reduce((sum, f) => sum + f.lineCount, 0),
      totalIssues,
      totalErrors,
      totalCharacters: scannedFiles.reduce((sum, f) => sum + f.charCount, 0),
      totalEstimatedTokens: scannedFiles.reduce((sum, f) => sum + f.estimatedTokens, 0),
      hasApiKey,
      hasGitignoreLocal,
    },
  };
}
