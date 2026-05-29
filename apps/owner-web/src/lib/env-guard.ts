/**
 * Build-time / module-load environment guard.
 *
 * Every page or client that reads a `NEXT_PUBLIC_*` base URL should
 * resolve it through `requirePublicBaseUrl()` so production builds fail
 * loud when a deployer forgets to set the env var. The localhost
 * fallback exists only for `next dev` — it never silently runs in
 * production.
 *
 * Mirrors apps/admin-web/src/lib/env-guard.ts so the two consoles
 * behave identically when an env var is missing.
 */

export function requirePublicBaseUrl(
  envName: string,
  devFallback: string,
): string {
  const fromEnv =
    typeof process !== 'undefined'
      ? // eslint-disable-next-line security/detect-object-injection -- envName is a compile-time literal from trusted call sites
        process.env?.[envName]?.trim()
      : undefined;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  if (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV === 'production'
  ) {
    throw new Error(
      `${envName} is required in production builds of owner-web.`,
    );
  }
  return devFallback;
}
