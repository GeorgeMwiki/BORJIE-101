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

/**
 * STATIC references to every `NEXT_PUBLIC_*` base URL this app resolves at
 * runtime. Next.js only inlines a `NEXT_PUBLIC_*` var into the CLIENT bundle
 * when it sees the LITERAL `process.env.NEXT_PUBLIC_X` — a dynamic
 * `process.env[name]` is NOT statically analysable and inlines to `undefined`
 * on the client (then the guard below threw and white-screened the whole
 * site). Listing each var here as a literal access is what makes
 * `requirePublicBaseUrl(name)` actually resolve in the browser.
 */
const PUBLIC_ENV: Readonly<Record<string, string | undefined>> = {
  NEXT_PUBLIC_OWNER_WEB_ORIGIN: process.env.NEXT_PUBLIC_OWNER_WEB_ORIGIN,
  NEXT_PUBLIC_ADMIN_WEB_ORIGIN: process.env.NEXT_PUBLIC_ADMIN_WEB_ORIGIN,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
};

export function requirePublicBaseUrl(
  envName: string,
  devFallback: string,
): string {
  // eslint-disable-next-line security/detect-object-injection -- envName is a compile-time literal from trusted call sites
  const fromEnv = PUBLIC_ENV[envName]?.trim();
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
