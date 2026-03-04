import { ScannedFile, LoadingBehavior, TokenCostBreakdown, SavingsEstimate } from './types';
import { AgentFileType, PromptIssue } from '../types';

// ── Pricing Constants ───────────────────────────────────────────────────────

/** Price per million input tokens (USD) — Claude Sonnet 4.5 default */
const DEFAULT_PRICE_PER_MTOK = 3;

/** Estimated messages a developer sends per working day */
const MESSAGES_PER_DAY = 75;

/** Working days per month */
const WORKING_DAYS_PER_MONTH = 22;

/** Estimated % of messages that trigger conditional file loading */
const CONDITIONAL_LOAD_RATE = 0.4;

// ── Loading Behavior Classification ─────────────────────────────────────────

/**
 * Classify how a file type is loaded into the AI context window.
 *
 * - always:     Loaded on every single message (costs money per message)
 * - conditional: Loaded when working on matching file paths (~40% of messages)
 * - on-demand:  Loaded only when user explicitly invokes a skill/command (~negligible)
 */
/**
 * Classify loading behavior. Pass relativePath to distinguish .cursor/rules/
 * scoped files (conditional) from root .cursorrules (always).
 */
export function classifyLoadingBehavior(fileType: AgentFileType, relativePath?: string): LoadingBehavior {
  // .cursor/rules/*.mdc are path-scoped (conditional), not always-loaded
  if (fileType === 'cursorrules' && relativePath && relativePath.includes('.cursor/rules/')) {
    return 'conditional';
  }

  switch (fileType) {
    // Always loaded into context on every message
    case 'claude-md':
    case 'claude-local-md':
    case 'cursorrules':
    case 'copilot-instructions':
    case 'agents-md':
      return 'always';

    // Loaded only when working on files matching the rule's glob pattern
    case 'claude-rules':
      return 'conditional';

    // Loaded only when the user invokes the command/skill
    case 'claude-commands':
    case 'skill-md':
      return 'on-demand';

    default:
      return 'always';
  }
}

// ── Cost Calculation ────────────────────────────────────────────────────────

/**
 * Calculate token cost breakdown for all scanned files.
 */
export function calculateTokenCost(
  files: ScannedFile[],
  pricePerMTok: number = DEFAULT_PRICE_PER_MTOK
): TokenCostBreakdown {
  let alwaysLoadedTokens = 0;
  let conditionalTokens = 0;
  let onDemandTokens = 0;

  const fileBreakdown: TokenCostBreakdown['files'] = [];

  for (const file of files) {
    const loading = classifyLoadingBehavior(file.type, file.relativePath);
    const tokens = file.estimatedTokens;

    switch (loading) {
      case 'always':
        alwaysLoadedTokens += tokens;
        break;
      case 'conditional':
        conditionalTokens += tokens;
        break;
      case 'on-demand':
      case 'metadata':
        onDemandTokens += tokens;
        break;
    }

    // Monthly cost per file
    let effectiveMessagesPerDay: number;
    switch (loading) {
      case 'always':
        effectiveMessagesPerDay = MESSAGES_PER_DAY;
        break;
      case 'conditional':
        effectiveMessagesPerDay = MESSAGES_PER_DAY * CONDITIONAL_LOAD_RATE;
        break;
      default:
        effectiveMessagesPerDay = 0; // on-demand is negligible
    }

    const dailyTokens = tokens * effectiveMessagesPerDay;
    const monthlyTokens = dailyTokens * WORKING_DAYS_PER_MONTH;
    const monthlyCost = (monthlyTokens / 1_000_000) * pricePerMTok;

    fileBreakdown.push({
      relativePath: file.relativePath,
      tokens,
      loading,
      monthlyCost,
    });
  }

  // Sort by monthly cost descending
  fileBreakdown.sort((a, b) => b.monthlyCost - a.monthlyCost);

  // Total monthly cost
  const alwaysDailyTokens = alwaysLoadedTokens * MESSAGES_PER_DAY;
  const conditionalDailyTokens = conditionalTokens * MESSAGES_PER_DAY * CONDITIONAL_LOAD_RATE;
  const totalDailyTokens = alwaysDailyTokens + conditionalDailyTokens;
  const totalMonthlyTokens = totalDailyTokens * WORKING_DAYS_PER_MONTH;
  const monthlyCost = (totalMonthlyTokens / 1_000_000) * pricePerMTok;
  const annualCost = monthlyCost * 12;

  return {
    alwaysLoadedTokens,
    conditionalTokens,
    onDemandTokens,
    totalTokens: alwaysLoadedTokens + conditionalTokens + onDemandTokens,
    monthlyCost,
    annualCost,
    files: fileBreakdown,
  };
}

// ── Savings Estimation ──────────────────────────────────────────────────────

interface FileIssueEntry {
  file: ScannedFile;
  issues: PromptIssue[];
}

/**
 * Estimate potential savings from fixing issues and optimizing file structure.
 */
export function estimateSavings(
  fileIssueMap: FileIssueEntry[],
  cost: TokenCostBreakdown,
  pricePerMTok: number = DEFAULT_PRICE_PER_MTOK
): SavingsEstimate[] {
  const savings: SavingsEstimate[] = [];

  // Count issue types that waste tokens
  let discoverableCount = 0;
  let proseCount = 0;
  let vagueCount = 0;
  let fileTooLongCount = 0;
  let totalAlwaysLoadedTokens = cost.alwaysLoadedTokens;

  for (const { file, issues } of fileIssueMap) {
    const loading = classifyLoadingBehavior(file.type, file.relativePath);
    if (loading !== 'always') continue; // only always-loaded files matter for savings

    for (const issue of issues) {
      switch (issue.code) {
        case 'DISCOVERABLE_INFO':
          discoverableCount++;
          break;
        case 'PROSE_PARAGRAPH':
          proseCount++;
          break;
        case 'VAGUE_INSTRUCTION':
          vagueCount++;
          break;
        case 'FILE_TOO_LONG':
          fileTooLongCount++;
          break;
      }
    }
  }

  // Estimate token savings per issue type
  // Discoverable info: ~25 tokens per occurrence (a line of file description)
  if (discoverableCount > 0) {
    const tokenReduction = discoverableCount * 25;
    savings.push({
      label: `Remove ${discoverableCount} auto-discoverable info line${discoverableCount > 1 ? 's' : ''}`,
      tokenReduction,
      monthlySavings: tokenReductionToMonthlyCost(tokenReduction, pricePerMTok),
    });
  }

  // Prose paragraphs: ~50 tokens per block (converting to bullets saves ~40%)
  if (proseCount > 0) {
    const tokenReduction = Math.round(proseCount * 50 * 0.4);
    savings.push({
      label: `Convert ${proseCount} prose block${proseCount > 1 ? 's' : ''} to bullet points`,
      tokenReduction,
      monthlySavings: tokenReductionToMonthlyCost(tokenReduction, pricePerMTok),
    });
  }

  // Vague instructions: ~15 tokens per occurrence (removed entirely)
  if (vagueCount > 0) {
    const tokenReduction = vagueCount * 15;
    savings.push({
      label: `Remove ${vagueCount} vague/redundant instruction${vagueCount > 1 ? 's' : ''}`,
      tokenReduction,
      monthlySavings: tokenReductionToMonthlyCost(tokenReduction, pricePerMTok),
    });
  }

  // Progressive disclosure: if always-loaded > 3000 tokens, suggest moving overflow to Skills
  if (totalAlwaysLoadedTokens > 3000) {
    const moveable = Math.round(totalAlwaysLoadedTokens * 0.3); // ~30% can typically move
    savings.push({
      label: 'Move specialized content to Agent Skills (on-demand loading)',
      tokenReduction: moveable,
      monthlySavings: tokenReductionToMonthlyCost(moveable, pricePerMTok),
    });
  }

  // Sort by savings descending
  savings.sort((a, b) => b.monthlySavings - a.monthlySavings);

  return savings;
}

function tokenReductionToMonthlyCost(tokens: number, pricePerMTok: number): number {
  const dailyTokensSaved = tokens * MESSAGES_PER_DAY;
  const monthlyTokensSaved = dailyTokensSaved * WORKING_DAYS_PER_MONTH;
  return (monthlyTokensSaved / 1_000_000) * pricePerMTok;
}

// ── Export constants for display ────────────────────────────────────────────

export const COST_ASSUMPTIONS = {
  pricePerMTok: DEFAULT_PRICE_PER_MTOK,
  modelName: 'Claude Sonnet',
  messagesPerDay: MESSAGES_PER_DAY,
  workingDaysPerMonth: WORKING_DAYS_PER_MONTH,
  conditionalLoadRate: CONDITIONAL_LOAD_RATE,
};
