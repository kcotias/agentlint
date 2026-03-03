/** Severity level or "off" to disable. `false` is an alias for "off". */
export type RuleSeverityConfig = 'error' | 'warning' | 'info' | 'off' | false;

/**
 * AgentLint configuration loaded from .agentlint.json or agentlint.config.json.
 *
 * User-facing format:
 * ```json
 * {
 *   "rules": { "HEDGING_LANGUAGE": "off", "FILE_TOO_LONG": "warning" },
 *   "categories": { "copilot": "off", "cursor": "off" },
 *   "overrides": [
 *     { "files": ["CLAUDE.local.md"], "rules": { "FILE_TOO_LONG": "off" } }
 *   ]
 * }
 * ```
 */
export interface AgentLintConfig {
  /**
   * Per-rule severity overrides.
   * - `"off"` or `false` disables the rule entirely.
   * - `"error"`, `"warning"`, `"info"` override the default severity.
   */
  rules?: Record<string, RuleSeverityConfig>;

  /**
   * Per-category overrides.
   * - `"off"` or `false` disables all rules in that category.
   * - `"error"`, `"warning"`, `"info"` override default severity for all rules in the category.
   */
  categories?: Record<string, RuleSeverityConfig>;

  /** File-specific overrides. Applied when the file path matches any pattern in `files`. */
  overrides?: Array<{
    /** Glob patterns or substrings to match against the file path. */
    files: string | string[];
    /** Per-rule severity overrides for matched files. */
    rules?: Record<string, RuleSeverityConfig>;
  }>;

  // ── Legacy fields (kept for backward compatibility with existing configs) ──

  /** @deprecated Use `rules` with `"off"` value instead. */
  disabledRules?: string[];

  /** @deprecated Use `rules` instead. */
  severityOverrides?: Record<string, 'error' | 'warning' | 'info' | 'off'>;

  /** @deprecated Use `categories` with `"off"` value instead. */
  disabledCategories?: string[];
}
