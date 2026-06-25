/**
 * @borjie/error-catalog — shared types.
 *
 * The catalog is a pure-data, framework-free module (no React, no node APIs)
 * so it imports cleanly into the Next web apps (owner-web, admin-web) AND the
 * Expo mobile apps (workforce-mobile, buyer-mobile) AND gateway/services.
 */

/**
 * Supported locales. Borjie ships bilingual en/sw with ABSOLUTE separation:
 * when a locale is active, ZERO copy from the other locale may render.
 */
export type CatalogLocale = "en" | "sw";

/**
 * A single localized error message. BOTH locales are mandatory — a missing
 * `sw` (or `en`) is a parity break and a build/CI failure, never a silent
 * cross-language fallback.
 */
export interface LocalizedMessage {
  readonly en: string;
  readonly sw: string;
}

/**
 * The shape of an API error envelope as emitted by the gateway:
 * `c.json({ success: false, error: { code, message } }, status)`.
 * The helper accepts this, a bare `{ code }`, or a raw code string.
 */
export interface ApiErrorLike {
  readonly code?: string | null;
  readonly message?: string | null;
}
