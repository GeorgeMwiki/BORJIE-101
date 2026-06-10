/**
 * Hook-free locale constants — safe to import from BOTH server modules
 * (locale.server.ts → next/headers) and client modules (locale.ts →
 * useLocale hook). Keeping these out of locale.ts prevents the client
 * React hooks in that file from being dragged into the server bundle
 * (which Next rejects with a "useState only works in a Client Component"
 * error). Single source for the cookie name + default across both sides.
 */

export type Locale = 'en' | 'sw';

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'borjie_locale';

/**
 * Read the locale from `document.cookie`. Returns the project default when the
 * cookie is missing or malformed. SSR-safe — returns the default on the server.
 * HOOK-FREE, so it is safe to import from server modules (the `useLocale` hook
 * lives in `locale.ts`, which a Server Component must never pull in).
 */
export function readLocaleFromDocument(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`),
  );
  if (!match) return DEFAULT_LOCALE;
  const value = decodeURIComponent(match[1]!);
  return value === 'sw' || value === 'en' ? value : DEFAULT_LOCALE;
}

/**
 * Pick one of two locale-strict variants. Never returns a concatenated
 * "EN / SW" string — the bug this helper exists to prevent. HOOK-FREE, so both
 * server modules (e.g. `notifications/page.tsx`) and client modules import it
 * from here without dragging React hooks into the server bundle.
 */
export function pickByLocale<T>(
  locale: Locale,
  variants: { readonly en: T; readonly sw: T },
): T {
  return locale === 'sw' ? variants.sw : variants.en;
}
