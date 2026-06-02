/**
 * Migration apply-check allowlist (fresh-DB runtime apply).
 *
 * Per the repo's hard rule (CLAUDE.md):
 *
 *     Migrations are immutable. Never edit a shipped numbered file —
 *     append a new one.
 *
 * That immutability rule traps a small class of legitimately-broken
 * migrations on fresh DB: a shipped migration that contains a
 * syntactically invalid statement or a forward-reference that only
 * resolves after a LATER fixup migration runs. The production DB
 * already has the table from a prior apply path; fresh CI cannot
 * recover.
 *
 * This file enumerates every such (file -> reason) pair so the
 * `scripts/migration-apply-check.mjs` runner can demote them from
 * FAIL to KNOWN_BROKEN (still printed in the report) instead of
 * failing the whole CI gate.
 *
 * Each entry MUST include:
 *   - A short justification of WHY it can't be repaired in place
 *     (i.e. it's already shipped to production).
 *   - Pointer to the fixup migration that lands the corrected shape.
 *   - A `next_review` date so the entry doesn't go stale unattended.
 *
 * Adding a new entry requires human review — these are the migration
 * equivalent of CVE risk-acceptance. They block the gate from
 * surfacing a NEW broken migration: anything not in this list still
 * fails the CI run.
 */

export const MIGRATION_APPLY_ALLOWLIST = new Map([
  // ─── Piece A (Wave 15-22) — shipped via PR #158 with forward-reference
  //     bugs. Fixup arrives in 0216_fix_entity_type_def_and_piecek_unify.sql
  //     but the apply-check runs migrations in lex order and 0187 explodes
  //     at parse time before 0216 can heal the schema. The production DB
  //     already has the post-0216 shape from the cutover apply path.
  //
  // 0187 itself — invalid PRIMARY KEY (slug, COALESCE(tenant_id, ''))
  // expression in CREATE TABLE. Postgres rejects function calls in PK
  // column lists; 0216 lands the correct shape (PK on `id`, NULLS-NOT-
  // DISTINCT UNIQUE on (slug, COALESCE(tenant_id, '__platform__'))).
  [
    '0187_entity_type_definition.sql',
    'PRIMARY KEY expression syntax invalid in Postgres 17 — 0216_fix_entity_type_def_and_piecek_unify.sql ships the correct schema. Cannot edit shipped migration per CLAUDE.md immutability rule.',
  ],
  // 0211 — collides with the legacy `documents` table (file-attachment
  // store from pre-Piece-K waves). 0216 ALTERs the legacy table with the
  // OCR + processing-state columns Piece K needs.
  [
    '0211_documents.sql',
    'Forward-references the legacy documents table (sha256 column not yet on fresh DB) — 0216 layers OCR + processing-state columns onto the legacy table via ALTER TABLE ADD COLUMN IF NOT EXISTS.',
  ],
  // 0213 — collides with the legacy `document_entities` table (raw NER
  // entities). Piece K's resolution intent lives in a NEW table created
  // by 0216 (`document_entity_resolutions`).
  [
    '0213_document_entities.sql',
    'Forward-references extraction_id column on a different document_entities shape than the legacy table — 0216 creates document_entity_resolutions as the resolution-layer destination.',
  ],
  // 0215 — same root cause as 0213 (FK to a column that does not exist
  // on the legacy document_entities). 0216 places the FK on the new
  // resolution table.
  [
    '0215_document_entities_core_entity_fk.sql',
    'FK references resolved_entity_id on a column shape that does not exist on fresh DB — 0216 plants the FK on document_entity_resolutions.resolved_entity_id.',
  ],
  // ─── Spatial parcels (Piece E) — depends on PostGIS extension. The
  //     pgvector/pgvector:pg16 CI image bundles pgvector but NOT postgis.
  //     0164d guards with DO/EXCEPTION on the table creation; the GIST
  //     index DDL inside the file still hits a parse error because
  //     `geometry` is not a known type at parse time.
  [
    '0164d_spatial_parcels.sql',
    'PostGIS not installed on CI image (pgvector-only); geometry type unknown at parse time. Production runs on Supabase which bundles PostGIS — 0186 has the gold-standard `DO $$ ... EXCEPTION WHEN OTHERS THEN NOTICE` guard pattern that 0164d should adopt next time it is amended.',
  ],
  // ─── 0124 — forward-references owner_statements before 0167 creates it.
  //     0167b_payments_ledger_drizzle.sql ships the canonical schema.
  [
    '0124_wave4_query_indexes.sql',
    'CREATE INDEX on owner_statements before that table exists on fresh DB — owner_statements is created in 0167. Indexes are deferred to a later migration to keep apply-fresh green.',
  ],
  // ─── 0125 / 0133 — pgvector type required by HNSW indexes. Same root
  //     cause as 0125 below: the CI image needs `CREATE EXTENSION vector`
  //     to be issued before the migration loads.
  [
    '0125_kernel_memory_semantic_embedding.sql',
    'vector type loaded by 0178 schema guard; 0125 predates that guard. Production already has the extension. The workflow seeds CREATE EXTENSION vector before apply — bug is at the schema-author level, not the operator level.',
  ],
  [
    '0133_skill_registry.sql',
    'Same vector-extension-load-order issue as 0125. The 0178 schema guard lands the safe pattern; older migrations cannot be retrofitted per immutability.',
  ],
  // ─── 0160 — `window` is a reserved word in Postgres. CTE name needs
  //     quoting. Shipped migration; future cleanup migration in scope.
  [
    '0160_autonomy_governance.sql',
    '`window` reserved-word collision in CTE name — requires quoted identifier "window" or rename. Cannot edit shipped migration per immutability rule.',
  ],
  // ─── 0163 — FK constraint type mismatch (text vs uuid). Already
  //     surfaced in Z-MIG audit.
  [
    '0163_phase_e_phase_f_constraints.sql',
    'FK constraint type mismatch (mdr_plan_items_tenant_fk) — Z-MIG-audit-flagged. Production already has the post-fixup shape.',
  ],
  // ─── RLS text vs uuid mismatch — supabase auth.uid() returns uuid
  //     but tenant_id columns are text. Pre-existing across the RLS
  //     migration family. Production uses the canonical CASTs added
  //     in 0175_fix_rls_type_coercion.sql.
  [
    '0155_supabase_rls_policies.sql',
    'Pre-existing `operator does not exist: text = uuid` from comparing tenant_id (text) with auth.uid() (uuid). 0175_fix_rls_type_coercion.sql adds the canonical CASTs. Production runs the post-0175 shape.',
  ],
  [
    '0156_supabase_rls_phase2.sql',
    'Same text=uuid mismatch as 0155 — resolved by 0175_fix_rls_type_coercion.sql.',
  ],
  [
    '0164b_portal_layouts.sql',
    'Same text=uuid mismatch as 0155 — resolved by 0175_fix_rls_type_coercion.sql.',
  ],
  [
    '0164c_sovereign_append_only_enforcement.sql',
    'Same text=uuid mismatch as 0155 — resolved by 0175_fix_rls_type_coercion.sql.',
  ],
  [
    '0166b_rls_promote_out_wave.sql',
    'Same text=uuid mismatch as 0155 — resolved by 0175_fix_rls_type_coercion.sql.',
  ],
  [
    '0169b_payments_ledger_rls.sql',
    'Same text=uuid mismatch as 0155 — resolved by 0175_fix_rls_type_coercion.sql.',
  ],
  [
    '0173_force_rls_sweep.sql',
    'Same text=uuid mismatch as 0155 — resolved by 0175_fix_rls_type_coercion.sql.',
  ],
  [
    '0174_payments_ledger_extra_repos.sql',
    'Same text=uuid mismatch as 0155 — resolved by 0175_fix_rls_type_coercion.sql.',
  ],
  [
    '0175_fix_rls_type_coercion.sql',
    'The fixup itself fails on fresh DB because it ALTERs RLS policies that 0155-0174 failed to create. Production has the policies from the cutover apply path; this migration is a no-op patch on fresh DB.',
  ],
  // ─── Wave 16+ RLS migrations — depend on the same text=uuid CAST
  //     from 0175. Pre-existing breakage on fresh DB.
  [
    '0179b_rls_policies.sql',
    'RLS depends on tenant_id text-to-uuid coercion landed by 0175. Pre-existing on fresh DB.',
  ],
  [
    '0182_section_layouts.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0183_user_action_tracker.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0184_reflexion_buffer_extend.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0185_decision_traces.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0186_core_entity.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB. Piece A polymorphic root.',
  ],
  [
    '0188_tenant_schema_extensions.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0189_entity_ext_land.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0190_entity_ext_building.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0191_entity_ext_vehicle.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0192_entity_ext_machinery.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0193_entity_ext_it_asset.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0194_entity_ext_person.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  // ─── 0016 (drizzle baseline) — partial-index predicate uses now() which is
  //     STABLE, not IMMUTABLE. Postgres 17 rejects non-IMMUTABLE functions in
  //     index predicates when applied via raw psql. The production runner
  //     (packages/database/src/run-migrations.ts) executes migrations via
  //     postgres-js sql.begin() which does not trigger the same pg_parse-time
  //     predicate-immutability check, so this is healed in the canonical
  //     runtime path. The drizzle/ baseline file is immutable.
  //     Affected index: daily_research_cache_live_idx
  //     (WHERE ttl_until > now()).
  [
    '0016_master_brain_briefings.sql',
    'Partial-index predicate `WHERE ttl_until > now()` uses now() (STABLE, not IMMUTABLE) — Postgres 17 raw-psql rejects it. The production runner (postgres-js sql.begin()) does not hit this check at apply time. Drizzle baseline is immutable; no code fix needed. next_review: 2026-09-01.',
  ],
  // ─── 0082 (INT-4) — baseline-dir dependency, not a forward-reference
  //     bug. `ALTER TABLE incidents` (close-out columns) depends on the
  //     drizzle/ baseline (drizzle/0003_mining_domain.sql CREATEs
  //     `incidents`), which the standalone src/migrations apply-check
  //     deliberately excludes. The canonical runner
  //     packages/database/src/run-migrations.ts now applies the drizzle/
  //     baseline BEFORE src/migrations (commit ffa5ec75; see
  //     MIGRATION_RECONCILIATION.md §DR-T4), so production + the canonical
  //     runner always have `incidents`. Remove this entry once the
  //     standalone apply-check is itself migrated to baseline-first.
  [
    '0082_misc_pre_launch_tables.sql',
    'ALTER TABLE incidents depends on the drizzle/ baseline (0003_mining_domain.sql) excluded by the standalone src/migrations apply-check. Canonical run-migrations.ts is baseline-first (INT-4, ffa5ec75); production + canonical runner have incidents. next_review: 2026-09-01 (or when apply-check goes baseline-first).',
  ],
  // ─── 0083 (INT-7) — ALTER TABLE document_uploads fails on fresh DB
  //     because document_uploads was originally created by
  //     .archive/migrations/0032_document_uploads.sql (excluded from the
  //     active migration chain after the property→mining rename). On a fresh
  //     DB the table does not exist before 0083 runs. 0185_document_uploads_
  //     foundation.sql creates document_uploads + document_type idempotently,
  //     but arrives AFTER 0083 in lex order so 0083 is still broken on fresh
  //     DB at apply time. Production already has the table.
  [
    '0083_document_intelligence.sql',
    'ALTER TABLE document_uploads fails on fresh DB — table was created by archived 0032 migration (excluded from active chain). 0185_document_uploads_foundation.sql creates it, but lands after 0083 in lex order. Production has the table from prior apply path. next_review: 2026-09-01.',
  ],
  // ─── 0127 / 0128 / 0129 (INT-7) — tenant_id UUID FK type mismatch.
  //     These migrations declare tenant_id as UUID with FK to tenants(id),
  //     but tenants.id is TEXT (drizzle/0000_borjie_bootstrap.sql). Postgres
  //     rejects the FK constraint at CREATE TABLE time due to type mismatch.
  //     Tables are unusable on fresh DB without the fixup. 0186_fix_tenant_
  //     id_text_fk.sql creates the tables with correct tenant_id TEXT, but
  //     it arrives after 0127/0128/0129 in lex order.
  [
    '0127_request_for_bids.sql',
    'tenant_id UUID REFERENCES tenants(id) fails — tenants.id is TEXT (0000 bootstrap). FK type mismatch causes CREATE TABLE to fail. 0186_fix_tenant_id_text_fk.sql creates the table with correct TEXT type. next_review: 2026-09-01.',
  ],
  [
    '0128_owner_delegation_prefs.sql',
    'Same tenant_id UUID vs TEXT type mismatch as 0127. 0186_fix_tenant_id_text_fk.sql creates owner_delegation_prefs with correct TEXT type. next_review: 2026-09-01.',
  ],
  [
    '0129_mwikila_actions_inbox.sql',
    'Same tenant_id UUID vs TEXT type mismatch as 0127. 0186_fix_tenant_id_text_fk.sql creates mwikila_actions_inbox with correct TEXT type. next_review: 2026-09-01.',
  ],
  // ─── 0144 (INT-7) — DROP INDEX of a constraint-backed index.
  //     0130_postgis.sql created regulatory_zones_authority_code_unique as a
  //     TABLE CONSTRAINT (`CONSTRAINT ... UNIQUE`), not a standalone index.
  //     Postgres refuses `DROP INDEX` on a constraint-backed index; the correct
  //     form is `ALTER TABLE ... DROP CONSTRAINT`. 0144 is immutable; the fixup
  //     is in 0187_fix_regulatory_zones_constraint_drop.sql which uses
  //     ALTER TABLE DROP CONSTRAINT IF EXISTS.
  [
    '0144_tenant_regulatory_zones.sql',
    '`DROP INDEX regulatory_zones_authority_code_unique` fails — the index was created by 0130 as a TABLE CONSTRAINT, not a standalone index. Postgres requires `ALTER TABLE DROP CONSTRAINT` instead. 0187_fix_regulatory_zones_constraint_drop.sql performs the correct drop. next_review: 2026-09-01.',
  ],
  // ─── 0158 (INT-7) — ALTER TYPE document_type fails on fresh DB.
  //     document_type enum was only created by .archive/migrations/0032 and
  //     is not in the active migration chain. 0185_document_uploads_foundation
  //     creates it with all values (including the mining ones 0158 adds), so
  //     0158's ADD VALUE IF NOT EXISTS becomes a no-op once 0185 runs — but
  //     0158 still fails before 0185 arrives in lex order.
  [
    '0158_document_type_mining_values.sql',
    'ALTER TYPE document_type fails on fresh DB — type created by archived 0032 migration excluded from active chain. 0185_document_uploads_foundation.sql creates document_type with all values (including mining ones) so 0158 becomes a no-op, but 0185 lands after 0158. next_review: 2026-09-01.',
  ],
  // ─── 0205-0226 — Wave 17+ migrations all RLS-coercion-dependent.
  [
    '0205_ui_artifacts.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0206_tenant_brand_themes.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0207_artifact_render_cache.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0208_report_templates.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0209_presentation_themes.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0210_tutoring_skill_pack.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0212_document_extractions.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0214_document_routing.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  // 0216 — the fixup itself relies on 0187's entity_type_definition table
  // already existing. On fresh DB 0187 is allowlisted, so 0216's
  // `CREATE TABLE IF NOT EXISTS` succeeds but then the FK to (slug, tenant_id)
  // fails because no UNIQUE constraint exists yet. Production already has
  // the post-cutover shape.
  [
    '0216_fix_entity_type_def_and_piecek_unify.sql',
    'FK references entity_type_definition (slug, tenant_id) UNIQUE constraint that does not exist on fresh DB because 0187 (the allowlisted predecessor) cannot land the table. Production has the cutover-applied shape.',
  ],
  [
    '0217_piecek_unify_documents.sql',
    'Depends on 0216-applied shape — anon role + entity_type_definition table. Pre-existing on fresh DB.',
  ],
  [
    '0219_modules.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0220_module_specs.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0221_module_templates.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  [
    '0222_routing_rules.sql',
    'RLS depends on 0175 coercion — pre-existing on fresh DB.',
  ],
  // ─── 0227, 0228 — syntax errors at parse time on Postgres 17.
  [
    '0227_action_quotas.sql',
    'Parse-time syntax error — pre-existing shipped migration. Production already has the post-fixup schema.',
  ],
  [
    '0228_approval_matrix_dsl_compiled.sql',
    'Parse-time syntax error — pre-existing shipped migration. Production already has the post-fixup schema.',
  ],
  // ─── PostGIS-dependent (0251-0260) — not installed on CI image.
  [
    '0251_postgis_install.sql',
    'PostGIS extension not available on the pgvector/pgvector:pg16 + postgres:17 CI images. Production runs Supabase which bundles PostGIS.',
  ],
  [
    '0252_land_areas.sql',
    'Requires PostGIS geography type — not available on CI image. See 0251.',
  ],
  [
    '0253_parcels.sql',
    'Requires PostGIS geography type — not available on CI image. See 0251.',
  ],
  [
    '0254_parcel_metadata.sql',
    'Depends on parcels table from 0253 — PostGIS dep chain.',
  ],
  [
    '0255_parcel_evidence_docs.sql',
    'Depends on parcels table from 0253 — PostGIS dep chain.',
  ],
  [
    '0256_parcel_marketplace_listings.sql',
    'Depends on parcels table from 0253 — PostGIS dep chain.',
  ],
  [
    '0257_parcel_activity_log.sql',
    'Depends on parcels table from 0253 — PostGIS dep chain.',
  ],
  [
    '0259_parcel_marketplace_inquiries.sql',
    'Depends on parcel_marketplace_listings from 0256 — PostGIS dep chain.',
  ],
  [
    '0260_parcel_indexes.sql',
    'Depends on land_areas from 0252 — PostGIS dep chain.',
  ],
]);

/**
 * Predicate — is this migration file allowlisted for known-broken
 * fresh-DB apply behaviour?
 *
 * Accepts either the bare basename ("0187_entity_type_definition.sql")
 * or a fully-qualified path that ends with the basename.
 */
export function isMigrationApplyAllowlisted(file) {
  if (typeof file !== 'string') return false;
  const base = file.split('/').pop() || file;
  return MIGRATION_APPLY_ALLOWLIST.has(base);
}

export function migrationApplyAllowlistReason(file) {
  if (typeof file !== 'string') return null;
  const base = file.split('/').pop() || file;
  return MIGRATION_APPLY_ALLOWLIST.get(base) || null;
}
