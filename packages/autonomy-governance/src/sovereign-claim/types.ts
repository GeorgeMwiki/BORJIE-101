/**
 * Sovereign-tier signed-claim verification — shared types.
 *
 * Ported from LITFIN `src/core/governance/tier-policy/sovereign-claim.ts`
 * and re-skinned for the Borjie mining-estate OS.
 *
 * Background: the tier-elevation gate (`tierFromPortal()`) is too thin on
 * its own. A single role-string compare unlocks `sovereign` — the highest
 * privilege tier, which can write royalty/licence policy, reroute AI
 * traffic, flip the kill-switch approval, or rotate secrets. One stolen
 * cookie or one role-cache poisoning would be the entire blast radius.
 *
 * This module adds defence-in-depth on top of the role check:
 *
 *   1. Signed claim. The caller must present an HMAC-signed claim that
 *      ties (userId, role, mfaVerifiedAt, scope) together. The signature
 *      is verified with a server-side secret. An attacker who holds the
 *      role string but not the secret cannot mint a claim.
 *
 *   2. Recent-MFA gate. The claim's `mfaVerifiedAt` must fall inside a
 *      configurable freshness window (default 15 minutes). Replaying a
 *      stolen long-lived session does not satisfy this check.
 *
 *   3. Scope-binding. The claim binds to a specific sovereign action
 *      scope. A claim issued for one action cannot be replayed against
 *      another.
 *
 * Wire `assertSovereignClaim()` into every sovereign tool BEFORE the
 * tier-policy check. The two complement each other: tier-policy gates
 * *what* you may do; sovereign-claim gates *who you actually are right now*.
 */

/**
 * Canonical sovereign action scopes for a mining-estate OS. Each
 * sovereign tool binds its claim to exactly one scope so a claim minted
 * for, e.g., royalty-policy writes cannot be replayed to rotate secrets.
 *
 * The verifier accepts any non-empty string as a scope (callers may add
 * tenant-specific scopes); this list documents the platform defaults and
 * powers exhaustive tests.
 */
export const SOVEREIGN_SCOPES = [
  'write_royalty_policy',
  'write_licence_policy',
  'reroute_ai_traffic',
  'flip_kill_switch',
  'rotate_secrets',
  'override_four_eye',
  'write_sovereign_payout',
] as const;

export type SovereignScope = (typeof SOVEREIGN_SCOPES)[number];

/**
 * A short-lived claim minted after MFA verification, signed by the
 * server with the `BORJIE_SOVEREIGN_SIGNING_KEY` secret.
 */
export interface SovereignClaim {
  /** Authenticated user id. */
  readonly userId: string;
  /** Role string at the moment of MFA. `BORJIE_SUPER_ADMIN` for
   *  sovereign actions. */
  readonly role: string;
  /** ISO 8601 timestamp of the MFA challenge that produced this claim. */
  readonly mfaVerifiedAt: string;
  /** The sovereign action scope this claim is bound to. */
  readonly scope: string;
  /** Lowercase hex HMAC-SHA256 over
   *  `${userId}|${role}|${mfaVerifiedAt}|${scope}`. */
  readonly signature: string;
}

/** Options for `assertSovereignClaim` / `tryVerifySovereignClaim`. */
export interface SovereignClaimVerifyOptions {
  /** Server-side signing secret. Required (no env fallback in the leaf). */
  readonly signingKey: string;
  /** Maximum age of the MFA timestamp in milliseconds. Default 15 min. */
  readonly maxAgeMs?: number;
  /** Required scope. Verification fails if `claim.scope` is not this value. */
  readonly requiredScope: string;
  /** Required role. Default `BORJIE_SUPER_ADMIN`. */
  readonly requiredRole?: string;
  /** Override the clock for tests. Returns epoch milliseconds. */
  readonly now?: () => number;
}

/** Discrete reasons a sovereign claim can be rejected. */
export type SovereignClaimError =
  | 'missing-signing-key'
  | 'invalid-signature'
  | 'wrong-scope'
  | 'wrong-role'
  | 'mfa-expired'
  | 'malformed-claim';

/** Result of the non-throwing verification path. */
export type SovereignClaimResult =
  | { readonly ok: true; readonly claim: SovereignClaim }
  | { readonly ok: false; readonly reason: SovereignClaimError };

/** Default freshness window for the recent-MFA gate (15 minutes). */
export const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000;

/** Default required role for sovereign actions. */
export const DEFAULT_SOVEREIGN_ROLE = 'BORJIE_SUPER_ADMIN';

/** Tolerated forward clock skew before a claim is rejected as future-dated. */
export const CLOCK_SKEW_TOLERANCE_MS = 60_000;
