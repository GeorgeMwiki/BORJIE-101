/**
 * Hardcoded-tax-rate-coverage allow-list.
 *
 * Production files that legitimately reference a numeric tax-rate literal
 * (`0.16`, `0.18`, `0.075`, `0.30`, etc.) in a financial-tax context
 * outside `packages/compliance-plugins/` and outside the jurisdictional
 * registry. Test files are auto-allowlisted at the scanner level.
 *
 * The platform's vision: tax rates are per-jurisdiction parameters that
 * MUST live in the compliance-plugin or jurisdictional-rules registry.
 * A literal `0.16` in business logic silently couples that path to one
 * country's VAT, which silently breaks for every other jurisdiction.
 *
 * Legitimate categories tracked here:
 *   1. Jurisdiction-pinned adapter modules — the rate is part of THIS
 *      country's wire-protocol invariant (e.g. KRA MRI invariant check
 *      validates `taxableIncome * 0.10`; KRA is Kenya-only by definition
 *      so the 10% rate is the Kenyan rental-income MRI rate).
 *   2. Country-specific MCP server adapters (`mcp-server-firs` IS the
 *      Nigerian FIRS adapter; the Nigerian VAT rate is encoded inline
 *      because FIRS = Federal Inland Revenue Service of Nigeria).
 *   3. Report-format modules pinned to a single tax authority
 *      (`services/reports/src/compliance/tz-tra-formatter.ts` is the
 *      Tanzanian TRA formatter; encodes the Tanzanian WHT rate).
 *
 * Adding a new tax-rate literal in business logic → register here with a
 * justification ≥ 8 characters, OR move it to the appropriate
 * compliance-plugin.
 *
 * Keys are paths RELATIVE to the repo root.
 */

export const HARDCODED_TAX_RATE_ALLOWLIST = new Map([
  // ─── Jurisdiction-pinned tool invariants ───────────────────────────
  [
    'packages/central-intelligence/src/kernel/tool-spec/hq-tools/platform.file_kra_mri.ts',
    'KRA MRI tool invariant-checks taxableIncome*0.10; KRA is Kenya-only and 10% is the Kenyan rental-MRI rate.',
  ],

  // ─── Country-specific MCP server adapters ──────────────────────────
  [
    'services/mcp-server-firs/src/adapter.ts',
    'FIRS adapter encodes Nigerian VAT_RATE=0.075 per Finance Act 2020 §15; FIRS is Nigeria-only by definition.',
  ],

  // ─── Compliance report formatters pinned to one authority ─────────
  [
    'services/reports/src/compliance/tz-tra-formatter.ts',
    'TZ-TRA formatter encodes Tanzanian WHT_RATE=0.1 per TRA rules; TRA is Tanzania-only by definition.',
  ],
]);
