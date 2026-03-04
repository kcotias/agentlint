import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Cross-tool migration: Convert agent instruction files between formats.
 * Currently supports:
 *   .cursorrules → CLAUDE.md
 *   copilot-instructions.md → CLAUDE.md
 *   AGENTS.md → CLAUDE.md
 *
 * The migration preserves content while restructuring it into
 * CLAUDE.md best-practices format with proper sections.
 */

// ── Section detection (format-agnostic) ─────────────────────────────────────

interface DetectedContent {
  projectContext: string[];
  commands: string[];
  architecture: string[];
  codeStyle: string[];
  constraints: string[];
  gotchas: string[];
  verification: string[];
  uncategorized: string[];
}

/**
 * Attempt to categorize lines from a source file into CLAUDE.md sections.
 * This is a best-effort heuristic — not every line can be categorized.
 */
function categorizeContent(lines: string[]): DetectedContent {
  const result: DetectedContent = {
    projectContext: [],
    commands: [],
    architecture: [],
    codeStyle: [],
    constraints: [],
    gotchas: [],
    verification: [],
    uncategorized: [],
  };

  let currentBucket: keyof DetectedContent = 'uncategorized';
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block — flush to current bucket
        codeBlockLines.push(line);
        result[currentBucket].push(...codeBlockLines);
        codeBlockLines = [];
        inCodeBlock = false;
        continue;
      } else {
        inCodeBlock = true;
        codeBlockLines = [line];
        // Code blocks with bash/sh are commands
        if (/```(bash|sh|shell|console)/i.test(trimmed)) {
          currentBucket = 'commands';
        }
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Detect section headers and switch bucket
    if (/^#{1,3}\s/i.test(trimmed)) {
      const lower = trimmed.toLowerCase();
      if (/commands?|build|test|scripts?|development/i.test(lower)) {
        currentBucket = 'commands';
      } else if (/architecture|structure|directory|layout|organization|overview/i.test(lower)) {
        currentBucket = 'architecture';
      } else if (/style|conventions?|patterns?|formatting|naming/i.test(lower)) {
        currentBucket = 'codeStyle';
      } else if (/constraints?|rules?|prohibitions?|boundaries|restrictions?|don'?t|never|avoid/i.test(lower)) {
        currentBucket = 'constraints';
      } else if (/gotchas?|caveats?|pitfalls?|warnings?|quirks?|watch\s*out|important|notes?/i.test(lower)) {
        currentBucket = 'gotchas';
      } else if (/verification|verify|validation|check|testing|quality/i.test(lower)) {
        currentBucket = 'verification';
      } else if (/about|project|intro|context|description/i.test(lower) || i < 5) {
        currentBucket = 'projectContext';
      } else {
        currentBucket = 'uncategorized';
      }
      result[currentBucket].push(line);
      continue;
    }

    // Content-based heuristics for individual lines
    if (currentBucket === 'uncategorized') {
      // First few non-header lines are likely project context
      if (i < 5 && trimmed.length > 0) {
        result.projectContext.push(line);
        continue;
      }

      // Lines with NEVER/MUST NOT/DO NOT are constraints
      if (/\b(NEVER|MUST NOT|DO NOT|DON'T|AVOID|FORBIDDEN|PROHIBITED)\b/.test(line)) {
        result.constraints.push(line);
        continue;
      }

      // Lines with command patterns are commands
      if (/\b(npm|yarn|pnpm|bun|cargo|go|make|pytest|pip)\s+(run\s+)?(test|build|lint|dev|start|install)/i.test(line)) {
        result.commands.push(line);
        continue;
      }

      // Lines with "MUST" or "ALWAYS" are code style
      if (/\b(MUST|ALWAYS|SHALL)\b/.test(line) && !/\b(NEVER|MUST NOT)\b/.test(line)) {
        result.codeStyle.push(line);
        continue;
      }

      // Lines with verification patterns
      if (/\b(verify|check|run tests|ensure|validate|after changes)\b/i.test(line)) {
        result.verification.push(line);
        continue;
      }
    }

    result[currentBucket].push(line);
  }

  // Flush any remaining code block
  if (codeBlockLines.length > 0) {
    result[currentBucket].push(...codeBlockLines);
  }

  return result;
}

/**
 * Build a CLAUDE.md from categorized content, following best-practices structure.
 */
function buildClaudeMd(source: DetectedContent, sourceLabel: string): string {
  const sections: string[] = [];

  // Header — use project context or a placeholder
  if (source.projectContext.length > 0) {
    // Check if there's already a top-level header
    const hasHeader = source.projectContext.some((l) => /^#\s/.test(l.trim()));
    if (!hasHeader) {
      sections.push('# [Project Name]');
      sections.push('');
    }
    sections.push(...source.projectContext);
  } else {
    sections.push('# [Project Name]');
    sections.push('');
    sections.push('[Framework] [type] app. Brief one-liner for agent orientation.');
  }
  sections.push('');

  // Migrated-from notice
  sections.push(`<!-- Migrated from ${sourceLabel} by AgentLint -->`);
  sections.push('');

  // Commands
  if (source.commands.length > 0) {
    const hasCommandHeader = source.commands.some((l) => /^#{1,3}\s/i.test(l.trim()));
    if (!hasCommandHeader) {
      sections.push('## Commands');
      sections.push('');
    }
    sections.push(...source.commands);
  } else {
    sections.push('## Commands');
    sections.push('');
    sections.push('```bash');
    sections.push('# TODO: Add your build/test/lint commands');
    sections.push('npm run build');
    sections.push('npm test');
    sections.push('npm run lint');
    sections.push('```');
  }
  sections.push('');

  // Architecture
  if (source.architecture.length > 0) {
    const hasHeader = source.architecture.some((l) => /^#{1,3}\s/i.test(l.trim()));
    if (!hasHeader) {
      sections.push('## Architecture');
      sections.push('');
    }
    sections.push(...source.architecture);
    sections.push('');
  }

  // Code Style
  if (source.codeStyle.length > 0) {
    const hasHeader = source.codeStyle.some((l) => /^#{1,3}\s/i.test(l.trim()));
    if (!hasHeader) {
      sections.push('## Code Style');
      sections.push('');
    }
    sections.push(...source.codeStyle);
    sections.push('');
  }

  // Constraints
  if (source.constraints.length > 0) {
    const hasHeader = source.constraints.some((l) => /^#{1,3}\s/i.test(l.trim()));
    if (!hasHeader) {
      sections.push('## Constraints');
      sections.push('');
    }
    sections.push(...source.constraints);
  } else {
    sections.push('## Constraints');
    sections.push('');
    sections.push('<!-- TODO: Add NEVER/MUST NOT rules — the #2 most effective instruction type -->');
  }
  sections.push('');

  // Gotchas
  if (source.gotchas.length > 0) {
    const hasHeader = source.gotchas.some((l) => /^#{1,3}\s/i.test(l.trim()));
    if (!hasHeader) {
      sections.push('## Gotchas');
      sections.push('');
    }
    sections.push(...source.gotchas);
    sections.push('');
  }

  // Verification
  if (source.verification.length > 0) {
    const hasHeader = source.verification.some((l) => /^#{1,3}\s/i.test(l.trim()));
    if (!hasHeader) {
      sections.push('## Verification');
      sections.push('');
    }
    sections.push(...source.verification);
  } else {
    sections.push('## Verification');
    sections.push('');
    sections.push('- After changes, run `npm test` to verify');
    sections.push('- Check types with `npx tsc --noEmit`');
  }
  sections.push('');

  // Uncategorized — append at end if there's content
  const meaningfulUncategorized = source.uncategorized.filter((l) => l.trim().length > 0);
  if (meaningfulUncategorized.length > 0) {
    sections.push('## Additional Notes');
    sections.push('');
    sections.push('<!-- AgentLint could not auto-categorize these. Please move them to the appropriate section above. -->');
    sections.push('');
    sections.push(...source.uncategorized);
    sections.push('');
  }

  return sections.join('\n');
}

// ── Public migration commands ────────────────────────────────────────────────

export async function migrateToClaudeMd(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('AgentLint: No workspace folder open.');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;

  // Find all migratable source files
  const sources: Array<{ label: string; path: string; type: string }> = [];

  // .cursorrules
  const cursorrules = path.join(rootPath, '.cursorrules');
  if (fs.existsSync(cursorrules)) {
    sources.push({ label: '.cursorrules', path: cursorrules, type: 'cursorrules' });
  }

  // .cursor/rules/*.mdc
  const cursorRulesDir = path.join(rootPath, '.cursor', 'rules');
  if (fs.existsSync(cursorRulesDir)) {
    const files = fs.readdirSync(cursorRulesDir).filter((f) => f.endsWith('.mdc') || f.endsWith('.md'));
    for (const file of files) {
      sources.push({
        label: `.cursor/rules/${file}`,
        path: path.join(cursorRulesDir, file),
        type: 'cursor-rule',
      });
    }
  }

  // copilot-instructions.md
  const copilotInstructions = path.join(rootPath, '.github', 'copilot-instructions.md');
  if (fs.existsSync(copilotInstructions)) {
    sources.push({ label: 'copilot-instructions.md', path: copilotInstructions, type: 'copilot' });
  }

  // AGENTS.md
  const agentsMd = path.join(rootPath, 'AGENTS.md');
  if (fs.existsSync(agentsMd)) {
    sources.push({ label: 'AGENTS.md', path: agentsMd, type: 'agents' });
  }

  if (sources.length === 0) {
    vscode.window.showInformationMessage(
      'AgentLint: No migratable files found (.cursorrules, copilot-instructions.md, AGENTS.md).'
    );
    return;
  }

  // Let user pick which file to migrate
  const picked = await vscode.window.showQuickPick(
    sources.map((s) => ({
      label: s.label,
      description: `Convert to CLAUDE.md`,
      detail: s.path,
    })),
    {
      placeHolder: 'Select a file to migrate to CLAUDE.md format',
      canPickMany: false,
    }
  );

  if (!picked) return;

  const source = sources.find((s) => s.label === picked.label)!;

  // Check if CLAUDE.md already exists
  const claudeMdPath = path.join(rootPath, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const action = await vscode.window.showWarningMessage(
      'CLAUDE.md already exists. How should AgentLint handle this?',
      'Merge (append new sections)',
      'Replace (overwrite)',
      'Cancel'
    );
    if (action === 'Cancel' || !action) return;

    if (action === 'Merge (append new sections)') {
      return mergeIntoClaudeMd(source, claudeMdPath);
    }
    // Replace — fall through to create new
  }

  // Read source and migrate
  const content = fs.readFileSync(source.path, 'utf8');
  const lines = content.split('\n');
  const categorized = categorizeContent(lines);
  const claudeMd = buildClaudeMd(categorized, source.label);

  // Write CLAUDE.md
  const uri = vscode.Uri.file(claudeMdPath);
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, encoder.encode(claudeMd));

  // Open it
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);

  // Count what was migrated
  const nonEmpty = categorized;
  const categorizedCount =
    nonEmpty.projectContext.filter((l) => l.trim()).length +
    nonEmpty.commands.filter((l) => l.trim()).length +
    nonEmpty.architecture.filter((l) => l.trim()).length +
    nonEmpty.codeStyle.filter((l) => l.trim()).length +
    nonEmpty.constraints.filter((l) => l.trim()).length +
    nonEmpty.gotchas.filter((l) => l.trim()).length +
    nonEmpty.verification.filter((l) => l.trim()).length;

  const uncatCount = nonEmpty.uncategorized.filter((l) => l.trim()).length;

  vscode.window.showInformationMessage(
    `AgentLint: Migrated ${source.label} → CLAUDE.md! ` +
      `${categorizedCount} lines auto-categorized, ${uncatCount} lines need manual review.`
  );
}

async function mergeIntoClaudeMd(
  source: { label: string; path: string; type: string },
  claudeMdPath: string
): Promise<void> {
  const existingContent = fs.readFileSync(claudeMdPath, 'utf8');
  const sourceContent = fs.readFileSync(source.path, 'utf8');

  const mergedContent =
    existingContent.trimEnd() +
    '\n\n' +
    `<!-- === Merged from ${source.label} by AgentLint === -->\n\n` +
    sourceContent;

  const uri = vscode.Uri.file(claudeMdPath);
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(uri, encoder.encode(mergedContent));

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(
    `AgentLint: Merged ${source.label} into CLAUDE.md. Review the merged content and reorganize as needed.`
  );
}
