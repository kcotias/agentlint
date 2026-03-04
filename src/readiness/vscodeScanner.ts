/**
 * VS Code wrapper for the readiness scanner.
 *
 * Uses vscode.workspace.findFiles for file discovery, then delegates
 * to the pure core for scanning and the renderer for output.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { scanReadiness, ScanInput } from './core';
import { renderReportMarkdown } from './renderer';
import { ReadinessReport } from './types';
import { AgentFileType } from '../types';

// ── File type detection (mirrors cli/scanner.ts for VS Code context) ─────────

function detectFileType(filePath: string): AgentFileType | null {
  const basename = path.basename(filePath);
  const lowerBasename = basename.toLowerCase();
  const dirName = path.basename(path.dirname(filePath));
  const parentDir = path.basename(path.dirname(path.dirname(filePath)));

  if (lowerBasename === 'claude.md') return 'claude-md';
  if (lowerBasename === 'claude.local.md') return 'claude-local-md';
  if (dirName === 'rules' && parentDir === '.claude' && lowerBasename.endsWith('.md')) return 'claude-rules';
  if (dirName === 'commands' && parentDir === '.claude' && lowerBasename.endsWith('.md')) return 'claude-commands';
  if (lowerBasename === 'agents.md') return 'agents-md';
  if (lowerBasename === '.cursorrules') return 'cursorrules';
  if (dirName === 'rules' && parentDir === '.cursor' && (lowerBasename.endsWith('.md') || lowerBasename.endsWith('.mdc'))) return 'cursorrules';
  if (lowerBasename === 'copilot-instructions.md') return 'copilot-instructions';
  if (lowerBasename === 'skill.md') return 'skill-md';
  if (lowerBasename.endsWith('.agent.md')) return 'agents-md';
  if (lowerBasename === 'agent.md') return 'agents-md';

  return null;
}

// ── VS Code Scanner ──────────────────────────────────────────────────────────

/**
 * Scan the workspace using VS Code APIs and return a ReadinessReport.
 * This is the VS Code entry point — the CLI uses a different file discovery path.
 */
export async function scanWorkspace(): Promise<ReadinessReport> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    // Return empty report
    return scanReadiness({ rootDir: '', files: [] });
  }

  const rootPath = workspaceFolders[0].uri.fsPath;

  // Discover agent files using VS Code glob
  const patterns = [
    '**/CLAUDE.md',
    '**/CLAUDE.local.md',
    '**/.claude/rules/*.md',
    '**/.claude/commands/*.md',
    '**/.cursorrules',
    '**/.cursor/rules/*.{md,mdc}',
    '**/copilot-instructions.md',
    '**/AGENTS.md',
    '**/AGENT.md',
    '**/*.agent.md',
    '**/SKILL.md',
  ];

  const excludePattern = '**/node_modules/**';
  const allUris: vscode.Uri[] = [];

  for (const pattern of patterns) {
    const uris = await vscode.workspace.findFiles(pattern, excludePattern, 50);
    allUris.push(...uris);
  }

  // Deduplicate by path
  const seen = new Set<string>();
  const files: ScanInput['files'] = [];

  for (const uri of allUris) {
    const absPath = uri.fsPath;
    if (seen.has(absPath)) continue;
    seen.add(absPath);

    const type = detectFileType(absPath);
    if (!type) continue;

    const relativePath = path.relative(rootPath, absPath);
    files.push({ absPath, relativePath, type });
  }

  // Check if API key is configured
  const config = vscode.workspace.getConfiguration('agentlint');
  const configKey = config.get<string>('anthropicApiKey');
  const hasApiKey = !!(configKey && configKey.length > 0) || !!process.env.ANTHROPIC_API_KEY;

  return scanReadiness({ rootDir: rootPath, files, hasApiKey });
}

export { renderReportMarkdown };
