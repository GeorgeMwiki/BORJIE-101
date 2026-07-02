/**
 * Allowlist for `audit-consent-sw-coverage.mjs`.
 *
 * Ratchet contract: every entry is a repo-relative path that IS ALLOWED
 * to carry an un-t()-wrapped English consent literal (justified, e.g. a
 * non-customer internal debug surface). A stale entry (path no longer
 * exists) FAILS the scanner — the allowlist may only shrink toward zero.
 *
 * Start EMPTY: the mining consent surfaces are all already t()-wrapped.
 * Do not add an entry to silence a real leak — fix the surface instead.
 */
export const CONSENT_SW_ALLOWLIST = new Set([]);
