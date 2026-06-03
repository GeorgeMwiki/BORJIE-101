/**
 * Sovereign-tier signed-claim verification — pure core.
 *
 * No `node:crypto`, no env reads, no I/O. All HMAC + constant-time
 * comparison is delegated to an injected {@link CryptoPort}, so this
 * module is a deterministic leaf the kernel can call before any
 * sovereign-tier action.
 */

import type { CryptoPort } from './crypto-port.js';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_SOVEREIGN_ROLE,
  type SovereignClaim,
  type SovereignClaimError,
  type SovereignClaimResult,
  type SovereignClaimVerifyOptions,
} from './types.js';

/** Thrown by `assertSovereignClaim` on any verification failure. Never
 *  carries the signing key or signature material in its message. */
export class SovereignClaimDenied extends Error {
  public readonly reason: SovereignClaimError;
  public constructor(reason: SovereignClaimError, detail?: string) {
    super(`Sovereign claim denied: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'SovereignClaimDenied';
    this.reason = reason;
  }
}

/** Stable field order for the signed payload. Mirrors LITFIN so a claim
 *  signed by one sibling could in principle be verified by the other if
 *  they shared a secret (they do not). */
function payloadString(input: {
  readonly userId: string;
  readonly role: string;
  readonly mfaVerifiedAt: string;
  readonly scope: string;
}): string {
  return `${input.userId}|${input.role}|${input.mfaVerifiedAt}|${input.scope}`;
}

/**
 * Sign a sovereign payload. Server-side only; never expose the secret to
 * a client. The signature is the lowercase hex HMAC-SHA256 over the
 * canonical payload string.
 */
export function signSovereignClaim(
  payload: Omit<SovereignClaim, 'signature'>,
  signingKey: string,
  crypto: CryptoPort,
): SovereignClaim {
  if (!signingKey) {
    throw new SovereignClaimDenied('missing-signing-key');
  }
  const signature = crypto.hmacSha256Hex(signingKey, payloadString(payload));
  return { ...payload, signature };
}

function isWellFormed(claim: unknown): claim is SovereignClaim {
  if (!claim || typeof claim !== 'object') {
    return false;
  }
  const c = claim as Record<string, unknown>;
  return (
    typeof c.userId === 'string' &&
    typeof c.role === 'string' &&
    typeof c.mfaVerifiedAt === 'string' &&
    typeof c.scope === 'string' &&
    typeof c.signature === 'string'
  );
}

function assertMfaWindow(
  mfaVerifiedAt: string,
  options: SovereignClaimVerifyOptions,
): void {
  const verifiedMs = Date.parse(mfaVerifiedAt);
  if (Number.isNaN(verifiedMs)) {
    throw new SovereignClaimDenied('malformed-claim', 'bad mfaVerifiedAt');
  }
  const now = (options.now ?? Date.now)();
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (now - verifiedMs > maxAge) {
    throw new SovereignClaimDenied(
      'mfa-expired',
      `${Math.round((now - verifiedMs) / 1000)}s old`,
    );
  }
  if (verifiedMs - now > CLOCK_SKEW_TOLERANCE_MS) {
    // Future-dated claim: reject, allowing a small skew tolerance.
    throw new SovereignClaimDenied('malformed-claim', 'future mfa');
  }
}

/**
 * Verify a sovereign claim. Returns the claim on success; throws
 * {@link SovereignClaimDenied} on any failure. Never logs the signing key.
 *
 * Order of checks: structure -> role -> scope -> signing-key presence ->
 * signature (constant-time) -> recent-MFA window. Role and scope are
 * cheap discriminators surfaced before the cryptographic comparison so a
 * wrong-scope replay is rejected with a precise reason.
 */
export function assertSovereignClaim(
  claim: SovereignClaim | null | undefined,
  options: SovereignClaimVerifyOptions,
  crypto: CryptoPort,
): SovereignClaim {
  if (!isWellFormed(claim)) {
    throw new SovereignClaimDenied('malformed-claim');
  }
  const { userId, role, mfaVerifiedAt, scope, signature } = claim;

  const requiredRole = options.requiredRole ?? DEFAULT_SOVEREIGN_ROLE;
  if (role.toUpperCase() !== requiredRole.toUpperCase()) {
    throw new SovereignClaimDenied('wrong-role', role);
  }

  if (scope !== options.requiredScope) {
    throw new SovereignClaimDenied(
      'wrong-scope',
      `claim=${scope} required=${options.requiredScope}`,
    );
  }

  if (!options.signingKey) {
    throw new SovereignClaimDenied('missing-signing-key');
  }

  const expected = crypto.hmacSha256Hex(
    options.signingKey,
    payloadString({ userId, role, mfaVerifiedAt, scope }),
  );
  if (!crypto.timingSafeEqualHex(expected, signature)) {
    throw new SovereignClaimDenied('invalid-signature');
  }

  assertMfaWindow(mfaVerifiedAt, options);

  return claim;
}

/**
 * Non-throwing wrapper. Returns a discriminated result instead of
 * throwing, which is convenient at API boundaries that translate the
 * failure into a 403 without a try/catch.
 */
export function tryVerifySovereignClaim(
  claim: SovereignClaim | null | undefined,
  options: SovereignClaimVerifyOptions,
  crypto: CryptoPort,
): SovereignClaimResult {
  try {
    const verified = assertSovereignClaim(claim, options, crypto);
    return { ok: true, claim: verified };
  } catch (err) {
    if (err instanceof SovereignClaimDenied) {
      return { ok: false, reason: err.reason };
    }
    return { ok: false, reason: 'malformed-claim' };
  }
}
