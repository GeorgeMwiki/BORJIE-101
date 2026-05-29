/**
 * Exponential-backoff retry helper for the SDK.
 *
 * Used by every idempotent call (GET, plus POSTs that carry an
 * `Idempotency-Key` so the server can safely dedupe a re-delivery).
 * Default schedule: 3 attempts with 200ms / 800ms / 3.2s delays — the
 * Borjie webhook contract uses the same shape, so callers see uniform
 * behaviour across SDK + webhook receivers.
 *
 * Caller passes a `shouldRetry` predicate so the policy can be
 * fine-tuned per call site (e.g. only retry on 5xx / 429 / network).
 * Defaults match the typical "transient" set.
 */

export interface RetryOptions {
  /** Total attempts (initial + retries). Default 3. */
  readonly attempts?: number;
  /** Delays in ms between attempts. Default [200, 800, 3200]. */
  readonly delaysMs?: readonly number[];
  /** Predicate; receives the error + 1-based attempt number. */
  readonly shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional clock override for tests. */
  readonly sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_DELAYS = Object.freeze([200, 800, 3200]);

const DEFAULT_TRANSIENT_STATUSES = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

export function defaultShouldRetry(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; code?: unknown };
  if (typeof e.status === 'number' && DEFAULT_TRANSIENT_STATUSES.has(e.status)) return true;
  if (typeof e.code === 'string') {
    if (e.code === 'NETWORK_ERROR') return true;
    if (e.code === 'RATE_LIMITED') return true;
  }
  return false;
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delays = opts.delaysMs ?? DEFAULT_DELAYS;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  const sleep =
    opts.sleepFn ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts) break;
      if (!shouldRetry(err, attempt)) break;
      const delay = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0;
      if (delay > 0) await sleep(delay);
    }
  }
  throw lastErr;
}
