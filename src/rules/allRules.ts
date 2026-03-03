/**
 * VS Code-free rule registration module.
 *
 * This module imports all rule category arrays and registers them with the
 * singleton rule registry.  It exists so the CLI can load every rule without
 * pulling in `localRules.ts` (which lives in the VS Code extension layer).
 *
 * The VS Code extension continues to use `localRules.ts`; the CLI uses this
 * module directly.
 */

import { registry } from './registry';
import { structureRules } from './categories/structure';
import { languageRules } from './categories/language';
import { securityRules } from './categories/security';
import { skillRules } from './categories/skill';
import { importsRules } from './categories/imports';
import { xmlRules } from './categories/xml';
import { linksRules } from './categories/links';
import { promptRules } from './categories/prompt';
import { hooksRules } from './categories/hooks';
import { agentsRules } from './categories/agents';
import { mcpRules } from './categories/mcp';
import { cursorRules } from './categories/cursor';
import { copilotRules } from './categories/copilot';
import { crossPlatformRules } from './categories/crossPlatform';
import { memoryRules } from './categories/memory';

let registered = false;

/**
 * Register every built-in rule with the global registry.
 *
 * Safe to call multiple times -- subsequent calls are no-ops.
 */
export function registerAllRules(): void {
  if (registered) {
    return;
  }
  registered = true;

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
}
