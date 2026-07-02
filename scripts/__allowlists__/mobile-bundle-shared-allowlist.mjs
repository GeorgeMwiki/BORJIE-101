/**
 * Baseline-ratchet allowlist for the workforce-mobile i18n bundle
 * `sw === en` shared-value check (audit-mobile-zero-mix.mjs).
 *
 * A key whose Swahili value is byte-identical to its English value is an
 * English-in-sw LEAK (the burnPrefix / catPricingLabel class) UNLESS the
 * value is a legitimately shared token: a language ENDONYM (a language is
 * named in its own tongue in a picker), a proper noun / mineral / equipment
 * name, an adopted domain loanword, a product term, or sample data.
 *
 * This set is the RATCHET floor: every entry is a value that is CORRECT to
 * be identical across locales. A NEW `sw === en` value not in this set fails
 * CI — that is the guard that stops the next untranslated-string regression.
 * Adding an entry is a deliberate act (justify it in review); it never
 * silently grows.
 */
export const MOBILE_BUNDLE_SHARED_ALLOWLIST = new Set([
  // Language endonyms — a language names itself the same in every locale.
  'English',
  'Kiswahili',
  // Mineral / proper nouns (identical in sw + en).
  'Tanzanite',
  // Equipment names (identical in sw + en).
  'Auger',
  // Product / regime terms coined in-product (not translated).
  'USD-cliff',
  'Brand-Lock',
  // Sample asset-id data (proper-noun identifiers).
  'Excavator-1, Truck-3, Loader-2',
  // Adopted domain loanwords — the sw bundle uses these consistently as
  // Swahili-adopted mining terms (see wm06ScoopOk = "Scoop imerekodiwa…").
  'Scoop',
  'SCOOP',
]);
