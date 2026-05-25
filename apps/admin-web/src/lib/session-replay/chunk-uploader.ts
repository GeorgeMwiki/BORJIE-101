/**
 * Chunk uploader for the rrweb session-replay recorder.
 *
 * Buffers chunks in-memory, POSTs them to the api-gateway, and retries
 * with exponential backoff on transient failure. The uploader has two
 * delivery modes:
 *
 *   - `flush()`           — normal periodic flush (30s cadence in the
 *                           recorder); uses `fetch` with retries.
 *   - `flushOnUnload()`   — tab-close path; uses `navigator.sendBeacon`
 *                           so the browser commits the request even as
 *                           the page is being torn down. No retries
 *                           (the page is gone).
 *
 * Hard rules:
 *   - The uploader caps in-memory buffer at MAX_BUFFER_BYTES so a flaky
 *     network cannot OOM the tab. Over-cap chunks are dropped (oldest
 *     first) with a warn-level console message.
 *   - Failed chunks older than MAX_AGE_MS are dropped on the next
 *     flush — the brain learns from yesterday's traces; replay is for
 *     the last few minutes of an active session.
 *   - PII masking is the recorder's job (rrweb's `maskAllInputs` +
 *     `pii-mask.ts`). The uploader stores opaque bytes.
 *
 * The uploader is constructor-injectable so unit tests can replace
 * `fetch` and the system clock.
 */

import { scrubPiiPatterns } from './pii-mask.js';

/** A buffered chunk. The recorder hands these in; the uploader holds
 *  them until a successful POST. */
export interface SessionReplayChunk {
  readonly sessionId: string;
  readonly sequenceNumber: number;
  readonly capturedAt: string;
  readonly eventCount: number;
  /** rrweb events. Stored as JSON strings to skip the JSON.stringify
   *  cost on retry. PII has already been scrubbed by the recorder. */
  readonly eventsJson: string;
  /** Optional surface — defaults to admin-web. */
  readonly surface?: string;
}

export interface ChunkUploaderConfig {
  readonly endpoint: string;
  readonly authToken?: string | (() => string | null);
  readonly maxRetries?: number;
  readonly maxBufferBytes?: number;
  readonly maxAgeMs?: number;
  readonly clock?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly sendBeacon?: (url: string, data: BodyInit) => boolean;
  readonly logger?: (level: 'warn' | 'error', msg: string, extra?: unknown) => void;
}

export interface ChunkUploaderStats {
  readonly bufferedChunks: number;
  readonly bufferedBytes: number;
  readonly droppedChunks: number;
  readonly failedFlushAttempts: number;
  readonly successfulUploads: number;
}

export interface ChunkUploader {
  enqueue(chunk: SessionReplayChunk): void;
  flush(): Promise<void>;
  flushOnUnload(): boolean;
  getStats(): ChunkUploaderStats;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024; // 4MB
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 5_000;

interface InternalChunk extends SessionReplayChunk {
  readonly enqueuedAt: number;
  readonly bytes: number;
}

export function createChunkUploader(
  config: ChunkUploaderConfig,
): ChunkUploader {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const maxBufferBytes = config.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const clock = config.clock ?? Date.now;
  const fetchImpl =
    config.fetchImpl ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  const sendBeacon =
    config.sendBeacon ??
    (typeof navigator !== 'undefined' &&
    typeof navigator.sendBeacon === 'function'
      ? navigator.sendBeacon.bind(navigator)
      : null);
  const logger =
    config.logger ??
    ((level, msg, extra) => {
      const fn = level === 'error' ? console.error : console.warn;
      if (extra !== undefined) fn(`[session-replay] ${msg}`, extra);
      else fn(`[session-replay] ${msg}`);
    });

  const buffer: InternalChunk[] = [];
  let droppedChunks = 0;
  let failedFlushAttempts = 0;
  let successfulUploads = 0;
  let flushing = false;

  function pruneAged(): void {
    const cutoff = clock() - maxAgeMs;
    for (let i = buffer.length - 1; i >= 0; i -= 1) {
      // eslint-disable-next-line security/detect-object-injection -- numeric loop counter bounded by buffer.length
      const c = buffer[i];
      if (c && c.enqueuedAt < cutoff) {
        buffer.splice(i, 1);
        droppedChunks += 1;
      }
    }
  }

  function currentBufferBytes(): number {
    let total = 0;
    for (const c of buffer) total += c.bytes;
    return total;
  }

  function evictUntilUnderCap(): void {
    while (buffer.length > 0 && currentBufferBytes() > maxBufferBytes) {
      buffer.shift();
      droppedChunks += 1;
    }
  }

  function resolveAuthHeader(): string | null {
    const tok = config.authToken;
    if (!tok) return null;
    if (typeof tok === 'function') {
      try {
        const value = tok();
        return value ? `Bearer ${value}` : null;
      } catch {
        return null;
      }
    }
    return `Bearer ${tok}`;
  }

  function toRequestBody(c: InternalChunk): string {
    // The wire format mirrors the api-gateway's PostChunkBodySchema.
    // The recorder has already scrubbed PII; we re-run the regex
    // patterns over the JSON payload as defence-in-depth.
    const eventsBase64 = base64Encode(scrubPiiPatterns(c.eventsJson));
    return JSON.stringify({
      sessionId: c.sessionId,
      surface: c.surface ?? 'admin-web',
      sequenceNumber: c.sequenceNumber,
      eventCount: c.eventCount,
      capturedAt: c.capturedAt,
      eventsGzipBase64: eventsBase64,
    });
  }

  async function postChunk(c: InternalChunk): Promise<boolean> {
    if (!fetchImpl) return false;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const auth = resolveAuthHeader();
    if (auth) headers.Authorization = auth;

    let attempt = 0;
    let backoff = BASE_BACKOFF_MS;
    while (attempt < maxRetries) {
      attempt += 1;
      try {
        const res = await fetchImpl(config.endpoint, {
          method: 'POST',
          headers,
          body: toRequestBody(c),
          credentials: 'include',
          keepalive: true,
        });
        if (res.ok || res.status === 200) {
          successfulUploads += 1;
          return true;
        }
        // 4xx (except 408 / 429) is fatal — the chunk is malformed or
        // the server rejected it. No point retrying.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          logger('warn', `chunk rejected (${res.status}); dropping`, {
            sessionId: c.sessionId,
            sequenceNumber: c.sequenceNumber,
          });
          return true; // treat as "handled" so we stop retrying
        }
      } catch (error) {
        logger('warn', 'chunk POST threw', {
          err: error instanceof Error ? error.message : String(error),
          attempt,
        });
      }
      failedFlushAttempts += 1;
      if (attempt < maxRetries) {
        await wait(backoff);
        backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
      }
    }
    return false;
  }

  return {
    enqueue(chunk) {
      const eventsJson = chunk.eventsJson ?? '';
      const bytes = utf8Bytes(eventsJson);
      const internal: InternalChunk = {
        ...chunk,
        eventsJson,
        enqueuedAt: clock(),
        bytes,
      };
      buffer.push(internal);
      evictUntilUnderCap();
    },

    async flush() {
      if (flushing) return;
      flushing = true;
      try {
        pruneAged();
        // Take a snapshot — newly enqueued chunks during this flush
        // wait for the next call.
        const snapshot = buffer.splice(0, buffer.length);
        for (const c of snapshot) {
          const ok = await postChunk(c);
          if (!ok) {
            // Re-queue at the head so order is preserved on next flush.
            buffer.unshift(c);
            evictUntilUnderCap();
          }
        }
      } finally {
        flushing = false;
      }
    },

    flushOnUnload() {
      if (!sendBeacon) return false;
      if (buffer.length === 0) return true;
      // sendBeacon takes one BodyInit per call; serialise each chunk
      // separately so a single oversized chunk does not block the rest.
      let ok = true;
      while (buffer.length > 0) {
        const c = buffer.shift();
        if (!c) break;
        try {
          const body = toRequestBody(c);
          const result = sendBeacon(
            config.endpoint,
            new Blob([body], { type: 'application/json' }),
          );
          if (!result) ok = false;
          else successfulUploads += 1;
        } catch {
          ok = false;
        }
      }
      return ok;
    },

    getStats() {
      return {
        bufferedChunks: buffer.length,
        bufferedBytes: currentBufferBytes(),
        droppedChunks,
        failedFlushAttempts,
        successfulUploads,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function utf8Bytes(s: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).byteLength;
  }
  return s.length;
}

/**
 * Base64-encode a UTF-8 string. We deliberately do NOT gzip in the
 * client — gzip in pure JS is expensive and the wire format permits a
 * non-compressed base64 payload (the server stores opaque bytes). When
 * `CompressionStream` is widely available the recorder can swap in a
 * real gzip pass; until then base64 of the JSON is honest and cheap.
 */
function base64Encode(input: string): string {
  if (typeof btoa === 'function') {
    // btoa requires latin1; encode UTF-8 → bytes → latin1 first.
    if (typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(input);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    }
    return btoa(input);
  }
  // Node fallback for the test runner.
  const Buf = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (Buf) return Buf.from(input, 'utf8').toString('base64');
  return input;
}
