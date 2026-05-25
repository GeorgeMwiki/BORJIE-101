/**
 * Circuit breaker — per-provider failure tracking.
 *
 * Three states:
 *   closed   — healthy; requests flow through.
 *   open     — too many recent failures; requests short-circuit (skip
 *              this provider in the ladder iteration).
 *   half-open — cooldown elapsed; one trial request allowed; success
 *              -> closed, failure -> open again.
 *
 * Pure state machine — no I/O. Callers create one breaker per provider
 * (keyed on `ProviderName`) and ask `shouldAllow()` before each call.
 */

import type { ProviderHealth, ProviderName } from '../types.js';

export interface CircuitBreakerConfig {
  /** Consecutive failures to trip the breaker. Default 5. */
  readonly failureThreshold?: number;
  /** Cooldown before half-open trial (ms). Default 30_000. */
  readonly cooldownMs?: number;
  /** Injected clock for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | undefined;
  halfOpenTrialInFlight: boolean;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly states: Map<ProviderName, BreakerState> = new Map();

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.cooldownMs = config.cooldownMs ?? 30_000;
    this.now = config.now ?? Date.now;
  }

  /** Returns true if a request to `provider` should be allowed. */
  shouldAllow(provider: ProviderName): boolean {
    const state = this.getOrCreate(provider);
    if (state.openedAt === undefined) return true;

    // Check cooldown — if elapsed, move to half-open and allow one trial.
    const elapsed = this.now() - state.openedAt;
    if (elapsed >= this.cooldownMs) {
      if (state.halfOpenTrialInFlight) return false;
      state.halfOpenTrialInFlight = true;
      return true;
    }
    return false;
  }

  /** Record a successful call. Resets the breaker to closed. */
  recordSuccess(provider: ProviderName): void {
    const state = this.getOrCreate(provider);
    state.consecutiveFailures = 0;
    state.openedAt = undefined;
    state.halfOpenTrialInFlight = false;
  }

  /** Record a failed call. Trips the breaker if threshold exceeded. */
  recordFailure(provider: ProviderName): void {
    const state = this.getOrCreate(provider);
    state.consecutiveFailures += 1;
    state.halfOpenTrialInFlight = false;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.openedAt = this.now();
    }
  }

  /** Returns 'healthy' | 'degraded' | 'open' for a provider. */
  health(provider: ProviderName): ProviderHealth {
    const state = this.states.get(provider);
    if (state === undefined) return 'healthy';
    if (state.openedAt !== undefined) return 'open';
    if (state.consecutiveFailures > 0) return 'degraded';
    return 'healthy';
  }

  private getOrCreate(provider: ProviderName): BreakerState {
    const existing = this.states.get(provider);
    if (existing !== undefined) return existing;
    const created: BreakerState = {
      consecutiveFailures: 0,
      openedAt: undefined,
      halfOpenTrialInFlight: false,
    };
    this.states.set(provider, created);
    return created;
  }
}

/**
 * Compute exponential backoff with full jitter.
 *
 *   delay = random(0, baseMs * 2^attempt)  capped at maxMs.
 *
 * Pure function — caller provides RNG for tests.
 */
export function exponentialBackoffMs(
  attempt: number,
  opts: { readonly baseMs?: number; readonly maxMs?: number; readonly rng?: () => number } = {}
): number {
  const base = opts.baseMs ?? 100;
  const max = opts.maxMs ?? 10_000;
  const rng = opts.rng ?? Math.random;
  const cap = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.floor(rng() * cap);
}
