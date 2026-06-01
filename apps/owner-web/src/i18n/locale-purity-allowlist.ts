/**
 * BASELINE allowlist for the locale-purity guard.
 *
 * Every entry WAS an owner-web source file that hardcoded Swahili and
 * had not yet been migrated. This list is a debt ledger: it may only
 * SHRINK. The guard test fails if a listed file no longer leaks (stale
 * entry) or if an unlisted file starts leaking (new mixing).
 *
 * Baseline 2026-05-31 (116) → chrome sweep (103) → full migration: 0.
 * Every owner-web Swahili literal now lives under `src/i18n/` (the dict
 * or `src/i18n/strings/*` modules), which the guard exempts.
 *
 * KEEP THIS AT []. Do NOT add entries to silence the guard — route any
 * new bilingual copy through the i18n dictionaries / strings modules.
 */

export const SWAHILI_LEAK_ALLOWLIST: readonly string[] = [];
