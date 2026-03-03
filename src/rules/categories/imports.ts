import { RuleDefinition } from '../types';
import { isInsideCodeBlock } from '../utils';

/**
 * IMPORT_PATH_NOT_FOUND
 *
 * Detects when instruction files reference paths that look like file system paths
 * (e.g., `src/utils/helper.ts`, `./config/db.ts`) but may not exist.
 * AI agents will try to read/modify referenced files — wrong paths waste tokens.
 */
const importPathNotFound: RuleDefinition = {
  meta: {
    id: 'IMPORT_PATH_NOT_FOUND',
    name: 'Import Path Not Found',
    description:
      'Detects file system path references in instruction files that may not exist. Scans for backtick-wrapped paths, "see path/to/file" references, and other common path reference patterns.',
    rationale:
      'AI agents will try to read or modify referenced files. If the path is wrong, the agent wastes tokens searching or creates files in wrong locations.',
    recommendation:
      'Verify the path exists. Use relative paths from project root.',
    badExample: 'See `src/utlis/helper.ts` for the implementation.',
    goodExample: 'See `src/utils/helper.ts` for the implementation.',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'imports',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Pattern for file system paths — must look like a real path with at least one directory separator
    // and a recognizable file extension or directory structure
    const pathPatterns = [
      // Backtick-wrapped paths: `src/utils/helper.ts`, `./config/db.ts`
      /`(\.{0,2}\/)?([a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z]{1,10}`/g,
      // "see <path>" or "refer to <path>" or "check <path>" patterns (with backticks)
      /(?:see|refer\s+to|check|read|look\s+at|edit|modify|update|open)\s+`(\.{0,2}\/)?([a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z]{1,10}`/gi,
    ];

    // Known extensions that indicate real file references
    const fileExtensions = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|cpp|h|hpp|css|scss|less|html|json|yaml|yml|toml|xml|md|txt|sh|bash|zsh|sql|graphql|proto|swift|kt|scala|ex|exs|clj|zig|vue|svelte)$/;

    const seen = new Set<string>();

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      for (const pattern of pathPatterns) {
        // Reset lastIndex for global patterns
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          // Extract the path from the backticks
          const backtickMatch = match[0].match(/`([^`]+)`/);
          if (!backtickMatch) continue;

          const path = backtickMatch[1];

          // Must have a recognized file extension
          if (!fileExtensions.test(path)) continue;

          // Skip URLs
          if (path.startsWith('http://') || path.startsWith('https://')) continue;

          // Skip package-style references (no / or starting with @)
          if (!path.includes('/')) continue;

          // Deduplicate within the file
          const key = `${i}:${path}`;
          if (seen.has(key)) continue;
          seen.add(key);

          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'IMPORT_PATH_NOT_FOUND',
            message: `Referenced path \`${path}\` — verify this file exists`,
            suggestion:
              'Verify the path exists in your project. Use relative paths from the project root. Typos in paths cause agents to waste tokens searching.',
          });
        }
      }
    }

    return issues;
  },
};

/**
 * CIRCULAR_REFERENCE
 *
 * Detects when an instruction file references itself or creates obvious
 * circular chains (e.g., CLAUDE.md says "see CLAUDE.md").
 */
const circularReference: RuleDefinition = {
  meta: {
    id: 'CIRCULAR_REFERENCE',
    name: 'Circular Reference',
    description:
      'Detects when an instruction file references itself or creates circular chains. Looks for self-referencing patterns like "see CLAUDE.md" inside CLAUDE.md.',
    rationale:
      'Circular references confuse agents, potentially causing infinite loops in instruction processing.',
    recommendation:
      'Remove self-references. Each file should be self-contained or reference only other file types.',
    badExample:
      'Inside CLAUDE.md: "For more details, see CLAUDE.md"',
    goodExample:
      'Inside CLAUDE.md: "For deployment details, see SKILL.md"',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'imports',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Build a map of file type to filenames that are self-references
    const selfReferencePatterns: Record<string, RegExp[]> = {
      'claude-md': [
        /\bCLAUDE\.md\b/i,
      ],
      'claude-local-md': [
        /\bCLAUDE\.local\.md\b/i,
      ],
      'claude-rules': [
        // For rules files, the actual filename varies, so detect "this file" patterns
      ],
      'agents-md': [
        /\bAGENTS\.md\b/i,
      ],
      'cursorrules': [
        /\.cursorrules\b/i,
      ],
      'copilot-instructions': [
        /copilot-instructions\.md\b/i,
      ],
      'skill-md': [
        /\bSKILL\.md\b/i,
      ],
    };

    // Generic self-reference patterns that apply to all file types
    const genericSelfRefPatterns = [
      /\b(?:see|refer\s+to|check|read|consult)\s+this\s+file\b/i,
      /\b(?:see|refer\s+to|check|read|consult)\s+(?:the\s+)?(?:current|this)\s+(?:document|file|page)\b/i,
    ];

    const typePatterns = selfReferencePatterns[context.fileType] || [];
    const allPatterns = [...typePatterns, ...genericSelfRefPatterns];

    if (allPatterns.length === 0) return issues;

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      // Skip header lines that are just the title of the file (e.g., "# CLAUDE.md")
      if (/^#{1,6}\s/.test(line)) continue;

      for (const pattern of allPatterns) {
        if (pattern.test(line)) {
          // For filename patterns, make sure it's in a reference context, not just mentioning the file
          // E.g., "see CLAUDE.md" is a reference; "This is the CLAUDE.md file" in a title is not
          const isGenericPattern = genericSelfRefPatterns.includes(pattern);
          const isReferenceContext = isGenericPattern ||
            /(?:see|refer|check|read|consult|look\s+at|open|follow|in|from)\s/i.test(line);

          if (isReferenceContext) {
            issues.push({
              startLine: i + 1,
              endLine: i + 1,
              severity: 'warning',
              code: 'CIRCULAR_REFERENCE',
              message: 'File appears to reference itself — this creates a circular reference',
              suggestion:
                'Remove self-references. Each instruction file should be self-contained or reference only other file types.',
            });
            break; // Only one issue per line
          }
        }
      }
    }

    return issues;
  },
};

/**
 * DUPLICATE_IMPORT
 *
 * Detects when the same file/module/package is referenced multiple times
 * in instructions.
 */
const duplicateImport: RuleDefinition = {
  meta: {
    id: 'DUPLICATE_IMPORT',
    name: 'Duplicate Import Reference',
    description:
      'Detects when the same file, module, or package is referenced multiple times across the document.',
    rationale:
      'Duplicate references waste tokens and can cause conflicting instructions if the references diverge.',
    recommendation:
      'Consolidate references to the same file into a single section.',
    badExample:
      'See `src/utils/auth.ts` for auth logic.\n...\nThe auth helper is in `src/utils/auth.ts`.',
    goodExample:
      '## Auth\nAll authentication logic is in `src/utils/auth.ts`.',
    defaultSeverity: 'info',
    applicableTo: 'all',
    category: 'imports',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Track all backtick-wrapped path references and their line numbers
    const pathOccurrences = new Map<string, number[]>();

    // Pattern for file paths in backticks — same as in importPathNotFound
    const pathInBackticks = /`(\.{0,2}\/)?([a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+\.[a-zA-Z]{1,10}`/g;
    const fileExtensions = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|cpp|h|hpp|css|scss|less|html|json|yaml|yml|toml|xml|md|txt|sh|bash|zsh|sql|graphql|proto|swift|kt|scala|ex|exs|clj|zig|vue|svelte)$/;

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];
      pathInBackticks.lastIndex = 0;
      let match;

      while ((match = pathInBackticks.exec(line)) !== null) {
        const backtickMatch = match[0].match(/`([^`]+)`/);
        if (!backtickMatch) continue;

        const path = backtickMatch[1];
        if (!fileExtensions.test(path)) continue;
        if (!path.includes('/')) continue;

        // Normalize the path for deduplication (remove leading ./)
        const normalized = path.replace(/^\.\//, '');

        const lines = pathOccurrences.get(normalized) || [];
        lines.push(i);
        pathOccurrences.set(normalized, lines);
      }
    }

    // Report paths that appear more than once
    for (const [path, lines] of pathOccurrences) {
      if (lines.length >= 2) {
        const lineNumbers = lines.map((l) => l + 1).join(', ');
        issues.push({
          startLine: lines[1] + 1, // Flag the second occurrence
          endLine: lines[1] + 1,
          severity: 'info',
          code: 'DUPLICATE_IMPORT',
          message: `\`${path}\` is referenced ${lines.length} times (lines ${lineNumbers})`,
          suggestion:
            'Consolidate references to the same file into a single section to save tokens and avoid conflicting instructions.',
        });
      }
    }

    return issues;
  },
};

/** All import/reference rules for registration. */
export const importsRules: RuleDefinition[] = [
  importPathNotFound,
  circularReference,
  duplicateImport,
];
