import { PromptIssue, AgentFileType } from '../types';
import { AgentLintConfig } from '../config/types';
import { RuleDefinition } from './types';
import { registry } from './registry';
import { buildRuleContext } from './utils';

// ── Inline Disable Parsing ──────────────────────────────────────────────────

/**
 * Represents a range of lines where specific rules (or all rules) are disabled.
 * Lines are 0-based indices.
 */
interface DisabledRange {
  /** 0-based start line (inclusive). */
  startLine: number;
  /** 0-based end line (inclusive). -1 means "to end of file". */
  endLine: number;
  /** Rule IDs disabled in this range. Empty set means ALL rules. */
  ruleIds: Set<string>;
}

/**
 * Result of parsing inline disable comments from file content.
 */
interface InlineDisables {
  /** File-level disables (apply to entire file). Empty set in ruleIds = all rules. */
  fileDisables: Set<string>;
  /** Ranges where specific rules are disabled (block disables). */
  disabledRanges: DisabledRange[];
  /** Single-line disables: set of "ruleId:lineIndex" or "*:lineIndex" keys. */
  nextLineDisables: Set<string>;
}

/**
 * Parse inline disable comments from file content.
 *
 * Supported formats (case-insensitive on the directive portion):
 *   <!-- agentlint-disable -->                  (disable ALL rules until enable)
 *   <!-- agentlint-disable RULE_ID -->          (disable specific rule until enable)
 *   <!-- agentlint-disable RULE_A, RULE_B -->   (disable multiple rules until enable)
 *   <!-- agentlint-enable -->                   (re-enable ALL rules)
 *   <!-- agentlint-enable RULE_ID -->           (re-enable specific rule)
 *   <!-- agentlint-enable RULE_A, RULE_B -->    (re-enable multiple rules)
 *   <!-- agentlint-disable-next-line -->        (disable ALL rules for next line)
 *   <!-- agentlint-disable-next-line RULE_ID --> (disable specific rule for next line)
 *   <!-- agentlint-disable-file -->             (disable ALL rules for entire file)
 *   <!-- agentlint-disable-file RULE_ID -->     (disable specific rule for entire file)
 */
function parseInlineDisables(lines: string[]): InlineDisables {
  const fileDisables = new Set<string>();
  const nextLineDisables = new Set<string>();
  const disabledRanges: DisabledRange[] = [];

  // Track currently open disable ranges: Map<ruleId | '*', startLine>
  const openDisables = new Map<string, number>();

  // Regex patterns (case-insensitive on the agentlint directive)
  const disableFileRegex = /<!--\s*agentlint-disable-file(?:\s+([\w\s,]+?))?\s*-->/i;
  const disableNextLineRegex = /<!--\s*agentlint-disable-next-line(?:\s+([\w\s,]+?))?\s*-->/i;
  const disableBlockRegex = /<!--\s*agentlint-disable(?:\s+([\w\s,]+?))?\s*-->/i;
  const enableBlockRegex = /<!--\s*agentlint-enable(?:\s+([\w\s,]+?))?\s*-->/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── File-level disables ──────────────────────────────────────────
    const fileMatch = disableFileRegex.exec(line);
    if (fileMatch) {
      if (fileMatch[1]) {
        const ruleIds = parseRuleIds(fileMatch[1]);
        for (const id of ruleIds) {
          fileDisables.add(id);
        }
      } else {
        fileDisables.add('*');
      }
      continue;
    }

    // ── Next-line disables ───────────────────────────────────────────
    const nextLineMatch = disableNextLineRegex.exec(line);
    if (nextLineMatch) {
      const targetLine = i + 1;
      if (nextLineMatch[1]) {
        const ruleIds = parseRuleIds(nextLineMatch[1]);
        for (const id of ruleIds) {
          nextLineDisables.add(`${id}:${targetLine}`);
        }
      } else {
        nextLineDisables.add(`*:${targetLine}`);
      }
      continue;
    }

    // ── Enable block (must be checked before disable block) ──────────
    const enableMatch = enableBlockRegex.exec(line);
    if (enableMatch) {
      if (enableMatch[1]) {
        const ruleIds = parseRuleIds(enableMatch[1]);
        for (const id of ruleIds) {
          const startLine = openDisables.get(id);
          if (startLine !== undefined) {
            disabledRanges.push({
              startLine,
              endLine: i - 1, // The line before enable is the last disabled line
              ruleIds: new Set([id]),
            });
            openDisables.delete(id);
          }
        }
      } else {
        // Enable all: close all open disables
        for (const [key, startLine] of openDisables) {
          disabledRanges.push({
            startLine,
            endLine: i - 1,
            ruleIds: key === '*' ? new Set<string>() : new Set([key]),
          });
        }
        openDisables.clear();
      }
      continue;
    }

    // ── Disable block (open a range) ─────────────────────────────────
    const disableMatch = disableBlockRegex.exec(line);
    if (disableMatch) {
      if (disableMatch[1]) {
        const ruleIds = parseRuleIds(disableMatch[1]);
        for (const id of ruleIds) {
          if (!openDisables.has(id)) {
            openDisables.set(id, i + 1); // Disable starts on the line AFTER the comment
          }
        }
      } else {
        // Disable all rules
        if (!openDisables.has('*')) {
          openDisables.set('*', i + 1);
        }
      }
      continue;
    }
  }

  // Close any unclosed disable ranges (extend to end of file)
  for (const [key, startLine] of openDisables) {
    disabledRanges.push({
      startLine,
      endLine: lines.length - 1,
      ruleIds: key === '*' ? new Set<string>() : new Set([key]),
    });
  }

  return { fileDisables, disabledRanges, nextLineDisables };
}

/**
 * Parse a comma-separated list of rule IDs, handling whitespace and trailing commas.
 */
function parseRuleIds(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^\w+$/.test(s));
}

// ── Issue Filtering ─────────────────────────────────────────────────────────

/**
 * Check if a specific issue is disabled by inline comments.
 * issue.startLine is 1-based; internal structures use 0-based line indices.
 */
function isIssueDisabledInline(
  issue: PromptIssue,
  disables: InlineDisables
): boolean {
  // File-level disable all
  if (disables.fileDisables.has('*')) return true;

  // File-level disable specific rule
  if (disables.fileDisables.has(issue.code)) return true;

  // Convert 1-based issue line to 0-based
  const lineIndex = issue.startLine - 1;

  // Next-line disable (all rules)
  if (disables.nextLineDisables.has(`*:${lineIndex}`)) return true;

  // Next-line disable (specific rule)
  if (disables.nextLineDisables.has(`${issue.code}:${lineIndex}`)) return true;

  // Range-based disables
  for (const range of disables.disabledRanges) {
    if (lineIndex >= range.startLine && lineIndex <= range.endLine) {
      // Empty ruleIds set means all rules are disabled
      if (range.ruleIds.size === 0) return true;
      if (range.ruleIds.has(issue.code)) return true;
    }
  }

  return false;
}

// ── Config-Based Rule Filtering ─────────────────────────────────────────────

/**
 * Check if a rule is disabled by config (rules or categories maps).
 * Returns true if the rule should be skipped entirely.
 */
function isRuleDisabledByConfig(
  rule: RuleDefinition,
  config: AgentLintConfig | undefined,
  filePath: string | undefined
): boolean {
  if (!config) return false;

  // Check per-rule config: rules[id] === 'off'
  if (config.rules) {
    const ruleConfig = config.rules[rule.meta.id];
    if (ruleConfig === 'off' || ruleConfig === false) return true;
  }

  // Check per-category config: categories[cat] === 'off'
  if (config.categories) {
    const catConfig = config.categories[rule.meta.category];
    if (catConfig === 'off' || catConfig === false) return true;
  }

  // Check file-specific overrides
  if (config.overrides && filePath) {
    for (const ov of config.overrides) {
      const patterns = Array.isArray(ov.files) ? ov.files : [ov.files];
      const matches = patterns.some((p) => filePath.includes(p));
      if (matches && ov.rules) {
        const fileRuleConfig = ov.rules[rule.meta.id];
        if (fileRuleConfig === 'off' || fileRuleConfig === false) return true;
      }
    }
  }

  // Legacy field support: disabledRules
  if (config.disabledRules?.length) {
    if (config.disabledRules.includes(rule.meta.id)) return true;
  }

  // Legacy field support: disabledCategories
  if (config.disabledCategories?.length) {
    if (config.disabledCategories.includes(rule.meta.category)) return true;
  }

  return false;
}

/**
 * Determine the effective severity for an issue based on config overrides.
 * Checks (in order): file-specific overrides, per-rule config, per-category config, legacy fields.
 * Returns null if the rule should be suppressed ('off').
 */
function getEffectiveSeverity(
  issue: PromptIssue,
  ruleDef: RuleDefinition | undefined,
  config?: AgentLintConfig,
  filePath?: string
): 'error' | 'warning' | 'info' | null {
  if (!config) return issue.severity;

  // ── File-specific overrides (highest priority) ────────────────────
  if (config.overrides && filePath) {
    for (const ov of config.overrides) {
      const patterns = Array.isArray(ov.files) ? ov.files : [ov.files];
      const matches = patterns.some((p) => filePath.includes(p));
      if (matches && ov.rules) {
        const fileRuleConfig = ov.rules[issue.code];
        if (fileRuleConfig === 'off' || fileRuleConfig === false) return null;
        if (fileRuleConfig === 'error' || fileRuleConfig === 'warning' || fileRuleConfig === 'info') {
          return fileRuleConfig;
        }
      }
    }
  }

  // ── Per-rule config ───────────────────────────────────────────────
  if (config.rules) {
    const ruleConfig = config.rules[issue.code];
    if (ruleConfig === 'off' || ruleConfig === false) return null;
    if (ruleConfig === 'error' || ruleConfig === 'warning' || ruleConfig === 'info') {
      return ruleConfig;
    }
  }

  // ── Per-category config ───────────────────────────────────────────
  if (config.categories && ruleDef) {
    const catConfig = config.categories[ruleDef.meta.category];
    if (catConfig === 'off' || catConfig === false) return null;
    if (catConfig === 'error' || catConfig === 'warning' || catConfig === 'info') {
      return catConfig;
    }
  }

  // ── Legacy field: severityOverrides ───────────────────────────────
  if (config.severityOverrides) {
    const override = config.severityOverrides[issue.code];
    if (override === 'off') return null;
    if (override) return override;
  }

  return issue.severity;
}

// ── Main Engine Entry Point ─────────────────────────────────────────────────

/**
 * Main entry point for the rule engine.
 *
 * Takes file content, file type, and optional file path + config.
 * Builds context, selects applicable rules, runs them, filters results
 * by inline disables and config overrides, and returns the final list of PromptIssue[].
 */
export function runRules(
  content: string,
  fileType: AgentFileType,
  filePath?: string,
  config?: AgentLintConfig
): PromptIssue[] {
  const context = buildRuleContext(content, fileType, filePath || '');

  // Get all rules applicable to this file type
  const allApplicable: RuleDefinition[] = registry.getApplicableTo(fileType);

  // Filter out rules disabled by config (rules, categories, file-specific overrides)
  const applicableRules = allApplicable.filter(
    (r) => !isRuleDisabledByConfig(r, config, filePath)
  );

  // Parse inline disable comments
  const inlineDisables = parseInlineDisables(context.lines);

  // Run each applicable rule and collect issues
  const allIssues: PromptIssue[] = [];

  for (const rule of applicableRules) {
    try {
      const issues = rule.check(context);
      allIssues.push(...issues);
    } catch {
      // If a rule throws, skip it silently to avoid breaking the whole lint run.
    }
  }

  // Filter by inline disables and apply severity overrides
  const filtered: PromptIssue[] = [];
  for (const issue of allIssues) {
    if (isIssueDisabledInline(issue, inlineDisables)) continue;

    const ruleDef = registry.get(issue.code);
    const severity = getEffectiveSeverity(issue, ruleDef, config, filePath);
    if (severity === null) continue;

    filtered.push({ ...issue, severity });
  }

  return filtered;
}
