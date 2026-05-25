/**
 * Shared provider runtime helpers.
 *
 * Real provider implementations need three things in common:
 *   1. A way to read API keys lazily from `process.env` (so tests can boot the
 *      router without keys, and so a missing key flips us back to stub mode
 *      without crashing the import).
 *   2. An async queue that bridges callback-based upstream APIs (WebSocket
 *      `message` events, fetch-streaming readers) into the AsyncIterable
 *      contract our `SttSessionHandle` / `TtsSessionHandle` expose.
 *   3. A fetch wrapper that honours `AbortSignal` and per-call timeouts, never
 *      throws on non-2xx (returns a tagged error instead per the task spec),
 *      and never logs the bearer key.
 *
 * Keep this file dependency-free — only `node:*` builtins. Provider files
 * remain ~200 lines each.
 */
import { logger } from '../logger.js';
/* eslint-disable no-console */

import { setTimeout as delay, clearTimeout as clearDelay } from 'node:timers';
import { assertUrlSafe } from '@borjie/enterprise-hardening';

/**
 * Read an environment variable lazily. Returns `undefined` (not empty string)
 * when missing or blank so callers can use `??` to fall back to stub behaviour.
 *
 * Lazy reads matter: tests boot the router without keys, and we don't want
 * import-time crashes the moment the provider file is required.
 */
export function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Truthy iff `LIVE_PROVIDER_TESTS` is set — gates any integration test that
 * would actually hit the network. The unit-test suite must stay green even
 * with this flag unset.
 */
export function liveProviderTestsEnabled(): boolean {
  return readEnv('LIVE_PROVIDER_TESTS') === 'true';
}

/**
 * Minimal async queue that lets a producer (WebSocket `onmessage`, streaming
 * fetch reader) push values into a single consumer iterating with `for await`.
 *
 * Semantics:
 *   - `push(value)` enqueues; if a consumer is currently awaiting `next()`
 *     the value is delivered immediately.
 *   - `close()` signals end-of-stream — any waiting consumer resolves with
 *     `{ done: true }`, subsequent `next()` calls also return done.
 *   - `fail(err)` propagates an error to the consumer's next `next()` call.
 *
 * This is single-consumer by design. Multiple iterators against the same
 * session is out of scope for the voice pipeline (a session has one caller).
 */
export class AsyncQueue<T> {
  private readonly buffer: T[] = [];
  private pendingResolve: ((value: IteratorResult<T>) => void) | null = null;
  private pendingReject: ((reason: unknown) => void) | null = null;
  private closed = false;
  private error: unknown = null;

  push(value: T): void {
    if (this.closed) return;
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve({ value, done: false });
      return;
    }
    this.buffer.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.error = error;
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;
      this.closed = true;
      reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          const value = this.buffer.shift() as T;
          return Promise.resolve({ value, done: false });
        }
        if (this.error !== null) {
          const err = this.error;
          this.error = null;
          this.closed = true;
          return Promise.reject(err);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.pendingResolve = resolve;
          this.pendingReject = reject;
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.close();
        return Promise.resolve({ value: undefined as unknown as T, done: true });
      },
    };
  }
}

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Timeout in ms. Caller is responsible for sensible defaults (5s STT, 30s TTS). */
  readonly timeoutMs: number;
  /** Optional external signal — composed with the internal timeout signal. */
  readonly externalSignal?: AbortSignal | undefined;
}

/**
 * Result of a fetch call. We intentionally do NOT throw on non-2xx so callers
 * can surface the upstream error as a provider error frame (per task spec).
 */
export type FetchResult =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly status: number; readonly bodyText: string; readonly providerError: string };

/**
 * fetch wrapper that:
 *   - composes a timeout AbortSignal with the caller's external signal
 *   - never logs Authorization / x-api-key headers
 *   - returns a tagged error object instead of throwing on non-2xx
 *
 * Network errors (DNS, ECONNREFUSED, AbortError) still throw — those are bugs
 * the caller's catch block should handle. The non-throw-on-non-2xx contract
 * applies only to "the server returned a response we don't like".
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions,
): Promise<FetchResult> {
  const { timeoutMs, externalSignal, ...init } = options;

  // SSRF guard — every outbound provider call (OpenAI, ElevenLabs,
  // Lelapa, Cartesia, …) is screened by the central
  // `assertUrlSafe` policy before we open the socket. Closes the
  // tenant-influenced-URL gap surfaced by audit-ssrf-coverage.
  // Vendor hosts are compile-time; the assertion still runs to catch
  // accidental introduction of a tenant-supplied URL upstream.
  try {
    await assertUrlSafe(url);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      bodyText: '',
      providerError: `safeFetch refused outbound URL: ${detail}`,
    };
  }

  const controller = new AbortController();
  const timer = delay(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  const onExternalAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearDelay(timer);
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      // Drain the body once for diagnostics. Cap to 2 KB so a 5 MB upstream
      // error page doesn't blow up our logs / response payload.
      let bodyText = '';
      try {
        const text = await response.text();
        bodyText = text.length > 2048 ? `${text.slice(0, 2048)}…[truncated]` : text;
      } catch {
        bodyText = '<unreadable body>';
      }
      return {
        ok: false,
        status: response.status,
        bodyText,
        providerError: `upstream ${response.status}: ${response.statusText}`,
      };
    }
    return { ok: true, response };
  } finally {
    clearDelay(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/** Default per-call timeouts. Exported so providers / tests can override. */
export const DEFAULT_STT_CHUNK_TIMEOUT_MS = 5_000;
export const DEFAULT_TTS_TOTAL_TIMEOUT_MS = 30_000;

/**
 * Compose user `AbortSignal` with our own internal one, so providers can
 * abort everything in `close()` while still respecting the caller's external
 * cancellation request.
 */
export function composeSignals(...signals: ReadonlyArray<AbortSignal | undefined>): AbortController {
  const controller = new AbortController();
  for (const sig of signals) {
    if (!sig) continue;
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller;
    }
    sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
  }
  return controller;
}

/**
 * Warn once per `key` — used to flag stub providers when they are invoked in
 * real mode. The Map-based cache prevents log spam in long-running services.
 */
const warnedKeys = new Set<string>();
export function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  logger.warn('value', { value: message });
}
