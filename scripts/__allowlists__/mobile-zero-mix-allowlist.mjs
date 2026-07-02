/**
 * Allowlist ratchet for `audit-mobile-zero-mix.mjs`.
 *
 * Each entry is a repo-relative path (POSIX slashes) that the mobile
 * zero-mix scanner should SKIP. Keep this empty; a real zero-mix
 * violation is a bug, never an allowlist entry. A stale entry (path no
 * longer exists) fails the run — the same ratchet shape as every other
 * `scripts/__allowlists__/*` file.
 */
export const MOBILE_ZERO_MIX_ALLOWLIST = new Set([]);
