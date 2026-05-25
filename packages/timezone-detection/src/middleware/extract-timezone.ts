/**
 * Server-side timezone extraction from an HTTP request.
 *
 * Priority chain (highest first):
 *   1. Authorization JWT `zoneinfo` claim (RFC 7519)
 *   2. `X-Timezone` header (browser ships its detected TZ)
 *   3. GeoIP lookup on the requesting IP
 *   4. Jurisdiction fallback (e.g. tenant settings)
 *   5. UTC
 *
 * This is the framework-agnostic core — Hono + Fastify variants wrap it.
 */

import type {
  GeoIPAdapter,
  JurisdictionCode,
  TimezoneId,
} from '../types.js';
import { detectComposite } from '../detect/detect-composite.js';
import {
  detectFromJWTClaim,
  parseJWTPayloadUnsafe,
} from '../detect/detect-from-jwt-claim.js';
import { isValidTimezone } from '../detect/validate.js';

/**
 * A minimal request abstraction so we don't pin to a framework.
 * Provide a getter for headers + (optionally) remote IP.
 */
export interface ExtractRequest {
  header(name: string): string | null | undefined;
  ip?: string | null;
}

export interface ExtractTimezoneOptions {
  /** Optional GeoIP adapter — when omitted, the IP layer is skipped. */
  readonly geoip?: GeoIPAdapter;
  /** Optional jurisdiction code resolved upstream (e.g. tenant default). */
  readonly jurisdiction?: JurisdictionCode | null;
  /**
   * Pre-decoded JWT payload (after signature verification). When set,
   * `Authorization` header is ignored — caller decided trust already.
   */
  readonly decodedJWT?: { readonly zoneinfo?: TimezoneId } | null;
}

/**
 * Extract a `TimezoneId` (always returns one, falls back to UTC).
 * Does NOT verify signatures — caller MUST verify the JWT before
 * relying on the returned TZ for security-sensitive logic.
 */
export async function extractTimezone(
  req: ExtractRequest,
  opts: ExtractTimezoneOptions = {},
): Promise<TimezoneId> {
  // 1) decoded JWT preferred
  if (opts.decodedJWT) {
    const r = detectFromJWTClaim(opts.decodedJWT);
    if (r) return r.timezone;
  } else {
    const authHeader = req.header('Authorization') ?? req.header('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = parseJWTPayloadUnsafe(token);
      const r = detectFromJWTClaim(payload);
      if (r) return r.timezone;
    }
  }

  // 2) X-Timezone header from the browser
  const xTz = req.header('X-Timezone') ?? req.header('x-timezone');
  if (xTz && isValidTimezone(xTz)) return xTz;

  // 3) GeoIP
  const ip = req.ip ?? null;
  const composite = await detectComposite({
    ip: opts.geoip && ip ? { ip, geoip: opts.geoip } : null,
    jurisdiction: opts.jurisdiction ?? null,
  });
  return composite.timezone;
}
