import type { LocalizedMessage } from "./types.js";

/**
 * The single generic localized fallback. Returned for ANY code that is not a
 * user-actionable 4xx in the catalog: unknown codes, 5xx-infra codes
 * (*_FAILED / *_UNAVAILABLE / *_ERROR / DB_* / DATABASE_*), and
 * internal/not-implemented/not-configured codes that must never surface raw
 * English to the user.
 *
 * The SW string matches the canonical generic-error register already used
 * across the apps ("Hitilafu imetokea. Tafadhali jaribu tena ...") so error
 * copy stays consistent and native-quality.
 */
export const GENERIC_FALLBACK: LocalizedMessage = {
  en: "Something went wrong. Please try again.",
  sw: "Hitilafu imetokea. Tafadhali jaribu tena baada ya muda mfupi.",
};
