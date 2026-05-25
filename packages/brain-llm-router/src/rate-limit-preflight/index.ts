/**
 * `@borjie/brain-llm-router/rate-limit-preflight` — public surface.
 *
 * See `./preflight-gate.ts` for the contract.
 */

export {
  RateLimitNearExhaustionError,
  checkRateLimitFloor,
  extractRetryAfterMsFromError,
} from './preflight-gate.js';
export {
  updateRateLimitFromHeaders,
  parseRetryAfterMs,
  type HeadersLike,
} from './header-parser.js';
export {
  getProviderRateLimitState,
  resetProviderRateLimitState,
  type ProviderRateLimitState,
  type PreflightProvider,
} from './rate-limit-state.js';
