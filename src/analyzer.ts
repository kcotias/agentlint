import * as vscode from 'vscode';
import { AgentFileType, AnalysisResult, PromptIssue } from './types';
import { buildMetaPrompt } from './metaPrompt';
import { track } from './analytics';

// Lazy-load the Anthropic SDK so the extension activates even when
// node_modules aren't bundled (e.g., VSIX without a bundler).
let _Anthropic: typeof import('@anthropic-ai/sdk').default | undefined;
function getAnthropicSDK(): typeof import('@anthropic-ai/sdk').default | undefined {
  if (!_Anthropic) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');
    } catch {
      // SDK not available — deep analysis disabled
    }
  }
  return _Anthropic;
}

interface CacheEntry {
  content: string;
  result: AnalysisResult;
}

const cache = new Map<string, CacheEntry>();

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('AgentLint');
  }
  return outputChannel;
}

function getApiKey(): string | undefined {
  const config = vscode.workspace.getConfiguration('agentlint');
  const configKey = config.get<string>('anthropicApiKey');
  if (configKey && configKey.length > 0) {
    return configKey;
  }
  return process.env.ANTHROPIC_API_KEY;
}

function getModel(): string {
  const config = vscode.workspace.getConfiguration('agentlint');
  return config.get<string>('model') || 'claude-sonnet-4-20250514';
}

function stripMarkdownFences(text: string): string {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ``` ... ```
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return cleaned;
}

function validateIssue(issue: unknown): issue is PromptIssue {
  if (typeof issue !== 'object' || issue === null) return false;
  const obj = issue as Record<string, unknown>;
  return (
    typeof obj.startLine === 'number' &&
    typeof obj.endLine === 'number' &&
    (obj.severity === 'error' || obj.severity === 'warning' || obj.severity === 'info') &&
    typeof obj.code === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.suggestion === 'string'
  );
}

export async function analyzeDocument(
  filePath: string,
  content: string,
  fileType: AgentFileType = 'claude-md'
): Promise<AnalysisResult | undefined> {
  const log = getOutputChannel();

  const startTime = Date.now();

  // Check cache
  const cached = cache.get(filePath);
  if (cached && cached.content === content) {
    log.appendLine(`[cache hit] ${filePath}`);
    track('deep_analysis_run', {
      model: getModel(),
      success: true,
      cached: true,
      duration_ms: Date.now() - startTime,
      issue_count: cached.result.issues.length,
      score: cached.result.score,
    });
    return cached.result;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return undefined;
  }

  const Anthropic = getAnthropicSDK();
  if (!Anthropic) {
    log.appendLine('[info] Anthropic SDK not available — deep analysis disabled. Local rules still active.');
    return undefined;
  }

  const model = getModel();
  const prompt = buildMetaPrompt(content, fileType);

  try {
    const client = new Anthropic({ apiKey });

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 30_000);

    let response: any;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: abortController.signal }
      );
    } finally {
      clearTimeout(timeout);
    }

    const textBlock = response.content.find((b: any) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      log.appendLine('[error] No text content in API response');
      return undefined;
    }

    const rawJson = stripMarkdownFences(textBlock.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseErr) {
      log.appendLine(`[error] Failed to parse JSON response: ${rawJson.substring(0, 200)}`);
      return undefined;
    }

    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Record<string, unknown>).issues)) {
      log.appendLine('[error] Response missing issues array');
      return undefined;
    }

    const raw = parsed as { issues: unknown[]; score?: unknown };
    const validIssues = raw.issues.filter(validateIssue) as PromptIssue[];

    const result: AnalysisResult = {
      issues: validIssues,
      score: typeof raw.score === 'number' ? raw.score : undefined,
    };

    cache.set(filePath, { content, result });
    log.appendLine(`[analysis] ${filePath}: ${validIssues.length} issues, score=${result.score ?? 'n/a'}`);
    track('deep_analysis_run', {
      model,
      success: true,
      cached: false,
      duration_ms: Date.now() - startTime,
      issue_count: validIssues.length,
      score: result.score,
    });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`[error] Analysis failed for ${filePath}: ${message}`);
    track('deep_analysis_run', {
      model,
      success: false,
      cached: false,
      duration_ms: Date.now() - startTime,
      error_type: err instanceof Error ? err.constructor.name : 'unknown',
    });
    return undefined;
  }
}

export function clearCache(filePath?: string): void {
  if (filePath) {
    cache.delete(filePath);
  } else {
    cache.clear();
  }
}
