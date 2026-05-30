/**
 * Server-side translation helper.
 *
 * Used in non-React contexts (services, route handlers, background jobs)
 * that still need to produce user-facing strings in the caller's language.
 * Reads the same translation trees the React `t()` hook uses so the single
 * source of truth lives in the host-supplied translation map.
 *
 * Missing-key behaviour matches the client-side resolver: returns an empty
 * string. Never falls back to a synthetic humanized label or a hardcoded
 * default.
 *
 * Ported verbatim from sibling-port src/core/i18n/server-t.ts with host-supplied
 * translation tree instead of sibling-port's monolithic translations.ts import.
 */

import type { Language } from "./languages";

export type ServerTranslations = Readonly<
  Record<Language, Record<string, unknown>>
>;

/**
 * Resolve a dot-notation key against the active language tree. Returns ""
 * if missing — the caller decides whether to swap to a UI retry state or
 * leave the label blank.
 */
export function serverT(
  translations: ServerTranslations,
  key: string,
  language: Language,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const tree = translations[language];
  if (!tree) return "";
  const parts = key.split(".");
  let current: unknown = tree;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") return "";
  if (!vars) return current;
  return current.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return match;
  });
}

/**
 * Convenience helper for bilingual "pick-one" cases: returns the translated
 * string if present, otherwise returns null so the caller can branch on
 * missing rather than silently rendering empty.
 */
export function serverTOrNull(
  translations: ServerTranslations,
  key: string,
  language: Language,
): string | null {
  const value = serverT(translations, key, language);
  return value === "" ? null : value;
}
