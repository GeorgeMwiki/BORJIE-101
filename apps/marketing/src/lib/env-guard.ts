/**
 * Build-time / module-load environment guard.
 *
 * Every page or client that reads a `NEXT_PUBLIC_*` base URL should
 * resolve it through `requirePublicBaseUrl()` so production builds fail
 * loud when a deployer forgets to set the env var. The localhost
 * fallback exists only for `next dev` — it never silently runs in
 * production.
 *
 * FAIL-LOUD ONLY ON THE SERVER/BUILD — NEVER ON THE CLIENT. A missing
 * `NEXT_PUBLIC_*` value that failed to inline into the client bundle must
 * NOT throw during hydration: a throw in a root-mounted client component
 * (e.g. the nav's sign-in link) bubbles to `global-error` and white-screens
 * the ENTIRE public site. So we throw only when `typeof window === 'undefined'`
 * (build + SSR, where a missing env SHOULD fail the deploy); on the client we
 * degrade to the fallback so the page still renders — a stale cross-app link
 * is strictly better than a dead site.
 *
 * Mirrors apps/admin-web/src/lib/env-guard.ts and
 * apps/owner-web/src/lib/env-guard.ts so the three Next apps behave
 * identically when an env var is missing.
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
      `${envName} is required in production builds of marketing site.`,
    );
  }
  return devFallback;
}
