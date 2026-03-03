import { RuleDefinition } from '../types';
import { countNonEmptyLines, isInsideCodeBlock } from '../utils';

/**
 * FILE_TOO_LONG
 *
 * Flags agent instruction files that exceed recommended line counts.
 * CLAUDE.md: 200 lines (Anthropic official guidance).
 * SKILL.md: 500 lines (Agent Skills spec).
 */
const fileTooLong: RuleDefinition = {
  meta: {
    id: 'FILE_TOO_LONG',
    name: 'File Too Long',
    description:
      'Checks whether an agent instruction file exceeds the recommended line count for its type.',
    rationale:
      'Overly long instruction files dilute signal and increase token cost on every agent invocation. Anthropic recommends keeping CLAUDE.md under 200 non-empty lines. Longer files should be split into skills or .claude/rules/ files that load on demand.',
    recommendation:
      'Move specialized instructions into SKILL.md files or .claude/rules/*.md files. Keep the root instruction file focused on project-wide commands, constraints, and conventions.',
    badExample:
      'A 350-line CLAUDE.md with language style guides, API docs, and deployment runbooks all inline.',
    goodExample:
      'A 120-line CLAUDE.md with commands and constraints, referencing skills for deployment and style.',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md', 'claude-rules', 'agents-md', 'cursorrules', 'copilot-instructions', 'skill-md'],
    category: 'structure',
    fixable: false,
  },
  check(context) {
    const nonEmpty = countNonEmptyLines(context.lines);
    const limit = context.fileType === 'skill-md' ? 500 : 200;
    const label = context.fileType === 'skill-md' ? 'SKILL.md' : 'CLAUDE.md';

    if (nonEmpty > limit) {
      return [
        {
          startLine: 1,
          endLine: context.lines.length,
          severity: 'warning',
          code: 'FILE_TOO_LONG',
          message: `File has ${nonEmpty} non-empty lines (recommended max: ${limit} for ${label})`,
          suggestion: `Reduce to under ${limit} lines. Move specialized instructions to skills or .claude/rules/ files for on-demand loading.`,
        },
      ];
    }
    return [];
  },
};

/**
 * MISSING_COMMANDS
 *
 * For CLAUDE.md / AGENTS.md / .cursorrules, checks whether any build/test/lint
 * commands are present. This is the #1 most impactful content for agent files.
 */
const missingCommands: RuleDefinition = {
  meta: {
    id: 'MISSING_COMMANDS',
    name: 'Missing Build/Test/Lint Commands',
    description:
      'Checks that the instruction file contains at least one recognizable build, test, or lint command.',
    rationale:
      'Build/test/lint commands are the single most valuable content in an agent instruction file. Without them, the agent cannot verify its own work, leading to broken builds and untested code.',
    recommendation:
      'Add a "## Commands" section listing the exact commands for building, testing, and linting the project.',
    badExample: 'A CLAUDE.md that only describes coding conventions but has no runnable commands.',
    goodExample:
      '## Commands\n- `npm run build` -- Build the project\n- `npm test` -- Run all tests\n- `npm run lint` -- Lint with ESLint',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'agents-md', 'cursorrules'],
    category: 'structure',
    fixable: false,
  },
  check(context) {
    if (
      context.fileType !== 'claude-md' &&
      context.fileType !== 'agents-md' &&
      context.fileType !== 'cursorrules'
    ) {
      return [];
    }

    const commandIndicators = [
      /\bnpm\s+(run\s+)?(test|build|lint|dev|start)/i,
      /\byarn\s+(test|build|lint|dev|start)/i,
      /\bpnpm\s+(run\s+)?(test|build|lint|dev|start)/i,
      /\bbun\s+(run\s+)?(test|build|lint|dev|start)/i,
      /\bpytest\b/i,
      /\bmake\s+\w+/i,
      /\bcargo\s+(test|build|run)/i,
      /\bgo\s+(test|build|run)/i,
      /\b(npx|bunx)\s+\w+/i,
      /```(bash|sh|shell|console)/i,
      /\$\s+\w+/,
    ];

    const hasCommands = context.lines.some((line) =>
      commandIndicators.some((pattern) => pattern.test(line))
    );

    if (!hasCommands) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'warning',
          code: 'MISSING_COMMANDS',
          message: 'No build/test/lint commands found — this is the #1 most valuable content',
          suggestion:
            'Add a "## Commands" section with exact build, test, lint, and dev commands. Example:\n## Commands\n- `npm run build` — Build the project\n- `npm test` — Run all tests\n- `npm run lint` — Lint with ESLint',
        },
      ];
    }

    return [];
  },
};

/**
 * MISSING_NEGATIVE_CONSTRAINTS
 *
 * Checks for the absence of NEVER / MUST NOT / DO NOT patterns.
 * Negative constraints are the #2 most effective instruction type for steering agents.
 */
const missingNegativeConstraints: RuleDefinition = {
  meta: {
    id: 'MISSING_NEGATIVE_CONSTRAINTS',
    name: 'Missing Negative Constraints',
    description:
      'Checks that the instruction file contains at least one negative constraint (NEVER, MUST NOT, DO NOT, etc.).',
    rationale:
      'Negative constraints are the second most effective instruction type after commands. They prevent common agent mistakes like modifying protected files, using banned patterns, or overwriting manual changes.',
    recommendation:
      'Add explicit prohibitions using NEVER, MUST NOT, or DO NOT. Focus on project-specific mistakes the agent should avoid.',
    badExample:
      'A CLAUDE.md with only positive instructions like "use TypeScript" and "write tests".',
    goodExample:
      'NEVER modify files in /config without explicit approval.\nMUST NOT use `any` type in TypeScript.\nDO NOT commit directly to main.',
    defaultSeverity: 'info',
    applicableTo: ['claude-md', 'claude-local-md', 'claude-rules', 'agents-md', 'cursorrules'],
    category: 'structure',
    fixable: false,
  },
  check(context) {
    if (context.fileType === 'skill-md' || context.fileType === 'copilot-instructions') {
      return [];
    }

    const negativePatterns = [
      /\bNEVER\b/,
      /\bMUST NOT\b/,
      /\bDO NOT\b/,
      /\bDON'T\b/,
      /\bAVOID\b/,
      /\bPROHIBITED\b/,
      /\bFORBIDDEN\b/,
    ];

    const hasNegatives = context.lines.some((line) =>
      negativePatterns.some((pattern) => pattern.test(line))
    );

    if (!hasNegatives && countNonEmptyLines(context.lines) > 10) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'info',
          code: 'MISSING_NEGATIVE_CONSTRAINTS',
          message: 'No negative constraints found (NEVER, MUST NOT, DO NOT)',
          suggestion:
            'Add explicit prohibitions. Negative constraints are the #2 most effective instruction type. Example: "NEVER modify files in /config without approval" or "MUST NOT use any type in TypeScript".',
        },
      ];
    }

    return [];
  },
};

/**
 * DISCOVERABLE_INFO
 *
 * Detects file-by-file descriptions that waste tokens because the agent
 * discovers this information by reading the codebase.
 */
const discoverableInfo: RuleDefinition = {
  meta: {
    id: 'DISCOVERABLE_INFO',
    name: 'Discoverable Information',
    description:
      'Detects file-by-file structure descriptions that the agent can discover by reading the codebase.',
    rationale:
      'AI agents read your codebase and discover file structure on their own. Listing every file and its purpose wastes tokens and risks going stale. Only document non-obvious architectural decisions or gotchas.',
    recommendation:
      'Remove file-by-file descriptions. Instead, document only non-obvious architectural decisions, hidden gotchas, or cross-cutting concerns that cannot be inferred from code alone.',
    badExample:
      '- `src/utils/helpers.ts` -- Helper functions\n- `src/utils/format.ts` -- Formatting utilities\n- `src/utils/validate.ts` -- Validation logic\n- `src/utils/parse.ts` -- Parsing functions\n- `src/utils/transform.ts` -- Data transformations',
    goodExample:
      '## Architecture Gotchas\n- The `payments/` module uses a saga pattern -- see ARCHITECTURE.md for the flow diagram.',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'structure',
    fixable: false,
  },
  check(context) {
    const issues = context.lines.reduce<{
      result: ReturnType<RuleDefinition['check']>;
      fileDescStart: number;
      fileDescCount: number;
      inCodeBlock: boolean;
    }>(
      (acc, line, i) => {
        if (line.trimStart().startsWith('```')) {
          acc.inCodeBlock = !acc.inCodeBlock;
          return acc;
        }
        if (acc.inCodeBlock) return acc;

        const fileDescPatterns = [
          /^\s*[-*]\s*`?(?:src|lib|app|pages|components|utils|helpers)\/[^`]*`?\s*[-\u2013\u2014:]\s*/,
          /^\s*[-*]\s*`?[\w./]+\.(ts|js|py|go|rs|java)`?\s*[-\u2013\u2014:]\s*\w+/,
        ];

        const isFileDesc = fileDescPatterns.some((p) => p.test(line));

        if (isFileDesc) {
          if (acc.fileDescStart === -1) acc.fileDescStart = i;
          acc.fileDescCount++;
        } else {
          if (acc.fileDescCount >= 5) {
            acc.result.push({
              startLine: acc.fileDescStart + 1,
              endLine: acc.fileDescStart + acc.fileDescCount,
              severity: 'info',
              code: 'DISCOVERABLE_INFO',
              message: `File-by-file description block (${acc.fileDescCount} entries) \u2014 Claude discovers this by reading code`,
              suggestion:
                'Remove file-by-file descriptions. Claude reads your codebase and discovers file structure on its own. Only document non-obvious architectural decisions or gotchas.',
            });
          }
          acc.fileDescCount = 0;
          acc.fileDescStart = -1;
        }
        return acc;
      },
      { result: [], fileDescStart: -1, fileDescCount: 0, inCodeBlock: false }
    );

    // Handle trailing block
    if (issues.fileDescCount >= 5) {
      issues.result.push({
        startLine: issues.fileDescStart + 1,
        endLine: issues.fileDescStart + issues.fileDescCount,
        severity: 'info',
        code: 'DISCOVERABLE_INFO',
        message: `File-by-file description block (${issues.fileDescCount} entries) \u2014 Claude discovers this by reading code`,
        suggestion:
          'Remove file-by-file descriptions. Claude reads your codebase and discovers file structure on its own. Only document non-obvious architectural decisions or gotchas.',
      });
    }

    return issues.result;
  },
};

/**
 * CONTEXT_EXCEEDS_TOOL_LIMIT
 *
 * Detects when instruction files exceed the known effective instruction limits
 * for their target AI tool. Each tool allocates a different amount of context
 * for instruction files, and exceeding that limit means silent truncation.
 */
const contextExceedsToolLimit: RuleDefinition = {
  meta: {
    id: 'CONTEXT_EXCEEDS_TOOL_LIMIT',
    name: 'File Exceeds Tool Context Limit',
    description:
      'Detects when instruction files exceed the known effective instruction limits for their target AI tool. Each tool has different context allocation for instruction files.',
    rationale:
      'Each AI tool has different context allocation for instruction files. Exceeding the limit means your instructions get silently truncated -- the agent never sees the overflow content.',
    recommendation:
      'Consider splitting into focused, scoped files. Move specialized instructions to on-demand files that load only when relevant.',
    badExample:
      'A 15,000-character .cursorrules file that exceeds Cursor\'s ~8,000-character effective limit.',
    goodExample:
      'A 5,000-character .cursorrules file within limits, with additional rules in .cursor/rules/ scoped files.',
    defaultSeverity: 'warning',
    applicableTo: ['cursorrules', 'claude-md', 'claude-local-md', 'agents-md'],
    category: 'structure',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];
    const charCount = context.content.length;

    // Tool-specific limits
    // copilot-instructions: handled by COPILOT_TOO_LONG -- skip
    // skill-md: handled by SKILL_TOKEN_BUDGET -- skip
    switch (context.fileType) {
      case 'cursorrules': {
        // Cursor's context allocation for rules is limited (~2,000 tokens)
        const cursorLimit = 8000;
        if (charCount > cursorLimit) {
          issues.push({
            startLine: 1,
            endLine: context.lines.length,
            severity: 'warning',
            code: 'CONTEXT_EXCEEDS_TOOL_LIMIT',
            message: `File is ${charCount.toLocaleString()} chars (~${Math.ceil(charCount / 4).toLocaleString()} tokens), exceeding Cursor's effective limit of ~${cursorLimit.toLocaleString()} chars`,
            suggestion:
              'This file exceeds the recommended limit for Cursor. Consider migrating to .cursor/rules/ directory with scoped, glob-targeted rule files.',
          });
        }
        break;
      }
      case 'claude-md':
      case 'claude-local-md': {
        // Claude has generous limits but there is still a practical ceiling
        const claudeLimit = 50000;
        if (charCount > claudeLimit) {
          issues.push({
            startLine: 1,
            endLine: context.lines.length,
            severity: 'info',
            code: 'CONTEXT_EXCEEDS_TOOL_LIMIT',
            message: `File is ${charCount.toLocaleString()} chars (~${Math.ceil(charCount / 4).toLocaleString()} tokens), exceeding the practical ceiling of ~${claudeLimit.toLocaleString()} chars for Claude`,
            suggestion:
              'This file exceeds the recommended limit for Claude. Consider splitting into SKILL.md files or .claude/rules/ scoped files that load on demand.',
          });
        }
        break;
      }
      case 'agents-md': {
        // Windsurf/Codex have stricter limits on AGENTS.md
        const agentsLimit = 12000;
        if (charCount > agentsLimit) {
          issues.push({
            startLine: 1,
            endLine: context.lines.length,
            severity: 'warning',
            code: 'CONTEXT_EXCEEDS_TOOL_LIMIT',
            message: `File is ${charCount.toLocaleString()} chars (~${Math.ceil(charCount / 4).toLocaleString()} tokens), exceeding the recommended limit of ~${agentsLimit.toLocaleString()} chars for AGENTS.md`,
            suggestion:
              'This file exceeds the recommended limit for AGENTS.md (Windsurf/Codex). Consider splitting into focused, scoped files.',
          });
        }
        break;
      }
      default:
        break;
    }

    return issues;
  },
};

/** All structure rules for registration. */
export const structureRules: RuleDefinition[] = [
  fileTooLong,
  missingCommands,
  missingNegativeConstraints,
  discoverableInfo,
  contextExceedsToolLimit,
];
