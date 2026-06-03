/**
 * `sovereign-claim` — public surface.
 *
 * Defence-in-depth gate for sovereign-tier actions in the Borjie
 * mining-estate OS: an HMAC-signed claim tying (userId, role,
 * mfaVerifiedAt, scope) plus a recent-MFA freshness window, so a stolen
 * cookie or role-string alone cannot mint a sovereign action.
 *
 * Pure leaf: all crypto is delegated to an injected {@link CryptoPort}.
 */

export type { CryptoPort } from './crypto-port.js';
export {
  SOVEREIGN_SCOPES,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_SOVEREIGN_ROLE,
  CLOCK_SKEW_TOLERANCE_MS,
  type SovereignScope,
  type SovereignClaim,
  type SovereignClaimVerifyOptions,
  type SovereignClaimError,
  type SovereignClaimResult,
} from './types.js';
export {
  SovereignClaimDenied,
  signSovereignClaim,
  assertSovereignClaim,
  tryVerifySovereignClaim,
} from './sovereign-claim.js';
