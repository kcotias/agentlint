import { AgentFileType } from '../types';
import { RuleContext } from './types';

/**
 * Compute ranges of lines that are inside fenced code blocks (```).
 * Returns an array of {start, end} where start is the opening ``` line index
 * and end is the closing ``` line index (both 0-based, inclusive).
 */
export function computeCodeBlockRanges(
  lines: string[]
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let openIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('```')) {
      if (openIndex === -1) {
        openIndex = i;
      } else {
        ranges.push({ start: openIndex, end: i });
        openIndex = -1;
      }
    }
  }

  // If a code block was opened but never closed, treat rest of file as code
  if (openIndex !== -1) {
    ranges.push({ start: openIndex, end: lines.length - 1 });
  }

  return ranges;
}

/**
 * Compute the range of YAML frontmatter (--- delimited block at start of file).
 * Returns {start, end} (0-based inclusive line indices) or null if no frontmatter.
 */
export function computeFrontmatterRange(
  lines: string[]
): { start: number; end: number } | null {
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return null;
  }

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return { start: 0, end: i };
    }
  }

  return null;
}

/**
 * Build a fully populated RuleContext from raw inputs.
 * Pre-computes code block ranges and frontmatter range for efficient rule execution.
 */
export function buildRuleContext(
  content: string,
  fileType: AgentFileType,
  filePath: string
): RuleContext {
  const lines = content.split('\n');
  return {
    content,
    lines,
    fileType,
    filePath,
    codeBlockRanges: computeCodeBlockRanges(lines),
    frontmatterRange: computeFrontmatterRange(lines),
  };
}

/** Count lines that are not empty or whitespace-only. */
export function countNonEmptyLines(lines: string[]): number {
  return lines.filter((l) => l.trim().length > 0).length;
}

/** Check if a line is a Markdown header (# through ######). */
export function isHeaderLine(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

/** Check if a line is a Markdown bullet or numbered list item. */
export function isBulletLine(line: string): boolean {
  return /^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line);
}

/** Check if a given line index falls inside any code block range. */
export function isInsideCodeBlock(
  lineIndex: number,
  ranges: Array<{ start: number; end: number }>
): boolean {
  return ranges.some((r) => lineIndex >= r.start && lineIndex <= r.end);
}

/** Check if a given line index falls inside the frontmatter range. */
export function isInsideFrontmatter(
  lineIndex: number,
  range: { start: number; end: number } | null
): boolean {
  if (!range) return false;
  return lineIndex >= range.start && lineIndex <= range.end;
}
