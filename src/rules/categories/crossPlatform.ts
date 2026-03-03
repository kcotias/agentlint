import { RuleDefinition } from '../types';
import { isInsideCodeBlock } from '../utils';

/**
 * Cross-Platform Contradiction Detection rules.
 *
 * These rules detect when a project has multiple AI tool config files
 * with contradictory instructions, or when a single file contains
 * internally inconsistent directives.
 */

// ── Rule: XP_CONFLICTING_PACKAGE_MANAGER ────────────────────────────────────

const conflictingPackageManager: RuleDefinition = {
  meta: {
    id: 'XP_CONFLICTING_PACKAGE_MANAGER',
    name: 'Conflicting Package Manager References',
    description:
      'Detects when an agent instruction file references multiple different package managers (npm, yarn, pnpm, bun), suggesting inconsistent tooling directives.',
    rationale:
      'If an instruction file says "use pnpm" but also contains "npm run test" in commands, the agent gets confused about which package manager to use. This leads to failed commands and inconsistent lock files.',
    recommendation:
      'Standardize on a single package manager throughout the file. Replace all command references to use the chosen manager consistently.',
    badExample:
      'Use pnpm for all installs.\n\n## Commands\n- `npm run build` -- Build the project\n- `npm test` -- Run tests',
    goodExample:
      'Use pnpm for all installs.\n\n## Commands\n- `pnpm run build` -- Build the project\n- `pnpm test` -- Run tests',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'crossPlatform',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Patterns that indicate explicit use of a specific package manager.
    // Each group: { manager name, patterns that signal it }
    const managerPatterns: Array<{
      name: string;
      patterns: RegExp[];
    }> = [
      {
        name: 'npm',
        patterns: [
          /\buse\s+npm\b/i,
          /\bnpm\s+(install|run|test|start|exec|ci)\b/,
          /\bnpx\s+\w+/,
        ],
      },
      {
        name: 'yarn',
        patterns: [
          /\buse\s+yarn\b/i,
          /\byarn\s+(add|install|run|test|start|dlx)\b/,
          /\byarn\b(?!\s*\.lock)/,
        ],
      },
      {
        name: 'pnpm',
        patterns: [
          /\buse\s+pnpm\b/i,
          /\bpnpm\s+(add|install|run|test|start|exec|dlx)\b/,
          /\bpnpx\s+\w+/,
        ],
      },
      {
        name: 'bun',
        patterns: [
          /\buse\s+bun\b/i,
          /\bbun\s+(add|install|run|test|start|x)\b/,
          /\bbunx\s+\w+/,
        ],
      },
    ];

    // Track which managers are found and on which lines
    const managerHits: Map<string, number[]> = new Map();

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      for (const { name, patterns } of managerPatterns) {
        if (patterns.some((p) => p.test(line))) {
          const existing = managerHits.get(name) || [];
          existing.push(i);
          managerHits.set(name, existing);
        }
      }
    }

    // If more than one manager is referenced, flag it
    const foundManagers = Array.from(managerHits.keys());
    if (foundManagers.length > 1) {
      // Find the first line where the second manager appears
      const allEntries = Array.from(managerHits.entries());
      // Sort by first occurrence
      allEntries.sort((a, b) => a[1][0] - b[1][0]);

      const firstManager = allEntries[0];
      const secondManager = allEntries[1];

      issues.push({
        startLine: secondManager[1][0] + 1,
        endLine: secondManager[1][0] + 1,
        severity: 'warning',
        code: 'XP_CONFLICTING_PACKAGE_MANAGER',
        message: `Conflicting package managers: file references both "${firstManager[0]}" and "${secondManager[0]}"`,
        suggestion: `Standardize on a single package manager. Replace all "${secondManager[0]}" references with "${firstManager[0]}" (or vice versa) to avoid confusing the agent.`,
      });
    }

    return issues;
  },
};

// ── Rule: XP_CONFLICTING_TEST_FRAMEWORK ─────────────────────────────────────

const conflictingTestFramework: RuleDefinition = {
  meta: {
    id: 'XP_CONFLICTING_TEST_FRAMEWORK',
    name: 'Conflicting Test Framework References',
    description:
      'Detects when instructions reference multiple conflicting test frameworks without clear scoping, such as both "jest" and "vitest" as the primary test runner.',
    rationale:
      '"Run jest" in one section and "run vitest" in another confuses the agent about which test runner to use. The agent may pick one arbitrarily or try to run both.',
    recommendation:
      'Specify a single test framework, or clearly scope each framework to its context (e.g., "jest for unit tests, cypress for e2e").',
    badExample:
      '## Testing\nRun `jest` to execute tests.\n\n## CI\nRun `vitest` before pushing.',
    goodExample:
      '## Testing\nRun `vitest` to execute all tests.\nFor e2e tests: `npx playwright test`.',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'crossPlatform',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Test frameworks that are typically mutually exclusive
    const testFrameworks: Array<{ name: string; pattern: RegExp }> = [
      { name: 'jest', pattern: /\bjest\b/i },
      { name: 'vitest', pattern: /\bvitest\b/i },
      { name: 'mocha', pattern: /\bmocha\b/i },
      { name: 'pytest', pattern: /\bpytest\b/i },
      { name: 'unittest', pattern: /\bunittest\b/i },
      { name: 'rspec', pattern: /\brspec\b/i },
      { name: 'go test', pattern: /\bgo\s+test\b/i },
    ];

    // Comparison/migration context patterns -- skip lines that are just comparing
    const comparisonPatterns = [
      /\binstead of\b/i,
      /\breplac(e|ed|ing)\b/i,
      /\bmigrat(e|ed|ing)\b/i,
      /\bvs\.?\b/i,
      /\bcompare/i,
      /\bformer(ly)?\b/i,
      /\bnot\s+\w+,?\s+use\b/i,
    ];

    const frameworkHits: Map<string, number[]> = new Map();

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      // Skip lines that are in a comparison/migration context
      if (comparisonPatterns.some((p) => p.test(line))) continue;

      for (const { name, pattern } of testFrameworks) {
        if (pattern.test(line)) {
          const existing = frameworkHits.get(name) || [];
          existing.push(i);
          frameworkHits.set(name, existing);
        }
      }
    }

    const foundFrameworks = Array.from(frameworkHits.keys());
    if (foundFrameworks.length > 1) {
      const allEntries = Array.from(frameworkHits.entries());
      allEntries.sort((a, b) => a[1][0] - b[1][0]);

      const firstFw = allEntries[0];
      const secondFw = allEntries[1];

      issues.push({
        startLine: secondFw[1][0] + 1,
        endLine: secondFw[1][0] + 1,
        severity: 'info',
        code: 'XP_CONFLICTING_TEST_FRAMEWORK',
        message: `Multiple test frameworks referenced: "${firstFw[0]}" and "${secondFw[0]}" -- agent may be confused about which to use`,
        suggestion: `Specify a single test framework, or clearly scope each one (e.g., "${firstFw[0]} for unit tests, ${secondFw[0]} for integration tests").`,
      });
    }

    return issues;
  },
};

// ── Rule: XP_CONFLICTING_STYLE_DIRECTIVES ───────────────────────────────────

const conflictingStyleDirectives: RuleDefinition = {
  meta: {
    id: 'XP_CONFLICTING_STYLE_DIRECTIVES',
    name: 'Conflicting Style Directives',
    description:
      'Detects directly contradictory style instructions within the same file, such as "use semicolons" vs "no semicolons" or "use tabs" vs "use spaces".',
    rationale:
      'Contradictory style rules mean the agent picks one randomly each time, producing inconsistent code across the project.',
    recommendation:
      'Remove one of the conflicting directives. Ensure all style instructions are consistent throughout the file.',
    badExample:
      'Use semicolons at the end of every statement.\n...\nDo not use semicolons -- rely on ASI.',
    goodExample: 'Always use semicolons at the end of every statement.',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'crossPlatform',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Pairs of contradictory style directives: [patternA, patternB, topic]
    const contradictions: Array<{
      a: RegExp;
      b: RegExp;
      topic: string;
    }> = [
      {
        a: /\buse\s+semicolons\b/i,
        b: /\b(no|without|avoid|don'?t\s+use)\s+semicolons\b/i,
        topic: 'semicolons',
      },
      {
        a: /\buse\s+tabs\b/i,
        b: /\buse\s+spaces\b/i,
        topic: 'indentation (tabs vs spaces)',
      },
      {
        a: /\bsingle\s+quotes\b/i,
        b: /\bdouble\s+quotes\b/i,
        topic: 'quote style (single vs double)',
      },
      {
        a: /\buse\s+var\b/i,
        b: /\b(never|don'?t|avoid|no)\s+use\s+var\b/i,
        topic: 'var usage',
      },
      {
        a: /\b(use|prefer)\s+arrow\s+functions\b/i,
        b: /\b(use|prefer)\s+function\s+declarations\b/i,
        topic: 'function style (arrow vs declaration)',
      },
    ];

    for (const { a, b, topic } of contradictions) {
      let hitA: number | null = null;
      let hitB: number | null = null;

      for (let i = 0; i < context.lines.length; i++) {
        if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

        const line = context.lines[i];
        if (hitA === null && a.test(line)) hitA = i;
        if (hitB === null && b.test(line)) hitB = i;

        if (hitA !== null && hitB !== null) break;
      }

      if (hitA !== null && hitB !== null) {
        const laterLine = Math.max(hitA, hitB);
        issues.push({
          startLine: laterLine + 1,
          endLine: laterLine + 1,
          severity: 'warning',
          code: 'XP_CONFLICTING_STYLE_DIRECTIVES',
          message: `Contradictory style directives for ${topic} found (lines ${hitA + 1} and ${hitB + 1})`,
          suggestion: `Remove one of the conflicting directives for ${topic}. The agent will pick one randomly if both are present.`,
        });
      }
    }

    return issues;
  },
};

// ── Rule: XP_TOOL_SPECIFIC_IN_WRONG_FILE ────────────────────────────────────

const toolSpecificInWrongFile: RuleDefinition = {
  meta: {
    id: 'XP_TOOL_SPECIFIC_IN_WRONG_FILE',
    name: 'Tool-Specific Concept in Wrong File',
    description:
      'Detects tool-specific concepts appearing in the wrong config file (e.g., Cursor concepts in CLAUDE.md, Claude concepts in AGENTS.md).',
    rationale:
      'Tool-specific instructions in the wrong file waste tokens and confuse agents. Each agent file should contain only instructions relevant to its target tool.',
    recommendation:
      'Move tool-specific instructions to the appropriate config file for that tool.',
    badExample:
      'CLAUDE.md:\nSet alwaysApply: true in the frontmatter.\nUse .cursorrules for global rules.',
    goodExample:
      'CLAUDE.md:\nUse SKILL.md files for specialized agent capabilities.\nCLAUDE.local.md for personal overrides.',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'crossPlatform',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Define which concepts are specific to which tools
    // and which file types should NOT contain them.
    const crossToolPatterns: Array<{
      pattern: RegExp;
      label: string;
      belongsTo: string;
      wrongIn: string[];
    }> = [
      // Cursor-specific concepts that should not appear in Claude/Agents files
      {
        pattern: /\b\.cursorrules\b/,
        label: '.cursorrules',
        belongsTo: 'Cursor',
        wrongIn: ['claude-md', 'claude-local-md', 'claude-rules', 'agents-md', 'copilot-instructions'],
      },
      {
        pattern: /\b\.mdc\b/,
        label: '.mdc (Cursor rules format)',
        belongsTo: 'Cursor',
        wrongIn: ['claude-md', 'claude-local-md', 'claude-rules', 'agents-md', 'copilot-instructions'],
      },
      {
        pattern: /\balwaysApply\b/,
        label: 'alwaysApply (Cursor frontmatter)',
        belongsTo: 'Cursor',
        wrongIn: ['claude-md', 'claude-local-md', 'claude-rules', 'agents-md', 'copilot-instructions'],
      },
      // Claude-specific concepts that should not appear in Agents/Copilot files
      {
        pattern: /\bSKILL\.md\b/,
        label: 'SKILL.md',
        belongsTo: 'Claude',
        wrongIn: ['agents-md', 'copilot-instructions'],
      },
      {
        pattern: /\bPreToolUse\b/,
        label: 'PreToolUse (Claude hook)',
        belongsTo: 'Claude',
        wrongIn: ['agents-md'],
      },
      {
        pattern: /\bPostToolUse\b/,
        label: 'PostToolUse (Claude hook)',
        belongsTo: 'Claude',
        wrongIn: ['agents-md'],
      },
      {
        pattern: /\bSubagentStop\b/,
        label: 'SubagentStop (Claude hook)',
        belongsTo: 'Claude',
        wrongIn: ['agents-md'],
      },
      {
        pattern: /\bclaude[-_]rules\b/i,
        label: 'claude-rules directory',
        belongsTo: 'Claude',
        wrongIn: ['agents-md', 'copilot-instructions'],
      },
      {
        pattern: /\b\.claude\/settings\.json\b/,
        label: '.claude/settings.json',
        belongsTo: 'Claude',
        wrongIn: ['agents-md', 'cursorrules'],
      },
      // Copilot-specific concepts that should not appear in Claude/Cursor files
      {
        pattern: /\bcopilot-instructions\.md\b/,
        label: 'copilot-instructions.md',
        belongsTo: 'Copilot',
        wrongIn: ['claude-md', 'claude-local-md', 'claude-rules', 'cursorrules'],
      },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      for (const { pattern, label, belongsTo, wrongIn } of crossToolPatterns) {
        if (wrongIn.includes(context.fileType) && pattern.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'info',
            code: 'XP_TOOL_SPECIFIC_IN_WRONG_FILE',
            message: `${belongsTo}-specific concept "${label}" found in ${context.fileType} file`,
            suggestion: `Move ${belongsTo}-specific instructions to the appropriate ${belongsTo} config file. This reference wastes tokens and may confuse the agent.`,
          });
          // One match per line to avoid noise
          break;
        }
      }
    }

    return issues;
  },
};

/** All cross-platform rules for registration. */
export const crossPlatformRules: RuleDefinition[] = [
  conflictingPackageManager,
  conflictingTestFramework,
  conflictingStyleDirectives,
  toolSpecificInWrongFile,
];
