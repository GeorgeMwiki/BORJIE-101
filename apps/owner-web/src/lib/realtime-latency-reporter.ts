/**
 * RT-3 client — batched cockpit-event latency reporter.
 *
 * Pluggable into the cockpit SSE hook. Every event received by the
 * client gets timed against its server `emittedAt` and queued; the
 * queue is flushed every FLUSH_INTERVAL_MS, or when it reaches
 * FLUSH_BATCH_SIZE, whichever comes first.
 *
 * We keep this in a singleton module-level queue so multiple SSE
 * components mounted on the same page do not double-report.
 *
 * Failure modes:
 *   - If `/api/v1/metrics/realtime-latency` is unreachable the batch
 *     is dropped (telemetry must never block the UI thread).
 *   - If the server clock and client clock differ wildly we still
 *     report — the server-side store clamps to [0, 60_000] ms.
 */

import { API_BASE } from './api-client';

interface QueuedSample {
  readonly kind: string;
  readonly latencyMs: number;
}

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE = 25;
const MAX_QUEUE_LENGTH = 100;

const queue: QueuedSample[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer || typeof window === 'undefined') return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushNow();
  }, FLUSH_INTERVAL_MS);
}

async function flushNow(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await fetch(`${API_BASE}/metrics/realtime-latency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ samples: batch }),
    });
  } catch {
    // telemetry is best-effort; do not surface to the UI.
  }
}

/**
 * Record one cockpit-event round trip. Pass the `kind` so the server
 * can break down stats per event type later (today it aggregates all).
 */
export function recordCockpitLatency(
  kind: string,
  serverEmittedAt: string,
): void {
  if (typeof window === 'undefined') return;
  const emittedMs = new Date(serverEmittedAt).valueOf();
  if (!Number.isFinite(emittedMs)) return;
  const latencyMs = Math.max(0, Date.now() - emittedMs);
  queue.push({ kind, latencyMs });
  if (queue.length >= MAX_QUEUE_LENGTH) {
    // Drop oldest if we've fallen too far behind.
    queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
  }
  if (queue.length >= FLUSH_BATCH_SIZE) {
    void flushNow();
    return;
  }
  scheduleFlush();
}

/**
 * Test helper — wipe the queue + cancel any pending flush. NEVER call
 * from non-test code.
 */
export function __resetReporterForTests(): void {
  queue.length = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
