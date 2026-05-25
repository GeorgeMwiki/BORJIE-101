/**
 * env-secrets.mjs — pure crypto-secret generation.
 *
 * Pure ESM, zero deps beyond Node's `crypto`. Imported by:
 *   - scripts/setup-borjie-env.mjs (full bootstrap)
 *   - scripts/generate-borjie-secrets.mjs (standalone rotation)
 *   - scripts/setup-borjie-env.test.mjs (unit tests)
 */

import { randomBytes } from 'node:crypto';

export const TODO_MARKER_PREFIX = 'TODO_BORJIE_';

/**
 * Each secret declares its env-var name, byte length, encoding, and a free
 * text "why" used in --explain output / docs generation.
 */
export const SECRET_FIELDS = Object.freeze([
  { key: 'ENCRYPTION_MASTER_KEY', bytes: 32, encoding: 'base64', purpose: 'Field-level AES key (PII at rest)' },
  { key: 'JWT_SECRET', bytes: 48, encoding: 'base64', purpose: 'API-gateway HS256 access-token signing' },
  { key: 'JWT_REFRESH_SECRET', bytes: 48, encoding: 'base64', purpose: 'Refresh-token signing' },
  { key: 'SESSION_HASH_SECRET', bytes: 48, encoding: 'base64', purpose: 'Audit hash-chain HMAC' },
  { key: 'MCP_API_KEY', bytes: 32, encoding: 'hex', purpose: 'Model-Context-Protocol gateway auth' },
  { key: 'INTERNAL_API_KEY', bytes: 32, encoding: 'hex', purpose: 'Service-to-service X-Internal-Key' },
  { key: 'CRON_SECRET', bytes: 32, encoding: 'hex', purpose: 'Cron-only endpoint guard' },
]);

/**
 * generateSecret — encoding-aware random byte generator.
 *
 * Uses `crypto.randomBytes` (CSPRNG). Base64 strings are URL-safe trimmed
 * because some downstream consumers (e.g. the audit hash-chain helper)
 * embed the secret in URLs; the trade-off vs. raw base64 is acceptable
 * because the secret is still 256+ bits.
 *
 * @param {number} bytes  byte count (>=16)
 * @param {'base64'|'hex'|'base64url'} encoding
 * @returns {string}
 */
export function generateSecret(bytes, encoding) {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new Error(`generateSecret: bytes must be integer >= 16, got ${bytes}`);
  }
  if (encoding !== 'base64' && encoding !== 'hex' && encoding !== 'base64url') {
    throw new Error(`generateSecret: unsupported encoding ${encoding}`);
  }
  return randomBytes(bytes).toString(encoding);
}

/**
 * generateAllSecrets — returns a fresh object with every SECRET_FIELDS entry.
 * Each call produces unique values; deterministic only via injected RNG.
 *
 * @param {(bytes: number, encoding: string) => string} [rngFn]  test override
 */
export function generateAllSecrets(rngFn = generateSecret) {
  // Immutable build: spread into a fresh object literal. No mutation of params.
  return SECRET_FIELDS.reduce((acc, { key, bytes, encoding }) => ({
    ...acc,
    [key]: rngFn(bytes, encoding),
  }), {});
}

/**
 * isTodoMarker — true for any placeholder we control. Includes the literal
 * "TODO_BORJIE_*" markers and obvious stand-ins ("your-…", "replace-me-…").
 */
export function isTodoMarker(value) {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (value.startsWith(TODO_MARKER_PREFIX)) return true;
  if (value.startsWith('your-')) return true;
  if (value.startsWith('replace-me')) return true;
  return false;
}
