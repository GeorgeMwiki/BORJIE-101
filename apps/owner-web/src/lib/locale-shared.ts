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
