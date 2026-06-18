/**
 * Build-time / module-load environment guard.
 *
 * Every page that reads a `NEXT_PUBLIC_*` base URL should resolve it
 * through `requirePublicBaseUrl()` so production builds fail loud when a
 * deployer forgets to set the env var. The localhost fallback exists
 * only for `next dev` — it never silently runs in production.
 *
 * FAIL-LOUD ONLY ON THE SERVER/BUILD — NEVER ON THE CLIENT. A throw in a
 * root-mounted client component over a missing inlined `NEXT_PUBLIC_*` value
 * bubbles to `global-error` and white-screens the entire app; so we throw
 * only when `typeof window === 'undefined'` (build + SSR) and degrade to the
 * fallback on the client.
 */

/**
 * STATIC references so Next inlines each `NEXT_PUBLIC_*` into the CLIENT
 * bundle — a dynamic `process.env[name]` inlines to `undefined` on the client
 * and made the guard throw + white-screen the app. Literal access here is what
 * makes `requirePublicBaseUrl(name)` resolve in the browser.
 */
const PUBLIC_ENV: Readonly<Record<string, string | undefined>> = {
  NEXT_PUBLIC_OWNER_WEB_ORIGIN: process.env.NEXT_PUBLIC_OWNER_WEB_ORIGIN,
  NEXT_PUBLIC_OWNER_PORTAL_URL: process.env.NEXT_PUBLIC_OWNER_PORTAL_URL,
  NEXT_PUBLIC_ADMIN_WEB_ORIGIN: process.env.NEXT_PUBLIC_ADMIN_WEB_ORIGIN,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_API_GATEWAY_URL: process.env.NEXT_PUBLIC_API_GATEWAY_URL,
  NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL:
    process.env.NEXT_PUBLIC_PLATFORM_PORTAL_BASE_URL,
};

export function requirePublicBaseUrl(
  envName: string,
  devFallback: string,
): string {
  // eslint-disable-next-line security/detect-object-injection -- envName is provided by trusted caller (compile-time literal)
  const fromEnv = PUBLIC_ENV[envName]?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  if (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV === 'production' &&
    typeof window === 'undefined'
  ) {
    throw new Error(
      `${envName} is required in production builds of admin-web.`,
    );
  }
  return devFallback;
}
