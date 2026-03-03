import { RuleDefinition } from '../types';
import { isInsideCodeBlock, isInsideFrontmatter } from '../utils';

// ─── Rule 1: NEGATIVE_ONLY_INSTRUCTIONS ─────────────────────────────────────

const negativeOnlyInstructions: RuleDefinition = {
  meta: {
    id: 'NEGATIVE_ONLY_INSTRUCTIONS',
    name: 'Negative-Only Instructions',
    description:
      'Detects files that contain only negative constraints (NEVER, DON\'T, MUST NOT, etc.) with zero positive instructions.',
    rationale:
      'Research shows agents perform better with positive instructions ("DO X") than purely negative ones ("DON\'T do Y"). A file with only prohibitions gives no guidance on what TO do.',
    recommendation:
      'For each "NEVER do X", add a corresponding "INSTEAD, do Y". Agents need both guardrails and guidance.',
    badExample: '- NEVER use var\n- NEVER use any\n- NEVER skip tests',
    goodExample:
      '- NEVER use var — MUST use const/let\n- NEVER use any — MUST use proper types\n- MUST run tests before committing',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const negativePatterns = /\b(NEVER|DON'T|MUST\s+NOT|DO\s+NOT|AVOID|FORBIDDEN|PROHIBITED)\b/i;
    const positivePatterns = /\b(MUST(?!\s+NOT)|ALWAYS|SHALL|SHOULD|PREFER|USE)\b/i;

    let negativeCount = 0;
    let positiveCount = 0;
    let firstNegativeLine = -1;
    let lastNegativeLine = -1;

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      const line = context.lines[i];

      if (negativePatterns.test(line)) {
        negativeCount++;
        if (firstNegativeLine === -1) firstNegativeLine = i;
        lastNegativeLine = i;
      }
      if (positivePatterns.test(line)) {
        positiveCount++;
      }
    }

    if (negativeCount > 3 && positiveCount === 0) {
      issues.push({
        startLine: firstNegativeLine + 1,
        endLine: lastNegativeLine + 1,
        severity: 'warning',
        code: 'NEGATIVE_ONLY_INSTRUCTIONS',
        message: `File contains ${negativeCount} negative constraints but zero positive instructions. Agents need guidance on what TO do, not just what to avoid.`,
        suggestion:
          'For each "NEVER do X", add a corresponding "INSTEAD, do Y". Agents need both guardrails and guidance.',
      });
    }

    return issues;
  },
};

// ─── Rule 2: LOST_IN_THE_MIDDLE ─────────────────────────────────────────────

const lostInTheMiddle: RuleDefinition = {
  meta: {
    id: 'LOST_IN_THE_MIDDLE',
    name: 'Critical Instructions Buried in Middle',
    description:
      'Detects critical instructions (MUST, NEVER, CRITICAL, IMPORTANT) buried in the middle 60% of a long file (>100 lines).',
    rationale:
      'LLM "lost in the middle" effect — models pay more attention to content at the beginning and end of their context window. Critical rules buried in the middle are more likely to be forgotten.',
    recommendation:
      'Move the most critical constraints to the top or bottom of the file. Consider using a "## Critical Rules" section at the very top.',
    defaultSeverity: 'info',
    applicableTo: ['claude-md', 'claude-local-md', 'agents-md'],
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];
    const totalLines = context.lines.length;

    if (totalLines <= 100) return issues;

    const criticalPattern = /\b(MUST|NEVER|CRITICAL|IMPORTANT)\b/;
    const topBoundary = Math.floor(totalLines * 0.2);
    const bottomBoundary = Math.floor(totalLines * 0.8);

    const criticalLines: { line: number; zone: 'top' | 'middle' | 'bottom' }[] = [];

    for (let i = 0; i < totalLines; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      if (criticalPattern.test(context.lines[i])) {
        let zone: 'top' | 'middle' | 'bottom';
        if (i < topBoundary) {
          zone = 'top';
        } else if (i >= bottomBoundary) {
          zone = 'bottom';
        } else {
          zone = 'middle';
        }
        criticalLines.push({ line: i, zone });
      }
    }

    if (criticalLines.length === 0) return issues;

    const middleLines = criticalLines.filter((c) => c.zone === 'middle');
    const edgeLines = criticalLines.filter((c) => c.zone !== 'middle');

    // Only warn if >70% of critical instructions are in the middle AND there are also some at edges
    if (
      middleLines.length > 0 &&
      edgeLines.length > 0 &&
      middleLines.length / criticalLines.length > 0.7
    ) {
      // Report each middle-zone critical line
      for (const entry of middleLines) {
        issues.push({
          startLine: entry.line + 1,
          endLine: entry.line + 1,
          severity: 'info',
          code: 'LOST_IN_THE_MIDDLE',
          message: `Critical instruction at line ${entry.line + 1} is buried in the middle of a ${totalLines}-line file where LLMs pay less attention.`,
          suggestion:
            'Move the most critical constraints to the top or bottom of the file. Consider using a "## Critical Rules" section at the very top.',
        });
      }
    }

    return issues;
  },
};

// ─── Rule 3: AMBIGUOUS_INSTRUCTION ──────────────────────────────────────────

const ambiguousInstruction: RuleDefinition = {
  meta: {
    id: 'AMBIGUOUS_INSTRUCTION',
    name: 'Ambiguous Instruction',
    description:
      'Detects instructions that use ambiguous quantifiers or relative terms without specifics.',
    rationale:
      'Agents interpret ambiguous terms differently each run. "Use appropriate error handling" means different things in different contexts. Specific instructions produce consistent results.',
    recommendation:
      'Replace ambiguous terms with specific values. Instead of "a few tests", say "at least 3 tests". Instead of "appropriate error handling", say "try-catch with typed errors".',
    badExample: 'Use appropriate error handling when necessary',
    goodExample: 'Wrap all async calls in try-catch. Log errors to stderr with stack traces.',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // These patterns are designed to match standalone ambiguous phrases.
    // Each requires enough context to avoid false positives.
    const ambiguousPatterns = [
      { regex: /\ba few\b/i, match: 'a few' },
      { regex: /\bsome of\b/i, match: 'some of' },
      { regex: /\bvarious\b/i, match: 'various' },
      { regex: /\bmany\b/i, match: 'many' },
      { regex: /\bseveral\b/i, match: 'several' },
      { regex: /\ba lot of\b/i, match: 'a lot of' },
      { regex: /\bappropriate\b/i, match: 'appropriate' },
      { regex: /\bproper\b(?!\s+\w+\s*[:=({])/i, match: 'proper' },
      { regex: /\bsuitable\b/i, match: 'suitable' },
      { regex: /\bas needed\b/i, match: 'as needed' },
      { regex: /\bwhen necessary\b/i, match: 'when necessary' },
      { regex: /\bif possible\b/i, match: 'if possible' },
      { regex: /\breasonable\b/i, match: 'reasonable' },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      const line = context.lines[i];
      // Skip header lines (they are section names, not instructions)
      if (/^#{1,6}\s/.test(line)) continue;

      for (const { regex, match } of ambiguousPatterns) {
        if (regex.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'info',
            code: 'AMBIGUOUS_INSTRUCTION',
            message: `Ambiguous term "${match}" — agents interpret this differently each run`,
            suggestion:
              'Replace with a specific value. Instead of "a few tests", say "at least 3 tests". Instead of "appropriate error handling", say "try-catch with typed errors".',
          });
          break; // One issue per line
        }
      }
    }

    return issues;
  },
};

// ─── Rule 4: WEAK_LANGUAGE_IN_CRITICAL ──────────────────────────────────────

const weakLanguageInCritical: RuleDefinition = {
  meta: {
    id: 'WEAK_LANGUAGE_IN_CRITICAL',
    name: 'Weak Language in Critical Section',
    description:
      'Detects weak/uncertain language (should, might, could, perhaps, maybe) in sections marked as Constraints, Critical, or Rules.',
    rationale:
      'Constraint sections need strong RFC 2119 language. "Should" in a constraints section signals optional compliance. Agents will sometimes skip "should" but obey "MUST".',
    recommendation:
      'In constraint sections, upgrade: should -> MUST, might -> will, could -> MUST, try to -> (remove), consider -> MUST.',
    badExample: '## Constraints\n- You should probably avoid using var',
    goodExample: '## Constraints\n- NEVER use var — MUST use const or let',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const criticalHeaderPattern =
      /^#{1,6}\s+.*(constraint|critical|rule|must|never|important|required)/i;

    const weakPatterns = [
      { regex: /\bshould\b(?!\s+not\b)/i, match: 'should' },
      { regex: /\bmight\b/i, match: 'might' },
      { regex: /\bcould\b/i, match: 'could' },
      { regex: /\bperhaps\b/i, match: 'perhaps' },
      { regex: /\bmaybe\b/i, match: 'maybe' },
      { regex: /\btry to\b/i, match: 'try to' },
      { regex: /\bconsider\b/i, match: 'consider' },
      { regex: /\bpossibly\b/i, match: 'possibly' },
      { regex: /\bideally\b/i, match: 'ideally' },
      { regex: /\bhopefully\b/i, match: 'hopefully' },
    ];

    let inCriticalSection = false;
    let criticalSectionLevel = 0;

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      const line = context.lines[i];

      // Detect header lines to track sections
      const headerMatch = line.match(/^(#{1,6})\s/);
      if (headerMatch) {
        const level = headerMatch[1].length;

        if (criticalHeaderPattern.test(line)) {
          inCriticalSection = true;
          criticalSectionLevel = level;
        } else if (inCriticalSection && level <= criticalSectionLevel) {
          // A same-level or higher-level header ends the critical section
          inCriticalSection = false;
        }
        continue;
      }

      if (!inCriticalSection) continue;

      for (const { regex, match } of weakPatterns) {
        if (regex.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'WEAK_LANGUAGE_IN_CRITICAL',
            message: `Weak language "${match}" in a constraints/critical section — agents may treat this as optional`,
            suggestion:
              'Upgrade to strong language: should -> MUST, might -> will, could -> MUST, try to -> (remove), consider -> MUST.',
          });
          break; // One issue per line
        }
      }
    }

    return issues;
  },
};

// ─── Rule 5: REDUNDANT_GENERIC_INSTRUCTION ──────────────────────────────────

const redundantGenericInstruction: RuleDefinition = {
  meta: {
    id: 'REDUNDANT_GENERIC_INSTRUCTION',
    name: 'Redundant Generic Instruction',
    description:
      'Detects instructions that just restate what AI agents already do by default, wasting tokens.',
    rationale:
      'These instructions waste tokens. Every AI coding agent already tries to write clean, consistent code. Telling it to "follow best practices" adds zero value. Only include instructions that override defaults or provide project-specific guidance.',
    recommendation:
      'Remove generic instructions. Only include project-specific rules that the agent wouldn\'t know. Instead of "write clean code", say "use early returns, max 20 lines per function".',
    badExample:
      '- Write clean, maintainable code\n- Follow best practices\n- Use descriptive variable names',
    goodExample:
      '- Max function length: 20 lines\n- Use early returns over nested conditions\n- Prefix private methods with underscore',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const genericPatterns = [
      { regex: /\bwrite clean(,?\s+maintainable)? code\b/i, text: 'write clean code' },
      { regex: /\bfollow best practices\b/i, text: 'follow best practices' },
      { regex: /\bbe consistent\b/i, text: 'be consistent' },
      { regex: /\buse descriptive (names?|variables?|naming)\b/i, text: 'use descriptive names' },
      { regex: /\bhandle errors\b(?!\s+\w+\s+(with|using|via|by)\s)/i, text: 'handle errors' },
      { regex: /\bwrite tests\b(?!\s+(for|that|using|with|in)\s)/i, text: 'write tests' },
      { regex: /\bdocument your code\b/i, text: 'document your code' },
      { regex: /\bkeep it simple\b/i, text: 'keep it simple' },
      { regex: /\buse proper indentation\b/i, text: 'use proper indentation' },
      {
        regex: /\bfollow the style guide\b(?!\s+at\b)(?!\s+in\b)(?!\s+from\b)(?!\s*[:(\[])/i,
        text: 'follow the style guide',
      },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      const line = context.lines[i];

      for (const { regex, text } of genericPatterns) {
        if (regex.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'info',
            code: 'REDUNDANT_GENERIC_INSTRUCTION',
            message: `Generic instruction "${text}" adds no value — agents already do this by default`,
            suggestion:
              'Remove generic instructions. Only include project-specific rules. Instead of "write clean code", say "use early returns, max 20 lines per function".',
          });
          break; // One issue per line
        }
      }
    }

    return issues;
  },
};

// ─── Rule 6: RULES_FILE_MISSING_GLOB ────────────────────────────────────────

const rulesFileMissingGlob: RuleDefinition = {
  meta: {
    id: 'RULES_FILE_MISSING_GLOB',
    name: 'Rules File Missing Glob Pattern',
    description:
      'Detects .claude/rules/ files that are missing the globs frontmatter field.',
    rationale:
      'Without a glob pattern, Claude Code won\'t know when to load this rules file. It becomes dead configuration that never applies.',
    recommendation:
      "Add a globs field to the frontmatter. Example: globs: 'src/**/*.ts' to apply only when editing TypeScript files.",
    badExample: '---\ndescription: TypeScript rules\n---',
    goodExample: "---\ndescription: TypeScript rules\nglobs: 'src/**/*.ts'\n---",
    defaultSeverity: 'error',
    applicableTo: ['claude-rules'],
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    if (context.fileType !== 'claude-rules') return issues;

    const { frontmatterRange } = context;

    // No frontmatter at all
    if (!frontmatterRange) {
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'RULES_FILE_MISSING_GLOB',
        message:
          'Rules file is missing frontmatter with a globs field. Claude Code won\'t know when to apply these rules.',
        suggestion:
          "Add YAML frontmatter with a globs field. Example:\n---\nglobs: 'src/**/*.ts'\ndescription: TypeScript rules\n---",
      });
      return issues;
    }

    // Has frontmatter — check for globs/glob key
    let hasGlobsKey = false;
    for (let i = frontmatterRange.start + 1; i < frontmatterRange.end; i++) {
      const line = context.lines[i].trim();
      if (/^globs?\s*:/i.test(line)) {
        hasGlobsKey = true;
        break;
      }
    }

    // Also check for alwaysApply: true, which is an alternative to globs
    let hasAlwaysApply = false;
    for (let i = frontmatterRange.start + 1; i < frontmatterRange.end; i++) {
      const line = context.lines[i].trim();
      if (/^alwaysApply\s*:\s*true/i.test(line)) {
        hasAlwaysApply = true;
        break;
      }
    }

    if (!hasGlobsKey && !hasAlwaysApply) {
      issues.push({
        startLine: frontmatterRange.start + 1,
        endLine: frontmatterRange.end + 1,
        severity: 'error',
        code: 'RULES_FILE_MISSING_GLOB',
        message:
          'Rules file frontmatter is missing a globs field. Claude Code won\'t know when to apply these rules.',
        suggestion:
          "Add a globs field to the frontmatter. Example: globs: 'src/**/*.ts'",
      });
    }

    return issues;
  },
};

// ─── Rule 7: RULES_FILE_INVALID_GLOB ────────────────────────────────────────

const rulesFileInvalidGlob: RuleDefinition = {
  meta: {
    id: 'RULES_FILE_INVALID_GLOB',
    name: 'Rules File Invalid Glob Pattern',
    description:
      'Detects .claude/rules/ files with syntactically invalid glob patterns in frontmatter.',
    rationale:
      'An invalid glob means the rules file will never match any files, making it silently ineffective.',
    recommendation:
      "Fix the glob pattern syntax. Use forward slashes and standard glob patterns: 'src/**/*.ts', '*.md', 'tests/**/*'",
    badExample: "---\nglobs: '[src/**/*.ts'\n---",
    goodExample: "---\nglobs: 'src/**/*.ts'\n---",
    defaultSeverity: 'error',
    applicableTo: ['claude-rules'],
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    if (context.fileType !== 'claude-rules') return issues;

    const { frontmatterRange } = context;
    if (!frontmatterRange) return issues;

    for (let i = frontmatterRange.start + 1; i < frontmatterRange.end; i++) {
      const line = context.lines[i];
      const globMatch = line.match(/^globs?\s*:\s*(.+)/i);
      if (!globMatch) continue;

      const globValue = globMatch[1].trim();
      // Handle quoted or unquoted values; also handle YAML arrays
      const patterns = extractGlobPatterns(globValue);

      for (const pattern of patterns) {
        const error = validateGlobPattern(pattern);
        if (error) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'error',
            code: 'RULES_FILE_INVALID_GLOB',
            message: `Invalid glob pattern "${pattern}": ${error}`,
            suggestion:
              "Fix the glob pattern syntax. Use forward slashes and standard glob patterns: 'src/**/*.ts', '*.md', 'tests/**/*'",
          });
        }
      }
    }

    return issues;
  },
};

/**
 * Extract individual glob patterns from a YAML value.
 * Handles: 'pattern', "pattern", pattern, [pattern1, pattern2], bare lists.
 */
function extractGlobPatterns(value: string): string[] {
  const patterns: string[] = [];
  const stripped = value.replace(/^['"]|['"]$/g, '');

  // YAML array syntax: [pattern1, pattern2]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1);
    const parts = inner.split(',');
    for (const part of parts) {
      const clean = part.trim().replace(/^['"]|['"]$/g, '');
      if (clean.length > 0) patterns.push(clean);
    }
  } else if (stripped.length > 0) {
    patterns.push(stripped);
  }

  return patterns;
}

/**
 * Validate a single glob pattern and return an error message, or null if valid.
 */
function validateGlobPattern(pattern: string): string | null {
  if (pattern.length === 0) {
    return 'empty glob pattern';
  }

  // Check for unmatched brackets
  let bracketDepth = 0;
  let braceDepth = 0;
  for (const char of pattern) {
    if (char === '[') bracketDepth++;
    if (char === ']') bracketDepth--;
    if (char === '{') braceDepth++;
    if (char === '}') braceDepth--;
    if (bracketDepth < 0 || braceDepth < 0) {
      return 'unmatched brackets or braces';
    }
  }
  if (bracketDepth !== 0) {
    return 'unmatched square bracket [';
  }
  if (braceDepth !== 0) {
    return 'unmatched curly brace {';
  }

  // Check for absolute paths (leading /)
  if (pattern.startsWith('/')) {
    return 'glob should be relative (starts with /). Remove the leading slash';
  }

  // Check for backslashes (Windows-style paths)
  if (pattern.includes('\\')) {
    return 'use forward slashes instead of backslashes in glob patterns';
  }

  return null;
}

// ─── Rule 8: UNKNOWN_FRONTMATTER_KEY ────────────────────────────────────────

const unknownFrontmatterKey: RuleDefinition = {
  meta: {
    id: 'UNKNOWN_FRONTMATTER_KEY',
    name: 'Unknown Frontmatter Key',
    description:
      'Detects unrecognized frontmatter keys in .claude/rules/ and SKILL.md files.',
    rationale:
      'Typos in frontmatter keys silently fail. `glob:` (singular) works but `pattern:` doesn\'t. Unknown keys waste space and may indicate misunderstanding of the format.',
    recommendation:
      'Use only recognized frontmatter keys. For .claude/rules/: description, globs, glob, alwaysApply. For SKILL.md: name, description.',
    badExample: '---\npattern: src/**/*.ts\ndescription: TS rules\n---',
    goodExample: "---\nglobs: 'src/**/*.ts'\ndescription: TS rules\n---",
    defaultSeverity: 'warning',
    applicableTo: ['claude-rules', 'skill-md'],
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const validKeysByType: Record<string, Set<string>> = {
      'claude-rules': new Set(['description', 'globs', 'glob', 'alwaysapply']),
      'skill-md': new Set(['name', 'description']),
    };

    const validKeys = validKeysByType[context.fileType];
    if (!validKeys) return issues;

    const { frontmatterRange } = context;
    if (!frontmatterRange) return issues;

    for (let i = frontmatterRange.start + 1; i < frontmatterRange.end; i++) {
      const line = context.lines[i];
      // Match YAML key at the start of a line (not indented continuation lines)
      const keyMatch = line.match(/^(\w[\w-]*)\s*:/);
      if (!keyMatch) continue;

      const key = keyMatch[1].toLowerCase();
      if (!validKeys.has(key)) {
        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'warning',
          code: 'UNKNOWN_FRONTMATTER_KEY',
          message: `Unknown frontmatter key "${keyMatch[1]}" — this will be ignored`,
          suggestion: `Use only recognized keys: ${Array.from(validKeys).join(', ')}`,
        });
      }
    }

    return issues;
  },
};

// ─── Rule 9: CHAIN_OF_THOUGHT_SIMPLE_TASK ───────────────────────────────────

const chainOfThoughtSimpleTask: RuleDefinition = {
  meta: {
    id: 'CHAIN_OF_THOUGHT_SIMPLE_TASK',
    name: 'Overly Prescriptive Step-by-Step',
    description:
      'Detects overly prescriptive step-by-step chains for simple tasks (5+ very short numbered steps).',
    rationale:
      'Excessive chain-of-thought instructions for trivial tasks waste tokens and can actually degrade performance by constraining the agent\'s natural problem-solving. Agents handle simple tasks well without micro-management.',
    recommendation:
      'Simplify multi-step instructions for straightforward tasks. Instead of 5 small steps, use 2-3 high-level instructions. Reserve detailed step-by-step for genuinely complex procedures.',
    badExample:
      '1. Open the file\n2. Find the function\n3. Read the code\n4. Identify the bug\n5. Fix the bug\n6. Save the file',
    goodExample:
      '1. Find and fix the bug in the authentication function\n2. Run the test suite to verify the fix',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'prompt',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    let sequenceStart = -1;
    let sequenceCount = 0;
    let shortStepCount = 0;
    let expectedNext = 1;

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) {
        flushSequence();
        continue;
      }
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      const line = context.lines[i];
      const stepMatch = line.match(/^\s*(\d+)\.\s+(.+)/);

      if (stepMatch) {
        const stepNum = parseInt(stepMatch[1], 10);
        const stepText = stepMatch[2].trim();

        if (stepNum === expectedNext || (sequenceCount === 0 && stepNum === 1)) {
          if (sequenceCount === 0) {
            sequenceStart = i;
            shortStepCount = 0;
          }
          sequenceCount++;
          expectedNext = stepNum + 1;

          // Count words in the step text
          const wordCount = stepText.split(/\s+/).length;
          if (wordCount < 15) {
            shortStepCount++;
          }
        } else {
          flushSequence();
          // Start a new sequence if this is step 1
          if (stepNum === 1) {
            sequenceStart = i;
            sequenceCount = 1;
            expectedNext = 2;
            const wordCount = stepText.split(/\s+/).length;
            shortStepCount = wordCount < 15 ? 1 : 0;
          }
        }
      } else if (line.trim() === '') {
        // Allow blank lines within a numbered sequence
        continue;
      } else {
        flushSequence();
      }
    }

    // Flush any remaining sequence at end of file
    flushSequence();

    function flushSequence() {
      if (sequenceCount >= 5 && shortStepCount === sequenceCount) {
        issues.push({
          startLine: sequenceStart + 1,
          endLine: sequenceStart + sequenceCount,
          severity: 'info',
          code: 'CHAIN_OF_THOUGHT_SIMPLE_TASK',
          message: `${sequenceCount}-step sequence where every step is very short. This may be over-specifying a simple task.`,
          suggestion:
            'Simplify multi-step instructions for straightforward tasks. Combine into 2-3 high-level instructions. Reserve detailed steps for genuinely complex procedures.',
        });
      }
      sequenceStart = -1;
      sequenceCount = 0;
      shortStepCount = 0;
      expectedNext = 1;
    }

    return issues;
  },
};

// ─── Export ─────────────────────────────────────────────────────────────────

/** All prompt engineering rules for registration. */
export const promptRules: RuleDefinition[] = [
  negativeOnlyInstructions,
  lostInTheMiddle,
  ambiguousInstruction,
  weakLanguageInCritical,
  redundantGenericInstruction,
  rulesFileMissingGlob,
  rulesFileInvalidGlob,
  unknownFrontmatterKey,
  chainOfThoughtSimpleTask,
];
