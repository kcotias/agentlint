import { RuleDefinition } from '../types';
import { countNonEmptyLines, isInsideCodeBlock } from '../utils';

/**
 * SKILL_MISSING_FRONTMATTER
 *
 * SKILL.md files require YAML frontmatter with name and description fields.
 */
const skillMissingFrontmatter: RuleDefinition = {
  meta: {
    id: 'SKILL_MISSING_FRONTMATTER',
    name: 'Missing Skill Frontmatter',
    description:
      'Checks that a SKILL.md file begins with a YAML frontmatter block (--- delimited) containing the required name and description fields.',
    rationale:
      'The Agent Skills specification requires YAML frontmatter for skill discovery and matching. Without frontmatter, the agent runtime cannot index or activate the skill.',
    recommendation:
      'Add a YAML frontmatter block at the very top of the file with name and description fields.',
    badExample: '# My Skill\n\nDo some things.',
    goodExample:
      '---\nname: pdf-processing\ndescription: Extract text and tables from PDF files. Use when working with PDF documents.\n---',
    defaultSeverity: 'error',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: true,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);

    if (!fmMatch) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'error',
          code: 'SKILL_MISSING_FRONTMATTER',
          message: 'SKILL.md requires YAML frontmatter with name and description fields',
          suggestion:
            'Add required frontmatter:\n---\nname: my-skill-name\ndescription: What this skill does and when to use it.\n---',
          fixable: true,
          replacement:
            '---\nname: my-skill-name\ndescription: What this skill does and when to use it.\n---\n\n',
        },
      ];
    }

    return [];
  },
};

/**
 * SKILL_MISSING_NAME
 *
 * The frontmatter must contain a "name" field.
 */
const skillMissingName: RuleDefinition = {
  meta: {
    id: 'SKILL_MISSING_NAME',
    name: 'Missing Skill Name',
    description:
      'Checks that the SKILL.md frontmatter contains a "name" field.',
    rationale:
      'The name field is the primary identifier used by agent runtimes to register and invoke skills. Without a name, the skill cannot be activated.',
    recommendation:
      'Add a name field to the frontmatter: lowercase, 1-64 chars, alphanumeric + hyphens.',
    badExample: '---\ndescription: Does something.\n---',
    goodExample: '---\nname: pdf-processing\ndescription: Does something.\n---',
    defaultSeverity: 'error',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return []; // Handled by SKILL_MISSING_FRONTMATTER

    const frontmatter = fmMatch[1];

    if (!/^name:\s*.+/m.test(frontmatter)) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'error',
          code: 'SKILL_MISSING_NAME',
          message: 'SKILL.md frontmatter is missing required "name" field',
          suggestion:
            'Add a name field: lowercase, 1-64 chars, alphanumeric + hyphens. Example: name: pdf-processing',
        },
      ];
    }

    return [];
  },
};

/**
 * SKILL_INVALID_NAME
 *
 * Validates the format of the skill name: length, case, hyphen rules.
 */
const skillInvalidName: RuleDefinition = {
  meta: {
    id: 'SKILL_INVALID_NAME',
    name: 'Invalid Skill Name',
    description:
      'Validates the skill name format: must be lowercase, 1-64 characters, no leading/trailing hyphens, no consecutive hyphens.',
    rationale:
      'Skill names are used as identifiers in the agent runtime. Invalid names cause registration failures or unexpected matching behavior. The format follows DNS-label conventions for portability.',
    recommendation:
      'Fix the name to be lowercase, 1-64 chars, alphanumeric with single hyphens only. No leading/trailing hyphens.',
    badExample: 'name: My-PDF--Processor-',
    goodExample: 'name: pdf-processor',
    defaultSeverity: 'error',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];

    const frontmatter = fmMatch[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)/m);
    if (!nameMatch) return []; // Handled by SKILL_MISSING_NAME

    const name = nameMatch[1].trim();
    const issues: ReturnType<RuleDefinition['check']> = [];

    if (name.length > 64) {
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_INVALID_NAME',
        message: `Skill name "${name}" exceeds 64 character limit (${name.length} chars)`,
        suggestion: 'Shorten the skill name to 64 characters or fewer.',
      });
    }
    if (/[A-Z]/.test(name)) {
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_INVALID_NAME',
        message: 'Skill name must be lowercase \u2014 uppercase characters found',
        suggestion: `Change to: name: ${name.toLowerCase()}`,
      });
    }
    if (/^-|-$/.test(name)) {
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_INVALID_NAME',
        message: 'Skill name must not start or end with a hyphen',
        suggestion: 'Remove leading/trailing hyphens from the skill name.',
      });
    }
    if (/--/.test(name)) {
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_INVALID_NAME',
        message: 'Skill name must not contain consecutive hyphens',
        suggestion: 'Replace consecutive hyphens with a single hyphen.',
      });
    }

    return issues;
  },
};

/**
 * SKILL_MISSING_DESCRIPTION
 *
 * The frontmatter must contain a "description" field.
 */
const skillMissingDescription: RuleDefinition = {
  meta: {
    id: 'SKILL_MISSING_DESCRIPTION',
    name: 'Missing Skill Description',
    description:
      'Checks that the SKILL.md frontmatter contains a "description" field.',
    rationale:
      'The description field is used by agent runtimes for skill matching and discovery. Without a description, the agent cannot determine when to activate this skill.',
    recommendation:
      'Add a description field (1-1024 chars) that explains what the skill does AND when to use it. Include specific keywords for agent matching.',
    badExample: '---\nname: pdf-processing\n---',
    goodExample:
      '---\nname: pdf-processing\ndescription: Extract text and tables from PDF files. Use when working with PDF documents.\n---',
    defaultSeverity: 'error',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];

    const frontmatter = fmMatch[1];

    if (!/^description:\s*.+/m.test(frontmatter)) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'error',
          code: 'SKILL_MISSING_DESCRIPTION',
          message: 'SKILL.md frontmatter is missing required "description" field',
          suggestion:
            'Add a description field (1-1024 chars) that describes what the skill does AND when to use it. Include specific keywords for agent matching.',
        },
      ];
    }

    return [];
  },
};

/**
 * SKILL_DESCRIPTION_TOO_LONG
 *
 * The description must not exceed 1024 characters.
 */
const skillDescriptionTooLong: RuleDefinition = {
  meta: {
    id: 'SKILL_DESCRIPTION_TOO_LONG',
    name: 'Skill Description Too Long',
    description:
      'Checks that the skill description does not exceed the 1024-character limit.',
    rationale:
      'Agent runtimes may truncate or reject descriptions exceeding 1024 characters. Long descriptions also waste tokens during skill matching. Keep descriptions concise but keyword-rich.',
    recommendation:
      'Shorten the description to 1024 characters or fewer. Be concise but include keywords for agent matching.',
    badExample: 'description: [A very long description exceeding 1024 characters...]',
    goodExample:
      'description: Extract text and tables from PDF files, fill PDF forms, and merge multiple PDFs. Use when working with PDF documents.',
    defaultSeverity: 'warning',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];

    const frontmatter = fmMatch[1];
    const descMatch = frontmatter.match(/^description:\s*(.+)/m);
    if (!descMatch) return [];

    const desc = descMatch[1].trim();
    if (desc.length > 1024) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'warning',
          code: 'SKILL_DESCRIPTION_TOO_LONG',
          message: `Skill description exceeds 1024 character limit (${desc.length} chars)`,
          suggestion:
            'Shorten the description to 1024 characters or fewer. Be concise but include keywords for agent matching.',
        },
      ];
    }

    return [];
  },
};

/**
 * SKILL_WEAK_DESCRIPTION
 *
 * Descriptions that are too brief for effective agent matching.
 */
const skillWeakDescription: RuleDefinition = {
  meta: {
    id: 'SKILL_WEAK_DESCRIPTION',
    name: 'Weak Skill Description',
    description:
      'Checks that the skill description is detailed enough (at least 20 characters) for effective agent matching.',
    rationale:
      'Very short descriptions do not provide enough keywords for the agent runtime to correctly match and activate this skill. A good description explains both WHAT the skill does and WHEN to use it.',
    recommendation:
      'Expand the description to explain what the skill does AND when to use it. Include specific keywords that the agent can match against.',
    badExample: 'description: PDF stuff.',
    goodExample:
      'description: Extract text and tables from PDF files, fill PDF forms, and merge multiple PDFs. Use when working with PDF documents.',
    defaultSeverity: 'warning',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];

    const frontmatter = fmMatch[1];
    const descMatch = frontmatter.match(/^description:\s*(.+)/m);
    if (!descMatch) return [];

    const desc = descMatch[1].trim();
    if (desc.length < 20) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'warning',
          code: 'SKILL_WEAK_DESCRIPTION',
          message: 'Skill description is too brief for effective agent matching',
          suggestion:
            'Expand the description to explain what the skill does AND when to use it. Include specific keywords. Example: "Extract text and tables from PDF files, fill PDF forms, and merge multiple PDFs. Use when working with PDF documents."',
        },
      ];
    }

    return [];
  },
};

/**
 * SKILL_TOKEN_BUDGET
 *
 * Check if SKILL.md body exceeds the recommended ~5000 token budget.
 * Rough estimate: 1 token ~= 4 characters for English text.
 */
const skillTokenBudget: RuleDefinition = {
  meta: {
    id: 'SKILL_TOKEN_BUDGET',
    name: 'Skill Token Budget Exceeded',
    description:
      'Checks that the SKILL.md body does not exceed the recommended 5000-token budget (estimated at ~4 chars per token).',
    rationale:
      'The entire SKILL.md body is loaded into the agent context when the skill is activated. Exceeding ~5000 tokens reduces efficiency and may crowd out other context. Move reference material to separate files.',
    recommendation:
      'Move detailed reference material to references/ or scripts/ directories. Keep the SKILL.md body focused on step-by-step instructions.',
    badExample: 'A 30,000 character SKILL.md with full API documentation inline.',
    goodExample:
      'A focused SKILL.md with step-by-step instructions, referencing ./references/api-spec.md for details.',
    defaultSeverity: 'warning',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    // Skip frontmatter
    const bodyMatch = content.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/);
    if (!bodyMatch) return [];

    const body = bodyMatch[1];
    const estimatedTokens = Math.ceil(body.length / 4);

    if (estimatedTokens > 5000) {
      return [
        {
          startLine: 1,
          endLine: context.lines.length,
          severity: 'warning',
          code: 'SKILL_TOKEN_BUDGET',
          message: `Skill body is ~${estimatedTokens} tokens (recommended: <5000). Exceeding budget reduces agent efficiency.`,
          suggestion:
            'Move detailed reference material to references/ or scripts/ directories. The SKILL.md body loads entirely when activated \u2014 keep it focused on step-by-step instructions.',
        },
      ];
    }
    return [];
  },
};

/**
 * SKILL_DANGEROUS_AUTO_INVOKE
 *
 * Skills performing destructive operations should have disable-model-invocation: true
 * to prevent the agent from auto-invoking them without user confirmation.
 */
const skillDangerousAutoInvoke: RuleDefinition = {
  meta: {
    id: 'SKILL_DANGEROUS_AUTO_INVOKE',
    name: 'Dangerous Skill Missing Auto-Invoke Guard',
    description:
      'Detects skills that perform destructive operations (deploy, delete, drop, destroy, rm, remove, migrate, rollback) without `disable-model-invocation: true` in frontmatter.',
    rationale:
      'Skills that can deploy, delete, or destroy resources will auto-invoke when the agent thinks they are relevant. Without `disable-model-invocation: true`, the agent can deploy to production or delete data without user confirmation.',
    recommendation:
      'Add `disable-model-invocation: true` to the frontmatter for skills that perform destructive operations. This requires explicit user invocation.',
    badExample:
      '---\nname: cleanup-db\ndescription: Clean up old database records\n---\nDROP TABLE old_records;',
    goodExample:
      '---\nname: cleanup-db\ndescription: Clean up old database records\ndisable-model-invocation: true\n---\nDROP TABLE old_records;',
    defaultSeverity: 'error',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: true,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return []; // Handled by SKILL_MISSING_FRONTMATTER

    const frontmatter = fmMatch[1];
    const fmEndLine = content.substring(0, content.indexOf('\n---', 4)).split('\n').length;

    // Check if the safety flag is present
    const hasSafetyFlag =
      /disable[-_]model[-_]invocation:\s*true/i.test(frontmatter);
    if (hasSafetyFlag) return [];

    // Scan the body (after frontmatter) for dangerous operation keywords
    const dangerousOps =
      /\b(deploy|delete|destroy|drop\s+table|drop\s+database|rm\s+-rf|remove|migrate|rollback|purge|truncate|reset)\b/i;

    let foundDangerousLine = -1;
    let foundOp = '';

    for (let i = fmEndLine + 1; i < context.lines.length; i++) {
      // Skip code blocks — we actually WANT to scan code blocks here since
      // the skill body often contains code that IS the destructive operation
      const line = context.lines[i];
      const match = line.match(dangerousOps);
      if (match) {
        foundDangerousLine = i;
        foundOp = match[1];
        break;
      }
    }

    if (foundDangerousLine === -1) return [];

    return [
      {
        startLine: 1,
        endLine: fmEndLine + 1,
        severity: 'error',
        code: 'SKILL_DANGEROUS_AUTO_INVOKE',
        message: `Skill contains destructive operation "${foundOp}" but lacks disable-model-invocation: true`,
        suggestion:
          'Add `disable-model-invocation: true` to the frontmatter for skills that perform destructive operations. This requires explicit user invocation.',
        fixable: true,
      },
    ];
  },
};

/**
 * SKILL_MISSING_TRIGGER
 *
 * Descriptions should contain action verbs so the agent can match them to user intents.
 */
const skillMissingTrigger: RuleDefinition = {
  meta: {
    id: 'SKILL_MISSING_TRIGGER',
    name: 'Skill Description Missing Action Verbs',
    description:
      'Detects skills whose description lacks actionable verb phrases that help the agent discover when to use the skill.',
    rationale:
      'The agent discovers skills by matching the user request against skill descriptions. A description without action verbs ("Database utilities") is hard to match against user intents like "clean up my database". Action-rich descriptions ("Clean up and optimize database tables") match naturally.',
    recommendation:
      "Include action verbs in the skill description. Instead of 'Database utilities', use 'Clean up, optimize, and migrate database tables'.",
    badExample:
      '---\nname: db-utils\ndescription: Database utilities\n---',
    goodExample:
      '---\nname: db-utils\ndescription: Clean up, optimize, and migrate database tables\n---',
    defaultSeverity: 'warning',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];

    const frontmatter = fmMatch[1];
    const descMatch = frontmatter.match(/^description:\s*(.+)/m);
    if (!descMatch) return []; // Handled by SKILL_MISSING_DESCRIPTION

    const desc = descMatch[1].trim();
    // Skip very short descriptions — handled by SKILL_WEAK_DESCRIPTION
    if (desc.length < 10) return [];

    const actionVerbs =
      /\b(create|generate|run|check|analyze|build|test|deploy|fix|update|convert|migrate|format|lint|validate|export|import|scan|optimize|extract|process|transform|clean|merge|split|parse|compile|install|configure|set\s?up|monitor|debug|refactor|review|search|find|detect|resolve|handle|manage|execute|fetch|download|upload|send|notify|publish|sync|backup|restore)\b/i;

    if (!actionVerbs.test(desc)) {
      return [
        {
          startLine: 1,
          endLine: 1,
          severity: 'warning',
          code: 'SKILL_MISSING_TRIGGER',
          message:
            'Skill description lacks action verbs for effective agent discovery',
          suggestion:
            "Include action verbs in the skill description. Instead of 'Database utilities', use 'Clean up, optimize, and migrate database tables'.",
        },
      ];
    }

    return [];
  },
};

/**
 * SKILL_NAME_FORMAT
 *
 * Skill names must be in kebab-case. Detects PascalCase, camelCase, snake_case, or names with spaces.
 */
const skillNameFormat: RuleDefinition = {
  meta: {
    id: 'SKILL_NAME_FORMAT',
    name: 'Skill Name Not Kebab-Case',
    description:
      'Detects skill names that use PascalCase, camelCase, snake_case, or contain spaces instead of kebab-case.',
    rationale:
      'Claude Code expects skill names in kebab-case (e.g., `run-tests`, `fix-lint`). PascalCase, camelCase, or snake_case names may fail to register as valid skills or cause unexpected matching behavior.',
    recommendation:
      "Use kebab-case for skill names: 'run-tests' not 'RunTests' or 'run_tests'.",
    badExample: 'name: RunTests\nname: runTests\nname: run_tests',
    goodExample: 'name: run-tests',
    defaultSeverity: 'error',
    applicableTo: ['skill-md'],
    category: 'skill',
    fixable: false,
  },
  check(context) {
    if (context.fileType !== 'skill-md') return [];

    const content = context.lines.join('\n');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];

    const frontmatter = fmMatch[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)/m);
    if (!nameMatch) return []; // Handled by SKILL_MISSING_NAME

    const name = nameMatch[1].trim();
    const issues: ReturnType<RuleDefinition['check']> = [];

    // Check for snake_case (underscores)
    if (/_/.test(name)) {
      const suggested = name.replace(/_/g, '-').toLowerCase();
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_NAME_FORMAT',
        message: `Skill name "${name}" uses snake_case. Use kebab-case instead.`,
        suggestion: `Use kebab-case for skill names: 'name: ${suggested}'`,
      });
    }

    // Check for spaces
    if (/\s/.test(name)) {
      const suggested = name.replace(/\s+/g, '-').toLowerCase();
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_NAME_FORMAT',
        message: `Skill name "${name}" contains spaces. Use kebab-case instead.`,
        suggestion: `Use kebab-case for skill names: 'name: ${suggested}'`,
      });
    }

    // Check for PascalCase pattern (starts with uppercase, has another uppercase after lowercase)
    if (/^[A-Z][a-z]+[A-Z]/.test(name)) {
      const suggested = name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_NAME_FORMAT',
        message: `Skill name "${name}" uses PascalCase. Use kebab-case instead.`,
        suggestion: `Use kebab-case for skill names: 'name: ${suggested}'`,
      });
    }
    // Check for camelCase pattern (starts with lowercase, then has uppercase)
    else if (/^[a-z]+[A-Z]/.test(name)) {
      const suggested = name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();
      issues.push({
        startLine: 1,
        endLine: 1,
        severity: 'error',
        code: 'SKILL_NAME_FORMAT',
        message: `Skill name "${name}" uses camelCase. Use kebab-case instead.`,
        suggestion: `Use kebab-case for skill names: 'name: ${suggested}'`,
      });
    }

    return issues;
  },
};

/** All SKILL.md rules for registration. */
export const skillRules: RuleDefinition[] = [
  skillMissingFrontmatter,
  skillMissingName,
  skillInvalidName,
  skillMissingDescription,
  skillDescriptionTooLong,
  skillWeakDescription,
  skillTokenBudget,
  skillDangerousAutoInvoke,
  skillMissingTrigger,
  skillNameFormat,
];
