import * as vscode from 'vscode';
import * as path from 'path';
import { analyzeDocument } from './analyzer';
import { issuesToDiagnostics } from './diagnostics';
import { runLocalRules } from './localRules';
import { AgentLintCodeActionProvider } from './quickfix';
import { createClaudeMdTemplate, createSkillMdTemplate, createClaudeRulesTemplate } from './templates';
import { scanWorkspace, renderReportMarkdown } from './readiness/vscodeScanner';
import { migrateToClaudeMd } from './migration';
import { exportAgentContext } from './contextExport';
import { AgentFileType, AgentFileInfo } from './types';
import { AgentLintConfig } from './config/types';
import { loadConfig, loadConfigFromFile } from './config/loader';

// ── File detection ───────────────────────────────────────────────────────────

/**
 * Detect what type of agent instruction file this is.
 * Returns undefined if not a recognized agent file.
 */
function detectAgentFile(filePath: string): AgentFileInfo | undefined {
  const basename = path.basename(filePath);
  const lowerBasename = basename.toLowerCase();
  const dirName = path.basename(path.dirname(filePath));
  const parentDir = path.basename(path.dirname(path.dirname(filePath)));

  // CLAUDE.md (root or .claude/ directory)
  if (lowerBasename === 'claude.md') {
    return { type: 'claude-md', label: 'CLAUDE.md' };
  }

  // CLAUDE.local.md
  if (lowerBasename === 'claude.local.md') {
    return { type: 'claude-local-md', label: 'CLAUDE.local.md' };
  }

  // .claude/rules/*.md
  if (dirName === 'rules' && parentDir === '.claude' && lowerBasename.endsWith('.md')) {
    return { type: 'claude-rules', label: '.claude/rules/' };
  }

  // .claude/commands/*.md (slash commands)
  if (dirName === 'commands' && parentDir === '.claude' && lowerBasename.endsWith('.md')) {
    return { type: 'claude-commands', label: '.claude/commands/' };
  }

  // AGENTS.md
  if (lowerBasename === 'agents.md') {
    return { type: 'agents-md', label: 'AGENTS.md' };
  }

  // .cursorrules
  if (lowerBasename === '.cursorrules') {
    return { type: 'cursorrules', label: '.cursorrules' };
  }

  // .cursor/rules/*.mdc or *.md
  if (dirName === 'rules' && parentDir === '.cursor' && (lowerBasename.endsWith('.md') || lowerBasename.endsWith('.mdc'))) {
    return { type: 'cursorrules', label: '.cursor/rules/' };
  }

  // copilot-instructions.md (typically in .github/)
  if (lowerBasename === 'copilot-instructions.md') {
    return { type: 'copilot-instructions', label: 'copilot-instructions.md' };
  }

  // SKILL.md
  if (lowerBasename === 'skill.md') {
    return { type: 'skill-md', label: 'SKILL.md' };
  }

  // .agent.md files (convention used by some tools)
  if (lowerBasename.endsWith('.agent.md')) {
    return { type: 'agents-md', label: basename };
  }

  // AGENT.md
  if (lowerBasename === 'agent.md') {
    return { type: 'agents-md', label: 'AGENT.md' };
  }

  return undefined;
}

// ── Debounce helper ─────────────────────────────────────────────────────────

const analysisTimers = new Map<string, NodeJS.Timeout>();

function debounceAnalysis(document: vscode.TextDocument, delayMs: number = 1000): void {
  const key = document.uri.toString();

  // Clear any pending timer for this document
  const existing = analysisTimers.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Set a new timer
  const timer = setTimeout(() => {
    analysisTimers.delete(key);
    runAnalysis(document);
  }, delayMs);

  analysisTimers.set(key, timer);
}

// ── Extension state ──────────────────────────────────────────────────────────

let diagnosticCollection: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let apiKeyWarningShown = false;

/** Cached AgentLint config loaded from .agentlint.json / agentlint.config.json. */
let cachedConfig: AgentLintConfig = {};

/**
 * (Re-)load the AgentLint config from the workspace root.
 * Updates cachedConfig in place.
 */
function reloadConfig(): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    cachedConfig = {};
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const vsConfig = vscode.workspace.getConfiguration('agentlint');
  const configPathSetting = vsConfig.get<string>('configPath', '');

  if (configPathSetting) {
    const absConfigPath = path.isAbsolute(configPathSetting)
      ? configPathSetting
      : path.resolve(rootPath, configPathSetting);

    try {
      cachedConfig = loadConfigFromFile(absConfigPath);
      outputChannel?.appendLine(`AgentLint: Loaded config from ${absConfigPath}`);
    } catch (err) {
      cachedConfig = {};
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel?.appendLine(`AgentLint: Failed to load config from "${configPathSetting}": ${msg}. Using defaults.`);
    }
  } else {
    cachedConfig = loadConfig(rootPath);
  }

  outputChannel?.appendLine('Config reloaded');
}

function setStatusBar(text: string, tooltip?: string): void {
  statusBarItem.text = text;
  statusBarItem.tooltip = tooltip;
  statusBarItem.show();
}

// ── Analysis runner ──────────────────────────────────────────────────────────

async function runAnalysis(document: vscode.TextDocument): Promise<void> {
  const fileInfo = detectAgentFile(document.uri.fsPath);
  if (!fileInfo) {
    return;
  }

  const content = document.getText();
  const filePath = document.uri.fsPath;
  outputChannel.appendLine(`Analyzing ${fileInfo.label}: ${filePath}`);

  // Phase 1: Run local (free, instant) rules — with config-based filtering
  const localIssues = runLocalRules(content, fileInfo.type, filePath, cachedConfig);
  const localDiagnostics = issuesToDiagnostics(localIssues, document);

  // Show local results immediately
  diagnosticCollection.set(document.uri, localDiagnostics);

  const localCount = localIssues.length;
  outputChannel.appendLine(`  Local rules: ${localCount} issues`);
  setStatusBar(
    `$(sync~spin) AgentLint [${fileInfo.label}]: ${localCount} local issue${localCount !== 1 ? 's' : ''}, analyzing with Claude...`,
    `Local rules found ${localCount} issues. Running Claude analysis...`
  );

  // Phase 2: Run LLM analysis (if API key available)
  const result = await analyzeDocument(document.uri.fsPath, content, fileInfo.type);

  if (!result) {
    // Check if this is an API key issue
    const config = vscode.workspace.getConfiguration('agentlint');
    const configKey = config.get<string>('anthropicApiKey');
    const hasKey = (configKey && configKey.length > 0) || process.env.ANTHROPIC_API_KEY;

    if (!hasKey && !apiKeyWarningShown) {
      apiKeyWarningShown = true;
      const action = await vscode.window.showWarningMessage(
        'AgentLint: No Anthropic API key configured. Local rules are active. Add an API key for deeper analysis.',
        'Open Settings'
      );
      if (action === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'agentlint.anthropicApiKey');
      }
    }

    // Keep local diagnostics, update status bar
    outputChannel.appendLine(`  Claude analysis skipped: ${hasKey ? 'API error' : 'no API key'}`);
    const icon = localCount === 0 ? '$(check)' : '$(alert)';
    const apiStatus = hasKey ? 'API error' : 'no API key';
    setStatusBar(
      `${icon} AgentLint [${fileInfo.label}]: ${localCount} issue${localCount !== 1 ? 's' : ''} (local only, ${apiStatus})`,
      `AgentLint local analysis complete. Configure an API key for deeper analysis.`
    );
    return;
  }

  // Phase 3: Merge local + LLM diagnostics (deduplicate by code + line range)
  outputChannel.appendLine(`  Claude analysis: ${result.issues.length} issues, score: ${result.score ?? 'n/a'}`);
  const llmDiagnostics = issuesToDiagnostics(result.issues, document);
  const mergedDiagnostics = mergeDiagnostics(localDiagnostics, llmDiagnostics);

  diagnosticCollection.set(document.uri, mergedDiagnostics);

  const totalCount = mergedDiagnostics.length;
  const scoreText = result.score !== undefined ? ` (${result.score}/100)` : '';
  const icon = totalCount === 0 ? '$(check)' : '$(alert)';

  setStatusBar(
    `${icon} AgentLint [${fileInfo.label}]: ${totalCount} issue${totalCount !== 1 ? 's' : ''}${scoreText}`,
    `AgentLint analysis complete. Score: ${result.score ?? 'n/a'}. ${localCount} local + ${result.issues.length} Claude issues.`
  );
}

/**
 * Merge local and LLM diagnostics, deduplicating overlapping issues.
 * Local rules take precedence since they're deterministic.
 */
function mergeDiagnostics(
  local: vscode.Diagnostic[],
  llm: vscode.Diagnostic[]
): vscode.Diagnostic[] {
  const merged = [...local];

  for (const llmDiag of llm) {
    // Check if a local diagnostic covers the same code + similar range
    const isDuplicate = local.some(
      (localDiag) =>
        localDiag.code === llmDiag.code &&
        Math.abs(localDiag.range.start.line - llmDiag.range.start.line) <= 2
    );

    if (!isDuplicate) {
      merged.push(llmDiag);
    }
  }

  return merged;
}

// ── Extension lifecycle ──────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('agentlint');
  context.subscriptions.push(diagnosticCollection);

  outputChannel = vscode.window.createOutputChannel('AgentLint');
  context.subscriptions.push(outputChannel);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'agentlint.analyzeNow';
  context.subscriptions.push(statusBarItem);

  // ── Config loading ──────────────────────────────────────────────────────
  reloadConfig();

  // Watch for .agentlint.json / agentlint.config.json changes
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    '**/{.agentlint.json,agentlint.config.json}'
  );
  configWatcher.onDidChange(() => {
    reloadConfig();
    // Re-analyze open agent files with the updated config
    if (vscode.window.activeTextEditor) {
      runAnalysis(vscode.window.activeTextEditor.document);
    }
  });
  configWatcher.onDidCreate(() => {
    reloadConfig();
    if (vscode.window.activeTextEditor) {
      runAnalysis(vscode.window.activeTextEditor.document);
    }
  });
  configWatcher.onDidDelete(() => {
    reloadConfig();
    if (vscode.window.activeTextEditor) {
      runAnalysis(vscode.window.activeTextEditor.document);
    }
  });
  context.subscriptions.push(configWatcher);

  // Register CodeActionProvider for quick-fixes
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { scheme: 'file', language: 'markdown' },
    new AgentLintCodeActionProvider(),
    { providedCodeActionKinds: AgentLintCodeActionProvider.providedCodeActionKinds }
  );
  context.subscriptions.push(codeActionProvider);

  // Register for non-markdown agent files (.cursorrules, .mdc)
  const agentFilePatterns = [
    '**/.cursorrules',
    '**/.cursor/rules/*.mdc',
  ];
  for (const pattern of agentFilePatterns) {
    const provider = vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern },
      new AgentLintCodeActionProvider(),
      { providedCodeActionKinds: AgentLintCodeActionProvider.providedCodeActionKinds }
    );
    context.subscriptions.push(provider);
  }

  // Command: manual analysis
  const analyzeCommand = vscode.commands.registerCommand('agentlint.analyzeNow', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      runAnalysis(editor.document);
    }
  });
  context.subscriptions.push(analyzeCommand);

  // Command: Create CLAUDE.md from template
  const createClaudeMdCmd = vscode.commands.registerCommand('agentlint.createClaudeMd', () => {
    createClaudeMdTemplate();
  });
  context.subscriptions.push(createClaudeMdCmd);

  // Command: Create SKILL.md from template
  const createSkillMdCmd = vscode.commands.registerCommand('agentlint.createSkillMd', () => {
    createSkillMdTemplate();
  });
  context.subscriptions.push(createSkillMdCmd);

  // Command: Create .claude/rules/ file from template
  const createRulesCmd = vscode.commands.registerCommand('agentlint.createClaudeRules', () => {
    createClaudeRulesTemplate();
  });
  context.subscriptions.push(createRulesCmd);

  // Command: AI-Readiness Report
  const readinessCmd = vscode.commands.registerCommand('agentlint.aiReadiness', async () => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'AgentLint: Scanning workspace for AI readiness...',
        cancellable: false,
      },
      async () => {
        const report = await scanWorkspace();
        const markdown = renderReportMarkdown(report);

        // Show in a new untitled document
        const doc = await vscode.workspace.openTextDocument({
          content: markdown,
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: true });

        // Also show summary notification
        const emoji = report.score >= 80 ? '🟢' : report.score >= 50 ? '🟡' : report.score >= 20 ? '🟠' : '🔴';
        vscode.window.showInformationMessage(
          `${emoji} AI-Readiness: ${report.score}/100 — L${report.maturity.level} ${report.maturity.label} — ${report.roadmap.length} steps to improve`
        );
      }
    );
  });
  context.subscriptions.push(readinessCmd);

  // Command: Migrate to CLAUDE.md
  const migrateCmd = vscode.commands.registerCommand('agentlint.migrateToClaudeMd', () => {
    migrateToClaudeMd();
  });
  context.subscriptions.push(migrateCmd);

  // Command: Export Agent Context
  const exportContextCmd = vscode.commands.registerCommand('agentlint.exportContext', () => {
    exportAgentContext();
  });
  context.subscriptions.push(exportContextCmd);

  // Trigger on text change (debounced for real-time feedback)
  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.contentChanges.length > 0) {
      const fileInfo = detectAgentFile(event.document.uri.fsPath);
      if (fileInfo) {
        debounceAnalysis(event.document);
      }
    }
  });
  context.subscriptions.push(onChange);

  // Trigger on save
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
    runAnalysis(document);
  });
  context.subscriptions.push(onSave);

  // Trigger on file open
  const onOpen = vscode.workspace.onDidOpenTextDocument((document) => {
    runAnalysis(document);
  });
  context.subscriptions.push(onOpen);

  // Trigger on active editor change
  const onEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      const fileInfo = detectAgentFile(editor.document.uri.fsPath);
      if (fileInfo) {
        setStatusBar(`$(eye) AgentLint [${fileInfo.label}]: Ready`);
        // Run analysis if no diagnostics exist yet
        if (!diagnosticCollection.has(editor.document.uri)) {
          runAnalysis(editor.document);
        }
      } else {
        statusBarItem.hide();
      }
    }
  });
  context.subscriptions.push(onEditorChange);

  // Clean up diagnostics when a file is closed
  const onClose = vscode.workspace.onDidCloseTextDocument((document) => {
    diagnosticCollection.delete(document.uri);
  });
  context.subscriptions.push(onClose);

  // Analyze any already-open target files
  if (vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (detectAgentFile(doc.uri.fsPath)) {
      runAnalysis(doc);
    }
  }
}

export function deactivate(): void {
  // Clear any pending analysis timers
  for (const timer of analysisTimers.values()) {
    clearTimeout(timer);
  }
  analysisTimers.clear();
}
