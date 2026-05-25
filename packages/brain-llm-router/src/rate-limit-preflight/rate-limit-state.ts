/**
 * Rate-limit pre-flight state — per-provider counters.
 *
 * Single in-process map keyed on provider name. Initialised to
 * `Infinity` so callers never throw `RateLimitNearExhaustionError`
 * before the first response has been observed. Each successful response
 * refreshes the counters via the header parser.
 *
 * Module-scope state is intentional: rate-limit floors must be shared
 * across all concurrent callers so a thundering-herd of in-flight
 * requests can't each independently decide to fire before the cap.
 */

/**
 * Providers that emit rate-limit headers we know how to parse.
 * Extend this list as new providers ship documented headers.
 */
export type PreflightProvider = 'anthropic' | 'openai';

export interface ProviderRateLimitState {
  /** Remaining REQUESTS in the current window. Infinity before first observation. */
  requestsRemaining: number;
  /** Remaining INPUT TOKENS in the current window. Infinity before first observation. */
  tokensRemaining: number;
  /** Epoch ms when the request window resets. 0 means "no info yet". */
  requestsResetMs: number;
  /** Epoch ms when the token window resets. 0 means "no info yet". */
  tokensResetMs: number;
  /** Timestamp of last observed response header (debug only). */
  lastObservedMs: number;
}

function initialState(): ProviderRateLimitState {
  return {
    requestsRemaining: Number.POSITIVE_INFINITY,
    tokensRemaining: Number.POSITIVE_INFINITY,
    requestsResetMs: 0,
    tokensResetMs: 0,
    lastObservedMs: 0,
  };
}

const _state: Record<PreflightProvider, ProviderRateLimitState> = {
  anthropic: initialState(),
  openai: initialState(),
};

/**
 * Mutable accessor — used by the header parser and the pre-flight gate
 * inside this package. External callers should use the read-only
 * snapshot via `getProviderRateLimitState()`.
 */
export function getMutableState(
  provider: PreflightProvider,
): ProviderRateLimitState {
  return _state[provider];
}

/**
 * Read-only snapshot for dashboards / observability. Returns shallow
 * clones so callers cannot mutate the live state.
 */
export function getProviderRateLimitState(): Readonly<
  Record<PreflightProvider, Readonly<ProviderRateLimitState>>
> {
  return {
    anthropic: { ..._state.anthropic },
    openai: { ..._state.openai },
  };
}

/** Test hook — wipe state to the post-construction defaults. */
export function resetProviderRateLimitState(): void {
  _state.anthropic = initialState();
  _state.openai = initialState();
}
