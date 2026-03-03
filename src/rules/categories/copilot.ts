import { RuleDefinition } from '../types';
import { isInsideCodeBlock } from '../utils';

/**
 * GitHub Copilot-specific rules (Tier 3).
 *
 * Rules for copilot-instructions.md files.
 * Validates file location, length, and Claude-specific content leakage.
 */

// ── Rule 14: COPILOT_WRONG_LOCATION ─────────────────────────────────────────

const copilotWrongLocation: RuleDefinition = {
  meta: {
    id: 'COPILOT_WRONG_LOCATION',
    name: 'Copilot Instructions in Wrong Location',
    description:
      'Detects copilot-instructions.md files that are not in the .github/ directory.',
    rationale:
      'GitHub Copilot only loads instructions from .github/copilot-instructions.md. Files placed elsewhere are silently ignored, providing no benefit.',
    recommendation:
      'Move to .github/copilot-instructions.md for Copilot to recognize it.',
    badExample:
      'Project root:\n  copilot-instructions.md  <-- silently ignored by Copilot',
    goodExample:
      'Project root:\n  .github/\n    copilot-instructions.md  <-- recognized by Copilot',
    defaultSeverity: 'warning',
    applicableTo: ['copilot-instructions'],
    category: 'copilot',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'copilot-instructions') return [];

    const filePath = context.filePath;

    // Check if the file is inside .github/
    const isInGithubDir =
      filePath.includes('.github/') || filePath.includes('.github\\');

    if (!isInGithubDir) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'warning',
          code: 'COPILOT_WRONG_LOCATION',
          message:
            'copilot-instructions.md is not in the .github/ directory. Copilot will not load it.',
          suggestion:
            'Move to .github/copilot-instructions.md for Copilot to recognize it.',
        },
      ];
    }

    return [];
  },
};

// ── Rule 15: COPILOT_TOO_LONG ───────────────────────────────────────────────

const copilotTooLong: RuleDefinition = {
  meta: {
    id: 'COPILOT_TOO_LONG',
    name: 'Copilot Instructions Too Long',
    description:
      'Detects copilot-instructions.md files exceeding 500 lines or approximately 8000 tokens.',
    rationale:
      'Copilot has a smaller effective instruction window than Claude Code. Very long instruction files get truncated, causing later instructions to be silently dropped.',
    recommendation:
      'Keep copilot-instructions.md concise. Focus on the most critical 100-200 lines.',
    badExample:
      'A 600-line copilot-instructions.md with exhaustive API documentation, style guides, and architecture notes.',
    goodExample:
      'A 150-line copilot-instructions.md with key conventions, preferred patterns, and critical constraints.',
    defaultSeverity: 'warning',
    applicableTo: ['copilot-instructions'],
    category: 'copilot',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'copilot-instructions') return [];

    const lineCount = context.lines.length;
    // Rough token estimation: ~4 characters per token
    const estimatedTokens = Math.ceil(context.content.length / 4);

    const issues: ReturnType<RuleDefinition['check']> = [];

    if (lineCount > 500) {
      issues.push({
        startLine: 1,
        endLine: context.lines.length,
        severity: 'warning',
        code: 'COPILOT_TOO_LONG',
        message: `File has ${lineCount} lines (recommended max: 500 for Copilot)`,
        suggestion:
          'Keep copilot-instructions.md concise. Focus on the most critical 100-200 lines. Later content may be truncated.',
      });
    } else if (estimatedTokens > 8000) {
      issues.push({
        startLine: 1,
        endLine: context.lines.length,
        severity: 'warning',
        code: 'COPILOT_TOO_LONG',
        message: `File has ~${estimatedTokens} estimated tokens (recommended max: ~8000 for Copilot)`,
        suggestion:
          'Keep copilot-instructions.md concise. Focus on the most critical 100-200 lines. Later content may be truncated.',
      });
    }

    return issues;
  },
};

// ── Rule 16: COPILOT_CLAUDE_SPECIFIC_INSTRUCTIONS ───────────────────────────

const copilotClaudeSpecificInstructions: RuleDefinition = {
  meta: {
    id: 'COPILOT_CLAUDE_SPECIFIC_INSTRUCTIONS',
    name: 'Claude-Specific Instructions in Copilot File',
    description:
      'Detects Claude-specific terms and concepts in Copilot instruction files, such as CLAUDE.md references, Anthropic mentions, hook events, MCP configurations, and XML tag patterns.',
    rationale:
      'Copilot does not understand Claude-specific concepts like PreToolUse hooks, SKILL.md references, or MCP server configurations. These instructions waste tokens and may confuse Copilot.',
    recommendation:
      'Remove Claude-specific instructions from Copilot files. Each tool should have its own instructions.',
    badExample:
      'copilot-instructions.md:\nUse PreToolUse hooks for validation.\nSee CLAUDE.md for full rules.\nConfigure MCP servers in .claude/settings.json.',
    goodExample:
      'copilot-instructions.md:\nPrefer TypeScript strict mode.\nAlways add return types to functions.\nUse ESLint for code quality.',
    defaultSeverity: 'warning',
    applicableTo: ['copilot-instructions'],
    category: 'copilot',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'copilot-instructions') return [];

    const issues: ReturnType<RuleDefinition['check']> = [];

    const claudeSpecificPatterns: Array<{
      pattern: RegExp;
      label: string;
    }> = [
      { pattern: /\bClaude\b/, label: 'Claude' },
      { pattern: /\bCLAUDE\.md\b/, label: 'CLAUDE.md' },
      { pattern: /\bAnthropic\b/, label: 'Anthropic' },
      { pattern: /\bclaude[-_]rules\b/i, label: 'claude-rules' },
      { pattern: /\bSKILL\.md\b/, label: 'SKILL.md' },
      { pattern: /\bSubagentStop\b/, label: 'SubagentStop' },
      { pattern: /\bPreToolUse\b/, label: 'PreToolUse' },
      { pattern: /\bPostToolUse\b/, label: 'PostToolUse' },
      {
        pattern: /\bmcpServers\b/,
        label: 'mcpServers (Claude-specific MCP config)',
      },
      {
        pattern: /\b\.claude\/settings\.json\b/,
        label: '.claude/settings.json',
      },
      {
        pattern: /<\/?(?:agent|thinking|result|artifact|tool_use|tool_result)\s*>/i,
        label: 'XML agent tags',
      },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      for (const { pattern, label } of claudeSpecificPatterns) {
        if (pattern.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'COPILOT_CLAUDE_SPECIFIC_INSTRUCTIONS',
            message: `Claude-specific reference "${label}" found in Copilot instructions`,
            suggestion:
              'Remove Claude-specific instructions from Copilot files. Each tool should have its own instructions.',
          });
          // Only report the first match per line to avoid noise
          break;
        }
      }
    }

    return issues;
  },
};

/** All Copilot-specific rules for registration. */
export const copilotRules: RuleDefinition[] = [
  copilotWrongLocation,
  copilotTooLong,
  copilotClaudeSpecificInstructions,
];
