import type { ApiErrorLike, CatalogLocale } from "./types.js";
import { ERROR_MESSAGES } from "./messages.js";
import { GENERIC_FALLBACK } from "./fallback.js";

/**
 * Extract a normalized UPPER_SNAKE code from any accepted input.
 * Accepts an ApiError-like envelope, a bare `{ code }`, or a raw code string.
 */
function extractCode(input: ApiErrorLike | { code?: string | null } | string | null | undefined): string {
  if (typeof input === "string") return input.trim().toUpperCase();
  const raw = input?.code;
  if (typeof raw === "string") return raw.trim().toUpperCase();
  return "";
}

/**
 * Resolve a gateway API error to a LOCALIZED, user-safe message in the active
 * locale. This is the ONLY function client apps should use to render a gateway
 * error — it NEVER returns a raw English `error.message` off the wire.
 *
 * Resolution:
 *   - known user-reachable 4xx code  -> its localized { en, sw } copy
 *   - unknown code / 5xx-infra / miss -> the single generic localized fallback
 *
 * @param errorOrCode an ApiError-like object, `{ code }`, or a raw code string
 * @param locale      the active locale ("en" | "sw"); follows the user, never
 *                    hardcoded by the caller
 */
export function localizeApiError(
  errorOrCode: ApiErrorLike | { code?: string | null } | string | null | undefined,
  locale: CatalogLocale,
): string {
  const code = extractCode(errorOrCode);
  const entry = code ? ERROR_MESSAGES[code] : undefined;
  const message = entry ?? GENERIC_FALLBACK;
  return message[locale];
}

/**
 * True when the catalog carries localized copy for this code (a user-reachable
 * 4xx). Useful for callers that want to branch on catalog coverage. A `false`
 * means `localizeApiError` will return the generic fallback.
 */
export function hasLocalizedError(
  errorOrCode: ApiErrorLike | { code?: string | null } | string | null | undefined,
): boolean {
  const code = extractCode(errorOrCode);
  return code.length > 0 && code in ERROR_MESSAGES;
}
