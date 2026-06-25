/**
 * BASELINE allowlist for the admin-web raw-enum-badge-label guard.
 *
 * Every entry WOULD be an admin-web component / page `.tsx` that renders a RAW
 * bounded-enum token as a badge/pill label — `<StubBadge tone={tone(x)}>{x}` /
 * `<Badge>{row.outcome}</Badge>` — instead of localizing the label through
 * `localizeEnumLabel(MAP, value, locale)` (or any `pickByLocale` localizer).
 * That raw token (e.g. `Indexed`, `High`, `running`, `OK`, `executed`) is a
 * SURFACE-level EN/SW mix under the `sw` toggle. This list is a debt ledger: it
 * may only SHRINK. The guard test fails if a listed file is no longer an
 * offender (stale entry) or if an unlisted file becomes one (a new raw-enum
 * badge sneaking in).
 *
 * Baseline 2026-06-25: [] — the round-11 Class-B pass introduced the shared
 * `@/lib/internal/enum-labels` maps and routed every bounded-enum badge label
 * (corpus status, experiment status, compliance/support severity, killswitch
 * state, junior + junior-AI status, rollback kind, daily-brief alert kind,
 * decision outcome + the DecisionPill, flow posture) through
 * `localizeEnumLabel`. The console is verified free of raw-enum badge labels,
 * so the ledger starts at zero.
 *
 * KEEP THIS AT []. Do NOT add entries to silence the guard — add the token's
 * `{ en, sw }` pair to the right map in `enum-labels.ts` and render the label
 * through `localizeEnumLabel(MAP, value, locale)`.
 */

export const RAW_ENUM_BADGE_ALLOWLIST: readonly string[] = [];
