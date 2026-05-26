/**
 * Session replay recorder — wraps `rrweb-record` so the client emits
 * chunked, PII-masked event batches.
 *
 * Sampling config (PostHog convergence + R4 brain-as-OS doc):
 *   - mousemove           ≈20Hz (rrweb default; 50ms interval)
 *   - scroll              200ms throttle
 *   - input               default (per-keystroke, but values masked)
 *   - PII masking         `maskAllInputs: true` + custom selector list
 *                         (`pii-mask.ts`) so anything tagged `data-pii`
 *                         or known sensitive type is dotted-out at
 *                         capture time. The raw value never enters the
 *                         in-memory buffer.
 *
 * Cadence:
 *   - Periodic flush every 30s (the recorder hands a chunk to the
 *     uploader; the uploader handles network retries).
 *   - On `visibilitychange === 'hidden'` and `pagehide` we call the
 *     uploader's `flushOnUnload()` which uses `navigator.sendBeacon`.
 *
 * Hard rules:
 *   - The recorder NEVER feeds events to the LLM context. The
 *     sensorium 14-event taxonomy (separate library) is the only thing
 *     the brain reads at LLM-prompt-assembly time.
 *   - rrweb is a runtime dependency added to package.json but not yet
 *     `pnpm install`-ed in this wave. The recorder dynamically imports
 *     `rrweb` so the module is tree-shake / SSR-safe; when the dep is
 *     missing, `start()` resolves to a no-op stopper.
 */

import type { ChunkUploader, SessionReplayChunk } from './chunk-uploader.js';
import { buildDefaultMaskConfig, scrubPiiPatterns } from './pii-mask.js';

export interface RecorderConfig {
  readonly sessionId: string;
  readonly uploader: ChunkUploader;
  readonly surface?: string;
  /** Flush cadence. Defaults to 30 000 ms. */
  readonly flushIntervalMs?: number;
  /** Hook for tests — bypass rrweb's actual recorder. */
  readonly rrwebFactory?: RrwebRecordFactory;
  readonly clock?: () => number;
  readonly logger?: (level: 'warn' | 'error', msg: string, extra?: unknown) => void;
}

export interface RecorderHandle {
  /** Stop recording, flush remaining events, detach DOM listeners. */
  stop(): Promise<void>;
  /** Force a flush of buffered events. Returns the number of chunks
   *  handed to the uploader. */
  forceFlush(): number;
  /** Number of events held in the in-progress buffer. */
  pendingEventCount(): number;
}

/** Duck-typed rrweb event — we only read enough fields to count + ship. */
export interface RrwebEvent {
  readonly type: number;
  readonly timestamp: number;
  readonly data?: unknown;
}

export type RrwebRecordStopper = () => void;

export interface RrwebRecordOptions {
  readonly emit: (event: RrwebEvent) => void;
  readonly maskAllInputs: boolean;
  readonly maskTextSelector?: string;
  readonly sampling?: Record<string, unknown>;
  readonly maskInputFn?: (text: string) => string;
  readonly maskTextFn?: (text: string) => string;
}

export type RrwebRecordFactory = (
  options: RrwebRecordOptions,
) => RrwebRecordStopper | null | undefined;

const DEFAULT_FLUSH_INTERVAL_MS = 30_000;

/**
 * Async start — the rrweb import is dynamic so this file can be
 * imported in an SSR-only build path without crashing. When rrweb is
 * not installed the recorder still ships an inert handle (stop/no-op).
 */
export async function startSessionReplayRecorder(
  config: RecorderConfig,
): Promise<RecorderHandle> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return inertHandle();
  }

  const flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const clock = config.clock ?? Date.now;
  const logger =
    config.logger ??
    ((level, msg, extra) => {
      const fn = level === 'error' ? console.error : console.warn;
      if (extra !== undefined) fn(`[session-replay] ${msg}`, extra);
      else fn(`[session-replay] ${msg}`);
    });
  const mask = buildDefaultMaskConfig();

  // In-progress buffer. We close it into a chunk + reset on every
  // flush.
  let buffer: RrwebEvent[] = [];
  let sequenceNumber = 0;

  function handleEvent(event: RrwebEvent): void {
    if (!event || typeof event.type !== 'number') return;
    buffer.push(event);
  }

  const recordFactory = config.rrwebFactory ?? (await loadRrwebFactory());
  let stopFn: RrwebRecordStopper | null = null;
  if (recordFactory) {
    try {
      stopFn =
        recordFactory({
          emit: handleEvent,
          maskAllInputs: mask.maskAllInputs,
          maskTextSelector: mask.maskTextSelector,
          ...(mask.maskInputFn !== undefined ? { maskInputFn: mask.maskInputFn } : {}),
          ...(mask.maskTextFn !== undefined ? { maskTextFn: mask.maskTextFn } : {}),
          sampling: {
            // rrweb defaults; expressed explicitly so future contributors
            // do not need to read the rrweb docs to understand the rates.
            mousemove: 50,
            scroll: 200,
            media: 800,
            input: 'last',
          },
        }) ?? null;
    } catch (error) {
      logger('error', 'rrweb.record failed to start', error);
    }
  } else {
    logger('warn', 'rrweb dependency missing — recorder is inert');
  }

  function buildChunk(): SessionReplayChunk | null {
    if (buffer.length === 0) return null;
    const events = buffer;
    buffer = [];
    const eventsJson = scrubPiiPatterns(JSON.stringify(events));
    const seq = sequenceNumber;
    sequenceNumber += 1;
    return {
      sessionId: config.sessionId,
      sequenceNumber: seq,
      capturedAt: new Date(clock()).toISOString(),
      eventCount: events.length,
      eventsJson,
      surface: config.surface ?? 'admin-web',
    };
  }

  function flushBufferToUploader(): number {
    const chunk = buildChunk();
    if (!chunk) return 0;
    config.uploader.enqueue(chunk);
    void config.uploader.flush();
    return 1;
  }

  const intervalHandle = setInterval(() => {
    flushBufferToUploader();
  }, flushIntervalMs);

  function onVisibility(): void {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      flushBufferToUploader();
      config.uploader.flushOnUnload();
    }
  }
  function onPageHide(): void {
    flushBufferToUploader();
    config.uploader.flushOnUnload();
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
  }

  return {
    async stop() {
      try {
        if (stopFn) stopFn();
      } catch (error) {
        logger('warn', 'rrweb stopper threw', error);
      }
      clearInterval(intervalHandle);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide);
      }
      flushBufferToUploader();
      try {
        await config.uploader.flush();
      } catch (error) {
        logger('warn', 'uploader.flush threw on stop', error);
      }
    },
    forceFlush: flushBufferToUploader,
    pendingEventCount: () => buffer.length,
  };
}

function inertHandle(): RecorderHandle {
  return {
    async stop() {
      /* no-op */
    },
    forceFlush: () => 0,
    pendingEventCount: () => 0,
  };
}

async function loadRrwebFactory(): Promise<RrwebRecordFactory | null> {
  // Indirect import via a string variable so Vite / Vitest do NOT
  // statically resolve the module at transform time. The dep is
  // declared in package.json but not yet installed; the dynamic path
  // keeps tests + SSR working without a hard import.
  const moduleId = 'rrweb';
  try {
    // @ts-ignore — runtime-only dep; absence is expected.
    const mod = (await import(/* @vite-ignore */ moduleId)) as {
      record?: (opts: unknown) => RrwebRecordStopper;
    };
    const record = mod?.record;
    if (typeof record !== 'function') return null;
    return ((options: RrwebRecordOptions) =>
      record(options)) as RrwebRecordFactory;
  } catch {
    return null;
  }
}
