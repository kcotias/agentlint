import { RuleDefinition } from '../types';
import { isInsideCodeBlock, isInsideFrontmatter } from '../utils';

/**
 * MCP (Model Context Protocol) server configuration rules (Tier 3).
 *
 * MCP servers provide tools and resources to AI agents.
 * These rules validate that MCP configurations in instruction files
 * are secure, portable, and resilient.
 */

/** Pattern that indicates a line is discussing MCP */
const MCP_CONTEXT_PATTERN =
  /\b(mcp|MCP|model\s+context\s+protocol|mcpServers|mcp:\/\/|mcp[-_]server)/i;

/** Authentication-related keywords */
const AUTH_KEYWORDS =
  /\b(auth|authentication|token|api[-_]?key|credential|secret|oauth|bearer|password|login|apiKey)\b/i;

/** Error handling keywords */
const ERROR_KEYWORDS =
  /\b(error|fail|failure|fallback|timeout|retry|retries|unavailable|offline|unreachable|down|catch|exception|backup|degrade|graceful)\b/i;

/** Hardcoded URL patterns for local servers */
const HARDCODED_URL_PATTERN =
  /\b(localhost:\d+|127\.0\.0\.1:\d+|0\.0\.0\.0:\d+|http:\/\/192\.168\.\d+\.\d+)/i;

// ── Helpers ─────────────────────────────────────────────────────────────────

interface McpSection {
  startLine: number;
  endLine: number;
  lines: string[];
  lineIndices: number[];
}

/**
 * Find sections that discuss MCP configuration.
 * A section starts when we see MCP context and ends at the next unrelated heading.
 */
function findMcpSections(
  lines: string[],
  codeBlockRanges: Array<{ start: number; end: number }>,
  frontmatterRange: { start: number; end: number } | null
): McpSection[] {
  const sections: McpSection[] = [];
  let current: McpSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (isInsideCodeBlock(i, codeBlockRanges)) continue;
    if (isInsideFrontmatter(i, frontmatterRange)) continue;

    const line = lines[i];
    const isHeader = /^#{1,4}\s/.test(line);

    if (isHeader && MCP_CONTEXT_PATTERN.test(line)) {
      // Start a new MCP section
      if (current) sections.push(current);
      current = {
        startLine: i,
        endLine: i,
        lines: [line],
        lineIndices: [i],
      };
    } else if (isHeader && current) {
      // End current MCP section at a new unrelated header
      sections.push(current);
      current = null;
    } else if (current) {
      current.lines.push(line);
      current.lineIndices.push(i);
      current.endLine = i;
    }
  }

  if (current) sections.push(current);

  return sections;
}

// ── Rule 8: MCP_MISSING_AUTH ────────────────────────────────────────────────

const mcpMissingAuth: RuleDefinition = {
  meta: {
    id: 'MCP_MISSING_AUTH',
    name: 'MCP Server Missing Authentication',
    description:
      'Detects MCP server references that do not mention authentication, tokens, keys, or credentials.',
    rationale:
      'MCP servers without auth guidance may lead agents to expose credentials or connect to unauthorized servers. Explicit auth documentation prevents security misconfiguration.',
    recommendation:
      'Specify authentication method for MCP servers: API key, OAuth token, or "no auth required".',
    badExample:
      '## MCP Servers\n- Database server at mcp://db-server\n- Analytics server for metrics',
    goodExample:
      '## MCP Servers\n- Database server at mcp://db-server (auth: API key via MCP_DB_KEY)\n- Analytics server: no authentication required (read-only public data)',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'mcp',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const mcpSections = findMcpSections(
      context.lines,
      context.codeBlockRanges,
      context.frontmatterRange
    );

    for (const section of mcpSections) {
      const sectionText = section.lines.join(' ');
      if (!AUTH_KEYWORDS.test(sectionText)) {
        issues.push({
          startLine: section.startLine + 1,
          endLine: section.endLine + 1,
          severity: 'warning',
          code: 'MCP_MISSING_AUTH',
          message:
            'MCP server configuration does not mention authentication or credentials',
          suggestion:
            'Specify authentication method for MCP servers: API key, OAuth token, or "no auth required".',
        });
      }
    }

    // Also check for inline MCP mentions outside of dedicated sections
    // but only if there are no dedicated sections (avoid double-flagging)
    if (mcpSections.length === 0) {
      let mcpMentionCount = 0;
      let mcpFirstLine = -1;
      let mcpLastLine = -1;
      let hasAuth = false;

      for (let i = 0; i < context.lines.length; i++) {
        if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
        if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

        const line = context.lines[i];
        if (MCP_CONTEXT_PATTERN.test(line)) {
          mcpMentionCount++;
          if (mcpFirstLine === -1) mcpFirstLine = i;
          mcpLastLine = i;
        }
        if (AUTH_KEYWORDS.test(line)) {
          hasAuth = true;
        }
      }

      // Only flag if there's meaningful MCP discussion (3+ mentions) without auth
      if (mcpMentionCount >= 3 && !hasAuth) {
        issues.push({
          startLine: mcpFirstLine + 1,
          endLine: mcpLastLine + 1,
          severity: 'warning',
          code: 'MCP_MISSING_AUTH',
          message:
            'MCP server references found but no authentication guidance provided',
          suggestion:
            'Specify authentication method for MCP servers: API key, OAuth token, or "no auth required".',
        });
      }
    }

    return issues;
  },
};

// ── Rule 9: MCP_HARDCODED_URL ───────────────────────────────────────────────

const mcpHardcodedUrl: RuleDefinition = {
  meta: {
    id: 'MCP_HARDCODED_URL',
    name: 'MCP Hardcoded URL',
    description:
      'Detects hardcoded localhost, 127.0.0.1, 0.0.0.0, or private IP URLs in MCP server configurations.',
    rationale:
      'Hardcoded URLs break when environments change. Port numbers vary across developer machines and CI environments.',
    recommendation:
      'Use environment variables or configuration references instead of hardcoded URLs: ${MCP_SERVER_URL}.',
    badExample:
      '## MCP Config\nmcpServers:\n  db: http://localhost:3456\n  api: http://127.0.0.1:8080',
    goodExample:
      '## MCP Config\nmcpServers:\n  db: ${MCP_DB_URL}\n  api: ${MCP_API_URL}',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'mcp',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    let inMcpContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track MCP context
      if (MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = false;
      }

      if (!inMcpContext) continue;

      const urlMatch = line.match(HARDCODED_URL_PATTERN);
      if (urlMatch) {
        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'warning',
          code: 'MCP_HARDCODED_URL',
          message: `Hardcoded URL "${urlMatch[0]}" in MCP configuration`,
          suggestion:
            'Use environment variables or configuration references instead of hardcoded URLs: ${MCP_SERVER_URL}.',
        });
      }
    }

    return issues;
  },
};

// ── Rule 10: MCP_MISSING_ERROR_HANDLING ─────────────────────────────────────

const mcpMissingErrorHandling: RuleDefinition = {
  meta: {
    id: 'MCP_MISSING_ERROR_HANDLING',
    name: 'MCP Missing Error Handling',
    description:
      'Detects MCP server instructions with more than 3 lines but no error or fallback guidance.',
    rationale:
      'MCP servers are external dependencies that can fail. Without fallback instructions, agents get stuck when a server is down.',
    recommendation:
      'Add fallback instructions: what should the agent do if the MCP server is unavailable?',
    badExample:
      '## MCP Servers\nUse the database MCP server to query user data.\nFetch analytics from the metrics MCP.\nUse the auth MCP for token validation.\nAll queries go through MCP.',
    goodExample:
      '## MCP Servers\nUse the database MCP server to query user data.\nIf the MCP server is unavailable, fall back to reading from the local cache.\nTimeout: 10 seconds per request. Retry up to 3 times.',
    defaultSeverity: 'info',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'mcp',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const mcpSections = findMcpSections(
      context.lines,
      context.codeBlockRanges,
      context.frontmatterRange
    );

    for (const section of mcpSections) {
      const nonEmptyLines = section.lines.filter(
        (l) => l.trim().length > 0
      );

      // Only flag sections with meaningful content (>3 non-empty lines)
      if (nonEmptyLines.length <= 3) continue;

      const sectionText = section.lines.join(' ');
      if (!ERROR_KEYWORDS.test(sectionText)) {
        issues.push({
          startLine: section.startLine + 1,
          endLine: section.endLine + 1,
          severity: 'info',
          code: 'MCP_MISSING_ERROR_HANDLING',
          message:
            'MCP server section has no error handling or fallback guidance',
          suggestion:
            'Add fallback instructions: what should the agent do if the MCP server is unavailable?',
        });
      }
    }

    return issues;
  },
};

// ── Rule 11: MCP_SCHEMA_INVALID_TRANSPORT ───────────────────────────────────

const mcpSchemaInvalidTransport: RuleDefinition = {
  meta: {
    id: 'MCP_SCHEMA_INVALID_TRANSPORT',
    name: 'MCP Invalid Transport Type',
    description:
      'Detects MCP server configurations referencing invalid transport types such as websocket, grpc, tcp, udp, or socket.',
    rationale:
      'MCP only supports stdio and SSE/streamable-http transports. Configuring a non-existent transport means the server will never connect.',
    recommendation:
      "Use a valid MCP transport: 'stdio' for local servers or 'sse'/'streamable-http' for remote servers.",
    badExample:
      '## MCP Servers\nmcpServers:\n  db:\n    transport: websocket\n    url: ws://localhost:3456',
    goodExample:
      '## MCP Servers\nmcpServers:\n  db:\n    transport: stdio\n    command: node server.js',
    defaultSeverity: 'error',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'mcp',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Valid transports
    const validTransports = /\b(stdio|sse|streamable-http|http|https)\b/i;

    // Invalid transports people might try
    const invalidTransportPattern =
      /\btransport\s*[:=]\s*["']?(websocket|ws|wss|grpc|tcp|udp|socket|rest|http2|pipe|ipc)["']?\b/i;

    let inMcpContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track MCP context
      if (MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = false;
      }

      if (!inMcpContext) continue;

      const invalidMatch = line.match(invalidTransportPattern);
      if (invalidMatch) {
        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'error',
          code: 'MCP_SCHEMA_INVALID_TRANSPORT',
          message: `Invalid MCP transport "${invalidMatch[1]}". MCP only supports stdio and SSE/streamable-http.`,
          suggestion:
            "Use a valid MCP transport: 'stdio' for local servers or 'sse'/'streamable-http' for remote servers.",
        });
      }
    }

    return issues;
  },
};

// ── Rule 12: MCP_DUPLICATE_SERVER ───────────────────────────────────────────

const mcpDuplicateServer: RuleDefinition = {
  meta: {
    id: 'MCP_DUPLICATE_SERVER',
    name: 'MCP Duplicate Server Definition',
    description:
      'Detects when the same MCP server name or URL appears multiple times in configuration.',
    rationale:
      'Duplicate MCP server definitions can cause connection conflicts. The agent may try to connect to the same server twice, or one definition may silently override another.',
    recommendation:
      'Remove duplicate MCP server definitions. Each server should be defined exactly once.',
    badExample:
      '## MCP Servers\nmcpServers:\n  db-server:\n    command: node db.js\n  db-server:\n    command: node db-v2.js',
    goodExample:
      '## MCP Servers\nmcpServers:\n  db-server:\n    command: node db.js\n  analytics-server:\n    command: node analytics.js',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'mcp',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Track server names and their line numbers
    const serverNames: Map<string, number[]> = new Map();
    const serverUrls: Map<string, number[]> = new Map();

    // Pattern for server name definitions in YAML-like config
    // e.g., "  db-server:" or "name: db-server" or "- name: db-server"
    const serverNamePattern =
      /(?:^\s{2,4}([\w-]+)\s*:|(?:^|\s)name\s*[:=]\s*["']?([\w-]+)["']?)/;

    // Pattern for server URLs
    const serverUrlPattern =
      /((?:https?|sse|stdio):\/\/[^\s"'`,]+|mcp:\/\/[^\s"'`,]+)/i;

    let inMcpContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track MCP context
      if (MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = false;
      }

      if (!inMcpContext) continue;

      // Check for server names
      const nameMatch = line.match(serverNamePattern);
      if (nameMatch) {
        const name = (nameMatch[1] || nameMatch[2] || '').toLowerCase();
        if (name && name !== 'mcpservers' && name !== 'servers') {
          if (!serverNames.has(name)) serverNames.set(name, []);
          serverNames.get(name)!.push(i);
        }
      }

      // Check for server URLs
      const urlMatch = line.match(serverUrlPattern);
      if (urlMatch) {
        const url = urlMatch[1].toLowerCase();
        if (!serverUrls.has(url)) serverUrls.set(url, []);
        serverUrls.get(url)!.push(i);
      }
    }

    // Report duplicate names
    for (const [name, lineNums] of serverNames) {
      if (lineNums.length > 1) {
        issues.push({
          startLine: lineNums[1] + 1,
          endLine: lineNums[1] + 1,
          severity: 'warning',
          code: 'MCP_DUPLICATE_SERVER',
          message: `Duplicate MCP server name "${name}" (first defined on line ${lineNums[0] + 1})`,
          suggestion:
            'Remove duplicate MCP server definitions. Each server should be defined exactly once.',
        });
      }
    }

    // Report duplicate URLs
    for (const [url, lineNums] of serverUrls) {
      if (lineNums.length > 1) {
        issues.push({
          startLine: lineNums[1] + 1,
          endLine: lineNums[1] + 1,
          severity: 'warning',
          code: 'MCP_DUPLICATE_SERVER',
          message: `Duplicate MCP server URL "${url}" (first defined on line ${lineNums[0] + 1})`,
          suggestion:
            'Remove duplicate MCP server definitions. Each server should be defined exactly once.',
        });
      }
    }

    return issues;
  },
};

// ── Rule 13: MCP_INSECURE_REMOTE ────────────────────────────────────────────

const mcpInsecureRemote: RuleDefinition = {
  meta: {
    id: 'MCP_INSECURE_REMOTE',
    name: 'MCP Insecure Remote Server',
    description:
      'Detects MCP server configurations using unencrypted HTTP for remote (non-localhost) servers.',
    rationale:
      'MCP servers carry sensitive data (code context, tool outputs). Using unencrypted HTTP for remote servers exposes this data to network interception.',
    recommendation:
      'Use HTTPS for remote MCP servers. Only use HTTP for localhost/development servers.',
    badExample:
      '## MCP Servers\nmcpServers:\n  api:\n    url: http://api.example.com/mcp\n    transport: sse',
    goodExample:
      '## MCP Servers\nmcpServers:\n  api:\n    url: https://api.example.com/mcp\n    transport: sse',
    defaultSeverity: 'warning',
    applicableTo: ['claude-md', 'claude-local-md'],
    category: 'mcp',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Match http:// URLs that are NOT localhost, 127.0.0.1, or 0.0.0.0
    const httpUrlPattern = /http:\/\/([^\s"'`,/:]+)/gi;
    const localhostNames = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'];

    let inMcpContext = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      if (isInsideCodeBlock(i, context.codeBlockRanges)) continue;
      if (isInsideFrontmatter(i, context.frontmatterRange)) continue;

      // Track MCP context
      if (MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = true;
      }
      if (/^#{1,3}\s/.test(line) && !MCP_CONTEXT_PATTERN.test(line)) {
        inMcpContext = false;
      }

      if (!inMcpContext) continue;

      httpUrlPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = httpUrlPattern.exec(line)) !== null) {
        const hostname = match[1].toLowerCase();

        // Skip localhost addresses
        if (localhostNames.some((local) => hostname.startsWith(local))) {
          continue;
        }

        issues.push({
          startLine: i + 1,
          endLine: i + 1,
          severity: 'warning',
          code: 'MCP_INSECURE_REMOTE',
          message: `Insecure HTTP URL for remote MCP server: "${match[0]}"`,
          suggestion:
            'Use HTTPS for remote MCP servers. Only use HTTP for localhost/development servers.',
        });
      }
    }

    return issues;
  },
};

/** All MCP server rules for registration. */
export const mcpRules: RuleDefinition[] = [
  mcpMissingAuth,
  mcpHardcodedUrl,
  mcpMissingErrorHandling,
  mcpSchemaInvalidTransport,
  mcpDuplicateServer,
  mcpInsecureRemote,
];
