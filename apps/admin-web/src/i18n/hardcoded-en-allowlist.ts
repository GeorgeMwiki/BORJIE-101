/**
 * BASELINE allowlist for the admin-web hardcoded-EN-component guard.
 *
 * Every entry WOULD be an admin-web component / page `.tsx` that renders
 * user-facing English prose yet has ZERO locale awareness — the SURFACE-level
 * EN/SW mix under the `sw` toggle (English body under Swahili chrome). This
 * list is a debt ledger: it may only SHRINK. The guard test fails if a listed
 * file is no longer an offender (stale entry) or if an unlisted file becomes
 * one (new hardcoded-EN surface sneaking in).
 *
 * Baseline 2026-06-25: [] — round 10 enumerated the full hardcoded-EN admin
 * surface (19 files: the /ask trio + audit/privacy/slice panels, the
 * session-replay pages + viewer, the superpower drawer/chips, the daily-brief
 * card, the industry/jarvis/decision-trace/mission-eval/rollback shells, the
 * feedback widget, and the root global-error boundary) and routed every
 * rendered string through `pickByLocale(locale, { en, sw })`, server-seeding
 * the active locale so there is no first-paint split. The console is verified
 * free of hardcoded-EN surfaces, so the ledger starts at zero.
 *
 * KEEP THIS AT []. Do NOT add entries to silence the guard — every rendered
 * string stays single-locale: resolve the active locale (server components via
 * `readLocaleFromServerCookies`, client components via the server-seeded
 * `useLocale()`), then `pickByLocale(locale, { en, sw })` every string.
 */

export const HARDCODED_EN_ALLOWLIST: readonly string[] = [];
