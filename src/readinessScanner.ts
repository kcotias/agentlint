import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runLocalRules } from './localRules';
import { AgentFileType } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScannedFile {
  path: string;
  relativePath: string;
  type: AgentFileType;
  lineCount: number;
  nonEmptyLineCount: number;
  /** Character count of file content */
  charCount: number;
  /** Estimated token count (~4 chars/token for English) */
  estimatedTokens: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface SectionCoverage {
  hasProjectContext: boolean;
  hasCommands: boolean;
  hasArchitecture: boolean;
  hasCodeStyle: boolean;
  hasConstraints: boolean;
  hasGotchas: boolean;
  hasVerification: boolean;
}

export type MaturityLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ReadinessReport {
  /** 0-100 overall score */
  score: number;
  /** Raw bonus points before penalties */
  bonusPoints: number;
  /** Total penalty points deducted */
  penaltyPoints: number;
  /** L0-L6 maturity level */
  maturityLevel: MaturityLevel;
  maturityLabel: string;
  /** Files found */
  files: ScannedFile[];
  /** Section coverage for primary CLAUDE.md */
  sections: SectionCoverage;
  /** Signals detected */
  signals: ReadinessSignal[];
  /** Penalties applied for bad practices */
  penalties: ReadinessPenalty[];
  /** Actionable next steps, ordered by impact */
  roadmap: RoadmapStep[];
  /** Aggregate stats */
  stats: {
    totalFiles: number;
    totalLines: number;
    totalIssues: number;
    totalErrors: number;
    totalCharacters: number;
    totalEstimatedTokens: number;
    hasApiKey: boolean;
    hasGitignoreLocal: boolean;
  };
}

export interface ReadinessSignal {
  name: string;
  found: boolean;
  points: number;
  description: string;
}

export interface ReadinessPenalty {
  /** Penalty rule code (maps to localRules codes) */
  code: string;
  /** Human-readable label */
  label: string;
  /** Points deducted */
  points: number;
  /** How many times this issue was found */
  count: number;
  /** Severity of the underlying issue */
  severity: 'error' | 'warning' | 'info';
  /** Which files are affected */
  affectedFiles: string[];
  /** Why this hurts your score */
  reason: string;
}

export interface RoadmapStep {
  priority: number;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  currentState: string;
  targetState: string;
}

// ── Scanner ──────────────────────────────────────────────────────────────────

const FILE_PATTERNS: Array<{ glob: string; type: AgentFileType; label: string }> = [
  { glob: '**/CLAUDE.md', type: 'claude-md', label: 'CLAUDE.md' },
  { glob: '**/.claude/CLAUDE.md', type: 'claude-md', label: '.claude/CLAUDE.md' },
  { glob: '**/CLAUDE.local.md', type: 'claude-local-md', label: 'CLAUDE.local.md' },
  { glob: '**/.claude/rules/*.md', type: 'claude-rules', label: '.claude/rules/' },
  { glob: '**/SKILL.md', type: 'skill-md', label: 'SKILL.md' },
  { glob: '**/AGENTS.md', type: 'agents-md', label: 'AGENTS.md' },
  { glob: '**/.cursorrules', type: 'cursorrules', label: '.cursorrules' },
  { glob: '**/.cursor/rules/*.mdc', type: 'cursorrules', label: '.cursor/rules/' },
  { glob: '**/.github/copilot-instructions.md', type: 'copilot-instructions', label: 'copilot-instructions.md' },
];

function countNonEmpty(content: string): number {
  return content.split('\n').filter((l) => l.trim().length > 0).length;
}

function detectSections(content: string): SectionCoverage {
  const lower = content.toLowerCase();
  return {
    hasProjectContext:
      /^#\s+\w+/m.test(content) &&
      (content.split('\n').slice(0, 5).some((l) => l.trim().length > 20 && !/^#/.test(l.trim()))),
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

function detectMaturityLevel(report: {
  files: ScannedFile[];
  sections: SectionCoverage;
  hasRfc2119: boolean;
  hasPathScoping: boolean;
  hasSkills: boolean;
}): { level: MaturityLevel; label: string } {
  const { files, sections, hasRfc2119, hasPathScoping, hasSkills } = report;

  const claudeMdFiles = files.filter((f) => f.type === 'claude-md' || f.type === 'claude-local-md');

  // L0: No files at all
  if (files.length === 0) return { level: 0, label: 'Absent' };

  // L6: Adaptive — has skills or dynamic loading mechanisms
  if (hasSkills && hasPathScoping && hasRfc2119) return { level: 6, label: 'Adaptive' };

  // L5: Maintained — L4 + evidence of staleness tracking
  // (Hard to detect automatically, so we approximate with multiple signals)
  if (hasPathScoping && hasRfc2119 && files.length >= 3 && Object.values(sections).filter(Boolean).length >= 5) {
    return { level: 5, label: 'Maintained' };
  }

  // L4: Abstracted — path-scoped rules
  if (hasPathScoping) return { level: 4, label: 'Abstracted' };

  // L3: Structured — multiple files split by concern
  if (files.length >= 2 && Object.values(sections).filter(Boolean).length >= 3) {
    return { level: 3, label: 'Structured' };
  }

  // L2: Scoped — uses RFC 2119 language
  if (hasRfc2119) return { level: 2, label: 'Scoped' };

  // L1: Basic — file exists
  return { level: 1, label: 'Basic' };
}

// ── Penalty Computation ─────────────────────────────────────────────────────

/**
 * Penalty weights by issue code.
 * Higher = worse. Errors penalize more than warnings, warnings more than info.
 */
const PENALTY_CATALOG: Record<
  string,
  { label: string; perOccurrence: number; severity: 'error' | 'warning' | 'info'; reason: string }
> = {
  // Errors — heavy penalties (these actively harm your AI workflow)
  SENSITIVE_DATA: {
    label: 'Sensitive data exposed',
    perOccurrence: 8,
    severity: 'error',
    reason: 'Secrets in agent files risk leaking credentials through AI-generated code or commits',
  },
  SKILL_MISSING_FRONTMATTER: {
    label: 'Skill missing frontmatter',
    perOccurrence: 5,
    severity: 'error',
    reason: 'Skill won\'t be discoverable by the agent without required name/description frontmatter',
  },
  SKILL_MISSING_NAME: {
    label: 'Skill missing name',
    perOccurrence: 4,
    severity: 'error',
    reason: 'Agent cannot register or invoke the skill without a valid name',
  },
  SKILL_MISSING_DESCRIPTION: {
    label: 'Skill missing description',
    perOccurrence: 4,
    severity: 'error',
    reason: 'Agent cannot match tasks to the skill without a description',
  },
  SKILL_INVALID_NAME: {
    label: 'Skill invalid name format',
    perOccurrence: 3,
    severity: 'error',
    reason: 'Invalid skill name will cause registration failures',
  },

  // Warnings — moderate penalties (these degrade instruction quality)
  FILE_TOO_LONG: {
    label: 'File exceeds recommended length',
    perOccurrence: 6,
    severity: 'warning',
    reason: 'Instruction adherence degrades uniformly beyond 200 lines — the agent ignores more of your rules',
  },
  HEDGING_LANGUAGE: {
    label: 'Hedging language used',
    perOccurrence: 2,
    severity: 'warning',
    reason: '"Try to" and "consider" are treated as optional — the agent will skip these instructions',
  },
  VAGUE_INSTRUCTION: {
    label: 'Vague/redundant instruction',
    perOccurrence: 2,
    severity: 'warning',
    reason: 'Wastes token budget on instructions the agent already follows by default',
  },
  MISSING_COMMANDS: {
    label: 'No build/test commands',
    perOccurrence: 5,
    severity: 'warning',
    reason: 'The #1 most valuable content is missing — agent will guess wrong build/test commands',
  },
  SKILL_DESCRIPTION_TOO_LONG: {
    label: 'Skill description too long',
    perOccurrence: 2,
    severity: 'warning',
    reason: 'Bloated description wastes tokens during skill matching for every agent turn',
  },
  SKILL_WEAK_DESCRIPTION: {
    label: 'Skill description too brief',
    perOccurrence: 3,
    severity: 'warning',
    reason: 'Agent won\'t reliably match tasks to this skill without descriptive keywords',
  },
  SKILL_TOKEN_BUDGET: {
    label: 'Skill exceeds token budget',
    perOccurrence: 4,
    severity: 'warning',
    reason: 'Skill body loads entirely on activation — exceeding 5000 tokens wastes context window',
  },

  // Info — light penalties (style issues that add up)
  PROSE_PARAGRAPH: {
    label: 'Dense prose blocks',
    perOccurrence: 1,
    severity: 'info',
    reason: 'LLMs follow structured bullet points more reliably than dense paragraphs',
  },
  DISCOVERABLE_INFO: {
    label: 'Auto-discoverable information',
    perOccurrence: 1,
    severity: 'info',
    reason: 'File-by-file descriptions waste token budget — Claude reads your code directly',
  },
  MISSING_NEGATIVE_CONSTRAINTS: {
    label: 'No negative constraints',
    perOccurrence: 2,
    severity: 'info',
    reason: '#2 most effective instruction type is missing — agent won\'t know your prohibitions',
  },
};

interface FileIssues {
  file: ScannedFile;
  issues: import('./types').PromptIssue[];
}

function computePenalties(fileIssueMap: FileIssues[]): ReadinessPenalty[] {
  // Aggregate issues across all files by code
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
    if (!catalog) continue; // Unknown issue code, no penalty

    // Cap per-category penalty to prevent one category from nuking the score
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
    });
  }

  // Sort by points descending (worst offenders first)
  penalties.sort((a, b) => b.points - a.points);

  return penalties;
}

export async function scanWorkspace(): Promise<ReadinessReport> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return emptyReport();
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const files: ScannedFile[] = [];
  const fileIssueMap: FileIssues[] = [];

  // Scan for all agent files
  for (const pattern of FILE_PATTERNS) {
    const uris = await vscode.workspace.findFiles(pattern.glob, '**/node_modules/**', 50);
    for (const uri of uris) {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const issues = runLocalRules(content, pattern.type);
        const lineCount = content.split('\n').length;

        const charCount = content.length;
        const estimatedTokens = Math.ceil(charCount / 4);

        const scannedFile: ScannedFile = {
          path: uri.fsPath,
          relativePath: path.relative(rootPath, uri.fsPath),
          type: pattern.type,
          lineCount,
          nonEmptyLineCount: countNonEmpty(content),
          charCount,
          estimatedTokens,
          issueCount: issues.length,
          errorCount: issues.filter((i) => i.severity === 'error').length,
          warningCount: issues.filter((i) => i.severity === 'warning').length,
          infoCount: issues.filter((i) => i.severity === 'info').length,
        };

        files.push(scannedFile);
        fileIssueMap.push({ file: scannedFile, issues });
      } catch {
        // File couldn't be read, skip
      }
    }
  }

  // Analyze primary CLAUDE.md
  const primaryClaudeMd = files.find(
    (f) => f.type === 'claude-md' && (f.relativePath === 'CLAUDE.md' || f.relativePath === '.claude/CLAUDE.md')
  );

  let primaryContent = '';
  let sections: SectionCoverage = {
    hasProjectContext: false,
    hasCommands: false,
    hasArchitecture: false,
    hasCodeStyle: false,
    hasConstraints: false,
    hasGotchas: false,
    hasVerification: false,
  };

  if (primaryClaudeMd) {
    try {
      primaryContent = fs.readFileSync(primaryClaudeMd.path, 'utf8');
      sections = detectSections(primaryContent);
    } catch {
      // ignore
    }
  }

  // Detect signals
  const hasRfc2119 = /\b(MUST|MUST NOT|SHALL|SHALL NOT|NEVER|ALWAYS)\b/.test(primaryContent);
  const hasPathScoping = files.some((f) => f.type === 'claude-rules');
  const hasSkills = files.some((f) => f.type === 'skill-md');
  const hasLocalMd = files.some((f) => f.type === 'claude-local-md');
  const hasGitignoreLocal = checkGitignoreHasLocal(rootPath);
  const hasClaudeDir = fs.existsSync(path.join(rootPath, '.claude'));
  const hasHooksConfig = checkHasHooks(rootPath);
  const hasMcpConfig = checkHasMcp(rootPath);
  const hasSubagents = fs.existsSync(path.join(rootPath, '.claude', 'agents'));
  const hasCommands = fs.existsSync(path.join(rootPath, '.claude', 'commands'));
  const hasPlugins = checkHasPlugins(rootPath);

  // Check API key
  const config = vscode.workspace.getConfiguration('agentlint');
  const configKey = config.get<string>('anthropicApiKey');
  const hasApiKey = Boolean((configKey && configKey.length > 0) || process.env.ANTHROPIC_API_KEY);

  // Build signals list
  const signals: ReadinessSignal[] = [
    { name: 'CLAUDE.md exists', found: !!primaryClaudeMd, points: 15, description: 'Primary agent configuration file' },
    { name: 'Project context', found: sections.hasProjectContext, points: 5, description: 'One-liner project orientation' },
    { name: 'Build/test commands', found: sections.hasCommands, points: 15, description: '#1 most valuable content' },
    { name: 'Negative constraints', found: sections.hasConstraints, points: 10, description: 'NEVER/MUST NOT rules' },
    { name: 'Architecture overview', found: sections.hasArchitecture, points: 5, description: 'Directory structure guide' },
    { name: 'Gotchas documented', found: sections.hasGotchas, points: 8, description: 'Non-obvious behaviors' },
    { name: 'Verification instructions', found: sections.hasVerification, points: 8, description: '2-3x quality improvement' },
    { name: 'RFC 2119 language', found: hasRfc2119, points: 5, description: 'MUST/NEVER/ALWAYS keywords' },
    { name: 'Path-scoped rules', found: hasPathScoping, points: 7, description: '.claude/rules/ with glob patterns' },
    { name: 'Agent Skills (SKILL.md)', found: hasSkills, points: 5, description: 'On-demand specialized instructions' },
    { name: 'CLAUDE.local.md', found: hasLocalMd, points: 3, description: 'Personal per-project overrides' },
    { name: '.claude/ directory', found: hasClaudeDir, points: 2, description: 'Claude configuration directory' },
    { name: 'Hooks configured', found: hasHooksConfig, points: 4, description: 'Deterministic automation (free)' },
    { name: 'MCP servers', found: hasMcpConfig, points: 3, description: 'External tool integration' },
    { name: 'Subagents', found: hasSubagents, points: 3, description: 'Specialized agent definitions' },
    { name: 'Slash commands', found: hasCommands, points: 2, description: 'Custom workflow commands' },
    { name: 'Plugins', found: hasPlugins, points: 2, description: 'Plugin ecosystem integration' },
    { name: '.gitignore includes local', found: hasGitignoreLocal, points: 2, description: 'CLAUDE.local.md gitignored' },
    { name: 'Under 200 lines', found: primaryClaudeMd ? primaryClaudeMd.nonEmptyLineCount <= 200 : false, points: 5, description: 'Anthropic recommended max' },
  ];

  const bonusPoints = Math.min(100, signals.reduce((sum, s) => sum + (s.found ? s.points : 0), 0));

  // Compute penalties from lint issues found across all files
  const penalties = computePenalties(fileIssueMap);
  const penaltyPoints = penalties.reduce((sum, p) => sum + p.points, 0);

  // Final score: bonus - penalties, clamped to 0-100
  const score = Math.max(0, Math.min(100, bonusPoints - penaltyPoints));

  const { level: maturityLevel, label: maturityLabel } = detectMaturityLevel({
    files,
    sections,
    hasRfc2119,
    hasPathScoping,
    hasSkills,
  });

  // Generate roadmap (now penalty-aware)
  const roadmap = generateRoadmap(signals, sections, files, maturityLevel, penalties);

  const totalIssues = files.reduce((sum, f) => sum + f.issueCount, 0);
  const totalErrors = files.reduce((sum, f) => sum + f.errorCount, 0);

  return {
    score,
    bonusPoints,
    penaltyPoints,
    maturityLevel,
    maturityLabel,
    files,
    sections,
    signals,
    penalties,
    roadmap,
    stats: {
      totalFiles: files.length,
      totalLines: files.reduce((sum, f) => sum + f.lineCount, 0),
      totalIssues,
      totalErrors,
      totalCharacters: files.reduce((sum, f) => sum + f.charCount, 0),
      totalEstimatedTokens: files.reduce((sum, f) => sum + f.estimatedTokens, 0),
      hasApiKey,
      hasGitignoreLocal,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function checkGitignoreHasLocal(rootPath: string): boolean {
  const gitignorePath = path.join(rootPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const content = fs.readFileSync(gitignorePath, 'utf8');
  return /CLAUDE\.local\.md/i.test(content);
}

function checkHasHooks(rootPath: string): boolean {
  const settingsPath = path.join(rootPath, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return false;
  try {
    const content = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.hooks && Object.keys(parsed.hooks).length > 0;
  } catch {
    return false;
  }
}

function checkHasMcp(rootPath: string): boolean {
  return (
    fs.existsSync(path.join(rootPath, '.mcp.json')) ||
    fs.existsSync(path.join(rootPath, '.claude', 'mcp.json'))
  );
}

function checkHasPlugins(rootPath: string): boolean {
  const settingsPath = path.join(rootPath, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) return false;
  try {
    const content = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.enabledPlugins && Object.keys(parsed.enabledPlugins).length > 0;
  } catch {
    return false;
  }
}

function emptyReport(): ReadinessReport {
  return {
    score: 0,
    bonusPoints: 0,
    penaltyPoints: 0,
    maturityLevel: 0,
    maturityLabel: 'Absent',
    files: [],
    sections: {
      hasProjectContext: false,
      hasCommands: false,
      hasArchitecture: false,
      hasCodeStyle: false,
      hasConstraints: false,
      hasGotchas: false,
      hasVerification: false,
    },
    signals: [],
    penalties: [],
    roadmap: [
      {
        priority: 1,
        title: 'Create CLAUDE.md',
        description: 'Run "AgentLint: Create CLAUDE.md from Template" to get started with a best-practices skeleton.',
        impact: 'high',
        effort: 'low',
        currentState: 'No agent configuration files found',
        targetState: 'L1 Basic — CLAUDE.md with commands and constraints',
      },
    ],
    stats: {
      totalFiles: 0,
      totalLines: 0,
      totalIssues: 0,
      totalErrors: 0,
      totalCharacters: 0,
      totalEstimatedTokens: 0,
      hasApiKey: false,
      hasGitignoreLocal: false,
    },
  };
}

// ── Roadmap Generator ────────────────────────────────────────────────────────

function generateRoadmap(
  signals: ReadinessSignal[],
  sections: SectionCoverage,
  files: ScannedFile[],
  maturityLevel: MaturityLevel,
  penalties: ReadinessPenalty[] = []
): RoadmapStep[] {
  const steps: RoadmapStep[] = [];
  let priority = 0;

  const missing = (name: string) => !signals.find((s) => s.name === name)?.found;

  // ── Tier 0: Fix critical issues FIRST (penalties) ─────────────────────────
  // Error-severity penalties are the highest priority — they actively harm your workflow
  const errorPenalties = penalties.filter((p) => p.severity === 'error');
  const warningPenalties = penalties.filter((p) => p.severity === 'warning');

  if (errorPenalties.length > 0) {
    const totalErrorPts = errorPenalties.reduce((sum, p) => sum + p.points, 0);
    steps.push({
      priority: ++priority,
      title: '🚨 Fix critical issues',
      description:
        `${errorPenalties.length} critical issue${errorPenalties.length > 1 ? 's' : ''} found costing you ${totalErrorPts} points:\n` +
        errorPenalties.map((p) => `- **${p.label}** (${p.count}x in ${p.affectedFiles.join(', ')}): ${p.reason}`).join('\n'),
      impact: 'high',
      effort: 'low',
      currentState: `${errorPenalties.reduce((sum, p) => sum + p.count, 0)} critical issues across ${new Set(errorPenalties.flatMap((p) => p.affectedFiles)).size} files`,
      targetState: 'Zero critical issues — no secrets, valid skill metadata',
    });
  }

  // Warning-severity penalties that are quick wins (hedging, vague instructions)
  const quickFixPenalties = warningPenalties.filter((p) =>
    ['HEDGING_LANGUAGE', 'VAGUE_INSTRUCTION'].includes(p.code)
  );
  if (quickFixPenalties.length > 0) {
    const totalQfPts = quickFixPenalties.reduce((sum, p) => sum + p.points, 0);
    steps.push({
      priority: ++priority,
      title: '✏️ Clean up weak instructions',
      description:
        `${quickFixPenalties.reduce((sum, p) => sum + p.count, 0)} weak instruction${quickFixPenalties.reduce((sum, p) => sum + p.count, 0) > 1 ? 's' : ''} costing ${totalQfPts} points. ` +
        'AgentLint offers quick-fixes (💡) for most of these — look for the lightbulb in VS Code.\n' +
        quickFixPenalties.map((p) => `- **${p.label}** (${p.count}x): ${p.reason}`).join('\n'),
      impact: 'medium',
      effort: 'low',
      currentState: `${quickFixPenalties.reduce((sum, p) => sum + p.count, 0)} hedging/vague instructions`,
      targetState: 'All instructions use imperative RFC 2119 language',
    });
  }

  // Bloat penalties (FILE_TOO_LONG, SKILL_TOKEN_BUDGET)
  const bloatPenalties = warningPenalties.filter((p) =>
    ['FILE_TOO_LONG', 'SKILL_TOKEN_BUDGET'].includes(p.code)
  );
  if (bloatPenalties.length > 0) {
    const totalBloatPts = bloatPenalties.reduce((sum, p) => sum + p.points, 0);
    steps.push({
      priority: ++priority,
      title: '📏 Reduce file bloat',
      description:
        `Oversized files are costing ${totalBloatPts} points. ` +
        'Instruction adherence degrades uniformly beyond recommended limits.\n' +
        bloatPenalties.map((p) => `- **${p.label}** in ${p.affectedFiles.join(', ')}: ${p.reason}`).join('\n'),
      impact: 'high',
      effort: 'medium',
      currentState: bloatPenalties.map((p) => `${p.affectedFiles.join(', ')} exceeds limit`).join('; '),
      targetState: 'CLAUDE.md <200 lines, Skills <5000 tokens — use .claude/rules/ for overflow',
    });
  }

  // Tier 1: Essentials (high impact, low effort)
  if (missing('CLAUDE.md exists')) {
    steps.push({
      priority: ++priority,
      title: 'Create CLAUDE.md',
      description:
        'Run "AgentLint: Create CLAUDE.md from Template" command. This is the foundation of AI-assisted development.',
      impact: 'high',
      effort: 'low',
      currentState: 'No CLAUDE.md found',
      targetState: 'CLAUDE.md with best-practices skeleton',
    });
  }

  if (missing('Build/test commands')) {
    steps.push({
      priority: ++priority,
      title: 'Add build/test/lint commands',
      description:
        'The #1 most valuable content. Add exact copy-paste commands with flags. Claude should never have to guess how to build or test.',
      impact: 'high',
      effort: 'low',
      currentState: 'No commands found in agent files',
      targetState: '## Commands section with build, test, lint, dev commands',
    });
  }

  if (missing('Negative constraints')) {
    steps.push({
      priority: ++priority,
      title: 'Add NEVER/MUST NOT constraints',
      description:
        'The #2 most effective instruction type. Add explicit rules about what the agent must not do.',
      impact: 'high',
      effort: 'low',
      currentState: 'No negative constraints found',
      targetState: '## Constraints section with NEVER, MUST NOT, DO NOT rules',
    });
  }

  if (missing('Verification instructions')) {
    steps.push({
      priority: ++priority,
      title: 'Add verification instructions',
      description:
        'Tell Claude how to check its own work. Boris Cherny (Claude Code creator) says this gives "2-3x quality improvement".',
      impact: 'high',
      effort: 'low',
      currentState: 'No verification steps found',
      targetState: '"After changes, run npm test" or "Check types with tsc --noEmit"',
    });
  }

  // Tier 2: Optimization (medium impact)
  if (missing('RFC 2119 language')) {
    steps.push({
      priority: ++priority,
      title: 'Use imperative RFC 2119 language',
      description:
        'Replace hedging ("try to", "consider") with MUST, MUST NOT, NEVER, ALWAYS. LLMs follow these more reliably.',
      impact: 'medium',
      effort: 'low',
      currentState: 'No RFC 2119 keywords detected',
      targetState: 'Instructions use MUST/NEVER/ALWAYS consistently',
    });
  }

  if (missing('Gotchas documented')) {
    steps.push({
      priority: ++priority,
      title: 'Document project gotchas',
      description:
        'Non-obvious behaviors that cause bugs if the agent doesn\'t know about them. Integration quirks, critical files, etc.',
      impact: 'medium',
      effort: 'medium',
      currentState: 'No gotchas section found',
      targetState: '## Gotchas with project-specific traps and workarounds',
    });
  }

  if (missing('Under 200 lines') && files.some((f) => f.type === 'claude-md' && f.nonEmptyLineCount > 200)) {
    steps.push({
      priority: ++priority,
      title: 'Trim CLAUDE.md under 200 lines',
      description:
        'Anthropic recommends <200 lines. Beyond this, instruction adherence degrades uniformly. Move specialized content to .claude/rules/ or skills.',
      impact: 'medium',
      effort: 'medium',
      currentState: `CLAUDE.md has ${files.find((f) => f.type === 'claude-md')?.nonEmptyLineCount ?? '?'} non-empty lines`,
      targetState: '<200 lines with specialized content in rules/skills',
    });
  }

  // Tier 3: Advanced (scaling your AI workflow)
  if (missing('Path-scoped rules') && maturityLevel < 4) {
    steps.push({
      priority: ++priority,
      title: 'Add path-scoped rules',
      description:
        'Create .claude/rules/ with glob-targeted rules. Different standards for different areas of your codebase, loaded only when relevant.',
      impact: 'medium',
      effort: 'medium',
      currentState: 'No path-scoped rules',
      targetState: '.claude/rules/ with glob patterns for area-specific rules',
    });
  }

  if (missing('Hooks configured')) {
    steps.push({
      priority: ++priority,
      title: 'Set up hooks for automation',
      description:
        'Hooks are free (no tokens) and deterministic. Auto-format after edits, run linters, filter verbose test output, get desktop notifications.',
      impact: 'medium',
      effort: 'medium',
      currentState: 'No hooks configured',
      targetState: 'PostToolUse hooks for auto-formatting, Notification hooks for alerts',
    });
  }

  if (missing('Agent Skills (SKILL.md)') && maturityLevel >= 3) {
    steps.push({
      priority: ++priority,
      title: 'Create Agent Skills for specialized workflows',
      description:
        'Move specialized instructions from CLAUDE.md to SKILL.md files. Skills load on-demand only when the task matches, saving tokens.',
      impact: 'medium',
      effort: 'high',
      currentState: 'No skills found',
      targetState: 'Specialized workflows as skills (progressive disclosure)',
    });
  }

  if (missing('.gitignore includes local') && !missing('CLAUDE.md exists')) {
    steps.push({
      priority: ++priority,
      title: 'Add CLAUDE.local.md to .gitignore',
      description:
        'CLAUDE.local.md is for personal overrides (API keys, local paths). Make sure it won\'t be committed.',
      impact: 'low',
      effort: 'low',
      currentState: 'CLAUDE.local.md not in .gitignore',
      targetState: '.gitignore includes CLAUDE.local.md',
    });
  }

  if (missing('Slash commands') && maturityLevel >= 3) {
    steps.push({
      priority: ++priority,
      title: 'Create custom slash commands',
      description:
        'Define repeatable workflows in .claude/commands/ for common tasks like code review, refactoring, or deployment.',
      impact: 'low',
      effort: 'medium',
      currentState: 'No custom commands',
      targetState: '.claude/commands/ with team workflow definitions',
    });
  }

  return steps;
}

// ── Report Renderer ──────────────────────────────────────────────────────────

export function renderReportMarkdown(report: ReadinessReport): string {
  const lines: string[] = [];

  // Header
  const scoreEmoji = report.score >= 80 ? '🟢' : report.score >= 50 ? '🟡' : report.score >= 20 ? '🟠' : '🔴';
  lines.push(`# ${scoreEmoji} AI-Readiness Report`);
  lines.push('');
  lines.push(`**Score: ${report.score}/100** | **Maturity: L${report.maturityLevel} ${report.maturityLabel}**`);
  lines.push('');

  // Score breakdown
  if (report.penaltyPoints > 0) {
    lines.push(`> 📊 **Score breakdown:** +${report.bonusPoints} bonus − ${report.penaltyPoints} penalties = **${report.score}**`);
    lines.push('');
  }

  // Maturity level explanation
  lines.push('## Maturity Level');
  lines.push('');
  const levels = [
    { level: 0, name: 'Absent', desc: 'No agent configuration files' },
    { level: 1, name: 'Basic', desc: 'File exists, may need customization' },
    { level: 2, name: 'Scoped', desc: 'Uses RFC 2119 language (MUST/NEVER)' },
    { level: 3, name: 'Structured', desc: 'Multiple files split by concern' },
    { level: 4, name: 'Abstracted', desc: 'Path-scoped rules (.claude/rules/)' },
    { level: 5, name: 'Maintained', desc: 'Comprehensive setup with regular updates' },
    { level: 6, name: 'Adaptive', desc: 'Skills + dynamic loading + full ecosystem' },
  ];

  for (const l of levels) {
    const marker = l.level === report.maturityLevel ? '**>>**' : '  ';
    const check = l.level <= report.maturityLevel ? '~~' : '  ';
    lines.push(
      `${marker} L${l.level} ${l.name} — ${l.desc} ${l.level <= report.maturityLevel ? '✅' : '⬜'}`
    );
  }
  lines.push('');

  // Signals checklist (bonuses)
  lines.push('## ✅ Good Practices (Bonuses)');
  lines.push('');
  lines.push('| Signal | Status | Impact |');
  lines.push('|---|---|---|');
  for (const signal of report.signals) {
    const status = signal.found ? '✅' : '❌';
    const pts = signal.found ? `+${signal.points}` : `+0/${signal.points}`;
    lines.push(`| ${signal.name} | ${status} | ${pts} pts |`);
  }
  const earnedBonus = report.signals.filter((s) => s.found).reduce((sum, s) => sum + s.points, 0);
  const possibleBonus = report.signals.reduce((sum, s) => sum + s.points, 0);
  lines.push(`| **Total** | | **+${earnedBonus}/${possibleBonus} pts** |`);
  lines.push('');

  // Penalties section
  if (report.penalties.length > 0) {
    lines.push('## ⚠️ Bad Practices (Penalties)');
    lines.push('');
    lines.push('These issues are actively hurting your AI-readiness score:');
    lines.push('');
    lines.push('| Issue | Count | Penalty | Severity | Files |');
    lines.push('|---|---|---|---|---|');
    for (const penalty of report.penalties) {
      const sevIcon =
        penalty.severity === 'error' ? '🔴' : penalty.severity === 'warning' ? '🟡' : '🔵';
      lines.push(
        `| ${penalty.label} | ${penalty.count}x | **-${penalty.points} pts** | ${sevIcon} ${penalty.severity} | ${penalty.affectedFiles.join(', ')} |`
      );
    }
    lines.push(`| **Total** | | **-${report.penaltyPoints} pts** | | |`);
    lines.push('');

    // Explain each penalty
    lines.push('### Why these hurt');
    lines.push('');
    for (const penalty of report.penalties) {
      lines.push(`- **${penalty.label}:** ${penalty.reason}`);
    }
    lines.push('');
  }

  // Section coverage (if CLAUDE.md exists)
  if (report.files.some((f) => f.type === 'claude-md')) {
    lines.push('## CLAUDE.md Section Coverage');
    lines.push('');
    const sectionItems = [
      { key: 'hasProjectContext', label: 'Project context (one-liner)', impact: 'Gives agent immediate orientation' },
      { key: 'hasCommands', label: 'Build/test/lint commands', impact: '#1 most valuable content' },
      { key: 'hasArchitecture', label: 'Architecture overview', impact: 'Saves exploration time' },
      { key: 'hasCodeStyle', label: 'Code style rules', impact: 'Only non-linter rules' },
      { key: 'hasConstraints', label: 'Constraints (NEVER/MUST NOT)', impact: '#2 most effective instruction type' },
      { key: 'hasGotchas', label: 'Gotchas & caveats', impact: 'Prevents common mistakes' },
      { key: 'hasVerification', label: 'Verification instructions', impact: '2-3x quality improvement' },
    ];

    for (const item of sectionItems) {
      const found = report.sections[item.key as keyof SectionCoverage];
      lines.push(`- ${found ? '✅' : '❌'} **${item.label}** — ${item.impact}`);
    }
    lines.push('');
  }

  // Token Budget section
  if (report.files.length > 0) {
    const totalTokens = report.stats.totalEstimatedTokens;
    const budgetEmoji = totalTokens <= 2000 ? '🟢' : totalTokens <= 5000 ? '🟡' : totalTokens <= 10000 ? '🟠' : '🔴';

    lines.push('## 📊 Token Budget');
    lines.push('');
    lines.push(`${budgetEmoji} Your agent instruction files use **~${totalTokens.toLocaleString()} tokens** total`);
    lines.push('');

    // Per-file breakdown sorted by token consumption
    const sorted = [...report.files].sort((a, b) => b.estimatedTokens - a.estimatedTokens);
    lines.push('| File | Tokens | % of Total | Lines | Issues |');
    lines.push('|---|---|---|---|---|');
    for (const file of sorted) {
      const pct = totalTokens > 0 ? ((file.estimatedTokens / totalTokens) * 100).toFixed(0) : '0';
      const bar = '█'.repeat(Math.max(1, Math.round(Number(pct) / 5)));
      const issueLabel =
        file.issueCount === 0
          ? '✅'
          : `${file.errorCount}E ${file.warningCount}W ${file.infoCount}I`;
      lines.push(`| ${file.relativePath} | ~${file.estimatedTokens.toLocaleString()} | ${bar} ${pct}% | ${file.nonEmptyLineCount} | ${issueLabel} |`);
    }
    lines.push(`| **Total** | **~${totalTokens.toLocaleString()}** | | **${report.stats.totalLines}** | **${report.stats.totalIssues}** |`);
    lines.push('');

    // Efficiency guidance
    if (totalTokens > 5000) {
      lines.push('> 💡 **Optimization tip:** Your instruction files consume significant tokens. Consider moving specialized content to Agent Skills (SKILL.md) which load on-demand, or .claude/rules/ which load only for matching file paths.');
      lines.push('');
    }
    if (totalTokens <= 2000) {
      lines.push('> ✅ **Lean and efficient!** Your instruction footprint is minimal, leaving maximum context for your actual code.');
      lines.push('');
    }
  }

  // Roadmap
  if (report.roadmap.length > 0) {
    lines.push('## Adoption Roadmap');
    lines.push('');
    lines.push('Steps to increase your AI-readiness score, ordered by impact:');
    lines.push('');

    for (const step of report.roadmap) {
      const impactBadge = step.impact === 'high' ? '🔴 High Impact' : step.impact === 'medium' ? '🟡 Medium' : '🟢 Low';
      const effortBadge = step.effort === 'low' ? '⚡ Quick' : step.effort === 'medium' ? '🔧 Moderate' : '🏗️ Involved';

      lines.push(`### ${step.priority}. ${step.title}`);
      lines.push('');
      lines.push(`${impactBadge} | ${effortBadge}`);
      lines.push('');
      lines.push(step.description);
      lines.push('');
      lines.push(`> **Now:** ${step.currentState}`);
      lines.push(`> **Target:** ${step.targetState}`);
      lines.push('');
    }
  }

  // Stats footer
  lines.push('---');
  lines.push('');
  lines.push(`*Scanned ${report.stats.totalFiles} agent files, ${report.stats.totalLines} total lines, ~${report.stats.totalEstimatedTokens.toLocaleString()} tokens, ${report.stats.totalIssues} issues found.*`);
  lines.push(`*AgentLint deep scan: ${report.stats.hasApiKey ? 'API key configured ✅' : 'No API key — local rules only'}*`);
  lines.push('');

  return lines.join('\n');
}
