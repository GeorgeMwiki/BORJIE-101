/**
 * @borjie/error-catalog — the SHARED CODE -> { en, sw } gateway-error catalog.
 *
 * One source of truth for turning a gateway `error.code` into a localized,
 * user-safe message in the active locale, importable by ALL four client apps
 * (owner-web, admin-web, workforce-mobile, buyer-mobile) and gateway/services.
 *
 * The canon: never render a raw English `error.message` off the wire — under
 * `sw` that is language mixing. Always localize through `localizeApiError`.
 *
 * Usage:
 *   import { localizeApiError } from "@borjie/error-catalog";
 *   const text = localizeApiError(err, locale); // locale: "en" | "sw"
 */
export { localizeApiError, hasLocalizedError } from "./localize.js";
export { ERROR_MESSAGES } from "./messages.js";
export { GENERIC_FALLBACK } from "./fallback.js";
export type { CatalogLocale, LocalizedMessage, ApiErrorLike } from "./types.js";
