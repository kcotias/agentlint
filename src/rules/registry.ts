import { AgentFileType } from '../types';
import { RuleDefinition, RuleCategory } from './types';

/**
 * Central registry for all AgentLint rule definitions.
 * Rules are registered at module load time and queried by the engine at runtime.
 */
class RuleRegistry {
  private rules: Map<string, RuleDefinition> = new Map();

  /** Register a single rule definition. Throws if the ID is already registered. */
  register(rule: RuleDefinition): void {
    if (this.rules.has(rule.meta.id)) {
      throw new Error(
        `AgentLint: Duplicate rule ID "${rule.meta.id}" — each rule must have a unique ID.`
      );
    }
    this.rules.set(rule.meta.id, rule);
  }

  /** Register an array of rule definitions. */
  registerAll(rules: RuleDefinition[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  /** Get a rule by its ID, or undefined if not found. */
  get(id: string): RuleDefinition | undefined {
    return this.rules.get(id);
  }

  /** Get all registered rules as an array. */
  getAll(): RuleDefinition[] {
    return Array.from(this.rules.values());
  }

  /** Get all rules in a specific category. */
  getByCategory(category: RuleCategory): RuleDefinition[] {
    return this.getAll().filter((r) => r.meta.category === category);
  }

  /** Get all rules applicable to a given file type. */
  getApplicableTo(fileType: AgentFileType): RuleDefinition[] {
    return this.getAll().filter((r) => {
      if (r.meta.applicableTo === 'all') return true;
      return r.meta.applicableTo.includes(fileType);
    });
  }

  /** Check if a rule with the given ID is registered. */
  has(id: string): boolean {
    return this.rules.has(id);
  }

  /** Return the count of registered rules. */
  count(): number {
    return this.rules.size;
  }
}

/** Singleton rule registry instance used throughout AgentLint. */
export const registry = new RuleRegistry();
