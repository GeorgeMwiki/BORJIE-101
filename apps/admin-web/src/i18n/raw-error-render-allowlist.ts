/**
 * BASELINE allowlist for the admin-web raw-error-message render guard.
 *
 * Every entry WOULD be an admin-web component / page `.tsx` that renders a RAW
 * gateway error message (`query.error.message` / `err.message`) to the user
 * instead of localizing it through `localizeApiError(err, locale)` from
 * `@borjie/error-catalog` — the SURFACE-level EN/SW mix under the `sw` toggle
 * (an English diagnostic under Swahili chrome on every failure). This list is a
 * debt ledger: it may only SHRINK. The guard test fails if a listed file is no
 * longer an offender (stale entry) or if an unlisted file becomes one (a new
 * raw-error render sneaking in).
 *
 * Baseline 2026-06-25: [] — the round-11 Class-A pass made the api-client carry
 * `{ code, message }`, made `unwrap` / the query layer throw a code-carrying
 * `ApiClientError`, and routed every internal-console error-state render +
 * onError toast through `localizeApiError(err, locale)`. The console is
 * verified free of raw-error renders, so the ledger starts at zero.
 *
 * KEEP THIS AT []. Do NOT add entries to silence the guard — localize through
 * `localizeApiError(err, locale)`; the raw `message` is dev / log channel only.
 */

export const RAW_ERROR_RENDER_ALLOWLIST: readonly string[] = [];
