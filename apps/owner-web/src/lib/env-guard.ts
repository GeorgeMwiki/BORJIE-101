/**
 * Build-time / module-load environment guard.
 *
 * Every page or client that reads a `NEXT_PUBLIC_*` base URL should
 * resolve it through `requirePublicBaseUrl()` so production builds fail
 * loud when a deployer forgets to set the env var. The localhost
 * fallback exists only for `next dev` — it never silently runs in
 * production.
 *
 * FAIL-LOUD ONLY ON THE SERVER/BUILD — NEVER ON THE CLIENT. A throw in a
 * root-mounted client component over a missing inlined `NEXT_PUBLIC_*` value
 * bubbles to `global-error` and white-screens the entire app; so we throw
 * only when `typeof window === 'undefined'` (build + SSR) and degrade to the
 * fallback on the client.
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
    process.env?.NODE_ENV === 'production' &&
    typeof window === 'undefined'
  ) {
    throw new Error(
      `${envName} is required in production builds of owner-web.`,
    );
  }
  return devFallback;
}
