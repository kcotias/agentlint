/**
 * Markdown renderer for the AI Readiness Report.
 *
 * Pure function — no vscode dependency. Takes a ReadinessReport and returns
 * a formatted markdown string suitable for VS Code preview or terminal output.
 */

import {
  ReadinessReport,
  ReadinessPenalty,
  RoadmapStep,
  SectionCoverage,
  MATURITY_LEVELS,
} from './types';
import { COST_ASSUMPTIONS } from './costCalculator';

// ── Grade Calculation ────────────────────────────────────────────────────────

function scoreToGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function scoreEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 50) return '🟡';
  if (score >= 20) return '🟠';
  return '🔴';
}

function fmt$(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ── Main Renderer ────────────────────────────────────────────────────────────

export function renderReportMarkdown(report: ReadinessReport): string {
  const lines: string[] = [];

  renderHeader(lines, report);
  renderExecutiveSummary(lines, report);
  renderMaturityLevel(lines, report);
  renderToolFit(lines, report);
  renderGoodPractices(lines, report);
  renderBadPractices(lines, report);
  renderSectionCoverage(lines, report);
  renderTokenBudget(lines, report);
  renderRoadmap(lines, report);
  renderFooter(lines, report);

  return lines.join('\n');
}

// ── Header ───────────────────────────────────────────────────────────────────

function renderHeader(lines: string[], report: ReadinessReport): void {
  const emoji = scoreEmoji(report.score);
  lines.push(`# ${emoji} AI-Readiness Report`);
  lines.push('');
}

// ── Executive Summary ────────────────────────────────────────────────────────

function renderExecutiveSummary(lines: string[], report: ReadinessReport): void {
  lines.push('## Executive Summary');
  lines.push('');

  const grade = scoreToGrade(report.score);
  const bestTool = report.toolFit[0];
  const bestToolLabel = bestTool
    ? `${bestTool.tool} (${bestTool.featuresConfigured}/${bestTool.featuresAvailable} features)`
    : 'None configured';

  const totalSavings = report.savings.reduce((sum, s) => sum + s.monthlySavings, 0);
  const savingsPct =
    report.cost.monthlyCost > 0
      ? Math.round((totalSavings / report.cost.monthlyCost) * 100)
      : 0;

  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| AI Readiness Score | **${report.score}/100** (Grade: **${grade}**) |`);
  lines.push(`| Maturity Level | L${report.maturity.level} ${report.maturity.label} |`);
  lines.push(`| Best Suited For | ${bestToolLabel} |`);
  lines.push(`| Monthly Context Cost | ~${fmt$(report.cost.monthlyCost)}/developer |`);
  if (totalSavings > 0) {
    lines.push(`| Potential Monthly Savings | ~${fmt$(totalSavings)}/developer (${savingsPct}% reduction) |`);
  }
  lines.push(`| Files Analyzed | ${report.stats.totalFiles} agent instruction files |`);
  lines.push(
    `| Issues Found | ${report.stats.totalIssues} (${report.stats.totalErrors} errors, ${report.penalties.filter((p) => p.severity === 'warning').reduce((sum, p) => sum + p.count, 0)} warnings) |`
  );
  lines.push('');

  // Score breakdown
  if (report.penaltyPoints > 0) {
    lines.push(
      `> 📊 **Score breakdown:** +${report.bonusPoints} good practices − ${report.penaltyPoints} penalties = **${report.score}/100**`
    );
    lines.push('');
  }

  // Top 3 actions
  if (report.roadmap.length > 0) {
    lines.push('**Top actions to improve your score:**');
    const top = report.roadmap.slice(0, 3);
    for (const step of top) {
      let benefit = '';
      if (step.pointsRecoverable) benefit += ` → +${step.pointsRecoverable} pts`;
      if (step.monthlySavings && step.monthlySavings > 0.01) benefit += `, save ${fmt$(step.monthlySavings)}/mo`;
      lines.push(`1. ${step.title}${benefit}`);
    }
    lines.push('');
  }
}

// ── Maturity Level ───────────────────────────────────────────────────────────

function renderMaturityLevel(lines: string[], report: ReadinessReport): void {
  const ml = report.maturity;
  lines.push(`## Maturity Level: L${ml.level} ${ml.label}`);
  lines.push('');

  // Progress bar
  const filled = ml.level;
  const total = 6;
  const segments: string[] = [];
  for (let i = 0; i <= total; i++) {
    if (i <= filled) {
      segments.push(`**L${i}**`);
    } else {
      segments.push(`L${i}`);
    }
  }
  const barFilled = '━━'.repeat(filled);
  const barEmpty = filled < total ? '──'.repeat(total - filled) : '';
  lines.push(`\`\`\``);
  lines.push(`  L0 ━━ L1 ━━ L2 ━━ L3 ━━ L4 ━━ L5 ━━ L6`);
  lines.push(`  ${'████'.repeat(filled)}${'░░░░'.repeat(total - filled)}`);
  lines.push(`\`\`\``);
  lines.push('');

  // Level checklist
  for (const lvl of MATURITY_LEVELS) {
    const check = lvl.level <= ml.level ? '✅' : '⬜';
    const marker = lvl.level === ml.level ? ' ← You are here' : '';
    lines.push(`${check} **L${lvl.level} ${lvl.label}** — ${lvl.description}${marker}`);
  }
  lines.push('');
}

// ── AI Tool Fit ──────────────────────────────────────────────────────────────

function renderToolFit(lines: string[], report: ReadinessReport): void {
  lines.push('## 🔧 AI Tool Fit');
  lines.push('');

  const multiTool = report.toolFit.filter((t) => t.featuresConfigured > 0).length;
  if (multiTool >= 2) {
    lines.push('> 🎯 **Multi-tool ready** — Your codebase is configured for multiple AI tools');
    lines.push('');
  }

  lines.push('| Tool | Configured | Score |');
  lines.push('|------|-----------|-------|');
  for (const tool of report.toolFit) {
    const bar = '█'.repeat(tool.featuresConfigured) + '░'.repeat(tool.featuresAvailable - tool.featuresConfigured);
    const score = `${tool.featuresConfigured}/${tool.featuresAvailable}`;
    lines.push(`| ${tool.tool} | ${bar} | ${score} |`);
  }
  lines.push('');

  // Feature details for top tool
  const best = report.toolFit[0];
  if (best && best.featuresConfigured > 0) {
    lines.push(`<details>`);
    lines.push(`<summary>${best.tool} feature breakdown</summary>`);
    lines.push('');
    for (const f of best.features) {
      lines.push(`- ${f.configured ? '✅' : '❌'} ${f.name}`);
    }
    lines.push('');
    lines.push(`</details>`);
    lines.push('');
  }
}

// ── Good Practices ───────────────────────────────────────────────────────────

function renderGoodPractices(lines: string[], report: ReadinessReport): void {
  lines.push('## ✅ Good Practices');
  lines.push('');

  const earned = report.signals.filter((s) => s.found).reduce((sum, s) => sum + s.points, 0);
  const possible = report.signals.reduce((sum, s) => sum + s.points, 0);

  lines.push('| Signal | Status | Points |');
  lines.push('|--------|--------|--------|');
  for (const signal of report.signals) {
    if (signal.found) {
      lines.push(`| ${signal.name} | ✅ | **+${signal.points}** |`);
    } else {
      lines.push(`| ${signal.name} | ❌ | 0 of ${signal.points} |`);
    }
  }
  lines.push(`| **Total** | — | **${earned} of ${possible} pts** |`);
  lines.push('');
}

// ── Bad Practices ────────────────────────────────────────────────────────────

function renderBadPractices(lines: string[], report: ReadinessReport): void {
  if (report.penalties.length === 0) return;

  lines.push('## ⚠️ Issues Found');
  lines.push('');
  lines.push('These issues are actively hurting your AI effectiveness:');
  lines.push('');

  lines.push('| Issue | Count | Penalty | Severity | Files |');
  lines.push('|-------|-------|---------|----------|-------|');
  for (const p of report.penalties) {
    const icon = p.severity === 'error' ? '🔴' : p.severity === 'warning' ? '🟡' : '🔵';
    lines.push(
      `| ${p.label} | ${p.count}x | **-${p.points} pts** | ${icon} ${p.severity} | ${p.affectedFiles.join(', ')} |`
    );
  }
  lines.push(`| **Total penalties** | — | **-${report.penaltyPoints} pts** | — | — |`);
  lines.push('');

  // Detailed explanations
  lines.push('### Why These Hurt');
  lines.push('');
  for (const p of report.penalties) {
    const icon = p.severity === 'error' ? '🔴' : p.severity === 'warning' ? '🟡' : '🔵';
    lines.push(`#### ${icon} ${p.label} (-${p.points} pts)`);
    lines.push(`**Affects:** ${p.affectedFiles.join(', ')} (${p.count} occurrence${p.count > 1 ? 's' : ''})`);
    lines.push('');
    lines.push(p.detail);
    lines.push('');
  }
}

// ── Section Coverage ─────────────────────────────────────────────────────────

function renderSectionCoverage(lines: string[], report: ReadinessReport): void {
  if (report.files.length === 0) return;

  lines.push('## 📋 Section Coverage');
  lines.push('');
  lines.push('Coverage detected across all agent instruction files:');
  lines.push('');

  const sectionItems = [
    { key: 'hasProjectContext', label: 'Project context', impact: 'Gives agent immediate orientation' },
    { key: 'hasCommands', label: 'Build/test/lint commands', impact: '#1 most valuable content' },
    { key: 'hasArchitecture', label: 'Architecture overview', impact: 'Saves exploration time' },
    { key: 'hasCodeStyle', label: 'Code style rules', impact: 'Only non-linter rules' },
    { key: 'hasConstraints', label: 'Constraints (NEVER/MUST NOT)', impact: '#2 most effective instruction type' },
    { key: 'hasGotchas', label: 'Gotchas & caveats', impact: 'Prevents common mistakes' },
    { key: 'hasVerification', label: 'Verification instructions', impact: '2-3x quality improvement' },
  ];

  const covered = sectionItems.filter((item) => report.sections[item.key as keyof SectionCoverage]).length;
  lines.push(`**${covered}/${sectionItems.length}** sections covered`);
  lines.push('');

  for (const item of sectionItems) {
    const found = report.sections[item.key as keyof SectionCoverage];
    lines.push(`- ${found ? '✅' : '❌'} **${item.label}** — ${item.impact}`);
  }
  lines.push('');
}

// ── Token Budget ─────────────────────────────────────────────────────────────

function renderTokenBudget(lines: string[], report: ReadinessReport): void {
  if (report.files.length === 0) return;

  const cost = report.cost;
  const budgetEmoji = cost.monthlyCost <= 1 ? '🟢' : cost.monthlyCost <= 5 ? '🟡' : cost.monthlyCost <= 15 ? '🟠' : '🔴';

  lines.push('## 💰 Token Budget & Cost Impact');
  lines.push('');
  lines.push(
    `${budgetEmoji} Your always-loaded context costs **~${fmt$(cost.monthlyCost)}/month** per developer (${fmt$(cost.annualCost)}/year).`
  );
  lines.push('');

  // Category breakdown
  const alwaysCost = cost.files.filter((f) => f.loading === 'always').reduce((sum, f) => sum + f.monthlyCost, 0);
  const condCost = cost.files.filter((f) => f.loading === 'conditional').reduce((sum, f) => sum + f.monthlyCost, 0);
  const alwaysFiles = cost.files.filter((f) => f.loading === 'always');
  const condFiles = cost.files.filter((f) => f.loading === 'conditional');
  const onDemandFiles = cost.files.filter((f) => f.loading === 'on-demand');

  lines.push('| Category | Files | Tokens | $/month |');
  lines.push('|----------|-------|--------|---------|');
  lines.push(
    `| 🔴 Always loaded | ${alwaysFiles.length} | ~${cost.alwaysLoadedTokens.toLocaleString()} | ${fmt$(alwaysCost)} |`
  );
  if (cost.conditionalTokens > 0) {
    lines.push(
      `| 🟡 Conditional | ${condFiles.length} | ~${cost.conditionalTokens.toLocaleString()} | ~${fmt$(condCost)}* |`
    );
  }
  if (cost.onDemandTokens > 0) {
    lines.push(
      `| 🟢 On-demand | ${onDemandFiles.length} | ~${cost.onDemandTokens.toLocaleString()} | ~$0.00 |`
    );
  }
  lines.push(
    `| **Total** | **${report.stats.totalFiles}** | **~${cost.totalTokens.toLocaleString()}** | **~${fmt$(cost.monthlyCost)}** |`
  );
  lines.push('');

  if (cost.conditionalTokens > 0) {
    lines.push(`*\\*Conditional files loaded ~${Math.round(COST_ASSUMPTIONS.conditionalLoadRate * 100)}% of messages on average*`);
    lines.push('');
  }

  // Per-file breakdown
  lines.push('<details>');
  lines.push('<summary>Per-file breakdown</summary>');
  lines.push('');
  lines.push('| File | Tokens | Loading | $/month |');
  lines.push('|------|--------|---------|---------|');
  for (const f of cost.files) {
    const loadIcon = f.loading === 'always' ? '🔴' : f.loading === 'conditional' ? '🟡' : '🟢';
    lines.push(`| ${f.relativePath} | ~${f.tokens.toLocaleString()} | ${loadIcon} ${f.loading} | ${fmt$(f.monthlyCost)} |`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');

  // Savings
  const totalSavings = report.savings.reduce((sum, s) => sum + s.monthlySavings, 0);
  const totalTokenSavings = report.savings.reduce((sum, s) => sum + s.tokenReduction, 0);

  if (report.savings.length > 0 && totalSavings > 0.01) {
    lines.push(`### 💡 Potential Savings: ~${fmt$(totalSavings)}/month (${fmt$(totalSavings * 12)}/year)`);
    lines.push('');
    lines.push('| Optimization | Token Reduction | Monthly Savings |');
    lines.push('|-------------|----------------|-----------------|');
    for (const s of report.savings) {
      lines.push(`| ${s.label} | ~${s.tokenReduction.toLocaleString()} tokens | ${fmt$(s.monthlySavings)} |`);
    }
    lines.push(`| **Total potential savings** | **~${totalTokenSavings.toLocaleString()} tokens** | **~${fmt$(totalSavings)}/month** |`);
    lines.push('');
  }

  lines.push(
    `*Pricing: ${COST_ASSUMPTIONS.modelName} ($${COST_ASSUMPTIONS.pricePerMTok}/MTok input), ${COST_ASSUMPTIONS.messagesPerDay} messages/day, ${COST_ASSUMPTIONS.workingDaysPerMonth} days/month.*`
  );
  lines.push('');
}

// ── Roadmap ──────────────────────────────────────────────────────────────────

function renderRoadmap(lines: string[], report: ReadinessReport): void {
  if (report.roadmap.length === 0) return;

  lines.push('## 🗺️ Adoption Roadmap');
  lines.push('');

  // Group by effort tier
  const quickWins = report.roadmap.filter((s) => s.effort === 'low');
  const mediumEffort = report.roadmap.filter((s) => s.effort === 'medium');
  const strategic = report.roadmap.filter((s) => s.effort === 'high');

  if (quickWins.length > 0) {
    lines.push('### ⚡ Quick Wins (< 30 minutes)');
    lines.push('');
    for (const step of quickWins) {
      renderRoadmapCard(lines, step);
    }
  }

  if (mediumEffort.length > 0) {
    lines.push('### 🔧 Medium Effort (1-2 hours)');
    lines.push('');
    for (const step of mediumEffort) {
      renderRoadmapCard(lines, step);
    }
  }

  if (strategic.length > 0) {
    lines.push('### 🏗️ Strategic Improvements');
    lines.push('');
    for (const step of strategic) {
      renderRoadmapCard(lines, step);
    }
  }
}

function renderRoadmapCard(lines: string[], step: RoadmapStep): void {
  const impactIcon = step.impact === 'high' ? '🔴' : step.impact === 'medium' ? '🟡' : '🟢';
  const ptsLabel = step.pointsRecoverable ? `+${step.pointsRecoverable} pts` : '';
  const savingsLabel = step.monthlySavings && step.monthlySavings > 0.01 ? `, save ${fmt$(step.monthlySavings)}/mo` : '';

  lines.push(`> **${step.priority}. ${step.title}** ${ptsLabel}${savingsLabel}`);
  lines.push('>');
  // Split description by newlines for proper markdown rendering
  const descLines = step.description.split('\n');
  for (const dl of descLines) {
    lines.push(`> ${dl}`);
  }
  lines.push('>');
  lines.push(`> 📍 **Now:** ${step.currentState}`);
  lines.push(`> 🎯 **Target:** ${step.targetState}`);
  lines.push(`> ${impactIcon} Impact: ${step.impact} | Effort: ${step.effort}`);
  lines.push('');
}

// ── Footer ───────────────────────────────────────────────────────────────────

function renderFooter(lines: string[], report: ReadinessReport): void {
  lines.push('---');
  lines.push('');
  lines.push(
    `*Scanned ${report.stats.totalFiles} agent files · ${report.stats.totalLines} lines · ` +
    `~${report.stats.totalEstimatedTokens.toLocaleString()} tokens · ` +
    `${report.stats.totalIssues} issues · ` +
    `Deep scan: ${report.stats.hasApiKey ? '✅ API key configured' : 'Local rules only'}*`
  );
  lines.push('');
  lines.push('*Generated by [AgentLint](https://github.com/kcotias/agentlint)*');
  lines.push('');
}
