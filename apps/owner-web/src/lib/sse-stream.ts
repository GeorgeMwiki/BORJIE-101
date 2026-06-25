/**
 * Server-Sent Events helper (async-generator flavour).
 *
 * The Master Brain gateway is at `/api/v1/mining/chat`. Browsers can't
 * `POST` from `EventSource`, so we use fetch + a ReadableStream reader
 * and a tiny line-based parser. Each yielded event is `{ event, data }`
 * with `data` already JSON-parsed.
 *
 * NOTE: new screens should prefer the `useSSE` hook in
 * `src/lib/use-sse.ts` — it handles cancellation, junior-call
 * breadcrumbs, evidence chips and message chunks uniformly. This
 * module is kept around for the existing `useChatSession` glue.
 *
 * Premium streaming UX (additive — see `StreamOptions.optimistic`):
 * to mask first-token latency we emit two *synthetic* frames ahead of
 * the network's first delta:
 *   - `turn_start`    at ~0ms  — an optimistic "the turn is live" beat
 *                                that lets the UI paint an empty bubble
 *                                immediately (Doherty <400ms feedback).
 *   - `skeleton_bubble` at ~100ms — a shimmer-placeholder cue, emitted
 *                                ONLY if no real delta has landed yet,
 *                                masking 40-60% of perceived latency.
 * Both are additive: existing consumers that don't recognise these
 * event names simply ignore them (their reducers return false), so the
 * change is a clean, backward-compatible superset of the wire format.
 * We also surface time-to-first-token (TTFT) through `onTtft`.
 */

import { API_BASE } from './api-client';

export interface SseEvent {
  readonly event: string;
  readonly data: unknown;
}

/**
 * Synthetic-frame tuning. These are presentational-only beats injected
 * client-side; they never alter the gateway payload.
 */
export interface OptimisticStreamConfig {
  /** Master switch for the synthetic frames. Default: true. */
  readonly enabled?: boolean;
  /**
   * Delay before the shimmer `skeleton_bubble` frame fires, if the
   * first real delta has not yet arrived. Default: 100ms (well inside
   * the Doherty <400ms first-visual-feedback budget).
   */
  readonly skeletonAfterMs?: number;
  /**
   * Called once with the measured TTFT (ms from stream-open to the
   * first content-bearing event). Lets callers log/track perceived
   * latency without coupling this module to a telemetry sink.
   */
  readonly onTtft?: (ttftMs: number) => void;
}

/**
 * Idle-watchdog tuning. A half-open socket leaves `reader.read()`
 * awaiting forever, so the chat spins indefinitely with no error. We
 * arm a timer that resets on every chunk; if no byte lands within the
 * window we abort the read and emit a visible `stream_error` so the UI
 * degrades to an error/retry affordance (FAILURE ≠ EMPTINESS).
 */
export interface StreamWatchdogConfig {
  /**
   * Max silence (ms) between chunks before the stream is declared
   * stalled. Default: 30_000ms — comfortably longer than a slow first
   * token, short enough that a dead socket surfaces quickly.
   */
  readonly idleTimeoutMs?: number;
}

export interface StreamOptions {
  readonly path: string;
  readonly body: unknown;
  readonly signal?: AbortSignal;
  /**
   * Optimistic skeleton-before-first-token behaviour. Omit to use the
   * premium defaults; pass `{ enabled: false }` to get the raw wire
   * stream with zero synthetic frames.
   */
  readonly optimistic?: OptimisticStreamConfig;
  /**
   * Idle-watchdog behaviour. Omit to use the default 30s stall window;
   * pass `{ idleTimeoutMs: 0 }` to disable the watchdog entirely (e.g.
   * tests that drive a synchronous mock reader).
   */
  readonly watchdog?: StreamWatchdogConfig;
}

/** Synthetic event names. Kept out of the gateway taxonomy on purpose. */
export const TURN_START_EVENT = 'turn_start';
export const SKELETON_BUBBLE_EVENT = 'skeleton_bubble';

/**
 * Error event emitted when the stream stalls (no chunk within the idle
 * window) or the underlying read rejects. Consumers MUST treat this as a
 * failure (show error/retry), never as an honest-empty completion — a
 * stalled stream is a FAILURE, not an EMPTY result.
 */
export const STREAM_ERROR_EVENT = 'stream_error';

const DEFAULT_SKELETON_AFTER_MS = 100;

/** Default idle window before a silent stream is declared stalled. */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/**
 * Event names that count as "real first content" for TTFT and for
 * suppressing the skeleton frame. Anything that puts text, a tool
 * breadcrumb, or evidence on screen ends the first-paint wait.
 */
const CONTENTFUL_EVENTS: ReadonlySet<string> = new Set([
  'delta',
  'message_chunk',
  'message_chunks',
  'breadcrumb',
  'junior_call',
  'junior_calls',
  'evidence',
  'evidence_id',
  'evidence_ids',
  'commitment_state',
  'done',
]);

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function isContentful(eventName: string): boolean {
  return CONTENTFUL_EVENTS.has(eventName);
}

/**
 * Open an SSE channel and yield decoded events. The async generator
 * terminates after the gateway sends `event: done` or when the caller
 * aborts via the signal.
 *
 * Synthetic optimistic frames (`turn_start`, `skeleton_bubble`) are
 * interleaved BEFORE the network's first contentful event, then
 * suppressed once real content flows. Real event order is never
 * altered — synthetic frames only ever precede the first real one.
 */
export async function* streamSse(opts: StreamOptions): AsyncGenerator<SseEvent> {
  const config = opts.optimistic ?? {};
  const optimisticEnabled = config.enabled !== false;
  const skeletonAfterMs = Math.max(0, config.skeletonAfterMs ?? DEFAULT_SKELETON_AFTER_MS);
  const idleTimeoutMs = Math.max(0, opts.watchdog?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);

  const startedAtMs = nowMs();
  let sawContentful = false;
  let ttftReported = false;

  const reportTtft = (): void => {
    if (ttftReported) return;
    ttftReported = true;
    config.onTtft?.(Math.max(0, nowMs() - startedAtMs));
  };

  // Optimistic `turn_start` at ~0ms — paint the live bubble immediately,
  // before the fetch even resolves its first byte.
  if (optimisticEnabled) {
    yield {
      event: TURN_START_EVENT,
      data: { atMs: 0, synthetic: true as const },
    };
  }

  const url = `${API_BASE.replace(/\/+$/, '')}${opts.path}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(opts.body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok || !response.body) {
    throw new Error(`sse stream failed with HTTP ${response.status}`);
  }

  // Emit the shimmer skeleton ~skeletonAfterMs later, but only if no
  // real content has landed by then. The timer races the reader below;
  // we drain it through a tiny one-slot channel so the generator stays
  // single-threaded and never reorders real frames.
  let skeletonDue = false;
  let skeletonEmitted = false;
  const skeletonTimer =
    optimisticEnabled && skeletonAfterMs >= 0
      ? setTimeout(() => {
          skeletonDue = true;
        }, skeletonAfterMs)
      : null;

  const maybeYieldSkeleton = function* (): Generator<SseEvent> {
    if (skeletonDue && !skeletonEmitted && !sawContentful && optimisticEnabled) {
      skeletonEmitted = true;
      yield {
        event: SKELETON_BUBBLE_EVENT,
        data: { reason: 'awaiting-first-token', synthetic: true as const },
      };
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      // Surface a due skeleton between reads so it lands while the
      // network is still silent (the perceptual win).
      yield* maybeYieldSkeleton();

      // Race the read against an idle watchdog. A half-open socket never
      // resolves `reader.read()`, so without this the chat spins forever.
      // On stall we abort the reader and emit a VISIBLE error frame so the
      // UI degrades to error/retry — never an honest-empty silent end.
      const outcome = await readWithIdleWatchdog(reader, idleTimeoutMs);
      if (outcome.kind === 'stalled') {
        yield {
          event: STREAM_ERROR_EVENT,
          data: {
            reason: 'idle-timeout',
            idleTimeoutMs,
            message: 'stream stalled: no data received within the idle window',
          },
        };
        return;
      }
      if (outcome.kind === 'error') {
        yield {
          event: STREAM_ERROR_EVENT,
          data: { reason: 'read-failed', message: outcome.message },
        };
        return;
      }
      const { value, done } = outcome.result;
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const ev = parseSseBlock(block);
        if (!ev) continue;
        if (!sawContentful && isContentful(ev.event)) {
          sawContentful = true;
          reportTtft();
        }
        yield ev;
        if (ev.event === 'done') return;
      }
    }
  } finally {
    if (skeletonTimer !== null) clearTimeout(skeletonTimer);
    // If the stream ended with zero contentful events, still close out
    // TTFT measurement so callers always get exactly one reading.
    reportTtft();
  }
}

/** Outcome of a single watchdog-guarded read. */
type ReadOutcome =
  | { readonly kind: 'chunk'; readonly result: ReadableStreamReadResult<Uint8Array> }
  | { readonly kind: 'stalled' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Await one `reader.read()`, but bounded by an idle timer. When
 * `idleTimeoutMs` elapses before a chunk lands the reader is cancelled
 * (releasing the half-open socket) and `{ kind: 'stalled' }` is returned
 * so the caller can surface a visible error. A rejected read maps to
 * `{ kind: 'error' }`. `idleTimeoutMs <= 0` disables the watchdog.
 */
async function readWithIdleWatchdog(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadOutcome> {
  if (idleTimeoutMs <= 0) {
    try {
      return { kind: 'chunk', result: await reader.read() };
    } catch (error) {
      return { kind: 'error', message: errorMessage(error) };
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const idle = new Promise<'stalled'>((resolve) => {
    timer = setTimeout(() => resolve('stalled'), idleTimeoutMs);
  });

  try {
    const winner = await Promise.race([
      reader.read().then((result) => ({ result }) as const),
      idle.then(() => 'stalled' as const),
    ]);
    if (winner === 'stalled') {
      // Release the half-open socket so the read promise can settle and
      // the connection is not leaked.
      await reader.cancel('idle-timeout').catch(() => undefined);
      return { kind: 'stalled' };
    }
    return { kind: 'chunk', result: winner.result };
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'stream read failed';
}

function parseSseBlock(block: string): SseEvent | null {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:'))
      dataLines.push(line.slice('data:'.length).trim());
  }
  if (!event || dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: dataLines.join('\n') };
  }
}
