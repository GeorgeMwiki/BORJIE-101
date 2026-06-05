/**
 * Regulator-pack signing-secret resolver.
 *
 * Encapsulates the single env read for the bundle HMAC key so the route file
 * stays free of `process.env` access (CLAUDE.md). Reuses the SAME secret as the
 * AI audit-trail bundle (`AUDIT_TRAIL_SIGNING_SECRET`) so a regulator can verify
 * both artifacts with one key.
 *
 * Returns `null` when the secret is unset OUTSIDE production (dev/test → the
 * bundle is hash-verifiable but unsigned). In production a missing secret is a
 * misconfiguration: the caller MUST surface it rather than ship an unsigned
 * regulator artifact, so we throw.
 */
export function resolveRegulatorPackSigningSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const raw = env.AUDIT_TRAIL_SIGNING_SECRET;
  if (raw && raw.trim().length > 0) {
    return raw;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'regulator-pack: AUDIT_TRAIL_SIGNING_SECRET is required in production to ' +
        'sign the exported bundle (refusing to emit an unsigned regulator artifact)',
    );
  }
  return null;
}
