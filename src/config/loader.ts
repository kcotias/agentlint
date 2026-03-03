import * as fs from 'fs';
import * as path from 'path';
import { AgentLintConfig } from './types';

/** Config file names, in priority order (first found wins). */
const CONFIG_FILENAMES = ['.agentlint.json', 'agentlint.config.json'];

/** Default (empty) configuration when no config file is found. */
const DEFAULT_CONFIG: AgentLintConfig = {};

/**
 * Normalize a severity value: converts `false` to `'off'`, passes through valid strings.
 * Returns undefined for unrecognized values (they'll be silently ignored).
 */
function normalizeSeverity(
  value: unknown
): 'error' | 'warning' | 'info' | 'off' | undefined {
  if (value === false) return 'off';
  if (value === 'error' || value === 'warning' || value === 'info' || value === 'off') {
    return value;
  }
  return undefined;
}

/**
 * Normalize a rules/categories record: convert `false` → `'off'`, drop invalid values.
 */
function normalizeRecord(
  raw: Record<string, unknown> | undefined
): Record<string, 'error' | 'warning' | 'info' | 'off'> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const result: Record<string, 'error' | 'warning' | 'info' | 'off'> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeSeverity(value);
    if (normalized) {
      result[key] = normalized;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Normalize and validate a parsed config object.
 * - Converts `false` → `'off'` everywhere
 * - Drops unknown/invalid severity values silently
 * - Merges legacy fields (`disabledRules`, `severityOverrides`, `disabledCategories`)
 *   into the new `rules`/`categories` format
 */
function normalizeConfig(raw: Record<string, unknown>): AgentLintConfig {
  const config: AgentLintConfig = {};

  // ── New-format fields ────────────────────────────────────────────────────

  const rulesRecord = normalizeRecord(raw.rules as Record<string, unknown> | undefined);
  if (rulesRecord) {
    config.rules = rulesRecord;
  }

  const categoriesRecord = normalizeRecord(raw.categories as Record<string, unknown> | undefined);
  if (categoriesRecord) {
    config.categories = categoriesRecord;
  }

  // Overrides
  if (Array.isArray(raw.overrides)) {
    const normalizedOverrides: AgentLintConfig['overrides'] = [];
    for (const ov of raw.overrides) {
      if (!ov || typeof ov !== 'object') continue;
      const ovObj = ov as Record<string, unknown>;

      // `files` can be string or string[]
      let files: string | string[] | undefined;
      if (typeof ovObj.files === 'string') {
        files = ovObj.files;
      } else if (Array.isArray(ovObj.files)) {
        files = ovObj.files.filter((f: unknown) => typeof f === 'string') as string[];
      }
      if (!files || (Array.isArray(files) && files.length === 0)) continue;

      const ovRules = normalizeRecord(ovObj.rules as Record<string, unknown> | undefined);

      normalizedOverrides.push({
        files,
        ...(ovRules ? { rules: ovRules } : {}),
      });
    }
    if (normalizedOverrides.length > 0) {
      config.overrides = normalizedOverrides;
    }
  }

  // ── Legacy field migration ───────────────────────────────────────────────
  // Merge legacy fields into the new format. New-format values take precedence.

  // disabledRules → rules[id] = 'off'
  if (Array.isArray(raw.disabledRules)) {
    if (!config.rules) config.rules = {};
    for (const id of raw.disabledRules) {
      if (typeof id === 'string' && !(id in config.rules)) {
        config.rules[id] = 'off';
      }
    }
  }

  // severityOverrides → rules[id] = severity
  if (raw.severityOverrides && typeof raw.severityOverrides === 'object') {
    if (!config.rules) config.rules = {};
    for (const [id, value] of Object.entries(raw.severityOverrides as Record<string, unknown>)) {
      if (!(id in config.rules)) {
        const normalized = normalizeSeverity(value);
        if (normalized) {
          config.rules[id] = normalized;
        }
      }
    }
  }

  // disabledCategories → categories[cat] = 'off'
  if (Array.isArray(raw.disabledCategories)) {
    if (!config.categories) config.categories = {};
    for (const cat of raw.disabledCategories) {
      if (typeof cat === 'string' && !(cat in config.categories)) {
        config.categories[cat] = 'off';
      }
    }
  }

  return config;
}

/**
 * Load AgentLint configuration from the given directory.
 *
 * Looks for `.agentlint.json` or `agentlint.config.json` (first found wins).
 * Returns a default empty config if no config file is found.
 * Logs a warning to console (not vscode) if the config file has syntax errors.
 *
 * This function works WITHOUT vscode — safe for CLI usage.
 */
export function loadConfig(rootDir: string): AgentLintConfig {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(rootDir, filename);

    if (!fs.existsSync(configPath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.warn(
          `AgentLint: Config file ${filename} has invalid structure (expected a JSON object). Using defaults.`
        );
        return { ...DEFAULT_CONFIG };
      }

      return normalizeConfig(parsed as Record<string, unknown>);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `AgentLint: Failed to parse ${filename}: ${message}. Using defaults.`
      );
      return { ...DEFAULT_CONFIG };
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Load config from a specific file path.
 * Throws if the file doesn't exist or can't be parsed.
 */
export function loadConfigFromFile(filePath: string): AgentLintConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Config file has invalid structure (expected a JSON object).`);
  }

  return normalizeConfig(parsed as Record<string, unknown>);
}

/**
 * Resolve the path to the config file if it exists, or undefined.
 * Useful for setting up file watchers.
 */
export function findConfigPath(rootDir: string): string | undefined {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(rootDir, filename);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return undefined;
}
