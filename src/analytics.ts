/**
 * AgentLint Analytics — anonymous usage tracking via Mixpanel.
 *
 * Zero dependencies: uses Node.js built-in `https` module.
 * Fire-and-forget: never blocks the UI, swallows all errors.
 * Privacy-first: no file paths, no content, no PII.
 *
 * Opt-out:
 *   VS Code: set `agentlint.telemetry: false` or `telemetry.telemetryLevel: off`
 *   CLI:     `--no-telemetry` flag or `DO_NOT_TRACK=1` env var
 */

import * as https from 'https';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ── Mixpanel project token (public client-side token, not a secret) ─────────

const MIXPANEL_TOKEN = '4cc52b9ff4027991a380d9f22175185e';

// ── Types ───────────────────────────────────────────────────────────────────

interface AnalyticsEvent {
  event: string;
  properties: Record<string, unknown>;
}

interface AnalyticsConfig {
  /** 'vscode' or 'cli' */
  context: 'vscode' | 'cli';
  /** Extension or CLI version */
  extensionVersion: string;
  /** VS Code version or 'cli' */
  editorVersion: string;
  /** Pre-resolved distinct ID (for CLI where globalState isn't available) */
  distinctId?: string;
  /** Function to check if telemetry is enabled */
  isEnabled: () => boolean;
  /** VS Code globalState for storing anonymous ID (only in VS Code context) */
  globalState?: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

// ── Singleton state ─────────────────────────────────────────────────────────

let config: AnalyticsConfig | undefined;
let queue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | undefined;
let distinctId: string | undefined;

const FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const FLUSH_THRESHOLD = 20; // events
const REQUEST_TIMEOUT_MS = 5_000; // 5 seconds

// ── Super properties (attached to every event) ──────────────────────────────

function getSuperProperties(): Record<string, unknown> {
  if (!config) return {};
  return {
    extension_version: config.extensionVersion,
    editor_version: config.editorVersion,
    context: config.context,
    os_platform: os.platform(),
    os_release: os.release(),
    node_version: process.version,
  };
}

// ── Distinct ID management ──────────────────────────────────────────────────

function getOrCreateDistinctId(): string {
  if (distinctId) return distinctId;

  // If a pre-resolved ID was passed (CLI), use it
  if (config?.distinctId) {
    distinctId = config.distinctId;
    return distinctId;
  }

  // VS Code: use globalState
  if (config?.globalState) {
    const stored = config.globalState.get<string>('agentlint.anonymousId');
    if (stored) {
      distinctId = stored;
      return distinctId;
    }
    distinctId = crypto.randomUUID();
    // Fire-and-forget — don't await
    config.globalState.update('agentlint.anonymousId', distinctId).then(
      () => {},
      () => {}
    );
    return distinctId;
  }

  // Fallback: generate a new one each session (shouldn't happen)
  distinctId = crypto.randomUUID();
  return distinctId;
}

/**
 * Get or create a persistent anonymous ID for CLI usage.
 * Stored at ~/.agentlint/anonymous-id
 */
export function getOrCreateCliDistinctId(): string {
  const dir = path.join(os.homedir(), '.agentlint');
  const filePath = path.join(dir, 'anonymous-id');

  try {
    const existing = fs.readFileSync(filePath, 'utf-8').trim();
    if (existing) return existing;
  } catch {
    // File doesn't exist yet
  }

  const id = crypto.randomUUID();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, id, 'utf-8');
  } catch {
    // Best-effort — if we can't write, use ephemeral ID
  }
  return id;
}

// ── Network layer ───────────────────────────────────────────────────────────

function sendToMixpanel(events: AnalyticsEvent[]): void {
  if (events.length === 0) return;

  try {
    const payload = events.map((e) => ({
      event: e.event,
      properties: {
        ...e.properties,
        token: MIXPANEL_TOKEN,
        distinct_id: getOrCreateDistinctId(),
        time: Math.floor(Date.now() / 1000),
        $insert_id: crypto.randomUUID(),
      },
    }));

    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const postData = `data=${encodeURIComponent(data)}`;

    const req = https.request(
      {
        hostname: 'api.mixpanel.com',
        port: 443,
        path: '/track',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        // Drain response to free socket
        res.resume();
      }
    );

    req.on('error', () => {
      // Swallow — analytics should never surface errors
    });

    req.on('timeout', () => {
      req.destroy();
    });

    req.write(postData);
    req.end();
  } catch {
    // Swallow all errors
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the analytics module. Call once at startup.
 */
export function initAnalytics(cfg: AnalyticsConfig): void {
  config = cfg;
  queue = [];

  // Start auto-flush timer
  flushTimer = setInterval(() => {
    flush();
  }, FLUSH_INTERVAL_MS);

  // Don't let the timer prevent Node from exiting (CLI)
  if (flushTimer && typeof flushTimer.unref === 'function') {
    flushTimer.unref();
  }
}

/**
 * Track an event. Fire-and-forget — never throws, never blocks.
 */
export function track(event: string, properties: Record<string, unknown> = {}): void {
  if (!config) return;

  try {
    if (!config.isEnabled()) return;

    queue.push({
      event,
      properties: {
        ...getSuperProperties(),
        ...properties,
      },
    });

    // Auto-flush when threshold is reached
    if (queue.length >= FLUSH_THRESHOLD) {
      flush();
    }
  } catch {
    // Swallow — analytics should never surface errors
  }
}

/**
 * Flush the event queue. Sends all queued events to Mixpanel.
 */
function flush(): void {
  if (queue.length === 0) return;

  const batch = queue.splice(0);
  sendToMixpanel(batch);
}

/**
 * Flush remaining events. Call before process exit.
 * Returns a promise that resolves after a short delay to allow the HTTP request to start.
 */
export async function flushAnalytics(): Promise<void> {
  flush();
  // Give the HTTP request a moment to fire
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * Dispose analytics: flush remaining events and clear timers.
 */
export function disposeAnalytics(): void {
  flush();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
  config = undefined;
  distinctId = undefined;
}
