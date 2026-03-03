import { RuleDefinition } from '../types';
import { isInsideCodeBlock, countNonEmptyLines } from '../utils';

/**
 * Memory rules -- CLAUDE.local.md & memory pattern validation.
 *
 * These rules validate memory/local instruction patterns, ensuring
 * CLAUDE.local.md files stay focused, personal, and complementary
 * to the shared CLAUDE.md.
 */

// ── Rule: MEMORY_LOCAL_SECRETS_EXPOSED ──────────────────────────────────────

const localSecretsExposed: RuleDefinition = {
  meta: {
    id: 'MEMORY_LOCAL_SECRETS_EXPOSED',
    name: 'Misplaced Content Between Local and Shared Files',
    description:
      'Detects when CLAUDE.local.md contains team-wide instructions that should be in CLAUDE.md, or when CLAUDE.md contains personal/machine-specific content that should be in CLAUDE.local.md.',
    rationale:
      'CLAUDE.local.md is for personal, machine-specific, or secret config. Shared instructions placed there will not reach teammates. Personal data in CLAUDE.md gets committed to the repository and shared with everyone.',
    recommendation:
      'Move team-wide instructions to CLAUDE.md and personal/machine-specific content to CLAUDE.local.md.',
    badExample:
      'CLAUDE.local.md:\nAll developers should use ESLint with our shared config.\nProject standard: use pnpm.',
    goodExample:
      'CLAUDE.local.md:\nMy preferred editor font size is 14px.\nLocal dev server runs on port 3001.',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'memory',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    if (context.fileType === 'claude-local-md') {
      // In local files, detect team-wide language that belongs in CLAUDE.md
      const teamPatterns: Array<{ pattern: RegExp; label: string }> = [
        { pattern: /\ball\s+developers\s+should\b/i, label: 'all developers should' },
        { pattern: /\bteam[-\s]wide\b/i, label: 'team-wide' },
        { pattern: /\bproject\s+standard\b/i, label: 'project standard' },
        { pattern: /\beveryone\s+(must|should)\b/i, label: 'everyone must/should' },
        { pattern: /\bthe\s+team\s+(must|should|needs)\b/i, label: 'the team must/should' },
        { pattern: /\bcompany\s+policy\b/i, label: 'company policy' },
        { pattern: /\borg[-\s]wide\b/i, label: 'org-wide' },
      ];

      for (let i = 0; i < context.lines.length; i++) {
        if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

        const line = context.lines[i];
        for (const { pattern, label } of teamPatterns) {
          if (pattern.test(line)) {
            issues.push({
              startLine: i + 1,
              endLine: i + 1,
              severity: 'warning',
              code: 'MEMORY_LOCAL_SECRETS_EXPOSED',
              message: `Team-wide language ("${label}") found in CLAUDE.local.md -- this belongs in CLAUDE.md`,
              suggestion:
                'Move team-wide instructions to CLAUDE.md so all teammates benefit. CLAUDE.local.md is for personal/machine-specific config only.',
            });
            break;
          }
        }
      }
    } else if (context.fileType === 'claude-md') {
      // In shared files, detect personal/machine-specific content
      const personalPatterns: Array<{ pattern: RegExp; label: string }> = [
        { pattern: /\/Users\/\w+/i, label: 'macOS user path' },
        { pattern: /C:\\Users\\\w+/i, label: 'Windows user path' },
        { pattern: /\/home\/\w+/i, label: 'Linux home path' },
        { pattern: /\bmy\s+prefer(red|ence)\b/i, label: 'personal preference' },
        { pattern: /\bI\s+prefer\b/i, label: 'personal preference (I prefer)' },
        { pattern: /\bmy\s+api[-\s]?key\b/i, label: 'personal API key reference' },
        { pattern: /\bmy\s+local\b/i, label: 'local-specific reference' },
      ];

      for (let i = 0; i < context.lines.length; i++) {
        if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

        const line = context.lines[i];
        for (const { pattern, label } of personalPatterns) {
          if (pattern.test(line)) {
            issues.push({
              startLine: i + 1,
              endLine: i + 1,
              severity: 'warning',
              code: 'MEMORY_LOCAL_SECRETS_EXPOSED',
              message: `Personal/machine-specific content ("${label}") found in shared CLAUDE.md -- move to CLAUDE.local.md`,
              suggestion:
                'Move personal paths, preferences, and API key references to CLAUDE.local.md. Shared CLAUDE.md gets committed to the repo.',
            });
            break;
          }
        }
      }
    }

    return issues;
  },
};

// ── Rule: MEMORY_LOCAL_NOT_GITIGNORED ───────────────────────────────────────

const localNotGitignored: RuleDefinition = {
  meta: {
    id: 'MEMORY_LOCAL_NOT_GITIGNORED',
    name: 'CLAUDE.local.md May Contain Sensitive Data',
    description:
      'Warns when CLAUDE.local.md contains patterns suggesting sensitive data (API keys, tokens, personal paths) as a reminder to ensure the file is gitignored.',
    rationale:
      'CLAUDE.local.md often contains personal paths, API keys, and machine-specific config that should not be committed. This rule serves as a reminder to add it to .gitignore.',
    recommendation:
      'Ensure CLAUDE.local.md is in your .gitignore. It should contain only personal/machine-specific instructions.',
    badExample:
      'CLAUDE.local.md:\nAPI_KEY=sk-1234567890\nMy dev server: /Users/john/projects/myapp',
    goodExample:
      'CLAUDE.local.md (gitignored):\nPrefer verbose test output.\nLocal dev port: 3001.',
    defaultSeverity: 'info',
    applicableTo: ['claude-local-md'],
    category: 'memory',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'claude-local-md') return [];

    const sensitivePatterns = [
      /\b(api[-_]?key|api[-_]?token|secret[-_]?key|access[-_]?token)\s*[:=]/i,
      /\bsk-[a-zA-Z0-9]{10,}/,
      /\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{10,}/,
      /\btoken\s*[:=]\s*['"][^'"]{10,}['"]/i,
      /\/Users\/\w+/,
      /C:\\Users\\\w+/i,
      /\/home\/\w+/,
      /\bpassword\s*[:=]/i,
    ];

    const hasSensitive = context.lines.some((line, i) => {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) return false;
      return sensitivePatterns.some((p) => p.test(line));
    });

    if (hasSensitive) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'info',
          code: 'MEMORY_LOCAL_NOT_GITIGNORED',
          message:
            'CLAUDE.local.md contains sensitive-looking data (API keys, tokens, or personal paths)',
          suggestion:
            'Ensure CLAUDE.local.md is in your .gitignore. It should contain only personal/machine-specific instructions and should never be committed.',
        },
      ];
    }

    return [];
  },
};

// ── Rule: MEMORY_OVERRIDES_MAIN ─────────────────────────────────────────────

const overridesMain: RuleDefinition = {
  meta: {
    id: 'MEMORY_OVERRIDES_MAIN',
    name: 'Local File Overrides Main Config',
    description:
      'Detects when CLAUDE.local.md contains instructions that directly contradict or override CLAUDE.md, rather than complementing it.',
    rationale:
      'Local files should complement, not fight, the main config. If you need to override CLAUDE.md, the main file should be updated instead. Overrides in local files create hidden inconsistencies that are hard to debug.',
    recommendation:
      'Update CLAUDE.md directly if the main config is wrong. Use CLAUDE.local.md only for personal preferences and machine-specific settings.',
    badExample:
      'CLAUDE.local.md:\nIgnore the above rules about testing.\nInstead of what CLAUDE.md says, use yarn.',
    goodExample:
      'CLAUDE.local.md:\nI prefer verbose test output.\nMy local dev server runs on port 3001.',
    defaultSeverity: 'info',
    applicableTo: ['claude-local-md'],
    category: 'memory',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'claude-local-md') return [];

    const issues: ReturnType<RuleDefinition['check']> = [];

    const overridePatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /\bignore\s+the\s+above\b/i, label: 'ignore the above' },
      { pattern: /\binstead\s+of\s+what\s+CLAUDE\.md\b/i, label: 'instead of what CLAUDE.md says' },
      { pattern: /\boverride\s*:/i, label: 'override:' },
      { pattern: /\bdisregard\b/i, label: 'disregard' },
      { pattern: /\bcontrary\s+to\b/i, label: 'contrary to' },
      { pattern: /\bignore\s+(CLAUDE\.md|the\s+main|the\s+shared)\b/i, label: 'ignore CLAUDE.md/main' },
      { pattern: /\bdo\s+not\s+follow\s+(CLAUDE\.md|the\s+main)\b/i, label: 'do not follow CLAUDE.md' },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];
      for (const { pattern, label } of overridePatterns) {
        if (pattern.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'info',
            code: 'MEMORY_OVERRIDES_MAIN',
            message: `Override pattern ("${label}") detected -- local file is fighting the main config`,
            suggestion:
              'Update CLAUDE.md directly if the main config is wrong. CLAUDE.local.md should complement, not override, the shared config.',
          });
          break;
        }
      }
    }

    return issues;
  },
};

// ── Rule: MEMORY_STALE_REFERENCES ───────────────────────────────────────────

const staleReferences: RuleDefinition = {
  meta: {
    id: 'MEMORY_STALE_REFERENCES',
    name: 'Potentially Stale References in Local File',
    description:
      'Detects references to potentially outdated tooling or deprecated patterns in local instruction files.',
    rationale:
      'Local files are rarely reviewed by teammates and tend to accumulate stale instructions. A local override referencing deprecated tools actively harms the agent by pointing it at outdated technology.',
    recommendation:
      'Review and update outdated references. Replace deprecated tools with their modern equivalents.',
    badExample:
      'CLAUDE.local.md:\nUse tslint for TypeScript linting.\nTarget Node 14 for builds.',
    goodExample:
      'CLAUDE.local.md:\nUse eslint with typescript-eslint for linting.\nTarget Node 20 for builds.',
    defaultSeverity: 'info',
    applicableTo: ['claude-local-md'],
    category: 'memory',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'claude-local-md') return [];

    const issues: ReturnType<RuleDefinition['check']> = [];

    const stalePatterns: Array<{
      pattern: RegExp;
      label: string;
      modernAlternative: string;
    }> = [
      {
        pattern: /\bnode\s+14\b/i,
        label: 'Node 14 (EOL)',
        modernAlternative: 'Node 20 or Node 22',
      },
      {
        pattern: /\bnode\s+16\b/i,
        label: 'Node 16 (EOL)',
        modernAlternative: 'Node 20 or Node 22',
      },
      {
        pattern: /\bpython\s*2\b/i,
        label: 'Python 2 (EOL)',
        modernAlternative: 'Python 3.x',
      },
      {
        pattern: /\breact\s+16\b/i,
        label: 'React 16 (outdated)',
        modernAlternative: 'React 18 or React 19',
      },
      {
        pattern: /\bwebpack\s*4\b/i,
        label: 'Webpack 4 (outdated)',
        modernAlternative: 'Webpack 5, Vite, or Turbopack',
      },
      {
        pattern: /\btslint\b/i,
        label: 'TSLint (deprecated)',
        modernAlternative: 'ESLint with typescript-eslint',
      },
      {
        pattern: /\bcreate-react-app\b/i,
        label: 'Create React App (deprecated)',
        modernAlternative: 'Vite, Next.js, or Remix',
      },
      {
        pattern: /\bmoment\.js\b/i,
        label: 'Moment.js (legacy)',
        modernAlternative: 'date-fns, dayjs, or Temporal',
      },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];
      for (const { pattern, label, modernAlternative } of stalePatterns) {
        if (pattern.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'info',
            code: 'MEMORY_STALE_REFERENCES',
            message: `Potentially stale reference: "${label}"`,
            suggestion: `Consider updating to ${modernAlternative}. Local files accumulate stale instructions -- review periodically.`,
          });
          break;
        }
      }
    }

    return issues;
  },
};

// ── Rule: MEMORY_TOO_LONG ───────────────────────────────────────────────────

const memoryTooLong: RuleDefinition = {
  meta: {
    id: 'MEMORY_TOO_LONG',
    name: 'CLAUDE.local.md Too Long',
    description:
      'Detects CLAUDE.local.md files that are excessively long (over 200 lines or ~3000 tokens), wasting context on every agent interaction.',
    rationale:
      'Local files load on every agent interaction. Bloated local files waste context tokens on every single request. Keep local config minimal -- preferences and overrides only.',
    recommendation:
      'Trim CLAUDE.local.md to essential personal preferences and machine-specific settings. Move reusable instructions to CLAUDE.md or SKILL.md files.',
    badExample:
      'A 400-line CLAUDE.local.md with copy-pasted documentation, full API references, and detailed workflow descriptions.',
    goodExample:
      'A 30-line CLAUDE.local.md with personal preferences: editor settings, local paths, preferred test verbosity.',
    defaultSeverity: 'warning',
    applicableTo: ['claude-local-md'],
    category: 'memory',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'claude-local-md') return [];

    const nonEmptyLines = countNonEmptyLines(context.lines);
    const estimatedTokens = Math.ceil(context.content.length / 4);

    const issues: ReturnType<RuleDefinition['check']> = [];

    if (nonEmptyLines > 200) {
      issues.push({
        startLine: 1,
        endLine: context.lines.length,
        severity: 'warning',
        code: 'MEMORY_TOO_LONG',
        message: `CLAUDE.local.md has ${nonEmptyLines} non-empty lines (recommended max: 200)`,
        suggestion:
          'Trim to essential personal preferences and machine-specific settings. Every line loads on every agent interaction, wasting context tokens.',
      });
    } else if (estimatedTokens > 3000) {
      issues.push({
        startLine: 1,
        endLine: context.lines.length,
        severity: 'warning',
        code: 'MEMORY_TOO_LONG',
        message: `CLAUDE.local.md has ~${estimatedTokens} estimated tokens (recommended max: ~3000)`,
        suggestion:
          'Trim to essential personal preferences and machine-specific settings. Every token loads on every agent interaction.',
      });
    }

    return issues;
  },
};

/** All memory rules for registration. */
export const memoryRules: RuleDefinition[] = [
  localSecretsExposed,
  localNotGitignored,
  overridesMain,
  staleReferences,
  memoryTooLong,
];
