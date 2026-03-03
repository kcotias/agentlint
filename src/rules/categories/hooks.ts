import { RuleDefinition } from '../types';
import { isInsideCodeBlock, isInsideFrontmatter } from '../utils';

/**
 * Hook validation rules (Tier 3).
 *
 * Claude Code hooks are shell commands that run on specific events.
 * They are configured in .claude/settings.json but documented in CLAUDE.md.
 * These rules validate hook-related instructions.
 */

/** Valid Claude Code hook event names */
const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
];

/** Pattern that indicates a line is discussing hooks */
const HOOK_CONTEXT_PATTERN =
  /\b(hook|hooks|PreToolUse|PostToolUse|Notification|SubagentStop|pre[-_]?tool|post[-_]?tool)\b/i;

/** Valid Claude Code tool names for hook matchers */
const VALID_TOOL_NAMES = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoRead',
  'TodoWrite',
  'Task',
  'NotebookEdit',
];

/** Common incorrect tool name references and what they should be */
const INVALID_TOOL_MATCHERS: Record<string, string> = {
  Execute: 'Bash',
  Run: 'Bash',
  Shell: 'Bash',
  Cat: 'Read',
  Search: 'Grep or Glob',
  Find: 'Glob or Grep',
  Fetch: 'WebFetch',
  Browse: 'WebFetch',
  Todo: 'TodoRead or TodoWrite',
};

// ── Rule 1: HOOK_MISSING_EVENT ──────────────────────────────────────────────

const hookMissingEvent: RuleDefinition = {
  meta: {
    id: 'HOOK_MISSING_EVENT',
    name: 'Hook Missing Event Trigger',
    description:
      'Detects hook configurations that do not specify a trigger event (PreToolUse, PostToolUse, Notification, Stop, SubagentStop).',
    rationale:
      'Hooks without clear event triggers are ambiguous. The agent cannot determine when to execute them, leading to hooks that either never fire or fire at unexpected times.',
    recommendation:
      'Specify the hook event: PreToolUse, PostToolUse, Notification, Stop, or SubagentStop.',
    badExample:
      '## Hooks\n- Run `npm run lint` after changes\n- Execute `prettier --write` on save',
    goodExample:
      '## Hooks\n- **PostToolUse (Write)**: Run `npm run lint` after file writes\n- **PreToolUse (Bash)**: Validate command before execution',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md', 'claude-rules'],
    category: 'hooks',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Find sections that discuss hooks
    let inHookSection = false;
    let hookSectionStart = -1;
    let hookSectionHasEvent = false;
    let hookSectionLineCount = 0;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Detect hook section headers
      const isHookHeader = /^#{1,4}\s+.*\bhooks?\b/i.test(line);

      // Detect a new section header (any heading)
      const isAnyHeader = /^#{1,6}\s/.test(line);

      if (isHookHeader) {
        // If we were already in a hook section, evaluate it
        if (inHookSection && !hookSectionHasEvent && hookSectionLineCount > 1) {
          issues.push({
            startLine: hookSectionStart + 1,
            endLine: i,
            severity: 'warning',
            code: 'HOOK_MISSING_EVENT',
            message:
              'Hook section does not specify a trigger event (PreToolUse, PostToolUse, etc.)',
            suggestion:
              'Specify the hook event: PreToolUse, PostToolUse, Notification, Stop, or SubagentStop.',
          });
        }
        inHookSection = true;
        hookSectionStart = i;
        hookSectionHasEvent = false;
        hookSectionLineCount = 0;
        continue;
      }

      if (isAnyHeader && inHookSection) {
        // Leaving hook section, evaluate
        if (!hookSectionHasEvent && hookSectionLineCount > 1) {
          issues.push({
            startLine: hookSectionStart + 1,
            endLine: i,
            severity: 'warning',
            code: 'HOOK_MISSING_EVENT',
            message:
              'Hook section does not specify a trigger event (PreToolUse, PostToolUse, etc.)',
            suggestion:
              'Specify the hook event: PreToolUse, PostToolUse, Notification, Stop, or SubagentStop.',
          });
        }
        inHookSection = false;
        continue;
      }

      if (inHookSection) {
        hookSectionLineCount++;
        // Check if this line mentions a valid event
        if (HOOK_EVENTS.some((evt) => line.includes(evt))) {
          hookSectionHasEvent = true;
        }
      }
    }

    // Handle end-of-file while still in hook section
    if (inHookSection && !hookSectionHasEvent && hookSectionLineCount > 1) {
      issues.push({
        startLine: hookSectionStart + 1,
        endLine: context.lines.length,
        severity: 'warning',
        code: 'HOOK_MISSING_EVENT',
        message:
          'Hook section does not specify a trigger event (PreToolUse, PostToolUse, etc.)',
        suggestion:
          'Specify the hook event: PreToolUse, PostToolUse, Notification, Stop, or SubagentStop.',
      });
    }

    return issues;
  },
};

// ── Rule 2: HOOK_DANGEROUS_COMMAND ──────────────────────────────────────────

const hookDangerousCommand: RuleDefinition = {
  meta: {
    id: 'HOOK_DANGEROUS_COMMAND',
    name: 'Dangerous Command in Hook',
    description:
      'Detects dangerous or destructive commands in hook definitions such as rm -rf, DROP TABLE, format, mkfs, dd, chmod 777, or fork bombs.',
    rationale:
      'Hooks execute automatically without user confirmation. Destructive commands in hooks can cause irreversible damage to files, databases, or system state.',
    recommendation:
      'Remove dangerous commands from hook definitions. Use safe alternatives with proper guards.',
    badExample:
      '## Hooks\n- PostToolUse: `rm -rf /tmp/build && rebuild`\n- PreToolUse: `chmod 777 ./deploy`',
    goodExample:
      '## Hooks\n- PostToolUse: `rm -rf ./build/output` (scoped to build dir)\n- PreToolUse: `chmod 755 ./deploy/scripts`',
    defaultSeverity: 'error',
    applicableTo: 'all',
    category: 'hooks',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const dangerousPatterns: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /\brm\s+-rf\s+\/(?!\w)/, label: 'rm -rf /' },
      { pattern: /\brm\s+-r\s+\/(?!\w)/, label: 'rm -r /' },
      { pattern: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE' },
      { pattern: /\bDROP\s+DATABASE\b/i, label: 'DROP DATABASE' },
      { pattern: /\bformat\s+C:/i, label: 'format C:' },
      { pattern: /\bmkfs\b/, label: 'mkfs' },
      { pattern: /\bdd\s+if=/, label: 'dd if=' },
      { pattern: /\bchmod\s+(-R\s+)?777\b/, label: 'chmod 777' },
      { pattern: /:\(\)\{\s*:\|:&\s*\};:/, label: 'fork bomb' },
      { pattern: />\s*\/dev\/sda/, label: '> /dev/sda' },
    ];

    // We need hook-like context to flag these -- don't flag random mentions
    let inHookContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) {
        // Still check inside code blocks if we're in a hook context
        // because hooks are often defined with inline code
        if (!inHookContext) continue;
      }
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track hook context: entering/leaving a hook section or seeing hook keywords
      if (HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = true;
      }
      // Leave hook context if we hit a new top-level section that isn't about hooks
      if (/^#{1,3}\s/.test(line) && !HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = false;
      }

      if (!inHookContext) continue;

      for (const { pattern, label } of dangerousPatterns) {
        if (pattern.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'error',
            code: 'HOOK_DANGEROUS_COMMAND',
            message: `Dangerous command "${label}" found in hook definition`,
            suggestion:
              'Remove dangerous commands from hook definitions. Use safe alternatives with proper guards.',
          });
        }
      }
    }

    return issues;
  },
};

// ── Rule 3: HOOK_MISSING_TIMEOUT ────────────────────────────────────────────

const hookMissingTimeout: RuleDefinition = {
  meta: {
    id: 'HOOK_MISSING_TIMEOUT',
    name: 'Hook Missing Timeout Guidance',
    description:
      'Detects hook instructions referencing long-running commands (curl, wget, npm install, docker, etc.) without timeout guidance.',
    rationale:
      'Hooks that hang will block the entire agent session. Claude Code has a 60-second default timeout, but documented hooks should be explicit about expected duration.',
    recommendation:
      'Add timeout guidance for long-running hook commands. Example: "timeout 30 npm test" or mention the expected duration.',
    badExample:
      '## Hooks\n- PostToolUse (Write): Run `npm install` after package.json changes',
    goodExample:
      '## Hooks\n- PostToolUse (Write): Run `timeout 60 npm install` after package.json changes (expected: <30s)',
    defaultSeverity: 'info',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'hooks',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const longRunningCommands =
      /\b(curl|wget|npm\s+install|pip\s+install|yarn\s+install|pnpm\s+install|docker|git\s+clone|git\s+pull|apt-get|brew\s+install|cargo\s+build)\b/i;
    const timeoutIndicators =
      /\b(timeout|max[-_]?duration|time[-_]?limit|\d+\s*seconds?|\d+s\b|--timeout|deadline)\b/i;

    let inHookContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track hook context
      if (HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = false;
      }

      if (!inHookContext) continue;

      if (longRunningCommands.test(line)) {
        // Check the current line and nearby lines (2 before, 2 after) for timeout guidance
        const nearby = context.lines
          .slice(Math.max(0, i - 2), Math.min(context.lines.length, i + 3))
          .join(' ');
        if (!timeoutIndicators.test(nearby)) {
          const match = line.match(longRunningCommands);
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'info',
            code: 'HOOK_MISSING_TIMEOUT',
            message: `Long-running command "${match?.[1]}" in hook without timeout guidance`,
            suggestion:
              'Add timeout guidance for long-running hook commands. Example: "timeout 30 npm test" or mention the expected duration.',
          });
        }
      }
    }

    return issues;
  },
};

// ── Rule 4: HOOK_INVALID_MATCHER ────────────────────────────────────────────

const hookInvalidMatcher: RuleDefinition = {
  meta: {
    id: 'HOOK_INVALID_MATCHER',
    name: 'Hook Invalid Tool Matcher',
    description:
      'Detects hook matcher patterns that reference non-existent Claude Code tools (e.g., "Execute" instead of "Bash", "Cat" instead of "Read").',
    rationale:
      'A hook with the wrong tool matcher will never fire, making it silently ineffective. Tool names are case-sensitive in Claude Code.',
    recommendation:
      'Use valid Claude Code tool names: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Task.',
    badExample:
      '## Hooks\n- PreToolUse (Execute): validate the command\n- PostToolUse (Search): check results',
    goodExample:
      '## Hooks\n- PreToolUse (Bash): validate the command\n- PostToolUse (Grep): check results',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'hooks',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Pattern: PreToolUse/PostToolUse followed by a tool name in parens or after colon
    const matcherPattern =
      /\b(PreToolUse|PostToolUse)\s*[\(:]\s*(\w+)/gi;

    let inHookContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track hook context
      if (HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = false;
      }

      if (!inHookContext) continue;

      let match: RegExpExecArray | null;
      // Reset lastIndex because we use the 'g' flag
      matcherPattern.lastIndex = 0;
      while ((match = matcherPattern.exec(line)) !== null) {
        const toolName = match[2];
        // Skip if it's a valid tool
        if (VALID_TOOL_NAMES.includes(toolName)) continue;

        // Check if it's a known invalid name
        const suggestion = INVALID_TOOL_MATCHERS[toolName];
        const correctionHint = suggestion
          ? ` Did you mean "${suggestion}"?`
          : '';

        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'warning',
          code: 'HOOK_INVALID_MATCHER',
          message: `Invalid tool matcher "${toolName}" in hook definition.${correctionHint}`,
          suggestion:
            'Use valid Claude Code tool names: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Task.',
        });
      }
    }

    return issues;
  },
};

// ── Rule 5: HOOK_SCRIPT_PATH_MISSING ────────────────────────────────────────

const hookScriptPathMissing: RuleDefinition = {
  meta: {
    id: 'HOOK_SCRIPT_PATH_MISSING',
    name: 'Hook References Potentially Missing Script',
    description:
      'Detects hook definitions that reference local script files which may not exist (placeholder paths, TODO markers, or template patterns).',
    rationale:
      'A hook that references `./scripts/pre-commit-lint.sh` fails silently if that file does not exist. The agent runs, the hook fires, and nothing happens — no error, no feedback.',
    recommendation:
      'Verify that referenced script paths exist. Consider using inline commands instead of script files for simpler hooks.',
    badExample:
      '## Hooks\n- PostToolUse (Write): Run `./scripts/TODO-lint.sh`\n- PreToolUse (Bash): Execute `bash scripts/placeholder.sh`',
    goodExample:
      '## Hooks\n- PostToolUse (Write): Run `npx eslint --fix`\n- PreToolUse (Bash): Execute `bash ./scripts/validate-cmd.sh` (committed in repo)',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'hooks',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Pattern to detect script file references in hook contexts
    const scriptPathPattern =
      /(?:bash|sh|python|python3|node|ruby|perl|zsh)\s+(?:\.\/)?([^\s`"']+\.(?:sh|py|js|ts|rb|pl))|(?:\.\/)(scripts?\/[^\s`"']+|hooks?\/[^\s`"']+)/gi;

    // Indicators the path is a placeholder or template
    const placeholderPattern =
      /\b(TODO|FIXME|placeholder|example|your[-_]?script|CHANGEME|xxx|template)\b/i;

    let inHookContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track hook context
      if (HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = false;
      }

      if (!inHookContext) continue;

      // Reset lastIndex for global regex
      scriptPathPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = scriptPathPattern.exec(line)) !== null) {
        const scriptPath = match[1] || match[2];
        if (!scriptPath) continue;

        if (placeholderPattern.test(scriptPath) || placeholderPattern.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'HOOK_SCRIPT_PATH_MISSING',
            message: `Hook references script "${scriptPath}" which appears to be a placeholder or template`,
            suggestion:
              'Verify that referenced script paths exist. Consider using inline commands instead of script files for simpler hooks.',
          });
        }
      }
    }

    return issues;
  },
};

// ── Rule 6: HOOK_CONFLICTING_EVENTS ─────────────────────────────────────────

const hookConflictingEvents: RuleDefinition = {
  meta: {
    id: 'HOOK_CONFLICTING_EVENTS',
    name: 'Hook Conflicting Pre/Post Events',
    description:
      'Detects when the same command or tool (e.g., prettier, eslint --fix) appears in both PreToolUse and PostToolUse hooks for the same tool.',
    rationale:
      'Running the same formatter in both PreToolUse and PostToolUse is redundant and wastes time. More dangerously, conflicting Pre/Post hooks can create infinite loops.',
    recommendation:
      'Choose either PreToolUse or PostToolUse for each operation, not both. Pre is for validation, Post is for side effects.',
    badExample:
      '## Hooks\n- PreToolUse (Write): `prettier --write`\n- PostToolUse (Write): `prettier --write`',
    goodExample:
      '## Hooks\n- PreToolUse (Write): `eslint --check` (validate)\n- PostToolUse (Write): `prettier --write` (format)',
    defaultSeverity: 'info',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'hooks',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Common commands that would be problematic if in both Pre and Post
    const commandPattern =
      /\b(prettier|eslint|black|autopep8|yapf|gofmt|rustfmt|rubocop|clang-format|isort|stylelint|biome|deno\s+fmt|ruff)\b/gi;

    // Track Pre and Post tool+command combos
    const preToolCommands: Map<string, { line: number; command: string }[]> =
      new Map();
    const postToolCommands: Map<string, { line: number; command: string }[]> =
      new Map();

    // Matcher pattern: PreToolUse/PostToolUse with tool name
    const hookEventPattern =
      /\b(PreToolUse|PostToolUse)\s*[\(:]\s*(\w+)/i;

    let inHookContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track hook context
      if (HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = false;
      }

      if (!inHookContext) continue;

      const eventMatch = line.match(hookEventPattern);
      if (!eventMatch) continue;

      const eventType = eventMatch[1]; // PreToolUse or PostToolUse
      const toolName = eventMatch[2]; // e.g., Write, Bash

      // Find commands on this line
      commandPattern.lastIndex = 0;
      let cmdMatch: RegExpExecArray | null;
      while ((cmdMatch = commandPattern.exec(line)) !== null) {
        const cmd = cmdMatch[1].toLowerCase();
        const key = `${toolName}:${cmd}`;
        const entry = { line: i, command: cmd };

        if (eventType === 'PreToolUse') {
          if (!preToolCommands.has(key)) preToolCommands.set(key, []);
          preToolCommands.get(key)!.push(entry);
        } else {
          if (!postToolCommands.has(key)) postToolCommands.set(key, []);
          postToolCommands.get(key)!.push(entry);
        }
      }
    }

    // Find overlaps
    for (const [key, preEntries] of preToolCommands) {
      const postEntries = postToolCommands.get(key);
      if (postEntries && postEntries.length > 0) {
        const [toolName, cmd] = key.split(':');
        issues.push({
          startLine: preEntries[0].line + 1,
          endLine: postEntries[0].line + 1,
          severity: 'info',
          code: 'HOOK_CONFLICTING_EVENTS',
          message: `Command "${cmd}" appears in both PreToolUse and PostToolUse for ${toolName}`,
          suggestion:
            'Choose either PreToolUse or PostToolUse for each operation, not both. Pre is for validation, Post is for side effects.',
        });
      }
    }

    return issues;
  },
};

// ── Rule 7: HOOK_MODIFIES_AGENT_FILES ───────────────────────────────────────

const hookModifiesAgentFiles: RuleDefinition = {
  meta: {
    id: 'HOOK_MODIFIES_AGENT_FILES',
    name: 'Hook Modifies Agent Instruction Files',
    description:
      'Detects hooks that modify agent instruction files themselves (CLAUDE.md, .claude/rules/, SKILL.md, .cursorrules, etc.).',
    rationale:
      'Hooks that modify agent config files create feedback loops — the config changes trigger re-analysis, which triggers hooks, which modify config again.',
    recommendation:
      'Hooks should not modify agent instruction files. This creates infinite re-analysis loops.',
    badExample:
      '## Hooks\n- PostToolUse (Write): `echo "new rule" >> CLAUDE.md`\n- PostToolUse: `sed -i "s/old/new/" .claude/rules/lint.md`',
    goodExample:
      '## Hooks\n- PostToolUse (Write): `npx eslint --fix`\n- PostToolUse (Bash): `npm run test`',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'hooks',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Agent config file patterns
    const agentFilePattern =
      /\b(CLAUDE\.md|CLAUDE\.local\.md|SKILL\.md|\.claude\/rules|\.claude\/settings|\.cursorrules|\.cursor\/rules|copilot-instructions\.md|\.github\/copilot-instructions)\b/i;

    // Write operation patterns
    const writeOpPattern =
      /(?:>>?\s|sed\s+-i|echo\s+.*>|write|edit|modify|append|cat\s+.*>|tee\s)/i;

    let inHookContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track hook context
      if (HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !HOOK_CONTEXT_PATTERN.test(line)) {
        inHookContext = false;
      }

      if (!inHookContext) continue;

      if (agentFilePattern.test(line) && writeOpPattern.test(line)) {
        const fileMatch = line.match(agentFilePattern);
        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'warning',
          code: 'HOOK_MODIFIES_AGENT_FILES',
          message: `Hook appears to modify agent instruction file "${fileMatch?.[1]}"`,
          suggestion:
            'Hooks should not modify agent instruction files. This creates infinite re-analysis loops.',
        });
      }
    }

    return issues;
  },
};

/** All hook validation rules for registration. */
export const hooksRules: RuleDefinition[] = [
  hookMissingEvent,
  hookDangerousCommand,
  hookMissingTimeout,
  hookInvalidMatcher,
  hookScriptPathMissing,
  hookConflictingEvents,
  hookModifiesAgentFiles,
];
