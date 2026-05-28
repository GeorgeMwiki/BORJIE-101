# RLS Coverage Matrix — Scale-Hardening Audit

**Last Updated:** 2026-05-28
**Wave:** SCALE HARDENING (Wave 28+ continuation)
**Scope:** Every tenant-scoped table created or touched in
`packages/database/src/migrations/0077..0090_*.sql`. Earlier
migrations (`0001..0076`) were last audited in
`0173_force_rls_sweep.sql` + `0175_fix_rls_type_coercion.sql`
and are out of scope for this pass.

## Constitutional invariant

`CLAUDE.md` hard rule: **"RLS is FORCE-enabled on every tenant-scoped
table."**

Three things must be true for every tenant-scoped table:

1. `tenant_id` column is `NOT NULL`.
2. Both `ENABLE ROW LEVEL SECURITY` *and* `FORCE ROW LEVEL SECURITY`
   are set on the table.
3. A `tenant_isolation` policy exists with both `USING` and
   `WITH CHECK` clauses bound to
   `current_setting('app.current_tenant_id', true)` (or the legacy
   `app.tenant_id` mirror — see "GUC duality" below).

A table that violates any of the three is a CRITICAL leak — a single
owner-roled connection or service-role token can read or mutate any
tenant's rows.

## GUC duality (intentional)

Two GUC names are read by RLS policies in this codebase:

- `app.current_tenant_id` — canonical, bound by
  `services/api-gateway/src/middleware/` per request.
- `app.tenant_id` — legacy mirror bound at the same site so older
  migrations (0146, 0156 helper) keep working unchanged. The
  middleware `withTenantContext()` sets BOTH in the same transaction
  so policies that reference either GUC name resolve correctly.

`packages/database/src/rls/with-tenant-context.ts` is the single
canonical binder. Repository code never reads `process.env` for the
tenant id and never double-filters in app code.

## Coverage matrix (0077..0090)

| Migration | Table(s) created / altered | tenant_id NOT NULL | ENABLE RLS | FORCE RLS | Policy | Verdict |
|-----------|----------------------------|-------------------:|-----------:|----------:|--------|---------|
| `0077_pilot_feedback.sql` | `pilot_feedback` | yes | yes | **no (closed by 0090)** | `pilot_feedback_tenant_isolation` | **GAP — closed by 0090** |
| `0078_pilot_issue_links.sql` | `pilot_issue_links` | n/a (platform-service, sentry fingerprints not tenant-scoped) | no | no | none | **INTENTIONAL — documented in 0078 header** |
| `0079_owner_brief_snapshots.sql` | `owner_brief_snapshots` | yes | yes | yes | `obs_tenant_isolation` | pass |
| `0080_mining_tasks_toolbox.sql` | `mining_tasks` | yes | yes | yes | `mining_tasks_tenant_isolation` | pass |
| `0080_mining_tasks_toolbox.sql` | `mining_toolbox_talks` | yes | yes | yes | `mining_toolbox_talks_tenant_isolation` | pass |
| `0081_mining_escalations_approvals.sql` | `mining_escalations` | yes | yes | yes | `mining_escalations_tenant_isolation` | pass |
| `0081_mining_escalations_approvals.sql` | `mining_approval_items` | yes | yes | yes | `mining_approval_items_tenant_isolation` | pass |
| `0082_misc_pre_launch_tables.sql` | `incidents` (ALTER) | inherited | inherited | inherited | inherited | pass (ALTER only) |
| `0082_misc_pre_launch_tables.sql` | `csr_plans` (ALTER) | inherited | inherited | inherited | inherited | pass (ALTER only) |
| `0082_misc_pre_launch_tables.sql` | `mining_sic_pings` | yes | yes | yes | `mining_sic_pings_tenant_isolation` | pass |
| `0083_document_intelligence.sql` | `document_uploads` (ALTER) | inherited | inherited | inherited | inherited | pass (ALTER only) |
| `0083_document_intelligence.sql` | `document_intelligence_sessions` | yes | yes | yes | `dis_tenant_isolation` | pass |
| `0083_document_intelligence.sql` | `document_corpus_links` | yes | yes | yes | `dcl_tenant_isolation` | pass |
| `0084_drafts_registry.sql` | `document_drafts` | yes | yes | yes | `document_drafts_tenant_isolation` | pass |
| `0085_tenant_account_kind.sql` | `tenants` (ALTER) | n/a (tenants is the root identity table; RLS established in earlier migration) | inherited | inherited | inherited | pass (ALTER only) |
| `0086_workforce_invitations.sql` | `workforce_invitations` | yes | yes | yes | `workforce_invitations_tenant_isolation` | pass |
| `0087_buyer_account_kind.sql` | `buyers` (ALTER + RLS top-up) | yes | yes (re-applied) | yes (re-applied) | inherited | pass |
| `0088_unified_personal_kb.sql` | `persons` | n/a (platform-level identity registry) | no | no | none | **INTENTIONAL — documented in 0088 header** |
| `0088_unified_personal_kb.sql` | `person_links` | n/a (platform-level join) | no | no | none | **INTENTIONAL — same header** |
| `0088_unified_personal_kb.sql` | `personal_memory_cells` | n/a (federated, R8 audit precedent matches `platform_memory_cells`) | no | no | none | **INTENTIONAL — `app.current_person_id` GUC + boundary tagger gate it** |
| `0089_owner_reminders_and_tabs.sql` | `reminders` | yes | yes | yes | `reminders_tenant_isolation` | pass |
| `0089_owner_reminders_and_tabs.sql` | `owner_tabs` | yes | yes | yes | `owner_tabs_tenant_isolation` | pass |
| `0090_scale_hardening_rls_force.sql` | `pilot_feedback` (FORCE top-up) | — | — | yes (idempotent ALTER) | — | **closes 0077 gap** |

### Tally

- Tenant-scoped tables created in 0077..0089: **15** (16 if you count
  the `pilot_feedback` row that 0077 missed).
- Tables with FORCE RLS today (after 0090 applies): **15 / 15**.
- Intentional-no-RLS tables (documented in their migration header):
  **4** (`pilot_issue_links`, `persons`, `person_links`,
  `personal_memory_cells`).
- New migrations added by this audit: **0090_scale_hardening_rls_force.sql**.
- Tables left with a known gap after 0090: **0**.

## Tables intentionally excluded from RLS (documented)

| Table | Migration | Reason | Symmetric protection |
|-------|-----------|--------|----------------------|
| `pilot_issue_links` | 0078 | Platform-service de-duplication index. Sentry fingerprints are not tenant-scoped — they identify error-type-level fingerprints that may surface across multiple tenants. | Access only from the platform service-role connection (Sentry → GitHub bridge) and the consolidation-worker. No tenant-supplied query path. |
| `persons` | 0088 | Canonical human identity. One row per person, can wear many hats across many tenants. RLS would force the brain to query for every (person, tenant) pair separately. | api-gateway service-role connection + future `app.current_person_id` GUC predicate. |
| `person_links` | 0088 | Many-hat join table. Tenant_id is a column but used as a filter, not an isolation gate (one person legitimately spans tenants). | Same as `persons`. |
| `personal_memory_cells` | 0088 | Federated personal memory. Mirrors `platform_memory_cells` precedent from cognitive-memory.schema.ts §159. Symmetric isolation via brain orchestrator's `boundary-tagger` filter at turn time (R8 audit). | `app.current_person_id` GUC + boundary tagger + brain audit chain. |

A `BYPASSRLS` role is **not** granted to any application role. The
Supabase `service_role` connection intentionally bypasses RLS at the
role level for cross-tenant background jobs; that bypass is exercised
only through `withServiceRoleContext()` (sets `app.is_service_role`)
which is itself audited via the hash-chained ai_audit_chain.

## How to add a tenant-scoped table going forward

1. In your migration, the boilerplate is exactly:

```sql
CREATE TABLE IF NOT EXISTS your_table (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  -- ... your columns
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_your_table_tenant
  ON your_table (tenant_id, created_at DESC);

ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE your_table FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'your_table'
       AND policyname = 'your_table_tenant_isolation'
  ) THEN
    CREATE POLICY your_table_tenant_isolation
      ON your_table
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
```

2. Drop a Drizzle schema in `packages/database/src/schemas/your-table.schema.ts`
   that mirrors the columns.

3. Add a row to this matrix on next audit pass.

4. CI gate: `borjie-audit-coverage.yml` (existing) scans new migrations
   for `tenant_id` references without `FORCE ROW LEVEL SECURITY`. Any
   new gap will fail the PR.

## References

- `CLAUDE.md` hard rules — RLS-FORCE invariant
- `Docs/MEMORY.md` — § "Hard invariants (NEVER violate)"
- `Docs/CODEMAPS/database.md` — RLS workflow
- `packages/database/src/rls/with-tenant-context.ts` — canonical binder
- `packages/database/src/migrations/0173_force_rls_sweep.sql` — prior
  pass over 0001..0172
- `packages/database/src/migrations/0090_scale_hardening_rls_force.sql`
  — this pass's FORCE top-up
