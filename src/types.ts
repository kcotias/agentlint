export interface PromptIssue {
  startLine: number;
  endLine: number;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestion: string;
  /** Whether a quick-fix can be applied automatically */
  fixable?: boolean;
  /** Replacement text for auto-fix (if fixable) */
  replacement?: string;
}

export interface AnalysisResult {
  issues: PromptIssue[];
  score?: number;
}

/** Recognized agent instruction file types */
export type AgentFileType =
  | 'claude-md'
  | 'claude-local-md'
  | 'claude-rules'
  | 'agents-md'
  | 'cursorrules'
  | 'copilot-instructions'
  | 'skill-md'
  | 'unknown';

/** Metadata about a detected agent file */
export interface AgentFileInfo {
  type: AgentFileType;
  /** Display label for status bar */
  label: string;
}
