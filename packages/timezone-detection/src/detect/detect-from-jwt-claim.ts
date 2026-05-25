/**
 * JWT claim detection — RFC 7519 §5.1 declares `zoneinfo` as a registered
 * **string** claim whose value SHOULD be an IANA Time Zone identifier
 * (e.g. `Africa/Nairobi`). Auth0, Okta and Cognito all support it.
 *
 * This module deliberately does NOT verify signatures — call your auth
 * library first (e.g. `jose.jwtVerify`) and pass the decoded payload.
 *
 * Confidence: 1.0 when present. The user explicitly authenticated, so
 * the claim is the most trustworthy single source we have.
 */

import type { DecodedJWT, DetectionResult } from '../types.js';
import { isValidTimezone } from './validate.js';

/**
 * Returns a `DetectionResult` (`source: 'jwt-claim'`, confidence 1.0)
 * when the decoded JWT has a valid `zoneinfo` claim, otherwise `null`.
 */
export function detectFromJWTClaim(
  decoded: DecodedJWT | null | undefined,
): DetectionResult | null {
  if (!decoded || typeof decoded !== 'object') return null;
  const zone = decoded.zoneinfo;
  if (!zone || typeof zone !== 'string') return null;
  if (!isValidTimezone(zone)) return null;
  return {
    timezone: zone,
    source: 'jwt-claim',
    confidence: 1.0,
    reason: 'RFC 7519 zoneinfo claim',
  };
}

/**
 * Tiny base64url JWT splitter — payload only. Use ONLY when the signature
 * has already been verified upstream. Returns `null` on any parse failure.
 */
export function parseJWTPayloadUnsafe(token: string): DecodedJWT | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json) as DecodedJWT;
  } catch {
    return null;
  }
}
