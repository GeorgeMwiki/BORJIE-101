/**
 * Secrets Derivation — HMAC sign / verify with rotation support
 *
 * This module provides dual-key verification so HMAC roots (audit-chain
 * keys, webhook signing keys, JWT pepper, etc.) can be rotated without
 * downtime or invalidating persisted signatures.
 *
 * Operational model (see `Docs/SECRETS_ROTATION.md`):
 *
 *   1. Pre-stage: operator copies the CURRENT secret value into
 *      `<NAME>_PREV` and writes the new value into `<NAME>`. Both
 *      values are present in the running environment.
 *   2. Cut-over: new writes are signed with `<NAME>` (current).
 *      Reads use `verifyWithRotation(current, prev, value, sig)` which
 *      accepts EITHER signature for a 24h soak window.
 *   3. Soak: 24h overlap. Any signature persisted before cut-over
 *      still verifies under `<NAME>_PREV`.
 *   4. Retire: operator removes `<NAME>_PREV`. Verification falls back
 *      to current-only.
 *
 * NEVER mutate input strings. NEVER log raw secrets. The module is
 * deliberately small and dependency-free (Node crypto only) so it can
 * be reviewed quickly during incident response.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Supported HMAC algorithms — defaulting to sha256. */
export type HmacAlgorithm = 'sha256' | 'sha384' | 'sha512';

/**
 * Sign a value with HMAC. Returns lowercase hex digest.
 *
 * @throws Error when secret is empty (callers must validate env vars
 *   at boot — empty signing keys are an operator error).
 */
export function sign(
  secret: string,
  value: string,
  algorithm: HmacAlgorithm = 'sha256',
): string {
  if (!secret || secret.length === 0) {
    throw new Error('sign: secret must be a non-empty string');
  }
  if (typeof value !== 'string') {
    throw new Error('sign: value must be a string');
  }
  return createHmac(algorithm, secret).update(value).digest('hex');
}

/**
 * Constant-time hex-digest comparison. Returns false when lengths
 * differ — Buffer.from with mismatched lengths would itself differ.
 */
function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Verify a single-key signature in constant time.
 */
export function verify(
  secret: string,
  value: string,
  signature: string,
  algorithm: HmacAlgorithm = 'sha256',
): boolean {
  if (!secret || !signature) return false;
  const expected = sign(secret, value, algorithm);
  return safeEqualHex(expected, signature);
}

/**
 * Verify a signature against EITHER the current secret or the previous
 * secret (overlap window during rotation). Returns the role of the
 * secret that validated, or `null` when neither key matched.
 *
 * Both checks are always executed (no short-circuit) so the function
 * runs in constant time relative to which key matches, which prevents
 * an attacker from learning the rotation state through a timing
 * side-channel.
 *
 * `prevSecret` may be `null`, `undefined`, or an empty string after
 * the rotation soak has ended — the function treats that as "no
 * previous key" and only checks `current`.
 */
export function verifyWithRotation(
  currentSecret: string,
  prevSecret: string | null | undefined,
  value: string,
  signature: string,
  algorithm: HmacAlgorithm = 'sha256',
): 'current' | 'previous' | null {
  if (!currentSecret || !signature) return null;

  const matchesCurrent = verify(currentSecret, value, signature, algorithm);

  // Always compute the previous check (when a previous key is present)
  // to keep the operation constant time across rotation states.
  let matchesPrev = false;
  if (prevSecret && prevSecret.length > 0) {
    matchesPrev = verify(prevSecret, value, signature, algorithm);
  }

  if (matchesCurrent) return 'current';
  if (matchesPrev) return 'previous';
  return null;
}

/**
 * Resolve a (current, previous) pair from process.env.
 *
 * Convention: for an HMAC root named `FOO`, the rotation pair is
 *   - `FOO`        — current value (REQUIRED in production)
 *   - `FOO_PREV`   — previous value (OPTIONAL, present during overlap)
 *
 * Returns an immutable record. Throws when `FOO` is missing — callers
 * MUST not silently fall back to an empty signing key.
 */
export interface SecretPair {
  readonly current: string;
  readonly previous: string | null;
  readonly rotating: boolean;
}

export function resolveSecretPair(
  envVarName: string,
  env: NodeJS.ProcessEnv = process.env,
): SecretPair {
  const current = env[envVarName];
  if (!current || current.length === 0) {
    throw new Error(
      `resolveSecretPair: env var ${envVarName} is required but missing or empty`,
    );
  }
  const prevName = `${envVarName}_PREV`;
  const previousRaw = env[prevName];
  const previous = previousRaw && previousRaw.length > 0 ? previousRaw : null;
  return Object.freeze({
    current,
    previous,
    rotating: previous !== null,
  });
}

/**
 * High-level helper: verify a signature against the rotation pair
 * resolved from env.
 */
export function verifyWithEnvRotation(
  envVarName: string,
  value: string,
  signature: string,
  options: {
    algorithm?: HmacAlgorithm;
    env?: NodeJS.ProcessEnv;
  } = {},
): 'current' | 'previous' | null {
  const pair = resolveSecretPair(envVarName, options.env ?? process.env);
  return verifyWithRotation(
    pair.current,
    pair.previous,
    value,
    signature,
    options.algorithm ?? 'sha256',
  );
}
