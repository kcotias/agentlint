import { RuleDefinition } from '../types';
import { isInsideCodeBlock } from '../utils';

/**
 * HTML void elements that don't need closing tags.
 * https://html.spec.whatwg.org/multipage/syntax.html#void-elements
 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Tags that are commonly used in markdown but aren't real XML structure.
 * We skip these to avoid false positives.
 */
const IGNORED_TAGS = new Set([
  // Common HTML inline tags that are often used standalone in markdown
  'p', 'b', 'i', 'u', 's', 'em', 'strong', 'code', 'pre', 'span',
  'a', 'sup', 'sub', 'small', 'big', 'mark', 'del', 'ins', 'abbr',
  // HTML structural tags that markdown authors typically use informally
  'div', 'li', 'ul', 'ol', 'table', 'tr', 'td', 'th', 'thead', 'tbody',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  // Common informal patterns
  'details', 'summary',
]);

/**
 * Parse XML/HTML-like tags from a line of text, skipping inline code spans.
 * Returns opening and closing tags found.
 */
interface TagInfo {
  name: string;
  isClosing: boolean;
  isSelfClosing: boolean;
  lineIndex: number;
  column: number;
}

function parseTagsFromLine(line: string, lineIndex: number): TagInfo[] {
  const tags: TagInfo[] = [];

  // Remove inline code spans (backtick-wrapped) to avoid false matches
  const sanitized = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));

  // Remove HTML comments
  const noComments = sanitized.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));

  // Match XML/HTML-like tags: <tagname ...> or </tagname> or <tagname ... />
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)\b[^>]*\/?>/g;
  let match;

  while ((match = tagPattern.exec(noComments)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();
    const isClosing = fullMatch.startsWith('</');
    const isSelfClosing = fullMatch.endsWith('/>');

    tags.push({
      name: tagName,
      isClosing,
      isSelfClosing,
      lineIndex,
      column: match.index,
    });
  }

  return tags;
}

/**
 * XML_TAG_UNBALANCED
 *
 * Detects unbalanced XML/HTML-style tags. Claude and other agents use XML tags
 * extensively for structured instructions.
 */
const xmlTagUnbalanced: RuleDefinition = {
  meta: {
    id: 'XML_TAG_UNBALANCED',
    name: 'Unbalanced XML Tag',
    description:
      'Detects unbalanced XML/HTML-style tags in instruction files. Checks that every opening tag has a matching closing tag and vice versa. Ignores self-closing tags, HTML void elements, code blocks, and common HTML tags used informally in markdown.',
    rationale:
      'Unbalanced XML tags cause agents to misparse instruction boundaries. Content after an unclosed tag may be treated as part of the wrong section.',
    recommendation:
      'Add the missing closing tag or remove the orphan opening tag.',
    badExample: '<example>\nDo this thing\n<!-- forgot </example> -->',
    goodExample: '<example>\nDo this thing\n</example>',
    defaultSeverity: 'error',
    applicableTo: 'all',
    category: 'xml',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Count opening and closing tags (excluding void, self-closing, and ignored tags)
    const tagCounts = new Map<string, { opens: number[]; closes: number[] }>();

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const tags = parseTagsFromLine(context.lines[i], i);

      for (const tag of tags) {
        // Skip void elements, self-closing tags, and common HTML tags
        if (VOID_ELEMENTS.has(tag.name)) continue;
        if (tag.isSelfClosing) continue;
        if (IGNORED_TAGS.has(tag.name)) continue;

        if (!tagCounts.has(tag.name)) {
          tagCounts.set(tag.name, { opens: [], closes: [] });
        }

        const counts = tagCounts.get(tag.name)!;
        if (tag.isClosing) {
          counts.closes.push(i);
        } else {
          counts.opens.push(i);
        }
      }
    }

    // Report unbalanced tags
    for (const [tagName, counts] of tagCounts) {
      const openCount = counts.opens.length;
      const closeCount = counts.closes.length;

      if (openCount > closeCount) {
        // More opens than closes — flag the extra opening tags
        const diff = openCount - closeCount;
        // Flag the last `diff` opening tags (most likely to be the unclosed ones)
        const unclosedOpens = counts.opens.slice(-diff);
        for (const lineIdx of unclosedOpens) {
          issues.push({
            startLine: lineIdx + 1,
            endLine: lineIdx + 1,
            severity: 'error',
            code: 'XML_TAG_UNBALANCED',
            message: `Opening <${tagName}> tag has no matching closing </${tagName}> tag`,
            suggestion: `Add a closing </${tagName}> tag or remove the orphan opening tag.`,
          });
        }
      } else if (closeCount > openCount) {
        // More closes than opens — flag the extra closing tags
        const diff = closeCount - openCount;
        const orphanCloses = counts.closes.slice(-diff);
        for (const lineIdx of orphanCloses) {
          issues.push({
            startLine: lineIdx + 1,
            endLine: lineIdx + 1,
            severity: 'error',
            code: 'XML_TAG_UNBALANCED',
            message: `Closing </${tagName}> tag has no matching opening <${tagName}> tag`,
            suggestion: `Add an opening <${tagName}> tag or remove the orphan closing tag.`,
          });
        }
      }
    }

    return issues;
  },
};

/**
 * XML_TAG_NESTING_ERROR
 *
 * Detects improperly nested XML tags (e.g., <a><b></a></b>).
 * Uses a simple stack-based parser.
 */
const xmlTagNestingError: RuleDefinition = {
  meta: {
    id: 'XML_TAG_NESTING_ERROR',
    name: 'XML Tag Nesting Error',
    description:
      'Detects improperly nested XML tags where closing tags do not match the expected nesting order. Uses a stack-based parser to verify proper nesting.',
    rationale:
      'Mis-nested tags cause agents to misinterpret instruction scope and hierarchy.',
    recommendation:
      'Fix the nesting order so tags close in reverse order of opening.',
    badExample: '<instructions><example></instructions></example>',
    goodExample: '<instructions><example></example></instructions>',
    defaultSeverity: 'error',
    applicableTo: 'all',
    category: 'xml',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Stack-based nesting check
    const stack: Array<{ name: string; lineIndex: number }> = [];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const tags = parseTagsFromLine(context.lines[i], i);

      for (const tag of tags) {
        // Skip void elements, self-closing tags, and common HTML tags
        if (VOID_ELEMENTS.has(tag.name)) continue;
        if (tag.isSelfClosing) continue;
        if (IGNORED_TAGS.has(tag.name)) continue;

        if (!tag.isClosing) {
          // Push opening tag onto stack
          stack.push({ name: tag.name, lineIndex: i });
        } else {
          // Closing tag — check if it matches top of stack
          if (stack.length === 0) {
            // Closing tag with nothing on the stack — handled by unbalanced rule
            continue;
          }

          const top = stack[stack.length - 1];
          if (top.name === tag.name) {
            // Correct nesting — pop the matching opening tag
            stack.pop();
          } else {
            // Check if this closing tag matches something deeper in the stack
            // This indicates a nesting error, not just an unbalanced tag
            const deeperIndex = findInStack(stack, tag.name);
            if (deeperIndex !== -1) {
              // Found the matching open tag deeper in the stack — nesting error
              issues.push({
                startLine: i + 1,
                endLine: i + 1,
                severity: 'error',
                code: 'XML_TAG_NESTING_ERROR',
                message: `</${tag.name}> closes out of order — expected </${top.name}> first (opened on line ${top.lineIndex + 1})`,
                suggestion: `Fix the nesting order. Close <${top.name}> before closing <${tag.name}>.`,
              });
              // Pop everything up to and including the matched tag to continue parsing
              stack.splice(deeperIndex);
            }
            // If not found in stack at all, the unbalanced rule will catch it
          }
        }
      }
    }

    return issues;
  },
};

/**
 * Find a tag name in the stack, searching from top to bottom.
 * Returns the index if found, -1 otherwise.
 */
function findInStack(
  stack: Array<{ name: string; lineIndex: number }>,
  tagName: string
): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name === tagName) return i;
  }
  return -1;
}

/** All XML/tag rules for registration. */
export const xmlRules: RuleDefinition[] = [
  xmlTagUnbalanced,
  xmlTagNestingError,
];
