/**
 * Public API for the readiness module.
 *
 * Re-exports the core scanning logic, renderer, and types.
 * VS Code consumers should use vscodeScanner.ts for file discovery.
 */

// Core (pure, no vscode dependency)
export { scanReadiness, detectSections } from './core';
export type { ScanInput } from './core';

// Renderer (pure, no vscode dependency)
export { renderReportMarkdown } from './renderer';

// Cost calculator
export { calculateTokenCost, estimateSavings, classifyLoadingBehavior, COST_ASSUMPTIONS } from './costCalculator';

// Types
export type {
  ReadinessReport,
  ScannedFile,
  LoadingBehavior,
  SectionCoverage,
  MaturityLevel,
  MaturityInfo,
  ReadinessSignal,
  ReadinessPenalty,
  ToolFitScore,
  TokenCostBreakdown,
  SavingsEstimate,
  RoadmapStep,
  FileIssues,
} from './types';
export { MATURITY_LEVELS } from './types';
