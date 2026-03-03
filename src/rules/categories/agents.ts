import { RuleDefinition } from '../types';
import { isInsideCodeBlock, isInsideFrontmatter } from '../utils';

/**
 * Agent / subagent configuration rules (Tier 3).
 *
 * Rules for multi-agent configurations (AGENTS.md, subagent definitions).
 * These validate that agent definitions are clear, non-overlapping, and constrained.
 */

/** Keywords that indicate a role/purpose description */
const ROLE_KEYWORDS =
  /\b(role|purpose|responsible|specializes?|handles?|manages?|owns?|focused on|in charge of|responsible for)\b/i;

/** Keywords that indicate constraints/boundaries */
const CONSTRAINT_KEYWORDS =
  /\b(NEVER|MUST NOT|DON'T|DO NOT|AVOID|boundary|boundaries|limit|limits|scope|constraint|constraints|forbidden|prohibited|restrict|restricted|only\b.*\bfiles?\b|off[-\s]?limits)\b/i;

/** Pattern to detect file glob patterns in text */
const FILE_PATTERN_REGEX =
  /(?:\*\.\w+|\.\/[\w/]+|src\/[\w/]+|(?:[\w-]+\/)+\*|`[^`]*\/[^`]*`)/g;

// ── Helpers ─────────────────────────────────────────────────────────────────

interface AgentSection {
  name: string;
  startLine: number;
  endLine: number;
  lines: string[];
  filePatterns: string[];
}

/**
 * Extract agent definition sections from an agents-md file.
 * Agent definitions are identified by level 2 or 3 headers.
 */
function extractAgentSections(
  lines: string[],
  codeBlockRanges: Array<{ start: number; end: number }>,
  frontmatterRange: { start: number; end: number } | null
): AgentSection[] {
  const sections: AgentSection[] = [];
  let current: AgentSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (isInsideCodeBlock(i, codeBlockRanges)) continue;
    if (isInsideFrontmatter(i, frontmatterRange)) continue;

    const line = lines[i];
    // Detect H2 or H3 headers as agent definitions
    const headerMatch = line.match(/^(#{2,3})\s+(.+)/);

    if (headerMatch) {
      // Close previous section
      if (current) {
        current.endLine = i - 1;
        sections.push(current);
      }

      current = {
        name: headerMatch[2].trim(),
        startLine: i,
        endLine: lines.length - 1,
        lines: [],
        filePatterns: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
      // Collect file patterns from this line
      const patterns = line.match(FILE_PATTERN_REGEX);
      if (patterns) {
        current.filePatterns.push(...patterns);
      }
    }
  }

  // Close the last section
  if (current) {
    sections.push(current);
  }

  return sections;
}

// ── Rule 5: AGENT_MISSING_ROLE ──────────────────────────────────────────────

const agentMissingRole: RuleDefinition = {
  meta: {
    id: 'AGENT_MISSING_ROLE',
    name: 'Agent Missing Role Description',
    description:
      'Detects agent definitions without a clear role or purpose statement within the first few lines of the section.',
    rationale:
      'Agents without clear roles produce unfocused, generic outputs. Role definition is the #1 predictor of agent quality.',
    recommendation:
      'Add a one-line role description: "This agent specializes in [specific task]".',
    badExample:
      '## Frontend Agent\n- Uses React\n- Writes TypeScript\n- Runs tests with Jest',
    goodExample:
      '## Frontend Agent\nThis agent specializes in building React UI components and managing frontend state.\n- Uses React\n- Writes TypeScript',
    defaultSeverity: 'warning',
    applicableTo: ['agents-md'],
    category: 'agents',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'agents-md') return [];

    const issues: ReturnType<RuleDefinition['check']> = [];
    const sections = extractAgentSections(
      context.lines,
      context.codeBlockRanges,
      context.frontmatterRange
    );

    for (const section of sections) {
      // Check first 5 non-empty lines for role keywords
      const firstLines = section.lines
        .filter((l) => l.trim().length > 0)
        .slice(0, 5);

      const hasRole = firstLines.some((line) => ROLE_KEYWORDS.test(line));

      if (!hasRole) {
        issues.push({
          startLine: section.startLine + 1,
          endLine: Math.min(
            section.startLine + 6,
            section.endLine + 1
          ),
          severity: 'warning',
          code: 'AGENT_MISSING_ROLE',
          message: `Agent "${section.name}" lacks a clear role or purpose description`,
          suggestion:
            'Add a one-line role description: "This agent specializes in [specific task]".',
        });
      }
    }

    return issues;
  },
};

// ── Rule 6: AGENT_CONFLICTING_SCOPE ─────────────────────────────────────────

const agentConflictingScope: RuleDefinition = {
  meta: {
    id: 'AGENT_CONFLICTING_SCOPE',
    name: 'Agents with Conflicting Scopes',
    description:
      'Detects when multiple agent definitions have overlapping file patterns or scopes.',
    rationale:
      'Overlapping scopes cause agent confusion about ownership. When two agents think they own the same files, they may produce conflicting changes.',
    recommendation:
      'Define clear, non-overlapping scopes for each agent. Use specific paths or file patterns.',
    badExample:
      '## Frontend Agent\nHandles `*.ts` files in src/\n\n## API Agent\nManages `*.ts` files in src/api/',
    goodExample:
      '## Frontend Agent\nHandles `*.tsx` files in src/components/\n\n## API Agent\nManages `*.ts` files in src/api/',
    defaultSeverity: 'warning',
    applicableTo: ['agents-md'],
    category: 'agents',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'agents-md') return [];

    const issues: ReturnType<RuleDefinition['check']> = [];
    const sections = extractAgentSections(
      context.lines,
      context.codeBlockRanges,
      context.frontmatterRange
    );

    // Only check sections that have file patterns
    const sectionsWithPatterns = sections.filter(
      (s) => s.filePatterns.length > 0
    );

    // Compare each pair of agent sections for overlapping patterns
    for (let i = 0; i < sectionsWithPatterns.length; i++) {
      for (let j = i + 1; j < sectionsWithPatterns.length; j++) {
        const a = sectionsWithPatterns[i];
        const b = sectionsWithPatterns[j];

        // Normalize patterns for comparison (strip backticks, lowercase)
        const aNorm = a.filePatterns.map((p) =>
          p.replace(/`/g, '').toLowerCase()
        );
        const bNorm = b.filePatterns.map((p) =>
          p.replace(/`/g, '').toLowerCase()
        );

        const overlapping = aNorm.filter((p) => bNorm.includes(p));

        if (overlapping.length > 0) {
          issues.push({
            startLine: b.startLine + 1,
            endLine: b.endLine + 1,
            severity: 'warning',
            code: 'AGENT_CONFLICTING_SCOPE',
            message: `Agents "${a.name}" and "${b.name}" have overlapping scope: ${overlapping.join(', ')}`,
            suggestion:
              'Define clear, non-overlapping scopes for each agent. Use specific paths or file patterns.',
          });
        }
      }
    }

    return issues;
  },
};

// ── Rule 7: AGENT_MISSING_CONSTRAINTS ───────────────────────────────────────

const agentMissingConstraints: RuleDefinition = {
  meta: {
    id: 'AGENT_MISSING_CONSTRAINTS',
    name: 'Agent Missing Constraints',
    description:
      'Detects agent definitions with more than 10 lines but no constraints or boundary statements.',
    rationale:
      'Unconstrained agents are dangerous. They may modify files outside their scope or make unintended changes. Constraints are essential for safe multi-agent workflows.',
    recommendation:
      'Add constraints: which files NOT to touch, which operations to avoid, when to ask for help.',
    badExample:
      '## Backend Agent\nThis agent handles all backend code.\n- Write API endpoints\n- Manage database schemas\n- Handle authentication\n- Write middleware\n- Manage config files\n- Handle error logging\n- Write tests\n- Manage deployments\n- Handle monitoring\n- Write documentation',
    goodExample:
      '## Backend Agent\nThis agent handles all backend code.\n- Write API endpoints\n- Manage database schemas\n\nConstraints:\n- NEVER modify frontend files in src/components/\n- MUST NOT change CI/CD configuration\n- DO NOT alter environment variables without approval',
    defaultSeverity: 'info',
    applicableTo: ['agents-md'],
    category: 'agents',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'agents-md') return [];

    const issues: ReturnType<RuleDefinition['check']> = [];
    const sections = extractAgentSections(
      context.lines,
      context.codeBlockRanges,
      context.frontmatterRange
    );

    for (const section of sections) {
      const nonEmptyLines = section.lines.filter(
        (l) => l.trim().length > 0
      );

      // Only flag sections with substantial content but no constraints
      if (nonEmptyLines.length <= 10) continue;

      const hasConstraints = section.lines.some((line) =>
        CONSTRAINT_KEYWORDS.test(line)
      );

      if (!hasConstraints) {
        issues.push({
          startLine: section.startLine + 1,
          endLine: section.endLine + 1,
          severity: 'info',
          code: 'AGENT_MISSING_CONSTRAINTS',
          message: `Agent "${section.name}" has ${nonEmptyLines.length} lines but no constraints or boundaries`,
          suggestion:
            'Add constraints: which files NOT to touch, which operations to avoid, when to ask for help.',
        });
      }
    }

    return issues;
  },
};

/** All agent/subagent rules for registration. */
export const agentsRules: RuleDefinition[] = [
  agentMissingRole,
  agentConflictingScope,
  agentMissingConstraints,
];
