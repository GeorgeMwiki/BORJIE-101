/**
 * Retry policy for the legacy-portal driver loop.
 *
 * SOTA grounding (Browser-use / WebVoyager / AutoGPT loop discipline):
 * a robust web-driving agent must distinguish TRANSIENT faults (network
 * blips, page-load timeouts) — which warrant a bounded retry with
 * exponential backoff — from FATAL faults (a control genuinely isn't on
 * the page) — which must fail immediately so the orchestrator can
 * re-plan rather than hammer a dead step.
 *
 * The whole point of this module is to NEVER bare-throw. `retryAction`
 * always resolves to the final {@link ActionResult}; a thrown error from
 * the wrapped action is itself classified and surfaced as a structured
 * `ok:false` result with a `reason`, never propagated to the caller.
 */

import type { ActionResult } from './legacy-portal-driver.js';

/**
 * Substrings that mark a fault as TRANSIENT (worth retrying). Matched
 * case-insensitively against the error message / result `reason`.
 */
export const TRANSIENT_DRIVER_ERRORS: ReadonlyArray<string> = Object.freeze([
  'timeout',
  'timed out',
  'network',
  'navigation',
  'detached',
  'econnrefused',
  'econnreset',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'socket hang up',
  'page-load',
]);

/**
 * `reason` codes that are PERMANENT by construction — re-driving them is
 * pointless (the control isn't on the page, the page is asking for human
 * intervention, etc.). These short-circuit the retry loop.
 */
export const FATAL_DRIVER_REASONS: ReadonlyArray<string> = Object.freeze([
  'control-not-found',
  'control-ambiguous',
  'getByRole-unavailable',
  'unknown-verb',
  'captcha-required',
  'mfa-required',
  'session-expired-after-login',
]);

export interface RetryPolicy {
  /** Total attempts (>=1). Default 3. */
  readonly maxAttempts: number;
  /** Base backoff in ms (exponential: base * 2^(attempt-1)). Default 100. */
  readonly backoffBaseMs: number;
  /** Hard ceiling on a single backoff sleep. Default 4000. */
  readonly backoffCapMs: number;
  /** Classifier: is this fault transient (retryable)? */
  readonly isTransient: (reason: string | undefined) => boolean;
}

/**
 * Default classifier. A fault is transient when its reason is NOT an
 * explicit fatal code AND it matches a known transient substring. An
 * UNKNOWN reason (e.g. a raw Playwright message we don't recognise) is
 * treated as transient ONCE so a flaky portal gets a second chance,
 * but the bounded `maxAttempts` still caps the blast radius.
 */
export function defaultIsTransient(reason: string | undefined): boolean {
  if (reason === undefined || reason === '') return true;
  const lower = reason.toLowerCase();
  if (FATAL_DRIVER_REASONS.some((code) => lower.includes(code))) {
    return false;
  }
  if (TRANSIENT_DRIVER_ERRORS.some((sub) => lower.includes(sub))) {
    return true;
  }
  // Unknown, non-fatal reason → give the portal one more shot.
  return true;
}

export const DEFAULT_DRIVER_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  backoffBaseMs: 100,
  backoffCapMs: 4000,
  isTransient: defaultIsTransient,
});

/** Injectable sleeper so tests run instantly. */
export type Sleeper = (ms: number) => Promise<void>;

const realSleep: Sleeper = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Compute the exponential backoff for a 1-based attempt index. */
export function backoffForAttempt(attempt: number, policy: RetryPolicy): number {
  const raw = policy.backoffBaseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(raw, policy.backoffCapMs);
}

export interface RetryActionOptions {
  readonly policy?: RetryPolicy;
  /** Injectable sleeper (tests pass an instant no-op). */
  readonly sleep?: Sleeper;
  /** Per-attempt observer for structured logging. */
  readonly onAttempt?: (info: {
    readonly attempt: number;
    readonly ok: boolean;
    readonly reason?: string;
    readonly transient: boolean;
    readonly willRetry: boolean;
  }) => void;
}

/**
 * Run `action` under a bounded retry policy. NEVER throws:
 *   - a successful result short-circuits and returns immediately;
 *   - a transient `ok:false` (or a thrown transient error) is retried
 *     with exponential backoff up to `maxAttempts`;
 *   - a fatal `ok:false` (e.g. `control-not-found`) returns at once;
 *   - if every attempt is exhausted, the LAST result is returned with
 *     its `reason` rewritten to `max-retries-exhausted` carrying the
 *     underlying cause, so the orchestrator sees a structured reason —
 *     not a stack trace.
 *
 * A thrown error inside `action` is caught and converted to a synthetic
 * `ActionResult` so even an unexpected exception surfaces structurally.
 */
export async function retryAction(
  action: () => Promise<ActionResult>,
  options: RetryActionOptions = {},
): Promise<ActionResult> {
  const policy = options.policy ?? DEFAULT_DRIVER_RETRY_POLICY;
  const sleep = options.sleep ?? realSleep;
  const attempts = Math.max(1, policy.maxAttempts);

  let last: ActionResult | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let result: ActionResult;
    try {
      result = await action();
    } catch (err) {
      // A thrown error becomes a synthetic transient-by-default result;
      // the classifier decides whether it is actually retryable.
      const message = err instanceof Error ? err.message : String(err);
      result = {
        ok: false,
        verb: last?.verb ?? 'click',
        reason: message,
        postActionSnapshot: last?.postActionSnapshot ?? {
          capturedAt: new Date().toISOString(),
          nodeCount: 0,
          truncated: false,
          root: null,
        },
        diff: last?.diff ?? {
          added: [],
          removed: [],
          changed: [],
          identical: true,
        },
      };
    }

    last = result;

    if (result.ok) {
      options.onAttempt?.({
        attempt,
        ok: true,
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        transient: false,
        willRetry: false,
      });
      return result;
    }

    const transient = policy.isTransient(result.reason);
    const willRetry = transient && attempt < attempts;

    options.onAttempt?.({
      attempt,
      ok: false,
      ...(result.reason !== undefined ? { reason: result.reason } : {}),
      transient,
      willRetry,
    });

    if (!willRetry) {
      // Fatal, or attempts exhausted — surface a structured reason.
      if (transient && attempt >= attempts) {
        return {
          ...result,
          reason: `max-retries-exhausted:${result.reason ?? 'unknown'}`,
        };
      }
      return result;
    }

    await sleep(backoffForAttempt(attempt, policy));
  }

  // Unreachable in practice (the loop always returns), but keep the
  // contract total: never throw, always return a structured result.
  return (
    last ?? {
      ok: false,
      verb: 'click',
      reason: 'max-retries-exhausted:no-attempt',
      postActionSnapshot: {
        capturedAt: new Date().toISOString(),
        nodeCount: 0,
        truncated: false,
        root: null,
      },
      diff: { added: [], removed: [], changed: [], identical: true },
    }
  );
}
