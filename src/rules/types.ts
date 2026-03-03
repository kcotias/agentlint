import { PromptIssue, AgentFileType } from '../types';

/** Rule category for grouping and filtering */
export type RuleCategory =
  | 'structure'      // File structure, sections, organization
  | 'language'       // Language quality, clarity, precision
  | 'security'       // Sensitive data, credentials
  | 'skill'          // SKILL.md specific
  | 'imports'        // Import/reference validation
  | 'xml'            // XML/tag validation
  | 'links'          // Link validation
  | 'prompt'         // Prompt engineering best practices
  | 'hooks'          // Hook configuration validation
  | 'agents'         // Agent/subagent configuration
  | 'mcp'            // MCP server configuration
  | 'cursor'         // Cursor-specific rules
  | 'copilot'        // Copilot-specific rules
  | 'crossPlatform'  // Cross-tool contradiction detection
  | 'memory';        // CLAUDE.local.md & memory patterns

/** Metadata for a rule -- like ESLint's rule.meta */
export interface RuleMeta {
  /** Unique rule ID, e.g. "HEDGING_LANGUAGE" */
  id: string;

  /** Human-readable short name */
  name: string;

  /** Detailed description of what this rule checks */
  description: string;

  /** Why this rule matters for AI agents */
  rationale: string;

  /** How to fix violations */
  recommendation: string;

  /** Example of bad code/text */
  badExample?: string;

  /** Example of good code/text */
  goodExample?: string;

  /** Rule severity default */
  defaultSeverity: 'error' | 'warning' | 'info';

  /** Which file types this rule applies to */
  applicableTo: AgentFileType[] | 'all';

  /** Rule category for grouping */
  category: RuleCategory;

  /** Can this rule auto-fix? */
  fixable: boolean;

  /** URL for full documentation (future) */
  docsUrl?: string;
}

/** Context passed to each rule function */
export interface RuleContext {
  /** Raw file content */
  content: string;

  /** Content split into lines */
  lines: string[];

  /** What type of agent file this is */
  fileType: AgentFileType;

  /** Absolute file path */
  filePath: string;

  /** Pre-computed: which lines are inside code blocks */
  codeBlockRanges: Array<{ start: number; end: number }>;

  /** Pre-computed: which lines are inside frontmatter */
  frontmatterRange: { start: number; end: number } | null;
}

/** A rule definition -- the unit of registration */
export interface RuleDefinition {
  meta: RuleMeta;
  check: (context: RuleContext) => PromptIssue[];
}
