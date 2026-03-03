import { RuleDefinition } from '../types';
import { isInsideCodeBlock } from '../utils';

/**
 * Cursor AI-specific rules (Tier 3).
 *
 * Rules for .cursorrules and .cursor/rules/ files.
 * Validates deprecated formats, missing frontmatter, and cross-tool conflicts.
 */

// ── Rule 11: CURSOR_RULES_DEPRECATED_FORMAT ─────────────────────────────────

const cursorRulesDeprecatedFormat: RuleDefinition = {
  meta: {
    id: 'CURSOR_RULES_DEPRECATED_FORMAT',
    name: 'Deprecated .cursorrules Format',
    description:
      'Detects use of the deprecated root-level .cursorrules file, which has been superseded by the .cursor/rules/ directory format.',
    rationale:
      'Cursor has moved to the .cursor/rules/ directory format with frontmatter support for better organization and glob-based scoping. The root .cursorrules file is legacy and may not receive future feature support.',
    recommendation:
      'Migrate to .cursor/rules/ directory format for better organization and glob-based scoping.',
    badExample: 'Project root:\n  .cursorrules  <-- deprecated single file',
    goodExample:
      'Project root:\n  .cursor/\n    rules/\n      react.mdc\n      testing.mdc',
    defaultSeverity: 'info',
    applicableTo: ['cursorrules'],
    category: 'cursor',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'cursorrules') return [];

    const filePath = context.filePath;

    // Check if this is a root .cursorrules file (not inside .cursor/rules/)
    const isInsideCursorRulesDir =
      filePath.includes('.cursor/rules/') ||
      filePath.includes('.cursor\\rules\\');

    if (!isInsideCursorRulesDir) {
      // It's a root .cursorrules file -- flag as deprecated
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'info',
          code: 'CURSOR_RULES_DEPRECATED_FORMAT',
          message:
            'Root .cursorrules file is deprecated. Cursor now uses .cursor/rules/ directory format.',
          suggestion:
            'Migrate to .cursor/rules/ directory format for better organization and glob-based scoping.',
        },
      ];
    }

    return [];
  },
};

// ── Rule 12: CURSOR_MDC_MISSING_FRONTMATTER ─────────────────────────────────

const cursorMdcMissingFrontmatter: RuleDefinition = {
  meta: {
    id: 'CURSOR_MDC_MISSING_FRONTMATTER',
    name: 'Cursor Rules File Missing Frontmatter',
    description:
      'Detects .cursor/rules/ files that lack YAML frontmatter (--- delimited block at the start).',
    rationale:
      '.cursor/rules/ files use frontmatter for metadata such as description, globs, and alwaysApply. Without frontmatter, Cursor cannot properly scope the rules to specific file types or contexts.',
    recommendation:
      'Add frontmatter with description and globs fields.',
    badExample:
      '# React Rules\nAlways use functional components.\nPrefer hooks over class components.',
    goodExample:
      '---\ndescription: React component conventions\nglobs: ["src/**/*.tsx"]\nalwaysApply: false\n---\n\n# React Rules\nAlways use functional components.',
    defaultSeverity: 'warning',
    applicableTo: ['cursorrules'],
    category: 'cursor',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'cursorrules') return [];

    const filePath = context.filePath;

    // Only apply to files inside .cursor/rules/
    const isInsideCursorRulesDir =
      filePath.includes('.cursor/rules/') ||
      filePath.includes('.cursor\\rules\\');

    if (!isInsideCursorRulesDir) return [];

    // Check if file starts with frontmatter (---)
    const firstLine = context.lines[0]?.trim();
    if (firstLine !== '---') {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'warning',
          code: 'CURSOR_MDC_MISSING_FRONTMATTER',
          message:
            'Cursor rules file in .cursor/rules/ is missing frontmatter (--- block)',
          suggestion:
            'Add frontmatter with description and globs fields. Example:\n---\ndescription: Rule description\nglobs: ["src/**/*.ts"]\n---',
        },
      ];
    }

    return [];
  },
};

// ── Rule 13: CURSOR_CONFLICTING_WITH_CLAUDE ─────────────────────────────────

const cursorConflictingWithClaude: RuleDefinition = {
  meta: {
    id: 'CURSOR_CONFLICTING_WITH_CLAUDE',
    name: 'Cursor File References Claude',
    description:
      'Detects when a Cursor rules file references Claude-specific concepts (Claude, CLAUDE.md, Anthropic, SKILL.md, etc.).',
    rationale:
      'Having instructions for multiple AI tools in the same file can cause confusion if they contradict each other. Cursor-specific files should contain only Cursor-relevant instructions.',
    recommendation:
      'Keep tool-specific files focused. Do not reference Claude in Cursor rules or vice versa.',
    badExample:
      '.cursorrules:\nUse arrow functions (also see CLAUDE.md for additional Claude-specific rules).\nClaude should always...',
    goodExample:
      '.cursorrules:\nUse arrow functions.\nPrefer const over let.\nAlways add JSDoc comments.',
    defaultSeverity: 'info',
    applicableTo: ['cursorrules'],
    category: 'cursor',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'cursorrules') return [];

    const issues: ReturnType<RuleDefinition['check']> = [];

    const claudeReferences =
      /\b(Claude|CLAUDE\.md|Anthropic|claude[-_]rules|SKILL\.md|SubagentStop|PreToolUse|PostToolUse)\b/;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      if (claudeReferences.test(line)) {
        const match = line.match(claudeReferences);
        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'info',
          code: 'CURSOR_CONFLICTING_WITH_CLAUDE',
          message: `Cursor rules file references Claude-specific concept: "${match?.[1]}"`,
          suggestion:
            'Keep tool-specific files focused. Do not reference Claude in Cursor rules or vice versa.',
        });
      }
    }

    return issues;
  },
};

/** All Cursor-specific rules for registration. */
export const cursorRules: RuleDefinition[] = [
  cursorRulesDeprecatedFormat,
  cursorMdcMissingFrontmatter,
  cursorConflictingWithClaude,
];
