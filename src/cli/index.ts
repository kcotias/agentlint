#!/usr/bin/env node

/**
 * AgentLint CLI — lint agent instruction files from the command line.
 *
 * Usage:
 *   npx agentlint                      Scan cwd for agent files and lint them
 *   npx agentlint path/to/CLAUDE.md    Lint a specific file
 *   npx agentlint --fix                Auto-fix fixable issues
 *   npx agentlint --score              Show readiness score
 *   npx agentlint --report             Full AI readiness report
 *   npx agentlint --strict             Treat warnings as errors
 *   npx agentlint --format json        JSON output for CI
 *   npx agentlint --format stylish     Pretty terminal output (default)
 *   npx agentlint --format github      GitHub Actions annotations
 *   npx agentlint --list-rules         List all available rules
 *   npx agentlint --help               Show help
 *   npx agentlint --version            Show version
 *
 * Exit codes:
 *   0 — No errors found
 *   1 — Lint errors found (or warnings, when --strict)
 *   2 — Fatal / configuration error
 */

import * as fs from 'fs';
import * as path from 'path';
import { PromptIssue, AgentFileType } from '../types';
import { registerAllRules } from '../rules/allRules';
import { runRules } from '../rules/engine';
import { registry } from '../rules/registry';
import { loadConfig, loadConfigFromFile } from '../config/loader';
import { AgentLintConfig } from '../config/types';
import { findAgentFiles, detectFileType } from './scanner';
import {
  FileResult,
  formatStylish,
  formatJson,
  formatGitHub,
  formatScore,
  formatRuleList,
  computeSummary,
} from './reporter';
import { scanReadiness } from '../readiness/core';
import { renderReportMarkdown } from '../readiness/renderer';
import { initAnalytics, track, flushAnalytics, getOrCreateCliDistinctId } from '../analytics';

// ── Argument parsing ─────────────────────────────────────────────────────────

interface CliOptions {
  /** File or directory targets (positional args) */
  targets: string[];
  /** Output format */
  format: 'stylish' | 'json' | 'github';
  /** Apply auto-fixes */
  fix: boolean;
  /** Show readiness score */
  score: boolean;
  /** Show full AI readiness report */
  report: boolean;
  /** Treat warnings as errors */
  strict: boolean;
  /** List all rules */
  listRules: boolean;
  /** Path to a custom config file */
  config: string;
  /** Only show errors (suppress warnings and info) */
  quiet: boolean;
  /** Create a .agentlint.json config file */
  init: boolean;
  /** Disable telemetry for this run */
  noTelemetry: boolean;
  /** Show help */
  help: boolean;
  /** Show version */
  version: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    targets: [],
    format: 'stylish',
    fix: false,
    score: false,
    report: false,
    strict: false,
    listRules: false,
    config: '',
    quiet: false,
    init: false,
    noTelemetry: false,
    help: false,
    version: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--version':
      case '-v':
        opts.version = true;
        break;
      case '--fix':
        opts.fix = true;
        break;
      case '--score':
        opts.score = true;
        break;
      case '--report':
        opts.report = true;
        break;
      case '--strict':
        opts.strict = true;
        break;
      case '--list-rules':
        opts.listRules = true;
        break;
      case '--config': {
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          opts.config = next;
          i++;
        } else {
          fatal('--config requires a path argument.');
        }
        break;
      }
      case '--quiet':
      case '-q':
        opts.quiet = true;
        break;
      case '--init':
        opts.init = true;
        break;
      case '--no-telemetry':
        opts.noTelemetry = true;
        break;
      case '--format':
      case '-f': {
        const next = argv[i + 1];
        if (next === 'json' || next === 'stylish' || next === 'github') {
          opts.format = next;
          i++;
        } else {
          fatal(`Unknown format: "${next}". Use "stylish", "json", or "github".`);
        }
        break;
      }
      default:
        if (arg.startsWith('--format=')) {
          const val = arg.slice('--format='.length);
          if (val === 'json' || val === 'stylish' || val === 'github') {
            opts.format = val;
          } else {
            fatal(`Unknown format: "${val}". Use "stylish", "json", or "github".`);
          }
        } else if (arg.startsWith('-')) {
          fatal(`Unknown option: ${arg}. Run "agentlint --help" for usage.`);
        } else {
          opts.targets.push(arg);
        }
    }

    i++;
  }

  return opts;
}

// ── Help text ────────────────────────────────────────────────────────────────

function printHelp(): void {
  const help = `
  AgentLint — Lint AI agent instruction files

  USAGE

    agentlint [options] [file|dir ...]

  EXAMPLES

    agentlint                       Scan current directory
    agentlint CLAUDE.md             Lint a specific file
    agentlint --fix                 Auto-fix fixable issues
    agentlint --format json         JSON output for CI
    agentlint --format github       GitHub Actions annotations
    agentlint --strict              Warnings become errors
    agentlint src/ docs/            Scan multiple directories

  OPTIONS

    --fix                 Apply auto-fixes for fixable issues
    --score               Show readiness score after linting
    --report              Full AI readiness report (score, cost, roadmap)
    --strict              Treat warnings as errors (exit 1)
    --format <fmt>        Output format: stylish (default), json, github
    --config <path>       Path to config file (default: .agentlint.json in cwd)
    --quiet, -q           Show only errors (suppress warnings and info)
    --init                Create a .agentlint.json config file
    --list-rules          List all available rules
    --no-telemetry        Disable anonymous usage analytics for this run
    -h, --help            Show this help message
    -v, --version         Show version number

  CONFIGURATION

    Place a .agentlint.json in your project root to configure:

      {
        "disabledRules": ["RULE_ID"],
        "disabledCategories": ["category"],
        "severityOverrides": { "RULE_ID": "warning" },
        "overrides": [{
          "files": ".claude/rules/*.md",
          "disabledRules": ["FILE_TOO_LONG"]
        }]
      }

  EXIT CODES

    0  No errors
    1  Lint errors found (or warnings with --strict)
    2  Fatal error
`;
  process.stdout.write(help);
}

// ── Version ──────────────────────────────────────────────────────────────────

function getVersion(): string {
  // Walk up from compiled output to find package.json
  // Compiled location: out/cli/index.js  -> ../../package.json
  // Source location:   src/cli/index.ts  -> ../../package.json
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      return pkg.version || '0.0.0';
    } catch {
      // continue
    }
  }
  return '0.0.0';
}

// ── Fix application ──────────────────────────────────────────────────────────

/**
 * Apply auto-fixes to a file.
 *
 * Processes fixable issues from bottom to top (so line numbers remain valid
 * after each replacement).  Returns the number of fixes applied.
 */
function applyFixes(filePath: string, issues: PromptIssue[]): number {
  const fixableIssues = issues.filter((i) => i.fixable && i.replacement !== undefined);
  if (fixableIssues.length === 0) {
    return 0;
  }

  let content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Sort by startLine descending so we can replace from bottom to top
  const sorted = [...fixableIssues].sort((a, b) => b.startLine - a.startLine);

  let fixCount = 0;
  for (const issue of sorted) {
    const startIdx = issue.startLine - 1; // 1-based to 0-based
    const endIdx = issue.endLine - 1;

    if (startIdx < 0 || endIdx >= lines.length) {
      continue;
    }

    // Replace the range of lines with the replacement text
    const replacementLines = (issue.replacement ?? '').split('\n');
    lines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines);
    fixCount++;
  }

  content = lines.join('\n');
  fs.writeFileSync(filePath, content, 'utf-8');
  return fixCount;
}

// ── Fatal error ──────────────────────────────────────────────────────────────

function fatal(message: string): never {
  process.stderr.write(`agentlint: ${message}\n`);
  process.exit(2);
}

// ── CLI exit helper ──────────────────────────────────────────────────────────

async function cliExit(code: number): Promise<never> {
  await flushAnalytics();
  process.exit(code);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Parse args (skip `node` and script path)
  const rawArgs = process.argv.slice(2);
  const opts = parseArgs(rawArgs);
  const cwd = process.cwd();

  // ── Quick exits (before analytics init) ─────────────────────────────────

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    process.stdout.write(`agentlint v${getVersion()}\n`);
    process.exit(0);
  }

  // ── Analytics init ────────────────────────────────────────────────────────
  const version = getVersion();
  initAnalytics({
    context: 'cli',
    extensionVersion: version,
    editorVersion: 'cli',
    distinctId: getOrCreateCliDistinctId(),
    isEnabled: () => {
      if (opts.noTelemetry) return false;
      if (process.env.DO_NOT_TRACK === '1') return false;
      return true;
    },
  });

  if (opts.init) {
    const configPath = path.resolve(cwd, '.agentlint.json');
    if (fs.existsSync(configPath)) {
      fatal('.agentlint.json already exists. Remove it first or edit it directly.');
    }

    const template = {
      rules: {},
      categories: {},
      overrides: [],
    };

    fs.writeFileSync(configPath, JSON.stringify(template, null, 2) + '\n', 'utf-8');
    process.stdout.write(`  Created .agentlint.json in ${cwd}\n\n`);
    process.stdout.write(`  Edit this file to configure rule severities and per-file overrides.\n`);
    process.stdout.write(`  Run "agentlint --list-rules" to see all available rules.\n\n`);
    track('cli_run', { subcommand: 'init', exit_code: 0 });
    await cliExit(0);
  }

  // ── --report (runs before registerAllRules — core.ts handles its own registration) ─

  if (opts.report) {
    const rootDir = opts.targets.length > 0 ? path.resolve(cwd, opts.targets[0]) : cwd;
    const discovered = findAgentFiles(rootDir);

    if (discovered.length === 0) {
      process.stdout.write('\n  No agent instruction files found. Nothing to report.\n\n');
      track('cli_run', { subcommand: 'report', files_found: 0, exit_code: 0 });
      await cliExit(0);
    }

    const files = discovered.map((f) => ({
      absPath: f.path,
      relativePath: path.relative(rootDir, f.path),
      type: f.type,
    }));

    const report = scanReadiness({ rootDir, files, hasApiKey: !!process.env.ANTHROPIC_API_KEY });
    const markdown = renderReportMarkdown(report);
    process.stdout.write(markdown);
    track('cli_run', {
      subcommand: 'report',
      files_found: files.length,
      readiness_score: report.score,
      exit_code: 0,
    });
    await cliExit(0);
  }

  // Register all rules (for lint mode, not report mode)
  registerAllRules();

  // ── --list-rules ─────────────────────────────────────────────────────────

  if (opts.listRules) {
    const allRules = registry.getAll();
    const ruleInfos = allRules.map((r) => ({
      id: r.meta.id,
      name: r.meta.name,
      description: r.meta.description,
      category: r.meta.category,
      defaultSeverity: r.meta.defaultSeverity,
      fixable: r.meta.fixable,
    }));
    process.stdout.write(formatRuleList(ruleInfos));
    track('cli_run', { subcommand: 'list-rules', exit_code: 0 });
    await cliExit(0);
  }

  // ── Resolve targets ──────────────────────────────────────────────────────

  const targets = opts.targets.length > 0 ? opts.targets : ['.'];

  // Collect files to lint
  const filesToLint: Array<{ absPath: string; type: AgentFileType }> = [];

  for (const target of targets) {
    const absTarget = path.resolve(cwd, target);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absTarget);
    } catch {
      return fatal(`Cannot access "${target}": No such file or directory.`);
    }

    if (stat.isFile()) {
      const type = detectFileType(absTarget);
      if (!type) {
        fatal(
          `"${target}" is not a recognized agent instruction file.\n` +
            'Recognized files: CLAUDE.md, .cursorrules, SKILL.md, AGENTS.md, copilot-instructions.md, .claude/rules/*.md'
        );
      }
      filesToLint.push({ absPath: absTarget, type });
    } else if (stat.isDirectory()) {
      const found = findAgentFiles(absTarget);
      for (const f of found) {
        filesToLint.push({ absPath: f.path, type: f.type });
      }
    } else {
      fatal(`"${target}" is not a file or directory.`);
    }
  }

  if (filesToLint.length === 0) {
    if (opts.format === 'json') {
      process.stdout.write(JSON.stringify({ files: [], summary: { errors: 0, warnings: 0, infos: 0, fixable: 0, fixableErrors: 0, fixableWarnings: 0 } }, null, 2));
      process.stdout.write('\n');
    } else if (opts.format === 'github') {
      process.stdout.write('::notice::AgentLint: No agent instruction files found.\n');
    } else {
      process.stdout.write('\n  No agent instruction files found.\n\n');
    }
    track('cli_run', { subcommand: 'lint', format: opts.format, files_linted: 0, exit_code: 0 });
    await cliExit(0);
  }

  // ── Load config ──────────────────────────────────────────────────────────

  let config: AgentLintConfig;
  if (opts.config) {
    const configPath = path.resolve(cwd, opts.config);
    try {
      config = loadConfigFromFile(configPath);
    } catch (err) {
      fatal(`Failed to load config "${opts.config}": ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    config = loadConfig(cwd);
  }

  // ── Lint each file ───────────────────────────────────────────────────────

  const results: FileResult[] = [];
  let totalFixesApplied = 0;

  for (const file of filesToLint) {
    let content: string;
    try {
      content = fs.readFileSync(file.absPath, 'utf-8');
    } catch {
      process.stderr.write(`agentlint: Could not read "${file.absPath}", skipping.\n`);
      continue;
    }

    let issues = runRules(content, file.type, file.absPath, config);

    // Apply fixes if requested
    if (opts.fix) {
      const fixCount = applyFixes(file.absPath, issues);
      totalFixesApplied += fixCount;

      if (fixCount > 0) {
        // Re-lint the fixed file to get updated issues
        const fixedContent = fs.readFileSync(file.absPath, 'utf-8');
        issues = runRules(fixedContent, file.type, file.absPath, config);
      }
    }

    results.push({
      filePath: file.absPath,
      relativePath: path.relative(cwd, file.absPath),
      issues,
    });
  }

  // ── Quiet mode: filter out non-error issues ─────────────────────────────

  if (opts.quiet) {
    for (const result of results) {
      result.issues = result.issues.filter(i => i.severity === 'error');
    }
  }

  // ── Output results ───────────────────────────────────────────────────────

  if (opts.format === 'json') {
    process.stdout.write(formatJson(results));
    process.stdout.write('\n');
  } else if (opts.format === 'github') {
    process.stdout.write(formatGitHub(results, opts.score));
    process.stdout.write('\n');
  } else {
    process.stdout.write(formatStylish(results));

    if (opts.fix && totalFixesApplied > 0) {
      process.stdout.write(
        `  ${totalFixesApplied} fix${totalFixesApplied !== 1 ? 'es' : ''} applied.\n\n`
      );
    }

    if (opts.score) {
      process.stdout.write(formatScore(results));
    }
  }

  // ── Exit code ────────────────────────────────────────────────────────────

  const summary = computeSummary(results);

  const exitCode = summary.errors > 0 ? 1 : (opts.strict && summary.warnings > 0 ? 1 : 0);

  track('cli_run', {
    subcommand: 'lint',
    format: opts.format,
    fix: opts.fix,
    strict: opts.strict,
    files_linted: filesToLint.length,
    total_errors: summary.errors,
    total_warnings: summary.warnings,
    fixes_applied: totalFixesApplied,
    exit_code: exitCode,
  });

  await cliExit(exitCode);
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  process.stderr.write(`agentlint: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
