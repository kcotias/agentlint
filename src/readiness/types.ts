import { AgentFileType, PromptIssue } from '../types';

// ── Scanned File ────────────────────────────────────────────────────────────

export interface ScannedFile {
  path: string;
  relativePath: string;
  type: AgentFileType;
  lineCount: number;
  nonEmptyLineCount: number;
  charCount: number;
  estimatedTokens: number;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

// ── Loading Behavior ────────────────────────────────────────────────────────

/**
 * How a file is loaded into the AI context window.
 * - always:      Injected on every message (CLAUDE.md, .cursorrules, copilot-instructions.md)
 * - conditional:  Loaded when working on matching files (.claude/rules/, .cursor/rules/)
 * - on-demand:   Loaded only when explicitly invoked (SKILL.md body, .claude/commands/)
 * - metadata:    Only frontmatter loaded at startup (~100 tokens for SKILL.md)
 */
export type LoadingBehavior = 'always' | 'conditional' | 'on-demand' | 'metadata';

// ── Section Coverage ────────────────────────────────────────────────────────

export interface SectionCoverage {
  hasProjectContext: boolean;
  hasCommands: boolean;
  hasArchitecture: boolean;
  hasCodeStyle: boolean;
  hasConstraints: boolean;
  hasGotchas: boolean;
  hasVerification: boolean;
}

// ── Maturity ────────────────────────────────────────────────────────────────

export type MaturityLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface MaturityInfo {
  level: MaturityLevel;
  label: string;
  description: string;
}

export const MATURITY_LEVELS: MaturityInfo[] = [
  { level: 0, label: 'Unconfigured', description: 'No AI agent instruction files found' },
  { level: 1, label: 'Foundation', description: 'Agent files exist with basic instructions' },
  { level: 2, label: 'Intentional', description: 'Uses precise RFC 2119 language (MUST/NEVER) for reliable compliance' },
  { level: 3, label: 'Organized', description: 'Multiple files split by concern with good section coverage' },
  { level: 4, label: 'Context-Aware', description: 'Path-scoped rules load contextually, reducing token waste' },
  { level: 5, label: 'Optimized', description: 'Comprehensive setup with hooks, MCP, and full section coverage' },
  { level: 6, label: 'Autonomous', description: 'Skills + plugins + dynamic loading for on-demand context' },
];

// ── Signals ─────────────────────────────────────────────────────────────────

export interface ReadinessSignal {
  name: string;
  found: boolean;
  points: number;
  description: string;
}

// ── Penalties ───────────────────────────────────────────────────────────────

export interface ReadinessPenalty {
  code: string;
  label: string;
  points: number;
  count: number;
  severity: 'error' | 'warning' | 'info';
  affectedFiles: string[];
  reason: string;
  /** Extended explanation with data and fix guidance */
  detail: string;
}

// ── AI Tool Recommendation ──────────────────────────────────────────────────

export interface ToolFitScore {
  tool: string;
  featuresAvailable: number;
  featuresConfigured: number;
  features: Array<{ name: string; configured: boolean }>;
}

// ── Cost ────────────────────────────────────────────────────────────────────

export interface TokenCostBreakdown {
  /** Always-loaded tokens (per message) */
  alwaysLoadedTokens: number;
  /** Conditionally loaded tokens */
  conditionalTokens: number;
  /** On-demand tokens (negligible cost) */
  onDemandTokens: number;
  /** Total tokens across all files */
  totalTokens: number;
  /** Estimated cost per month (USD) */
  monthlyCost: number;
  /** Estimated cost per year (USD) */
  annualCost: number;
  /** Per-file breakdown */
  files: Array<{
    relativePath: string;
    tokens: number;
    loading: LoadingBehavior;
    monthlyCost: number;
  }>;
}

export interface SavingsEstimate {
  label: string;
  tokenReduction: number;
  monthlySavings: number;
}

// ── Roadmap ─────────────────────────────────────────────────────────────────

export interface RoadmapStep {
  priority: number;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  currentState: string;
  targetState: string;
  /** Points recoverable from this step */
  pointsRecoverable?: number;
  /** Monthly $ savings from this step */
  monthlySavings?: number;
}

// ── Report ──────────────────────────────────────────────────────────────────

export interface ReadinessReport {
  score: number;
  bonusPoints: number;
  penaltyPoints: number;
  maturity: MaturityInfo;
  files: ScannedFile[];
  sections: SectionCoverage;
  signals: ReadinessSignal[];
  penalties: ReadinessPenalty[];
  roadmap: RoadmapStep[];
  toolFit: ToolFitScore[];
  cost: TokenCostBreakdown;
  savings: SavingsEstimate[];
  stats: {
    totalFiles: number;
    totalLines: number;
    totalIssues: number;
    totalErrors: number;
    totalCharacters: number;
    totalEstimatedTokens: number;
    hasApiKey: boolean;
    hasGitignoreLocal: boolean;
  };
}

// ── File Issues (internal) ──────────────────────────────────────────────────

export interface FileIssues {
  file: ScannedFile;
  issues: PromptIssue[];
}
