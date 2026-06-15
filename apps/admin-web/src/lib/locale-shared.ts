/**
 * Hook-free locale helpers for the admin console — safe to import from BOTH
 * server modules (the root layout, `locale.server.ts`) and client modules
 * (`locale.ts` → the `useLocale` hook). Keeping the pure `pickByLocale`
 * helper out of `locale.ts` prevents the React hooks in that file from being
 * dragged into the server bundle (which Next rejects). Single source for the
 * cookie name + default across both sides.
 *
 * Mirrors apps/owner-web/src/lib/locale-shared.ts — same cookie name, same
 * DEFAULT_LOCALE, same absolute-toggle guarantee (zero EN/SW mixing).
 */

export type Locale = 'en' | 'sw';

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'borjie_locale';

/**
 * Read the locale from `document.cookie`. Returns the project default when the
 * cookie is missing or malformed. SSR-safe — returns the default on the
 * server. HOOK-FREE, so server modules can import it safely.
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
 * "EN / SW" string — that is the bug this helper exists to prevent. HOOK-FREE,
 * so both server and client modules can import it.
 */
export function pickByLocale<T>(
  locale: Locale,
  variants: { readonly en: T; readonly sw: T },
): T {
  return locale === 'sw' ? variants.sw : variants.en;
}
