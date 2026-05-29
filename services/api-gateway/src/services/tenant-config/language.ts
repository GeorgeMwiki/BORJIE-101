/**
 * Language helpers — Issue #207 (world-scale tenants), WS-2.
 *
 * Centralises the bilingual sw/en pick-up so the rest of the
 * application never re-implements the "what language does THIS
 * tenant want?" logic.
 *
 * The catalogue is intentionally extensible: adding fr/pt/es/id at
 * migration 0143 widened the CHECK constraint to admit them, and the
 * lookup table below now lists them with their human-facing labels.
 * Adding a new language is a row in `LANGUAGE_CATALOGUE`.
 */

import type { SupportedLanguage, TenantConfig } from './types.js';
import { SUPPORTED_LANGUAGES } from './types.js';

export interface LanguageCatalogueEntry {
  readonly code: SupportedLanguage;
  /** BCP-47 base. */
  readonly bcp47: string;
  /** Human-facing name in English. */
  readonly nameEn: string;
  /** Human-facing endonym (own-language name). */
  readonly nameEndonym: string;
  /** ISO-639-1 country marker (when relevant). */
  readonly fallbackTo: SupportedLanguage;
}

export const LANGUAGE_CATALOGUE: ReadonlyArray<LanguageCatalogueEntry> =
  Object.freeze([
    Object.freeze({
      code: 'sw',
      bcp47: 'sw-TZ',
      nameEn: 'Swahili (Tanzania)',
      nameEndonym: 'Kiswahili',
      fallbackTo: 'en',
    }),
    Object.freeze({
      code: 'sw-KE',
      bcp47: 'sw-KE',
      nameEn: 'Swahili (Kenya)',
      nameEndonym: 'Kiswahili',
      fallbackTo: 'sw',
    }),
    Object.freeze({
      code: 'en',
      bcp47: 'en-US',
      nameEn: 'English',
      nameEndonym: 'English',
      fallbackTo: 'en',
    }),
    Object.freeze({
      code: 'fr',
      bcp47: 'fr-FR',
      nameEn: 'French',
      nameEndonym: 'Français',
      fallbackTo: 'en',
    }),
    Object.freeze({
      code: 'pt',
      bcp47: 'pt-BR',
      nameEn: 'Portuguese',
      nameEndonym: 'Português',
      fallbackTo: 'en',
    }),
    Object.freeze({
      code: 'es',
      bcp47: 'es-CL',
      nameEn: 'Spanish (Chile)',
      nameEndonym: 'Español',
      fallbackTo: 'en',
    }),
    Object.freeze({
      code: 'id',
      bcp47: 'id-ID',
      nameEn: 'Indonesian',
      nameEndonym: 'Bahasa Indonesia',
      fallbackTo: 'en',
    }),
  ]);

/**
 * Returns the catalogue entry for a language code, or the English
 * fallback when the code is unknown.
 */
export function getLanguageEntry(
  code: string,
): LanguageCatalogueEntry {
  const match = LANGUAGE_CATALOGUE.find((e) => e.code === code);
  if (match) return match;
  return LANGUAGE_CATALOGUE.find((e) => e.code === 'en') as LanguageCatalogueEntry;
}

/**
 * Returns the BCP-47 tag the platform should pass to `Intl.*` APIs
 * for this tenant. NEVER hardcoded — every caller MUST go through
 * this so adding a new language is a catalogue row.
 */
export function bcp47ForTenant(cfg: TenantConfig): string {
  return getLanguageEntry(cfg.defaultLanguage).bcp47;
}

/**
 * Returns a bilingual snippet `{ primary, fallback }` for the tenant —
 * primary is the tenant's language, fallback always renders so the
 * downstream UI can show both side-by-side without re-implementing
 * the choice.
 */
export function bilingualForTenant(
  cfg: TenantConfig,
  copy: Partial<Record<SupportedLanguage, string>>,
): { readonly primary: string; readonly fallback: string } {
  const entry = getLanguageEntry(cfg.defaultLanguage);
  const primary = copy[entry.code] ?? copy[entry.fallbackTo] ?? copy.en ?? '';
  const fallback = copy.en ?? copy[entry.fallbackTo] ?? primary;
  return Object.freeze({ primary, fallback });
}

/**
 * Type-narrowing helper for runtime values that may originate from a
 * tenant row column. Coerces unknown strings to 'en' rather than 'sw'
 * because the "global default" outside Tanzania is English.
 */
export function coerceSupportedLanguage(value: unknown): SupportedLanguage {
  if (typeof value !== 'string') return 'en';
  return (SUPPORTED_LANGUAGES as ReadonlyArray<string>).includes(value)
    ? (value as SupportedLanguage)
    : 'en';
}
