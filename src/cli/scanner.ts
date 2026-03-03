/**
 * Standalone file discovery for the AgentLint CLI.
 *
 * Walks a directory tree looking for recognized agent instruction files
 * (CLAUDE.md, .cursorrules, SKILL.md, etc.) and classifies each one.
 *
 * Does NOT depend on the `vscode` module -- uses only Node built-ins.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentFileType } from '../types';

// ── File type detection ──────────────────────────────────────────────────────

/**
 * Determine the AgentFileType for a given absolute file path.
 * Returns `null` if the file is not a recognized agent instruction file.
 */
export function detectFileType(filePath: string): AgentFileType | null {
  const basename = path.basename(filePath);
  const lowerBasename = basename.toLowerCase();
  const dirName = path.basename(path.dirname(filePath));
  const parentDir = path.basename(path.dirname(path.dirname(filePath)));

  // CLAUDE.md (root or .claude/ directory)
  if (lowerBasename === 'claude.md') {
    return 'claude-md';
  }

  // CLAUDE.local.md
  if (lowerBasename === 'claude.local.md') {
    return 'claude-local-md';
  }

  // .claude/rules/*.md
  if (dirName === 'rules' && parentDir === '.claude' && lowerBasename.endsWith('.md')) {
    return 'claude-rules';
  }

  // .claude/commands/*.md (slash commands)
  if (dirName === 'commands' && parentDir === '.claude' && lowerBasename.endsWith('.md')) {
    return 'claude-commands';
  }

  // AGENTS.md
  if (lowerBasename === 'agents.md') {
    return 'agents-md';
  }

  // .cursorrules
  if (lowerBasename === '.cursorrules') {
    return 'cursorrules';
  }

  // .cursor/rules/*.mdc or *.md
  if (
    dirName === 'rules' &&
    parentDir === '.cursor' &&
    (lowerBasename.endsWith('.md') || lowerBasename.endsWith('.mdc'))
  ) {
    return 'cursorrules';
  }

  // copilot-instructions.md (typically in .github/)
  if (lowerBasename === 'copilot-instructions.md') {
    return 'copilot-instructions';
  }

  // SKILL.md
  if (lowerBasename === 'skill.md') {
    return 'skill-md';
  }

  // .agent.md files (convention used by some tools)
  if (lowerBasename.endsWith('.agent.md')) {
    return 'agents-md';
  }

  // AGENT.md
  if (lowerBasename === 'agent.md') {
    return 'agents-md';
  }

  return null;
}

// ── Directory scanning ───────────────────────────────────────────────────────

/** A discovered agent file with its absolute path and detected type. */
export interface DiscoveredFile {
  path: string;
  type: AgentFileType;
}

/** Directories that should never be traversed. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.tox',
  '.venv',
  'venv',
  'vendor',
  'target',
]);

/**
 * Walk `rootDir` and return every agent instruction file found.
 *
 * The walk respects IGNORED_DIRS to avoid descending into heavy subtrees like
 * node_modules or .git.  It also looks at well-known locations first (e.g.
 * root-level CLAUDE.md, .claude/rules/) so the ordering is deterministic.
 */
export function findAgentFiles(rootDir: string): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];
  const seen = new Set<string>();

  // ── Fast-path: check well-known locations first ────────────────────────────

  const wellKnown = [
    'CLAUDE.md',
    'CLAUDE.local.md',
    '.cursorrules',
    'AGENTS.md',
    'AGENT.md',
    'SKILL.md',
    path.join('.github', 'copilot-instructions.md'),
  ];

  for (const rel of wellKnown) {
    const abs = path.join(rootDir, rel);
    if (fileExists(abs)) {
      const type = detectFileType(abs);
      if (type) {
        results.push({ path: abs, type });
        seen.add(abs);
      }
    }
  }

  // .claude/rules/*.md
  const claudeRulesDir = path.join(rootDir, '.claude', 'rules');
  if (dirExists(claudeRulesDir)) {
    for (const entry of readDir(claudeRulesDir)) {
      if (entry.endsWith('.md')) {
        const abs = path.join(claudeRulesDir, entry);
        const type = detectFileType(abs);
        if (type && !seen.has(abs)) {
          results.push({ path: abs, type });
          seen.add(abs);
        }
      }
    }
  }

  // .claude/commands/*.md
  const claudeCommandsDir = path.join(rootDir, '.claude', 'commands');
  if (dirExists(claudeCommandsDir)) {
    for (const entry of readDir(claudeCommandsDir)) {
      if (entry.endsWith('.md')) {
        const abs = path.join(claudeCommandsDir, entry);
        const type = detectFileType(abs);
        if (type && !seen.has(abs)) {
          results.push({ path: abs, type });
          seen.add(abs);
        }
      }
    }
  }

  // .cursor/rules/*.mdc or *.md
  const cursorRulesDir = path.join(rootDir, '.cursor', 'rules');
  if (dirExists(cursorRulesDir)) {
    for (const entry of readDir(cursorRulesDir)) {
      if (entry.endsWith('.md') || entry.endsWith('.mdc')) {
        const abs = path.join(cursorRulesDir, entry);
        const type = detectFileType(abs);
        if (type && !seen.has(abs)) {
          results.push({ path: abs, type });
          seen.add(abs);
        }
      }
    }
  }

  // ── Recursive walk for SKILL.md, AGENTS.md, *.agent.md in subdirectories ─

  walkDir(rootDir, (filePath) => {
    if (seen.has(filePath)) {
      return;
    }
    const type = detectFileType(filePath);
    if (type) {
      results.push({ path: filePath, type });
      seen.add(filePath);
    }
  });

  return results;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readDir(p: string): string[] {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

/**
 * Recursively walk a directory, calling `visitor` for every file found.
 * Skips directories in IGNORED_DIRS and hidden directories (except .claude,
 * .cursor, .github which contain agent files).
 */
function walkDir(dir: string, visitor: (filePath: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or other read error
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip ignored directories
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      // Skip hidden directories except the ones we care about
      if (
        entry.name.startsWith('.') &&
        entry.name !== '.claude' &&
        entry.name !== '.cursor' &&
        entry.name !== '.github'
      ) {
        continue;
      }

      walkDir(fullPath, visitor);
    } else if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}
