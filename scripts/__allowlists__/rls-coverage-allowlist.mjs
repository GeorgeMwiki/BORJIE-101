/**
 * RLS-coverage allow-list.
 *
 * Drizzle pgTable declarations whose schema carries `tenant_id` (or an
 * equivalent tenant-scoping column) but are intentionally exempt from the
 * `ENABLE ROW LEVEL SECURITY` + tenant policy requirement.
 *
 * 2026-06-11 RECONCILIATION (why this file shrank from 120 entries to 1)
 * ---------------------------------------------------------------------
 * The bulk of this list was never a real exemption set — it was a workaround
 * for blind spots in `scripts/audit-rls-coverage.mjs`. That scanner only read
 * `src/migrations` (never the 72-file `drizzle/` baseline), only recognised
 * dynamic ENABLE/POLICY loops whose array variable was literally named
 * `tenant_tables`, could not see inline `FOREACH … IN ARRAY ARRAY[…]` loops,
 * and could not see dollar-quoted `format($pol$ CREATE POLICY …$pol$)` strings.
 * Every table it could not credit was parked here as a "tracked gap".
 *
 * Once the scanner was made loop/baseline-aware, those tables resolved as
 * genuinely covered, so their allow-list entries were removed (115 of them).
 * Migration 0336 then closed the only 5 truly-uncovered tenant tables
 * (org_memberships, invite_codes, geo_label_types, geo_nodes, geo_assignments —
 * each isolated on a non-`tenant_id` column). A further 55 entries pointed at
 * tables that no longer exist (property-domain BossNyumba relics) and were
 * dropped as stale.
 *
 * What remains is the ONE genuine architectural exemption:
 *   - `compliance_escalations` is a PLATFORM-scoped admin-internals table
 *     (admin-internals.schema.ts): it carries a `tenant_id` for context only
 *     and is read exclusively by the service-role admin client, which bypasses
 *     RLS. RLS is ENABLEd (defence-in-depth) but no per-tenant SELECT policy is
 *     declared BY DESIGN — a tenant policy would be wrong, not missing.
 *
 * Keys are the SQL table name (snake_case). Reasons must be ≥ 8 chars and
 * explain the architectural choice. Add an entry ONLY for a deliberate,
 * documented exemption — never to silence a real gap. A real gap gets a
 * migration (see 0336 for the template).
 */

export const RLS_ALLOWLIST = new Map([
  [
    'compliance_escalations',
    'ARCHITECTURAL EXEMPTION — platform-scoped admin-internals table; ' +
      'RLS ENABLEd defence-in-depth but service-role-only by design (no ' +
      'per-tenant policy). See packages/database/src/schemas/admin-internals.schema.ts.',
  ],
]);
