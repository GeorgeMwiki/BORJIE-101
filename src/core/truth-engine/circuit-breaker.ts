/**
 * Circuit Breaker for evidence-collector fetches
 *
 * RELATIONSHIP TO CANONICAL BREAKER
 * ---------------------------------
 * The canonical project breaker lives at
 * `src/core/risk-mitigation/circuit-breaker.ts` and exposes a class-based
 * `CircuitBreaker` keyed by service-name with a config shape that includes
 * `successThreshold`, `volumeThreshold`, `errorThresholdPercentage`,
 * `resetTimeout`, and `rollingWindowSize`.
 *
 * This module deliberately exposes a different paradigm:
 *   - functional (canAttempt / recordSuccess / recordFailure / withBreaker)
 *   - URL-host keyed (breakerKeyForUrl)
 *   - sliding-window failures + half_open probe count
 *
 * Reason for divergence: the evidence-collector loop fans out many
 * URL-keyed fetches per request and wants a stateless functional surface
 * (no per-host class instantiation) that can be threaded through
 * server-side rendering and worker contexts without lifecycle juggling.
 * Consolidating into the canonical class would force a class-per-host
 * registry and re-shape the call sites; the trade-off is judged not worth
 * it. Lower-level config primitives (failure threshold, cooldown) are
 * conceptually mirrored.
 *
 * Three states per (domain, key):
 *   - closed   — calls flow normally, failures counted in a sliding window.
 *   - open     — calls short-circuit immediately for `cooldownMs`.
 *   - half_open — after cooldown, allows one probe; success closes, fail re-opens.
 *
 * In-process state map; on serverless this resets per-instance which is fine
 * because the breaker's job is to protect a SINGLE warm instance from
 * repeatedly slamming a dead origin in tight loops. Cross-instance protection
 * is the job of the upstream rate-limit + cron schedule.
 */

// Share the canonical CircuitState union so type vocabulary stays consistent
// across all three breaker variants. The functional API below maps onto these
// states via a lowercase alias kept for backward compatibility with the
// existing evidence-collector call sites.
export type { CircuitState } from "@/core/risk-mitigation/types";

interface BreakerState {
  status: "closed" | "open" | "half_open";
  failures: number[]; // timestamps of recent failures (sliding window)
  openedAt: number | null;
  consecutiveSuccesses: number;
}

interface BreakerConfig {
  readonly failureThreshold: number; // e.g. 5 failures within window
  readonly windowMs: number; // sliding window for failure count
  readonly cooldownMs: number; // how long to stay open before half_open
  readonly halfOpenMaxCalls: number; // how many probes allowed in half_open
}

const DEFAULT_CONFIG: BreakerConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 120_000,
  halfOpenMaxCalls: 1,
};

const breakerState = new Map<string, BreakerState>();

function getState(key: string): BreakerState {
  const existing = breakerState.get(key);
  if (existing) return existing;
  const fresh: BreakerState = {
    status: "closed",
    failures: [],
    openedAt: null,
    consecutiveSuccesses: 0,
  };
  breakerState.set(key, fresh);
  return fresh;
}

/**
 * Returns true iff the breaker is currently allowing calls.
 * Mutates state for half_open transitions.
 */
export function canAttempt(
  key: string,
  config: BreakerConfig = DEFAULT_CONFIG,
): boolean {
  const state = getState(key);
  const now = Date.now();

  if (state.status === "closed") return true;

  if (state.status === "open") {
    if (state.openedAt && now - state.openedAt >= config.cooldownMs) {
      // Transition to half_open — record immutably (replace state)
      breakerState.set(key, {
        ...state,
        status: "half_open",
        consecutiveSuccesses: 0,
      });
      return true;
    }
    return false;
  }

  // half_open — only allow halfOpenMaxCalls before forcing closed/open
  return state.consecutiveSuccesses < config.halfOpenMaxCalls;
}

/**
 * Record a successful call. In half_open, success closes the breaker.
 */
export function recordSuccess(key: string): void {
  const state = getState(key);
  if (state.status === "half_open") {
    breakerState.set(key, {
      status: "closed",
      failures: [],
      openedAt: null,
      consecutiveSuccesses: 0,
    });
    return;
  }
  // Trim sliding window on success too, so old failures age out
  const now = Date.now();
  breakerState.set(key, {
    ...state,
    failures: state.failures.filter((t) => now - t < DEFAULT_CONFIG.windowMs),
  });
}

/**
 * Record a failed call. Opens the breaker if threshold reached.
 */
export function recordFailure(
  key: string,
  config: BreakerConfig = DEFAULT_CONFIG,
): void {
  const state = getState(key);
  const now = Date.now();
  const recent = [...state.failures, now].filter(
    (t) => now - t < config.windowMs,
  );

  if (
    state.status === "half_open" ||
    recent.length >= config.failureThreshold
  ) {
    breakerState.set(key, {
      status: "open",
      failures: recent,
      openedAt: now,
      consecutiveSuccesses: 0,
    });
    return;
  }

  breakerState.set(key, {
    ...state,
    failures: recent,
  });
}

/**
 * Force the breaker closed (test harness / admin recovery).
 */
export function resetBreaker(key: string): void {
  breakerState.delete(key);
}

/**
 * Resolve breaker key from URL hostname. Same host shares a single breaker so
 * a flaky bot.go.tz doesn't drag down demo-bank.test, but multiple paths on the
 * same host coalesce sensibly.
 */
export function breakerKeyForUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "invalid_url";
  }
}

/**
 * Wrap a fetch-style operation with the breaker. Throws if the breaker is open.
 * On error, records failure; on success, records success. Either way, it
 * mirrors the underlying call result (success or thrown error).
 */
export async function withBreaker<T>(
  key: string,
  op: () => Promise<T>,
  config: BreakerConfig = DEFAULT_CONFIG,
): Promise<T> {
  if (!canAttempt(key, config)) {
    throw new Error(`circuit_breaker_open:${key}`);
  }
  try {
    const result = await op();
    recordSuccess(key);
    return result;
  } catch (err) {
    recordFailure(key, config);
    throw err;
  }
}
