/**
 * Race a promise against an AbortSignal — LLM-interrupt wrapper (LP-21b).
 *
 * Ported from LITFIN `src/core/heartbeat/sleep-passes/race-against-abort.ts`
 * and re-skinned for Borjie's sleep-pass-orchestrator.
 *
 * WHY THIS EXISTS
 * ---------------
 * Each sleep pass receives an `abortSignal` and is expected to check
 * `abortSignal.aborted` between expensive steps. But a single long-running
 * awaited call — a `brainCall` to an LLM, a slow Postgres `REINDEX`, a
 * GraphRAG community summarisation — does NOT observe the signal while it
 * is in flight. A 60s model call therefore keeps the pass worker blocked
 * past its `maxDurationMs` budget, starving every later pass in the tick.
 *
 * `raceAgainstAbort` lets the worker stop *waiting* on that call the moment
 * the signal fires (the server-side request may still complete, but our
 * loop bails immediately). When the downstream client natively accepts an
 * `AbortSignal`, callers can pass it through and drop this wrapper.
 *
 * LEAK-FREE LISTENER CLEANUP
 * --------------------------
 * The abort listener is removed in BOTH settle branches (resolve and
 * reject) so we never leak an `addEventListener` handler on a long-lived
 * AbortSignal — e.g. one shared across many candidates in a single pass
 * run. A `settled` latch guarantees the promise settles exactly once even
 * if abort and the underlying promise race to the same microtask.
 *
 * @module race-against-abort
 */

/**
 * Resolve `p` unless `signal` aborts first.
 *
 * - No signal → pass-through (`p` returned unchanged).
 * - Already-aborted signal → reject immediately WITHOUT awaiting `p`.
 * - Late abort → reject at abort time with an `AbortError`-tagged Error.
 * - `p` settles first → forward its value/error; remove the listener.
 */
export function raceAgainstAbort<T>(
  signal: AbortSignal | undefined,
  p: Promise<T>,
): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) {
    return Promise.reject(
      Object.assign(new Error(ABORT_REASONS.BEFORE_START), {
        name: 'AbortError',
      }),
    );
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(
        Object.assign(new Error(ABORT_REASONS.DURING_RUN), {
          name: 'AbortError',
        }),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Message tags an abort-triggered rejection carries, so callers can tell an
 * abort apart from a genuine downstream error. Compare `err.name ===
 * 'AbortError'` AND/OR match one of these messages.
 */
export const ABORT_REASONS = Object.freeze({
  BEFORE_START: 'Aborted before start',
  DURING_RUN: 'Sleep pass budget elapsed',
} as const);

/** True when `err` is an abort-triggered rejection from {@link raceAgainstAbort}. */
export function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  return (
    err.message === ABORT_REASONS.BEFORE_START ||
    err.message === ABORT_REASONS.DURING_RUN
  );
}
