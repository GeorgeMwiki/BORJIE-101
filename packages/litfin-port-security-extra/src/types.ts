/**
 * Shared types for litfin-port-security-extra patterns.
 */

export type TenantId = string & { readonly __brand: 'TenantId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type JurisdictionCode =
  | 'KE'
  | 'TZ'
  | 'UG'
  | 'NG'
  | 'ZA'
  | 'GH'
  | 'RW'
  | 'EU'
  | 'UK'
  | 'US'
  | 'OTHER';

export interface CryptoPort {
  /** HMAC-SHA256 of `data` under `secret`. Returns hex. */
  readonly hmacSha256Hex: (secret: string, data: string) => Promise<string>;
  /** Constant-time string compare. */
  readonly timingSafeEqualHex: (a: string, b: string) => boolean;
}

export interface SecurityClock {
  readonly now: () => number;
}

export const DEFAULT_SECURITY_CLOCK: SecurityClock = { now: () => Date.now() };
