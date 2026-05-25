/**
 * Cryptographically-secure ID generation for domain entities.
 *
 * Replaces the legacy `${Date.now()}_${Math.random().toString(36).substring(2, N)}`
 * pattern across the domain-services codebase. The old pattern was
 * guessable (Math.random is not a CSPRNG) and enabled invoice/payment
 * ID enumeration — a real risk for a multi-tenant financial system.
 *
 * We keep the human-readable `<prefix>_<timestamp>_<rand>` shape so
 * logs/dashboards remain legible, but the random suffix now comes from
 * crypto.randomBytes.
 */

import { randomBytes } from 'node:crypto';

/**
 * Generate a random hex string of `byteLength` bytes (2 * byteLength chars).
 * Uses Node's CSPRNG; safe for entity IDs, tokens, correlation IDs.
 */
export function randomHex(byteLength = 4): string {
  return randomBytes(byteLength).toString('hex');
}

/**
 * Generate a prefixed, timestamped, crypto-random ID.
 *
 * Example: prefixedId('inv') → "inv_1713207234123_8af2c1d9"
 *
 * @param prefix short entity prefix (e.g. 'inv', 'pay', 'cust')
 * @param randomBytesLength number of random bytes to append (default 4 → 8 hex chars)
 */
export function prefixedId(prefix: string, randomBytesLength = 4): string {
  return `${prefix}_${Date.now()}_${randomHex(randomBytesLength)}`;
}
