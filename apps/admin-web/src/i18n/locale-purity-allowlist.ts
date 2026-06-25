/**
 * BASELINE allowlist for the admin-web locale-purity guard.
 *
 * Every entry WOULD be an admin-web source file with a string literal that
 * mixes English and Swahili in one rendered context (code-switched eyebrow,
 * subtitle, label, etc.). This list is a debt ledger: it may only SHRINK.
 * The guard test fails if a listed file no longer mixes (stale entry) or if
 * an unlisted file starts mixing (new code-switching sneaking in).
 *
 * Baseline 2026-06-25: [] — round 8 retired the off-mandate property/Sheng
 * skills and closed the admin EN/SW mixing (e.g. the `Platform - Uangalifu`
 * eyebrow → server-seeded single-locale `pickByLocale`). The admin console
 * is verified free of intra-string code-switching, so the ledger starts at
 * zero.
 *
 * KEEP THIS AT []. Do NOT add entries to silence the guard — every rendered
 * string stays single-locale (route bilingual copy through
 * `pickByLocale(locale, { en, sw })`, one language per branch).
 */

export const LANGUAGE_MIX_ALLOWLIST: readonly string[] = [];
