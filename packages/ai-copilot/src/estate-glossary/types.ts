/**
 * Estate-glossary public types.
 *
 * Agent LINGDNA (Wave 28) — multilingual estate-management glossary.
 * Every term carries an English canonical form, translations into the 11
 * supported locales, jurisdiction tags, a category, a short definition,
 * and optional legal-statute citations so downstream copilots (legal-
 * drafter, compliance, tenant-facing chat) can ground their output in
 * real, verifiable text instead of hallucinating.
 *
 * Immutability: every entry is a plain JSON object; callers MUST treat
 * them as read-only. The lookup API returns references into a frozen
 * registry.
 */

/**
 * BCP-47 locale code. The platform currently supports the 11 locales
 * below. Keep this list short-and-sweet — each added locale is a
 * curation burden across ~2k glossary entries.
 */
export type Locale =
  | 'en'
  | 'sw'
  | 'ar'
  | 'fr'
  | 'de'
  | 'ko'
  | 'ja'
  | 'pt'
  | 'es'
  | 'zh'
  | 'hi';

export const ALL_LOCALES: readonly Locale[] = Object.freeze([
  'en',
  'sw',
  'ar',
  'fr',
  'de',
  'ko',
  'ja',
  'pt',
  'es',
  'zh',
  'hi',
]);

/**
 * ISO-3166 alpha-2 country code. Used to scope a term to one or more
 * jurisdictions. Some terms are global (e.g. "lease") and tag many
 * jurisdictions; others are local (e.g. "ground rent" or "council tax").
 */
export type Jurisdiction = string;

export type GlossaryCategory =
  | 'tenancy'
  | 'finance'
  | 'maintenance'
  | 'compliance'
  | 'legal_proceedings'
  | 'hr'
  | 'insurance'
  | 'marketing'
  | 'procurement';

/**
 * A citation into real statute text. `section` is free-form because
 * different jurisdictions use different numbering ("§535", "s.6",
 * "Cap 301 s.12"). `year` is the enactment / revision year.
 */
export interface LegalCitation {
  readonly jurisdiction: Jurisdiction;
  readonly statuteRef: string;
  readonly section: string;
  readonly year?: number;
}

/**
 * A glossary entry. Always populate `english`, `category`,
 * `jurisdictions`, and `definition`. Translations for non-priority
 * locales may be the empty string — callers should fall back to
 * English when that happens.
 */
export interface GlossaryEntry {
  readonly termId: string;
  readonly english: string;
  readonly translations: Readonly<Record<Locale, string>>;
  readonly jurisdictions: readonly Jurisdiction[];
  readonly category: GlossaryCategory;
  readonly definition: string;
  readonly legalCitation?: LegalCitation;
  readonly synonyms?: readonly string[];
  readonly relatedTerms?: readonly string[];
  readonly notes?: string;
}

export interface GlossarySearchFilters {
  readonly locale?: Locale;
  readonly jurisdiction?: Jurisdiction;
  readonly category?: GlossaryCategory;
  readonly limit?: number;
}

/**
 * Build a translations map with English populated and every other locale
 * initialised to the empty string. Individual data files override
 * specific locales. This keeps the data files concise and makes it
 * obvious which locales are still pending curation (`// TODO-L18N`).
 */
export function withEnglishOnly(
  english: string,
  overrides: Partial<Record<Locale, string>> = {},
): Readonly<Record<Locale, string>> {
  const base: Record<Locale, string> = {
    en: english,
    sw: '',
    ar: '',
    fr: '',
    de: '',
    ko: '',
    ja: '',
    pt: '',
    es: '',
    zh: '',
    hi: '',
  };
  const merged: Record<Locale, string> = { ...base, ...overrides, en: english };
  return Object.freeze(merged);
}
