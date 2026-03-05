import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentFileType } from './types';
import { track } from './analytics';

/**
 * Export Agent Context: Shows EXACTLY what Claude sees when it loads your
 * instruction files — in priority order, with token counts per file, and
 * the full content. Think of it as "View Source" for your agent's brain.
 *
 * Load order follows Claude's hierarchy:
 *   1. Managed CLAUDE.md (enterprise, not local)
 *   2. Project CLAUDE.md (root or .claude/)
 *   3. .claude/rules/*.md (only matching file globs — we show all)
 *   4. CLAUDE.local.md (personal overrides)
 *   5. Agent Skills (SKILL.md — loaded on-demand, shown as reference)
 *   6. Other files (AGENTS.md, .cursorrules, etc.)
 */

interface ContextFile {
  relativePath: string;
  absolutePath: string;
  type: AgentFileType;
  content: string;
  charCount: number;
  estimatedTokens: number;
  lineCount: number;
  loadOrder: number;
  loadBehavior: 'always' | 'path-scoped' | 'on-demand' | 'other-tool';
  loadNote: string;
}

/** Priority ordering for Claude's file loading hierarchy */
const LOAD_ORDER: Record<string, { order: number; behavior: ContextFile['loadBehavior']; note: string }> = {
  'claude-md': { order: 1, behavior: 'always', note: 'Loaded on every Claude Code session' },
  'claude-rules': { order: 2, behavior: 'path-scoped', note: 'Loaded only when editing files matching the glob pattern' },
  'claude-local-md': { order: 3, behavior: 'always', note: 'Personal overrides, loaded after project CLAUDE.md' },
  'skill-md': { order: 4, behavior: 'on-demand', note: 'Loaded only when the agent detects a matching task' },
  'agents-md': { order: 5, behavior: 'always', note: 'Agent definitions, loaded on session start' },
  'cursorrules': { order: 6, behavior: 'other-tool', note: 'Cursor-specific — not loaded by Claude Code' },
  'copilot-instructions': { order: 7, behavior: 'other-tool', note: 'Copilot-specific — not loaded by Claude Code' },
  'unknown': { order: 8, behavior: 'other-tool', note: 'Unknown file type' },
};

const FILE_PATTERNS: Array<{ glob: string; type: AgentFileType }> = [
  { glob: '**/CLAUDE.md', type: 'claude-md' },
  { glob: '**/.claude/CLAUDE.md', type: 'claude-md' },
  { glob: '**/CLAUDE.local.md', type: 'claude-local-md' },
  { glob: '**/.claude/rules/*.md', type: 'claude-rules' },
  { glob: '**/SKILL.md', type: 'skill-md' },
  { glob: '**/AGENTS.md', type: 'agents-md' },
  { glob: '**/.cursorrules', type: 'cursorrules' },
  { glob: '**/.cursor/rules/*.mdc', type: 'cursorrules' },
  { glob: '**/.github/copilot-instructions.md', type: 'copilot-instructions' },
];

export async function exportAgentContext(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('AgentLint: No workspace folder open.');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const contextFiles: ContextFile[] = [];

  // Scan for all agent files
  for (const pattern of FILE_PATTERNS) {
    const uris = await vscode.workspace.findFiles(pattern.glob, '**/node_modules/**', 50);
    for (const uri of uris) {
      try {
        const content = fs.readFileSync(uri.fsPath, 'utf8');
        const relativePath = path.relative(rootPath, uri.fsPath);
        const loadInfo = LOAD_ORDER[pattern.type] || LOAD_ORDER.unknown;

        contextFiles.push({
          relativePath,
          absolutePath: uri.fsPath,
          type: pattern.type,
          content,
          charCount: content.length,
          estimatedTokens: Math.ceil(content.length / 4),
          lineCount: content.split('\n').length,
          loadOrder: loadInfo.order,
          loadBehavior: loadInfo.behavior,
          loadNote: loadInfo.note,
        });
      } catch {
        // skip unreadable
      }
    }
  }

  if (contextFiles.length === 0) {
    vscode.window.showInformationMessage(
      'AgentLint: No agent instruction files found in this workspace.'
    );
    return;
  }

  // Sort by load order (Claude's priority hierarchy)
  contextFiles.sort((a, b) => a.loadOrder - b.loadOrder || a.relativePath.localeCompare(b.relativePath));

  // Build the export document
  const markdown = renderContextExport(contextFiles, rootPath);

  // Show in a new untitled document
  const doc = await vscode.workspace.openTextDocument({
    content: markdown,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });

  const totalTokens = contextFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);
  const claudeFiles = contextFiles.filter((f) => f.loadBehavior !== 'other-tool');
  const claudeTokens = claudeFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);

  vscode.window.showInformationMessage(
    `AgentLint: Exported ${contextFiles.length} agent files (~${totalTokens.toLocaleString()} tokens). ` +
    `Claude loads ~${claudeTokens.toLocaleString()} tokens from ${claudeFiles.length} files.`
  );

  track('context_exported', {
    total_files: contextFiles.length,
    total_tokens: totalTokens,
    claude_files: claudeFiles.length,
    claude_tokens: claudeTokens,
  });
}

function renderContextExport(files: ContextFile[], rootPath: string): string {
  const lines: string[] = [];
  const totalTokens = files.reduce((sum, f) => sum + f.estimatedTokens, 0);

  const claudeFiles = files.filter((f) => f.loadBehavior !== 'other-tool');
  const claudeTokens = claudeFiles.reduce((sum, f) => sum + f.estimatedTokens, 0);
  const otherToolFiles = files.filter((f) => f.loadBehavior === 'other-tool');

  // Header
  lines.push('# 🧠 Agent Context Export');
  lines.push('');
  lines.push('> What your AI agent actually sees when it loads your instruction files.');
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total agent files | ${files.length} |`);
  lines.push(`| Claude-loaded files | ${claudeFiles.length} |`);
  lines.push(`| Other-tool files | ${otherToolFiles.length} |`);
  lines.push(`| Total tokens (all files) | ~${totalTokens.toLocaleString()} |`);
  lines.push(`| Claude-loaded tokens | ~${claudeTokens.toLocaleString()} |`);
  lines.push('');

  // Load order visualization
  lines.push('## Load Order');
  lines.push('');
  lines.push('Claude loads instruction files in this priority order (more specific overrides more general):');
  lines.push('');

  const behaviorIcons: Record<string, string> = {
    always: '🔵 Always loaded',
    'path-scoped': '📁 Path-scoped (on matching files)',
    'on-demand': '⚡ On-demand (when task matches)',
    'other-tool': '⚪ Not loaded by Claude',
  };

  for (const file of files) {
    const icon = file.loadBehavior === 'other-tool' ? '⚪' :
      file.loadBehavior === 'always' ? '🔵' :
        file.loadBehavior === 'path-scoped' ? '📁' : '⚡';
    const tokenPct = totalTokens > 0 ? ((file.estimatedTokens / totalTokens) * 100).toFixed(0) : '0';
    lines.push(
      `${icon} **${file.relativePath}** — ~${file.estimatedTokens.toLocaleString()} tokens (${tokenPct}%) — ${file.loadNote}`
    );
  }
  lines.push('');

  // Legend
  lines.push('**Legend:** ');
  for (const [behavior, label] of Object.entries(behaviorIcons)) {
    lines.push(`${label} | `);
  }
  lines.push('');
  lines.push('');

  // Full content sections
  lines.push('## File Contents');
  lines.push('');
  lines.push('Below is the exact content of each agent file, in load order:');
  lines.push('');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const icon = file.loadBehavior === 'other-tool' ? '⚪' :
      file.loadBehavior === 'always' ? '🔵' :
        file.loadBehavior === 'path-scoped' ? '📁' : '⚡';

    lines.push(`### ${i + 1}. ${icon} ${file.relativePath}`);
    lines.push('');
    lines.push(`> ${file.lineCount} lines | ${file.charCount.toLocaleString()} chars | ~${file.estimatedTokens.toLocaleString()} tokens | ${file.loadNote}`);
    lines.push('');

    // Extract glob from .claude/rules/ files frontmatter
    if (file.type === 'claude-rules') {
      const globMatch = file.content.match(/^---[\s\S]*?globs?:\s*["']?([^\n"']+)/m);
      if (globMatch) {
        lines.push(`> **Glob pattern:** \`${globMatch[1].trim()}\` — only loaded when editing matching files`);
        lines.push('');
      }
    }

    // Extract skill name/description
    if (file.type === 'skill-md') {
      const nameMatch = file.content.match(/^name:\s*(.+)/m);
      const descMatch = file.content.match(/^description:\s*(.+)/m);
      if (nameMatch) {
        lines.push(`> **Skill name:** \`${nameMatch[1].trim()}\``);
      }
      if (descMatch) {
        lines.push(`> **Triggers on:** ${descMatch[1].trim()}`);
      }
      lines.push('');
    }

    // Content in a code block
    lines.push('```markdown');
    lines.push(file.content);
    lines.push('```');
    lines.push('');

    // Separator between files
    if (i < files.length - 1) {
      lines.push('---');
      lines.push('');
    }
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push(`*Exported by AgentLint from ${path.basename(rootPath)}. ${files.length} files, ~${totalTokens.toLocaleString()} total tokens.*`);
  lines.push('');

  return lines.join('\n');
}
