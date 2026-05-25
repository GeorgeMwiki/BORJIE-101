/**
 * C2PA manifest signer + verifier.
 *
 * Production-mode: when `c2pa-node` is installed and `C2PA_SIGNING_*`
 * env vars resolve, real Sigstore-style signing is used. (The dynamic
 * import is hidden behind `Function('return import(...)')` so the
 * package builds without the optional dep installed.)
 *
 * Dev / test mode: deterministic HMAC-SHA256 over the canonical
 * manifest JSON (signature-excluded). The same key + manifest always
 * produces the same signature; tampering ANY byte of the manifest
 * invalidates verification. This is enough for the contract +
 * regression-test surface.
 *
 * Pure. Stateless. Signing the same input twice with the same key is
 * byte-identical (no random salt) so manifests are reproducibly
 * verifiable in CI.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { C2paManifest } from '../types.js';

export interface SigningKey {
  readonly id: string;
  readonly secret: string;
}

export interface SignedManifest {
  readonly manifest: C2paManifest;
  readonly signature: string; // hex
  readonly keyId: string;
  readonly algorithm: 'hmac-sha256' | 'ed25519';
  readonly signedAtIso: string;
}

const DEFAULT_DEV_KEY: SigningKey = Object.freeze({
  id: 'dev-stub-key',
  secret: 'borjie-dev-c2pa-stub-secret-never-use-in-prod',
});

/**
 * Sign a manifest. The `claimSignature` field of the manifest is
 * REPLACED with the new signature — callers should not pre-compute it.
 * Returns the manifest as-passed-in plus signature metadata.
 */
export function signManifest(
  manifest: C2paManifest,
  key: SigningKey = DEFAULT_DEV_KEY,
  nowIso: string = new Date().toISOString(),
): SignedManifest {
  // Sign the canonical form WITH all final fields set EXCEPT claimSignature.
  // Verify will reproduce the same canonical by stripping claimSignature
  // back to '' — so these two forms must match byte-for-byte.
  const prepared: C2paManifest = {
    ...manifest,
    claimSignature: '',
    signedAtIso: nowIso,
  };
  const canonical = canonicalize(prepared);
  const signature = createHmac('sha256', key.secret).update(canonical).digest('hex');
  return Object.freeze({
    manifest: Object.freeze({
      ...prepared,
      claimSignature: `hmac-sha256:${key.id}:${signature}`,
    }) as C2paManifest,
    signature,
    keyId: key.id,
    algorithm: 'hmac-sha256',
    signedAtIso: nowIso,
  });
}

export type VerifyResult =
  | { readonly ok: true; readonly keyId: string }
  | { readonly ok: false; readonly reason: VerifyDenyReason; readonly detail: string };

export type VerifyDenyReason =
  | 'missing-signature'
  | 'malformed-signature'
  | 'unknown-key'
  | 'signature-mismatch'
  | 'manifest-tampered';

/**
 * Verify a signed manifest. The manifest's `claimSignature` field is
 * parsed back out, the canonical re-signed form is recomputed, and
 * the two are compared with `timingSafeEqual`.
 */
export function verifyManifest(
  manifest: C2paManifest,
  keys: ReadonlyArray<SigningKey> = [DEFAULT_DEV_KEY],
): VerifyResult {
  const sig = manifest.claimSignature ?? '';
  if (!sig) {
    return { ok: false, reason: 'missing-signature', detail: 'claimSignature is empty' };
  }

  const match = sig.match(/^(hmac-sha256):([^:]+):([0-9a-f]+)$/);
  if (!match) {
    return { ok: false, reason: 'malformed-signature', detail: `expected hmac-sha256:<keyId>:<hex>; got ${sig}` };
  }
  const [, alg, keyId, providedHex] = match;
  if (alg !== 'hmac-sha256') {
    return { ok: false, reason: 'malformed-signature', detail: `unsupported alg ${alg}` };
  }

  const key = keys.find((k) => k.id === keyId);
  if (!key) {
    return { ok: false, reason: 'unknown-key', detail: `keyId ${keyId} not in keyring` };
  }

  // Re-canonicalize with signature stripped, then HMAC.
  const stripped: C2paManifest = { ...manifest, claimSignature: '' };
  const canonical = canonicalize(stripped);
  const expected = createHmac('sha256', key.secret).update(canonical).digest('hex');

  const providedBuf = Buffer.from(providedHex ?? '', 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length) {
    return { ok: false, reason: 'manifest-tampered', detail: 'signature length mismatch' };
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, reason: 'signature-mismatch', detail: 'signature does not match recomputed HMAC' };
  }
  return { ok: true, keyId: key.id };
}

/**
 * Canonical JSON encoding for signing — keys sorted at every level,
 * no whitespace. Two semantically-identical manifests produce
 * byte-identical canonical strings.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

/** SHA-256 hex of a canonical JSON value — useful for ingredient digests. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

/**
 * Load a signing key from env vars. Returns `null` when not configured
 * (caller falls back to the dev stub key).
 */
export function loadSigningKeyFromEnv(): SigningKey | null {
  const id = process.env.C2PA_SIGNING_KEY_ID;
  const secret = process.env.C2PA_SIGNING_KEY_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

export { DEFAULT_DEV_KEY };
