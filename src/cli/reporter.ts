/**
 * Terminal output formatters for the AgentLint CLI.
 *
 * Three output modes:
 *   - "stylish" (default) — human-friendly coloured output, like ESLint
 *   - "json"              — machine-readable JSON for CI pipelines
 *   - "github"            — GitHub Actions workflow commands (annotations + step summary)
 *
 * Colours are automatically disabled when the NO_COLOR environment variable
 * is set or when stdout is not a TTY.
 */

import * as fs from 'fs';
import { PromptIssue } from '../types';

// ── Colour helpers ───────────────────────────────────────────────────────────

const supportsColor =
  !process.env.NO_COLOR && process.stdout.isTTY === true;

function red(s: string): string {
  return supportsColor ? `\x1b[31m${s}\x1b[0m` : s;
}
function yellow(s: string): string {
  return supportsColor ? `\x1b[33m${s}\x1b[0m` : s;
}
function blue(s: string): string {
  return supportsColor ? `\x1b[34m${s}\x1b[0m` : s;
}
function gray(s: string): string {
  return supportsColor ? `\x1b[90m${s}\x1b[0m` : s;
}
function bold(s: string): string {
  return supportsColor ? `\x1b[1m${s}\x1b[0m` : s;
}
function green(s: string): string {
  return supportsColor ? `\x1b[32m${s}\x1b[0m` : s;
}
function dim(s: string): string {
  return supportsColor ? `\x1b[2m${s}\x1b[0m` : s;
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'error':
      return red('error');
    case 'warning':
      return yellow('warning');
    case 'info':
      return blue('info');
    default:
      return severity;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileResult {
  /** Absolute path to the file */
  filePath: string;
  /** Path relative to cwd, used for display */
  relativePath: string;
  /** Issues found in this file */
  issues: PromptIssue[];
}

export interface LintSummary {
  errors: number;
  warnings: number;
  infos: number;
  fixable: number;
  fixableErrors: number;
  fixableWarnings: number;
}

// ── Summary computation ──────────────────────────────────────────────────────

export function computeSummary(results: FileResult[]): LintSummary {
  const summary: LintSummary = {
    errors: 0,
    warnings: 0,
    infos: 0,
    fixable: 0,
    fixableErrors: 0,
    fixableWarnings: 0,
  };

  for (const result of results) {
    for (const issue of result.issues) {
      switch (issue.severity) {
        case 'error':
          summary.errors++;
          if (issue.fixable) {
            summary.fixable++;
            summary.fixableErrors++;
          }
          break;
        case 'warning':
          summary.warnings++;
          if (issue.fixable) {
            summary.fixable++;
            summary.fixableWarnings++;
          }
          break;
        case 'info':
          summary.infos++;
          if (issue.fixable) {
            summary.fixable++;
          }
          break;
      }
    }
  }

  return summary;
}

// ── Stylish formatter ────────────────────────────────────────────────────────

/**
 * Format lint results as a human-readable string with ANSI colours.
 *
 * Output mimics ESLint's "stylish" formatter:
 *
 *     CLAUDE.md
 *       3:1  warning  Hedging language: "try to" weakens instructions  HEDGING_LANGUAGE
 *      15:1  error    Missing ## Commands section                       MISSING_COMMANDS
 *
 *     X 4 problems (2 errors, 1 warning, 1 info)
 */
export function formatStylish(results: FileResult[]): string {
  const lines: string[] = [];
  const summary = computeSummary(results);
  const totalProblems = summary.errors + summary.warnings + summary.infos;

  // Skip files with no issues
  const filesWithIssues = results.filter((r) => r.issues.length > 0);

  if (filesWithIssues.length === 0) {
    lines.push('');
    lines.push(green('  No problems found.'));
    lines.push('');
    return lines.join('\n');
  }

  for (const result of filesWithIssues) {
    lines.push('');
    lines.push(bold(result.relativePath));

    // Sort issues by line number
    const sorted = [...result.issues].sort((a, b) => a.startLine - b.startLine);

    // Compute column widths for alignment
    const locWidth = Math.max(...sorted.map((i) => `${i.startLine}:1`.length));
    const sevWidth = 7; // "warning" is the longest severity

    for (const issue of sorted) {
      const loc = `${issue.startLine}:1`;
      const sev = severityColor(issue.severity);
      const sevPlain = issue.severity;
      const msg = issue.message;
      const code = gray(issue.code);

      // Pad location and severity for alignment
      const locPad = loc.padEnd(locWidth);
      const sevPad = sevPlain.length < sevWidth ? ' '.repeat(sevWidth - sevPlain.length) : '';

      lines.push(`  ${locPad}  ${sev}${sevPad}  ${msg}  ${code}`);
    }
  }

  // Summary line
  lines.push('');

  const problemParts: string[] = [];
  if (summary.errors > 0) {
    problemParts.push(`${summary.errors} error${summary.errors !== 1 ? 's' : ''}`);
  }
  if (summary.warnings > 0) {
    problemParts.push(`${summary.warnings} warning${summary.warnings !== 1 ? 's' : ''}`);
  }
  if (summary.infos > 0) {
    problemParts.push(`${summary.infos} info${summary.infos !== 1 ? 's' : ''}`);
  }

  const icon = summary.errors > 0 ? red('X') : yellow('!');
  lines.push(
    `${icon} ${totalProblems} problem${totalProblems !== 1 ? 's' : ''} (${problemParts.join(', ')})`
  );

  // Fixable line
  if (summary.fixable > 0) {
    const fixParts: string[] = [];
    if (summary.fixableErrors > 0) {
      fixParts.push(`${summary.fixableErrors} error${summary.fixableErrors !== 1 ? 's' : ''}`);
    }
    if (summary.fixableWarnings > 0) {
      fixParts.push(
        `${summary.fixableWarnings} warning${summary.fixableWarnings !== 1 ? 's' : ''}`
      );
    }
    lines.push(
      `  ${fixParts.join(' and ')} potentially fixable with ${bold('--fix')}`
    );
  }

  lines.push('');
  return lines.join('\n');
}

// ── JSON formatter ───────────────────────────────────────────────────────────

interface JsonFileOutput {
  filePath: string;
  issues: Array<{
    line: number;
    severity: string;
    code: string;
    message: string;
    suggestion: string;
    fixable: boolean;
  }>;
}

interface JsonOutput {
  files: JsonFileOutput[];
  summary: LintSummary;
}

/**
 * Format lint results as a JSON string suitable for CI pipelines.
 */
export function formatJson(results: FileResult[]): string {
  const summary = computeSummary(results);

  const output: JsonOutput = {
    files: results.map((r) => ({
      filePath: r.relativePath,
      issues: r.issues.map((i) => ({
        line: i.startLine,
        severity: i.severity,
        code: i.code,
        message: i.message,
        suggestion: i.suggestion,
        fixable: i.fixable ?? false,
      })),
    })),
    summary,
  };

  return JSON.stringify(output, null, 2);
}

// ── Score formatter ──────────────────────────────────────────────────────────

/**
 * Compute and format a simple readiness score from lint results.
 *
 * This is a lightweight version of the full readiness report -- it penalises
 * for errors/warnings and rewards for clean files.  The full readiness scanner
 * (VS Code only) provides a more nuanced score with signals and roadmap.
 */
export function formatScore(results: FileResult[]): string {
  const lines: string[] = [];
  const summary = computeSummary(results);

  // Simple scoring: start at 100, deduct for issues
  const errorPenalty = summary.errors * 10;
  const warningPenalty = summary.warnings * 3;
  const infoPenalty = summary.infos * 1;
  const score = Math.max(0, Math.min(100, 100 - errorPenalty - warningPenalty - infoPenalty));

  const scoreColor = score >= 80 ? green : score >= 50 ? yellow : red;
  const grade =
    score >= 90
      ? 'A'
      : score >= 80
        ? 'B'
        : score >= 70
          ? 'C'
          : score >= 60
            ? 'D'
            : 'F';

  lines.push('');
  lines.push(bold('  AgentLint Score'));
  lines.push('');
  lines.push(`  ${scoreColor(`${score}/100`)} ${dim(`(Grade: ${grade})`)}`);
  lines.push('');

  if (summary.errors > 0) {
    lines.push(`  ${red(`-${errorPenalty}`)} from ${summary.errors} error${summary.errors !== 1 ? 's' : ''}`);
  }
  if (summary.warnings > 0) {
    lines.push(
      `  ${yellow(`-${warningPenalty}`)} from ${summary.warnings} warning${summary.warnings !== 1 ? 's' : ''}`
    );
  }
  if (summary.infos > 0) {
    lines.push(`  ${blue(`-${infoPenalty}`)} from ${summary.infos} info${summary.infos !== 1 ? 's' : ''}`);
  }
  if (score === 100) {
    lines.push(green('  Perfect score! Your agent instructions are clean.'));
  }

  lines.push('');
  lines.push(dim('  Run the full readiness report in VS Code for signals, maturity level, and roadmap.'));
  lines.push('');

  return lines.join('\n');
}

// ── Rule list formatter ──────────────────────────────────────────────────────

interface RuleInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultSeverity: string;
  fixable: boolean;
}

// ── GitHub Actions formatter ─────────────────────────────────────────────────

/**
 * Compute the readiness score (0-100) from lint results.
 * Extracted as a standalone helper so it can be reused across formatters.
 */
export function computeScore(results: FileResult[]): number {
  const summary = computeSummary(results);
  const errorPenalty = summary.errors * 10;
  const warningPenalty = summary.warnings * 3;
  const infoPenalty = summary.infos * 1;
  return Math.max(0, Math.min(100, 100 - errorPenalty - warningPenalty - infoPenalty));
}

/**
 * Map a severity level to a GitHub Actions annotation command.
 */
function ghAnnotationLevel(severity: string): string {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'notice';
    default:
      return 'notice';
  }
}

/**
 * Map a severity level to a Markdown emoji for the summary table.
 */
function ghSeverityEmoji(severity: string): string {
  switch (severity) {
    case 'error':
      return '🔴 Error';
    case 'warning':
      return '🟡 Warning';
    case 'info':
      return '🔵 Info';
    default:
      return severity;
  }
}

/**
 * Escape a string for use in GitHub Actions workflow command parameters.
 * Workflow commands use `::` as delimiters and `%` for encoding.
 */
function ghEscape(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

/**
 * Format lint results as GitHub Actions workflow commands.
 *
 * Produces two outputs:
 * 1. Annotation lines written to stdout (::error, ::warning, ::notice)
 * 2. A Markdown summary table written to $GITHUB_STEP_SUMMARY (if available)
 *
 * This format is designed for use in GitHub Actions CI pipelines.
 * Annotations appear inline on PRs and in the Actions log.
 */
export function formatGitHub(results: FileResult[], showScore: boolean): string {
  const lines: string[] = [];
  const summary = computeSummary(results);
  const totalProblems = summary.errors + summary.warnings + summary.infos;

  // ── 1. Emit workflow command annotations to stdout ──────────────────────

  for (const result of results) {
    const sorted = [...result.issues].sort((a, b) => a.startLine - b.startLine);

    for (const issue of sorted) {
      const level = ghAnnotationLevel(issue.severity);
      const file = result.relativePath;
      const line = issue.startLine;
      const title = ghEscape(issue.code);
      const msg = ghEscape(issue.message);

      lines.push(`::${level} file=${file},line=${line},col=1,title=${title}::${msg}`);
    }
  }

  // ── 2. Build Markdown summary ──────────────────────────────────────────

  const md: string[] = [];
  md.push('## 🔍 AgentLint Results');
  md.push('');

  if (totalProblems === 0) {
    md.push('✅ **No problems found.** Your agent instruction files look great!');
    md.push('');
  } else {
    // File summary table
    const filesWithIssues = results.filter((r) => r.issues.length > 0);
    if (filesWithIssues.length > 0) {
      md.push('| File | Errors | Warnings | Info |');
      md.push('|------|--------|----------|------|');

      for (const result of filesWithIssues) {
        let errors = 0;
        let warnings = 0;
        let infos = 0;
        for (const issue of result.issues) {
          switch (issue.severity) {
            case 'error':
              errors++;
              break;
            case 'warning':
              warnings++;
              break;
            case 'info':
              infos++;
              break;
          }
        }
        md.push(`| \`${result.relativePath}\` | ${errors} | ${warnings} | ${infos} |`);
      }
      md.push('');
    }

    // Issues detail table
    md.push('### Issues');
    md.push('');
    md.push('| Severity | Rule | File | Line | Message |');
    md.push('|----------|------|------|------|---------|');

    for (const result of results) {
      const sorted = [...result.issues].sort((a, b) => a.startLine - b.startLine);
      for (const issue of sorted) {
        const sev = ghSeverityEmoji(issue.severity);
        md.push(
          `| ${sev} | \`${issue.code}\` | \`${result.relativePath}\` | ${issue.startLine} | ${issue.message} |`
        );
      }
    }
    md.push('');
  }

  // Score section
  if (showScore) {
    const score = computeScore(results);
    const grade =
      score >= 90
        ? 'A'
        : score >= 80
          ? 'B'
          : score >= 70
            ? 'C'
            : score >= 60
              ? 'D'
              : 'F';

    md.push(`**Score: ${score}/100** (Grade: ${grade})`);
    md.push('');
  }

  // Summary line
  const problemParts: string[] = [];
  if (summary.errors > 0) {
    problemParts.push(`${summary.errors} error${summary.errors !== 1 ? 's' : ''}`);
  }
  if (summary.warnings > 0) {
    problemParts.push(`${summary.warnings} warning${summary.warnings !== 1 ? 's' : ''}`);
  }
  if (summary.infos > 0) {
    problemParts.push(`${summary.infos} info${summary.infos !== 1 ? 's' : ''}`);
  }

  if (totalProblems > 0) {
    md.push(
      `> ✖ ${totalProblems} problem${totalProblems !== 1 ? 's' : ''} (${problemParts.join(', ')})`
    );
  } else {
    md.push('> ✔ No problems found');
  }
  md.push('');

  // ── 3. Write summary to $GITHUB_STEP_SUMMARY if available ──────────────

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      fs.appendFileSync(summaryPath, md.join('\n'), 'utf-8');
    } catch {
      // Silently ignore — we're not in GitHub Actions or the path is invalid
    }
  }

  // Also output the summary to stdout for local testing / visibility
  lines.push('');
  lines.push(md.join('\n'));

  // ── 4. Emit ::set-output equivalents (via GITHUB_OUTPUT) ───────────────

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const score = computeScore(results);
    const outputLines = [
      `score=${score}`,
      `errors=${summary.errors}`,
      `warnings=${summary.warnings}`,
      `total=${totalProblems}`,
    ];
    try {
      fs.appendFileSync(outputPath, outputLines.join('\n') + '\n', 'utf-8');
    } catch {
      // Silently ignore
    }
  }

  return lines.join('\n');
}

// ── Rule list formatter ──────────────────────────────────────────────────────

/**
 * Format the list of all available rules for --list-rules output.
 */
export function formatRuleList(rules: RuleInfo[]): string {
  const lines: string[] = [];

  // Group by category
  const byCategory = new Map<string, RuleInfo[]>();
  for (const rule of rules) {
    const cat = rule.category;
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(rule);
  }

  lines.push('');
  lines.push(bold(`  ${rules.length} rules available`));
  lines.push('');

  for (const [category, catRules] of byCategory) {
    lines.push(bold(`  ${category}`));

    for (const rule of catRules) {
      const sev = severityColor(rule.defaultSeverity);
      const fix = rule.fixable ? green(' [fixable]') : '';
      lines.push(`    ${gray(rule.id.padEnd(35))} ${sev}  ${rule.description}${fix}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
