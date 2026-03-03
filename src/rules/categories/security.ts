import { RuleDefinition } from '../types';
import { isInsideCodeBlock } from '../utils';

/**
 * SENSITIVE_DATA
 *
 * Detects potential secrets, API keys, tokens, and passwords that should
 * never be committed in agent instruction files.
 */
const sensitiveData: RuleDefinition = {
  meta: {
    id: 'SENSITIVE_DATA',
    name: 'Sensitive Data Detected',
    description:
      'Detects potential secrets, API keys, tokens, passwords, and private keys embedded in agent instruction files.',
    rationale:
      'Agent instruction files like CLAUDE.md are typically committed to version control and shared across a team. Embedding secrets in these files exposes credentials to anyone with repo access and may leak them into AI context windows.',
    recommendation:
      'Remove the sensitive value immediately. Use environment variables or .env files for secrets. For personal tokens needed by the agent, use .claude.local.md (gitignored).',
    badExample: 'api_key: sk-proj-abc123def456ghi789',
    goodExample:
      'Use the API key from the OPENAI_API_KEY environment variable. See .env.example for required variables.',
    defaultSeverity: 'error',
    applicableTo: 'all',
    category: 'security',
    fixable: false,
  },
  check(context) {
    const issues: ReturnType<RuleDefinition['check']> = [];

    const patterns = [
      { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}/i, label: 'API key' },
      { regex: /(?:secret|token|password|passwd|pwd)\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}/i, label: 'secret/token/password' },
      { regex: /sk-[A-Za-z0-9]{20,}/, label: 'OpenAI/Anthropic API key' },
      { regex: /ghp_[A-Za-z0-9]{36,}/, label: 'GitHub personal access token' },
      { regex: /xoxb-[A-Za-z0-9\-]{20,}/, label: 'Slack bot token' },
      { regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: 'Private key' },
      { regex: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key ID' },
    ];

    let inCodeBlock = false;

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      // Flag sensitive data regardless of whether it is inside a code block —
      // secrets should never appear in instruction files at all.
      for (const { regex, label } of patterns) {
        if (regex.test(line)) {
          issues.push({
            startLine: i + 1,
            endLine: i + 1,
            severity: 'error',
            code: 'SENSITIVE_DATA',
            message: `Possible ${label} detected \u2014 do not commit secrets in agent instruction files`,
            suggestion:
              'Remove the sensitive value. Use environment variables or .env files for secrets. Consider using .claude.local.md (gitignored) for personal tokens.',
          });
          break;
        }
      }
    }

    return issues;
  },
};

/** All security rules for registration. */
export const securityRules: RuleDefinition[] = [sensitiveData];
