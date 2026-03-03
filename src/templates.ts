import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Template generator for CLAUDE.md files.
 * Research-backed curated skeleton — the anti-/init.
 * Designed to be filled in by humans, NOT auto-detected.
 */

const CLAUDE_MD_TEMPLATE = `# [Project Name]

[Framework] [type] app with [key integrations]. Brief one-liner for agent orientation.

## Commands

\`\`\`bash
# Build
npm run build

# Test (single file)
npm test -- path/to/file.test.ts

# Test (all)
npm test

# Lint
npm run lint

# Dev server
npm run dev
\`\`\`

## Architecture

- \`src/\` — [describe what goes here]
- \`tests/\` — [test organization]

## Code Style

<!-- Only rules NOT enforced by your linter/formatter -->
- MUST use [specific pattern] for [specific case]
- MUST use [import style] for [modules]

## Constraints

- NEVER modify files in \`[critical path]\` without explicit approval
- MUST NOT use \`any\` type in TypeScript
- DO NOT commit directly to main — always use feature branches

## Gotchas

<!-- Non-obvious things that cause bugs if Claude doesn't know -->
- [Quirk about the build system]
- [Integration that behaves unexpectedly]
- [File that must not be auto-modified]

## Verification

- After changes, run \`npm test\` to verify
- Check types with \`npx tsc --noEmit\`
`;

const SKILL_MD_TEMPLATE = `---
name: my-skill-name
description: What this skill does and when to use it. Include specific keywords for agent matching.
---

# [Skill Name]

## When to use this skill

Use this skill when the user needs to [specific task]...

## Step-by-step instructions

1. [First step]
2. [Second step]
3. [Verification step]

## Examples

### Input
\`\`\`
[example input]
\`\`\`

### Expected output
\`\`\`
[example output]
\`\`\`

## Edge cases

- [What to do when X happens]
- [Fallback behavior for Y]
`;

const CLAUDE_RULES_TEMPLATE = `---
description: Rules for [specific area]
globs: "src/**/*.ts"
---

# [Area] Rules

- MUST [specific rule for files matching this glob]
- NEVER [specific prohibition]
`;

export async function createClaudeMdTemplate(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('AgentLint: No workspace folder open.');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const claudeMdPath = path.join(rootPath, 'CLAUDE.md');

  if (fs.existsSync(claudeMdPath)) {
    const overwrite = await vscode.window.showWarningMessage(
      'CLAUDE.md already exists. Overwrite?',
      'Overwrite',
      'Cancel'
    );
    if (overwrite !== 'Overwrite') return;
  }

  const uri = vscode.Uri.file(claudeMdPath);
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, encoder.encode(CLAUDE_MD_TEMPLATE));

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(
    'AgentLint: Created CLAUDE.md from best-practices template. Fill in the [placeholders]!'
  );
}

export async function createSkillMdTemplate(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('AgentLint: No workspace folder open.');
    return;
  }

  const skillName = await vscode.window.showInputBox({
    prompt: 'Skill name (lowercase, hyphens only)',
    placeHolder: 'my-skill-name',
    validateInput: (value) => {
      if (!value) return 'Name is required';
      if (/[A-Z]/.test(value)) return 'Must be lowercase';
      if (/[^a-z0-9-]/.test(value)) return 'Only lowercase letters, numbers, and hyphens';
      if (/^-|-$/.test(value)) return 'Must not start or end with hyphen';
      if (/--/.test(value)) return 'No consecutive hyphens';
      if (value.length > 64) return 'Max 64 characters';
      return undefined;
    },
  });

  if (!skillName) return;

  const rootPath = workspaceFolders[0].uri.fsPath;
  const skillDir = path.join(rootPath, skillName);
  const skillMdPath = path.join(skillDir, 'SKILL.md');

  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  const content = SKILL_MD_TEMPLATE.replace('my-skill-name', skillName).replace(
    '[Skill Name]',
    skillName
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );

  const uri = vscode.Uri.file(skillMdPath);
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(
    `AgentLint: Created ${skillName}/SKILL.md from template. Fill in the instructions!`
  );
}

export async function createClaudeRulesTemplate(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('AgentLint: No workspace folder open.');
    return;
  }

  const ruleName = await vscode.window.showInputBox({
    prompt: 'Rule file name (without .md)',
    placeHolder: 'typescript-rules',
  });

  if (!ruleName) return;

  const rootPath = workspaceFolders[0].uri.fsPath;
  const rulesDir = path.join(rootPath, '.claude', 'rules');
  const rulePath = path.join(rulesDir, `${ruleName}.md`);

  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }

  const uri = vscode.Uri.file(rulePath);
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, encoder.encode(CLAUDE_RULES_TEMPLATE));

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(
    `AgentLint: Created .claude/rules/${ruleName}.md — set the glob pattern and add your rules!`
  );
}
