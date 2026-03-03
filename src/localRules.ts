import { PromptIssue, AgentFileType } from './types';
import { AgentLintConfig } from './config/types';

// ── Rule registration ────────────────────────────────────────────────────────
// Import the registry and all category modules so rules are registered at load time.

import { registry } from './rules/registry';
import { structureRules } from './rules/categories/structure';
import { languageRules } from './rules/categories/language';
import { securityRules } from './rules/categories/security';
import { skillRules } from './rules/categories/skill';
import { importsRules } from './rules/categories/imports';
import { xmlRules } from './rules/categories/xml';
import { linksRules } from './rules/categories/links';
import { promptRules } from './rules/categories/prompt';
import { hooksRules } from './rules/categories/hooks';
import { agentsRules } from './rules/categories/agents';
import { mcpRules } from './rules/categories/mcp';
import { cursorRules } from './rules/categories/cursor';
import { copilotRules } from './rules/categories/copilot';
import { crossPlatformRules } from './rules/categories/crossPlatform';
import { memoryRules } from './rules/categories/memory';

// Import the rule engine
import { runRules } from './rules/engine';

// Register all rules on first load
registry.registerAll(structureRules);
registry.registerAll(languageRules);
registry.registerAll(securityRules);
registry.registerAll(skillRules);
registry.registerAll(importsRules);
registry.registerAll(xmlRules);
registry.registerAll(linksRules);
registry.registerAll(promptRules);
registry.registerAll(hooksRules);
registry.registerAll(agentsRules);
registry.registerAll(mcpRules);
registry.registerAll(cursorRules);
registry.registerAll(copilotRules);
registry.registerAll(crossPlatformRules);
registry.registerAll(memoryRules);

// ── Backward-compatible entry point ──────────────────────────────────────────

/**
 * Deterministic (free, no API) local lint rules.
 * These run instantly on every save -- no Claude API call needed.
 *
 * This function maintains backward compatibility with extension.ts.
 * Internally it delegates to the modular rule engine.
 *
 * @param content    — Raw file content
 * @param fileType   — Detected agent file type
 * @param filePath   — (optional) Absolute file path, used for file-specific config overrides
 * @param config     — (optional) AgentLintConfig loaded from .agentlint.json
 */
export function runLocalRules(
  content: string,
  fileType: AgentFileType,
  filePath?: string,
  config?: AgentLintConfig
): PromptIssue[] {
  return runRules(content, fileType, filePath, config);
}
