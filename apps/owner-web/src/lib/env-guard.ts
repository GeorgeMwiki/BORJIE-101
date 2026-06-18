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

/**
 * STATIC references so Next inlines each `NEXT_PUBLIC_*` into the CLIENT
 * bundle — a dynamic `process.env[name]` inlines to `undefined` on the client
 * and made the guard throw + white-screen the app. Literal access here is what
 * makes `requirePublicBaseUrl(name)` resolve in the browser.
 */
const PUBLIC_ENV: Readonly<Record<string, string | undefined>> = {
  NEXT_PUBLIC_OWNER_WEB_ORIGIN: process.env.NEXT_PUBLIC_OWNER_WEB_ORIGIN,
  NEXT_PUBLIC_ADMIN_WEB_ORIGIN: process.env.NEXT_PUBLIC_ADMIN_WEB_ORIGIN,
  NEXT_PUBLIC_MARKETING_ORIGIN: process.env.NEXT_PUBLIC_MARKETING_ORIGIN,
  NEXT_PUBLIC_API_GATEWAY_URL: process.env.NEXT_PUBLIC_API_GATEWAY_URL,
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
      `${envName} is required in production builds of owner-web.`,
    );
  }
  return devFallback;
}
