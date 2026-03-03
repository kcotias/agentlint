import { RuleDefinition } from '../types';
import { isHeaderLine, isBulletLine, isInsideCodeBlock } from '../utils';

/**
 * HEDGING_LANGUAGE
 *
 * Detects weak phrasing that degrades instruction adherence:
 * "try to", "consider", "you might want to", "if possible", "maybe", etc.
 */
const hedgingLanguage: RuleDefinition = {
  meta: {
    id: 'HEDGING_LANGUAGE',
    name: 'Hedging Language Detected',
    description:
      'Detects weak, non-committal phrasing such as "try to", "consider", "perhaps", and "if possible" in agent instructions.',
    rationale:
      'AI agents interpret hedging language as optional guidance rather than firm requirements. Phrases like "try to" or "if possible" give the agent permission to skip the instruction entirely. RFC 2119 keywords (MUST, MUST NOT, NEVER, ALWAYS) produce significantly higher adherence rates.',
    recommendation:
      'Replace hedging phrases with imperative mood using RFC 2119 keywords. "try to use" becomes "MUST use". "consider adding" becomes "ALWAYS add".',
    badExample: 'Try to use TypeScript for new files if possible.',
    goodExample: 'MUST use TypeScript for all new files.',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'language',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];
    const hedgePatterns = [
      { regex: /\btry to\b/i, match: 'try to' },
      { regex: /\bconsider\s+(using|adding|implementing)/i, match: 'consider ...' },
      { regex: /\byou might want to\b/i, match: 'you might want to' },
      { regex: /\bif possible\b/i, match: 'if possible' },
      { regex: /\bmaybe\s+(use|add|try|consider)/i, match: 'maybe ...' },
      { regex: /\bperhaps\b/i, match: 'perhaps' },
      { regex: /\bshould probably\b/i, match: 'should probably' },
      { regex: /\bit would be nice\b/i, match: 'it would be nice' },
      { regex: /\bideally\b/i, match: 'ideally' },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];
      // Skip lines inside code blocks
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      for (const { regex, match } of hedgePatterns) {
        if (regex.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'HEDGING_LANGUAGE',
            message: `Hedging language "${match}" weakens this instruction`,
            suggestion:
              'Use imperative mood with RFC 2119 keywords: MUST, MUST NOT, NEVER, ALWAYS. Example: "MUST use" instead of "try to use".',
            fixable: false,
          });
          break; // One issue per line max
        }
      }
    }
    return issues;
  },
};

/**
 * VAGUE_INSTRUCTION
 *
 * Detects obviously vague instructions that Claude already follows by default,
 * such as "write clean code" or "follow best practices".
 */
const vagueInstruction: RuleDefinition = {
  meta: {
    id: 'VAGUE_INSTRUCTION',
    name: 'Vague Instruction',
    description:
      'Detects generic, non-actionable instructions like "write clean code" or "follow best practices" that provide no value to an AI agent.',
    rationale:
      'AI agents already produce clean, well-structured code by default. Vague instructions waste tokens and dilute the signal of your specific, actionable constraints. Every instruction should be verifiable and project-specific.',
    recommendation:
      'Replace with a specific, verifiable instruction. Instead of "write clean code", specify "MUST use named exports" or "Functions MUST NOT exceed 50 lines".',
    badExample: 'Write clean code and follow best practices.',
    goodExample:
      'MUST use named exports (no default exports).\nFunctions MUST NOT exceed 50 lines.\nMUST add JSDoc for all public APIs.',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'language',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];
    const vaguePatterns = [
      { regex: /\bwrite clean code\b/i, text: 'write clean code' },
      { regex: /\bfollow best practices\b/i, text: 'follow best practices' },
      { regex: /\buse good naming\b/i, text: 'use good naming' },
      { regex: /\bkeep it simple\b/i, text: 'keep it simple' },
      { regex: /\bwrite readable code\b/i, text: 'write readable code' },
      { regex: /\bhandle errors?\s+(properly|appropriately|correctly)\b/i, text: 'handle errors properly' },
      { regex: /\buse\s+appropriate\s+\w+/i, text: 'use appropriate ...' },
      { regex: /\bwrite (good|proper|quality) (code|tests)\b/i, text: 'write good/proper code' },
      { regex: /\bensure (code|the code) is (well|properly)\b/i, text: 'ensure code is well ...' },
      { regex: /\bbe (careful|cautious) (with|when|about)\b/i, text: 'be careful with ...' },
    ];

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      for (const { regex, text } of vaguePatterns) {
        if (regex.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'VAGUE_INSTRUCTION',
            message: `Vague instruction "${text}" \u2014 Claude already does this by default`,
            suggestion:
              'Replace with a specific, verifiable instruction. Instead of "write clean code", say "MUST use named exports" or "Functions MUST NOT exceed 50 lines".',
          });
          break;
        }
      }
    }

    return issues;
  },
};

/**
 * PROSE_PARAGRAPH
 *
 * Detects dense prose blocks (3+ consecutive non-header, non-bullet lines).
 * Dense text is harder for LLMs to parse -- bullets are preferred.
 */
const proseParagraph: RuleDefinition = {
  meta: {
    id: 'PROSE_PARAGRAPH',
    name: 'Dense Prose Block',
    description:
      'Detects blocks of 3 or more consecutive lines of dense prose text that are not headers, bullets, or other structured Markdown.',
    rationale:
      'LLMs parse structured formats (bullet lists, headers, tables) more reliably than dense prose paragraphs. Long prose blocks increase the chance that individual instructions are missed or blended together.',
    recommendation:
      'Convert to bullet points or a numbered list. Each discrete instruction should be its own bullet for maximum adherence.',
    badExample:
      'When writing tests you should make sure to cover edge cases. You should also use descriptive names for test cases. Additionally, mock external services to keep tests fast and reliable.',
    goodExample:
      '- MUST cover edge cases in all tests\n- MUST use descriptive test case names\n- MUST mock external services for speed and reliability',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'language',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];
    let proseStart = -1;
    let proseCount = 0;

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) {
        if (proseCount >= 3) {
          issues.push({
            startLine: proseStart + 1,
            endLine: proseStart + proseCount,
            severity: 'info',
            code: 'PROSE_PARAGRAPH',
            message: `Dense prose block (${proseCount} lines). Bullet points are easier for LLMs to parse.`,
            suggestion:
              'Convert to bullet points or a concise list. LLMs follow structured formats more reliably than prose paragraphs.',
          });
        }
        proseCount = 0;
        proseStart = -1;
        continue;
      }

      const trimmed = context.lines[i].trim();

      // Skip the code-fence lines themselves
      if (trimmed.startsWith('```')) {
        if (proseCount >= 3) {
          issues.push({
            startLine: proseStart + 1,
            endLine: proseStart + proseCount,
            severity: 'info',
            code: 'PROSE_PARAGRAPH',
            message: `Dense prose block (${proseCount} lines). Bullet points are easier for LLMs to parse.`,
            suggestion:
              'Convert to bullet points or a concise list. LLMs follow structured formats more reliably than prose paragraphs.',
          });
        }
        proseCount = 0;
        proseStart = -1;
        continue;
      }

      const isProse =
        trimmed.length > 40 &&
        !isHeaderLine(trimmed) &&
        !isBulletLine(trimmed) &&
        !trimmed.startsWith('|') &&
        !trimmed.startsWith('>') &&
        !trimmed.startsWith('---') &&
        !trimmed.startsWith('```');

      if (isProse) {
        if (proseStart === -1) proseStart = i;
        proseCount++;
      } else {
        if (proseCount >= 3) {
          issues.push({
            startLine: proseStart + 1,
            endLine: proseStart + proseCount,
            severity: 'info',
            code: 'PROSE_PARAGRAPH',
            message: `Dense prose block (${proseCount} lines). Bullet points are easier for LLMs to parse.`,
            suggestion:
              'Convert to bullet points or a concise list. LLMs follow structured formats more reliably than prose paragraphs.',
          });
        }
        proseCount = 0;
        proseStart = -1;
      }
    }

    // Handle trailing prose
    if (proseCount >= 3) {
      issues.push({
        startLine: proseStart + 1,
        endLine: proseStart + proseCount,
        severity: 'info',
        code: 'PROSE_PARAGRAPH',
        message: `Dense prose block (${proseCount} lines). Bullet points are easier for LLMs to parse.`,
        suggestion:
          'Convert to bullet points or a concise list. LLMs follow structured formats more reliably than prose paragraphs.',
      });
    }

    return issues;
  },
};

/** All language quality rules for registration. */
export const languageRules: RuleDefinition[] = [
  hedgingLanguage,
  vagueInstruction,
  proseParagraph,
];
