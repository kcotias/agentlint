import { RuleDefinition } from '../types';
import { isInsideCodeBlock } from '../utils';

/**
 * BROKEN_MARKDOWN_LINK
 *
 * Detects markdown links with empty or malformed URLs: [text](), [text]( ),
 * [text](undefined), [text](TODO), [text](#).
 */
const brokenMarkdownLink: RuleDefinition = {
  meta: {
    id: 'BROKEN_MARKDOWN_LINK',
    name: 'Broken Markdown Link',
    description:
      'Detects markdown links with empty, placeholder, or malformed URLs such as [text](), [text]( ), [text](undefined), [text](TODO), [text](#).',
    rationale:
      'Agents may try to navigate broken links, wasting time and potentially hallucinating content.',
    recommendation:
      'Add a valid URL or remove the link entirely.',
    badExample: '[API docs]()\n[Config guide](TODO)\n[Home](#)',
    goodExample: '[API docs](https://docs.example.com/api)\n[Config guide](./docs/config.md)',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'links',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Pattern for markdown links: [text](url)
    // We specifically look for broken URL portions
    const brokenLinkPatterns = [
      // [text]() — completely empty
      /\[[^\]]+\]\(\s*\)/g,
      // [text](undefined) — literal undefined
      /\[[^\]]+\]\(\s*undefined\s*\)/g,
      // [text](null) — literal null
      /\[[^\]]+\]\(\s*null\s*\)/g,
      // [text](TODO) or [text](TBD) or [text](FIXME) — placeholder text
      /\[[^\]]+\]\(\s*(?:TODO|TBD|FIXME|PLACEHOLDER|XXX)\s*\)/gi,
      // [text](#) — empty anchor
      /\[[^\]]+\]\(\s*#\s*\)/g,
      // [text](.) — single dot is not meaningful
      /\[[^\]]+\]\(\s*\.\s*\)/g,
    ];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      for (const pattern of brokenLinkPatterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(line)) !== null) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'BROKEN_MARKDOWN_LINK',
            message: `Broken markdown link: ${match[0]}`,
            suggestion:
              'Add a valid URL or file path, or remove the link entirely. Agents may try to navigate broken links.',
          });
        }
      }
    }

    return issues;
  },
};

/**
 * RELATIVE_LINK_OUTSIDE_REPO
 *
 * Detects relative links that traverse above the project root with excessive
 * ../ traversal (3+ levels).
 */
const relativeLinkOutsideRepo: RuleDefinition = {
  meta: {
    id: 'RELATIVE_LINK_OUTSIDE_REPO',
    name: 'Relative Link Outside Repository',
    description:
      'Detects relative links that traverse above the project root using excessive ../ traversal (3 or more levels up).',
    rationale:
      'Agents typically cannot access files outside the project. Links leaving the repo will fail silently.',
    recommendation:
      'Use absolute paths or keep references within the project directory.',
    badExample: 'See [shared config](../../../other-project/config.json) for defaults.',
    goodExample: 'See [shared config](./config/defaults.json) for defaults.',
    defaultSeverity: 'warning',
    applicableTo: 'all',
    category: 'links',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Match markdown links with relative paths: [text](../../.../path)
    const markdownLinkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

    // Match backtick-wrapped paths with excessive ../
    const backtickPathPattern = /`((?:\.\.\/){3,}[^`]*)`/g;

    // The threshold: 3+ levels of ../ is suspicious
    const excessiveTraversal = /(?:\.\.\/){3,}/;

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      // Check markdown links
      markdownLinkPattern.lastIndex = 0;
      let match;
      while ((match = markdownLinkPattern.exec(line)) !== null) {
        const url = match[1].trim();

        // Skip absolute URLs
        if (url.startsWith('http://') || url.startsWith('https://')) continue;

        if (excessiveTraversal.test(url)) {
          const levels = (url.match(/\.\.\//g) || []).length;
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'warning',
            code: 'RELATIVE_LINK_OUTSIDE_REPO',
            message: `Link traverses ${levels} levels up (${url}) — likely escapes the project root`,
            suggestion:
              'Use absolute paths or keep references within the project directory. Agents cannot access files outside the repo.',
          });
        }
      }

      // Check backtick-wrapped paths
      backtickPathPattern.lastIndex = 0;
      while ((match = backtickPathPattern.exec(line)) !== null) {
        const path = match[1];
        const levels = (path.match(/\.\.\//g) || []).length;
        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'warning',
          code: 'RELATIVE_LINK_OUTSIDE_REPO',
          message: `Path traverses ${levels} levels up (\`${path}\`) — likely escapes the project root`,
          suggestion:
            'Use absolute paths or keep references within the project directory. Agents cannot access files outside the repo.',
        });
      }
    }

    return issues;
  },
};

/**
 * README_DUPLICATION
 *
 * Detects when CLAUDE.md content is mostly duplicated from README.md patterns:
 * badges, contribution guides, license sections, public install instructions.
 */
const readmeDuplication: RuleDefinition = {
  meta: {
    id: 'README_DUPLICATION',
    name: 'README Content Duplication',
    description:
      'Detects when CLAUDE.md contains README-style content such as shields.io badges, contribution guides, license sections, and public npm install instructions that waste agent context.',
    rationale:
      'README content wastes agent context window. Agents need actionable instructions, not marketing copy or contributor docs. Every token spent on README duplication is a token not available for real instructions.',
    recommendation:
      'Remove README-style content. CLAUDE.md should contain only agent-actionable instructions: commands, constraints, architecture, gotchas.',
    badExample:
      '[![Build Status](https://img.shields.io/badge/...)]\n## Contributing\nPlease read CONTRIBUTING.md before submitting a PR.\n## License\nMIT',
    goodExample:
      '## Commands\n- `npm run build` — Build the project\n\n## Constraints\n- NEVER commit to main directly',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'links',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'claude-md' && context.fileType !== 'claude-local-md') {
      return [];
    }

    const issues: ReturnType<RuleDefinition['check']> = [];

    // Track how many README patterns we find and where
    const readmeIndicators: Array<{ lineIndex: number; pattern: string }> = [];

    for (let i = 0; i < context.lines.length; i++) {
      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;

      const line = context.lines[i];

      // shields.io or badge image URLs
      if (/shields\.io|badge\/|img\.shields|badgen\.net|badge\.fury/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'badge reference' });
        continue;
      }

      // Badge image patterns: [![...](https://...)]
      if (/\[!\[.+\]\(.+\)\]\(.+\)/.test(line) && /https?:\/\//.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'badge image' });
        continue;
      }

      // "## Contributing" section header with typical PR/contribution language
      if (/^#{1,3}\s+contribut/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'contributing section' });
        continue;
      }

      // PR submission instructions
      if (/\b(?:submit\s+a\s+(?:pull\s+request|PR)|open\s+a\s+PR|fork\s+(?:the\s+)?(?:repo|repository))\b/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'PR instructions' });
        continue;
      }

      // "## License" section
      if (/^#{1,3}\s+license/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'license section' });
        continue;
      }

      // License badge or text patterns
      if (/\b(?:MIT|Apache\s+2\.0|GPL|BSD|ISC)\s+(?:License|licence)\b/i.test(line) &&
          !/\b(?:NEVER|MUST|DO NOT|constraint|rule)\b/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'license text' });
        continue;
      }

      // Public npm install as a "getting started" instruction (not a build command)
      if (/^\s*(?:[-*]?\s*)?(?:`)?(?:npm\s+install|yarn\s+add|pnpm\s+add)\s+[a-z@][a-z0-9@/_.-]*(?:`)?$/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'public package install' });
        continue;
      }

      // GitHub stars / forks references
      if (/\bgithub\.com\/[^/]+\/[^/]+\/(?:stargazers|network|fork)/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'GitHub stars/forks reference' });
        continue;
      }

      // "## Installation" as a public getting-started section
      if (/^#{1,3}\s+installation/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'installation section' });
        continue;
      }

      // "## Getting Started" section
      if (/^#{1,3}\s+getting\s+started/i.test(line)) {
        readmeIndicators.push({ lineIndex: i, pattern: 'getting started section' });
        continue;
      }
    }

    // If we found 3+ README-style indicators, it's likely duplicated content
    if (readmeIndicators.length >= 3) {
      const patternTypes = [...new Set(readmeIndicators.map((r) => r.pattern))];
      const firstLine = readmeIndicators[0].lineIndex;

      issues.push({
        startLine: firstLine + 1,
        endLine: readmeIndicators[readmeIndicators.length - 1].lineIndex + 1,
        severity: 'warning',
        code: 'README_DUPLICATION',
        message: `Found ${readmeIndicators.length} README-style patterns (${patternTypes.join(', ')}) — this wastes agent context`,
        suggestion:
          'Remove README-style content from CLAUDE.md. Agent instruction files should contain only actionable instructions: commands, constraints, architecture decisions, and gotchas. Badges, contribution guides, and license info belong in README.md.',
      });
    }

    return issues;
  },
};

/** All link validation rules for registration. */
export const linksRules: RuleDefinition[] = [
  brokenMarkdownLink,
  relativeLinkOutsideRepo,
  readmeDuplication,
];
