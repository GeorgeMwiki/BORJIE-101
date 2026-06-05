# Migration reconciliation audit

**Date:** 2026-06-01
**Scope:** `packages/database/` only.
**Author tooling:** static audit (READ-heavy) + one appended forward migration.
**Status:** drift documented; one safe forward migration appended
(`src/migrations/0157_rls_repoint_legacy_tenant_guc_intree.sql`).

This document reconciles the migration set so the repo is self-verifiable.
It is the source of truth for the "why are there migration numbers in the
schema that aren't on disk" question raised by two security reviews.

---

## 0. TL;DR

- There are **three distinct migration lineages** in this package, applied by
  **three different runners** writing to **two different tracking tables**.
  This is the root cause of every "missing migration" symptom.
- **On disk + applied by repo runners (the Borjie mining lineage):**
  - `drizzle/` → `0000`–`0076` (72 `.sql`, 5 internal gaps) — applied by
    `scripts/apply-borjie-mining-migration.mjs`.
  - `src/migrations/` → `0077`–`0156` (81 `.sql`, 1 gap, 1 decimal, **1 hard
    duplicate**) — applied by `src/run-migrations.ts` **and**
    `scripts/migrate-prod.ts`.
- **On disk but NOT applied by any repo runner (the archived BossNyumba
  property-domain lineage):** `.archive/migrations/` → `0001`–`0273`
  (259 `.sql`). Every schema/comment reference to a migration number the
  Borjie dirs don't have (e.g. `0172`, `0183`, `0188`–`0194`, `0252`,
  `0266`–`0273`) resolves **here**.
- **Disk max is `0156`.** `CLAUDE.md`'s "183 migrations" and the
  `Docs/CODEMAPS/database.md` "183 migrations" claim count the **archived**
  lineage, not what the repo runners apply. (See DR-1.)
- **Wrong-GUC RLS:** 46 in-tree tenant tables carry a literal `CREATE POLICY`
  on the legacy `app.tenant_id` GUC that the gateway no longer sets →
  fail-closed (zero rows) under FORCE RLS. Fixed by appended `0157`.
  (See §3 + DR-3.)

---

## 1. Runner / lineage topology (the root cause)

| Runner | Reads dir | Numeric range | Tracking table | Invoked by |
|---|---|---|---|---|
| `scripts/apply-borjie-mining-migration.mjs` | `packages/database/drizzle/` | `0000`–`0076` | `drizzle.__drizzle_migrations` | CI `borjie-db-migrations-check.yml`; manual |
| `src/run-migrations.ts` (`pnpm db:migrate`) | `packages/database/src/migrations/` | `0077`–`0156` | `drizzle.__drizzle_migrations` | boot hook / CLI |
| `scripts/migrate-prod.ts` (`scripts/migrate-prod.sh`) | `packages/database/src/migrations/` | `0077`–`0156` | **`_migrations`** (different table!) | prod deploy |

Consequences / drift baked into the tooling:

- **DR-T1 — split tracking tables.** `run-migrations.ts` and the mining shim
  record into `drizzle.__drizzle_migrations`; `migrate-prod.ts` records into
  `_migrations`. A migration applied via one path is **not** seen as applied
  by the other → re-execution risk. Idempotent migrations (the house style)
  mask this, but non-idempotent ones (rare) would double-apply.
- **DR-T2 — CI only covers `drizzle/`.** `borjie-db-migrations-check.yml`
  runs only `apply-borjie-mining-migration.mjs` → `drizzle/0000–0076`.
  `src/migrations/0077–0156` (where the duplicate `0102` and all of §3's
  wrong-GUC policies live) is **never** dry-run in CI. Recommend extending CI
  (DR-T2 in §6).
- **DR-T3 — uniqueness test guards the wrong dir.**
  `src/__tests__/migration-uniqueness.test.ts` asserts unique prefixes under
  `packages/database/drizzle/` only. It does **not** scan `src/migrations/`,
  so it cannot catch the live duplicate `0102_geology_capture.sql` vs
  `0102_workforce_certifications.sql` (DR-2). The test's header also cites a
  rejection allowlist "in `scripts/apply-borjie-mining-migration.mjs`" — that
  script does exist, but the test does not actually exercise the
  `src/migrations/` path the prod runner uses.

### DR-T4 — INT-4: `incidents` baseline gap on standalone `src/migrations/` apply (FIXED in the runner)

- **Symptom.** `incidents` is a real Drizzle table
  (`src/schemas/safety-csr.schema.ts`) and `src/migrations/0082_misc_pre_launch_tables.sql`
  does `ALTER TABLE incidents …`, but **no `src/migrations/` file CREATEs it** —
  the `CREATE TABLE IF NOT EXISTS incidents` lives in the BASELINE,
  `drizzle/0003_mining_domain.sql:789`. Applying `src/migrations/` STANDALONE
  on an empty DB therefore fails at `0082` with
  `relation "incidents" does not exist`. (`0082`'s `IF NOT EXISTS` column
  guards do not help: the bare `ALTER TABLE incidents ADD CONSTRAINT …` and
  `CREATE INDEX … ON incidents` still target a non-existent relation.)
- **Root cause.** The two-dir lineage above (`drizzle/` baseline + `src/migrations/`
  deltas) was historically applied by **two separate runners** (DR-T1). The
  canonical bootstrap is baseline-FIRST: `drizzle/` (creates `incidents`) then
  `src/migrations/` (alters it). Any path that applies `src/migrations/` ALONE
  is the only place the gap bites.
- **Fix (in `packages/database`, forward-only, no edit to the immutable 0082).**
  `src/run-migrations.ts` now applies BOTH phases in order —
  `drizzle/` (BASELINE_DIR) then `src/migrations/` (MIGRATIONS_DIR) — keyed off
  the shared `drizzle.__drizzle_migrations` ledger (the dirs use disjoint number
  ranges so filename hashes never collide). This folds the old
  `scripts/apply-borjie-mining-migration.mjs` baseline phase into the canonical
  runner, so EVERY from-scratch bootstrap through `pnpm db:migrate` /
  `runMigrations()` is baseline-first and `0082` always sees `incidents`. It
  also resolves DR-T1's split-tracking re-execution risk for the runner path.
  Verified end-to-end against ephemeral Postgres in
  `src/__tests__/mining-vocab-migrations.integration.test.ts` (standalone-0082
  fails; baseline-then-0082 succeeds).
- **Residual (standalone CI harness only).** `scripts/migration-apply-check.mjs`
  (workflows `migration-apply-check.yml` / `migration-apply-fresh.yml`) still
  applies `--migrations-dir=packages/database/src/migrations` ALONE, so it will
  still report `0082` as failing on a fresh DB. Two equivalent, out-of-package
  follow-ups close it (neither edits a shipped migration): (a) add `0082` to
  `scripts/__allowlists__/migration-apply-allowlist.mjs` with reason "incidents
  created in baseline drizzle/0003; apply is baseline-first via run-migrations.ts"
  — the same accepted-risk pattern already used for the RLS/PostGIS/pgvector
  baseline-dependent migrations; or (b) point those workflows at the baseline-first
  `run-migrations.ts` (or apply `drizzle/` before `src/migrations/`). `migrate-prod.ts`
  has the same standalone shape and would benefit from the same baseline-first fold.

---

## 2a. On-disk migration numbers + gaps

### `drizzle/` (Borjie mining base — 0000–0076)
- **Present:** 72 files: `0000, 0003–0005, 0007–0013, 0015–0074, 0076`.
- **Internal gaps:** `0001, 0002, 0006, 0014, 0075`.
  - `0001`, `0002` exist as **disabled** `_legacy_0001_documents_bundle.sql.skip`
    and `_legacy_0002_notification_dispatch_log.sql.skip` (rejected by the
    runner's `^\d{4}_.*\.sql$` allowlist — intentional).
  - `0075` **deliberately skipped** — see `0076_cognitive_wiring_health.sql:24`
    ("0075 deliberately skipped per Docs/DESIGN/NEURO_WIRING_SOTA_2026.md").
  - `0006`, `0014` — no creating file and no in-repo skip; only referenced in
    backfill `RAISE NOTICE '[0006] …'` strings in `0004_marketplace_bids.sql`.
    Treat as historically-renumbered/absorbed (low risk; both ranges are
    idempotent-guarded elsewhere). Documented as DR-6.

### `src/migrations/` (Borjie mining continuation — 0077–0156)
- **Present:** 81 files spanning `0077`–`0156`.
- **Gap:** `0123` (the sequence jumps `0122 → 0124`; `0124_saved_searches.sql`
  is present). No `0123_*` exists in this dir or in schema references for the
  Borjie lineage — benign skip.
- **Decimal/extra:** `0096b_scope_node_links.sql` (a `b`-suffixed insert after
  `0096_scope_nodes_taxonomy.sql`; sorts after `0096`, before `0097` — OK).
- **Hard duplicate (DR-2, ACTION):** both
  `0102_geology_capture.sql` **and** `0102_workforce_certifications.sql` exist
  and are git-tracked.
  - `0102_workforce_certifications.sql` is **byte-identical** to
    `0110_workforce_certifications.sql` (and their `down/` scripts match too) —
    i.e. `0102_workforce_certifications.sql` is the pre-renumber leftover; the
    canonical copy is `0110`. The renumber to `0110` resolved the collision
    with `0102_geology_capture.sql` but the stale `0102_workforce_*` file was
    never deleted.
  - **Impact:** under `localeCompare` sort the two `0102_*` files both apply;
    the workforce-cert one then re-applies as `0110` (idempotent, so harmless
    today), but the shared `drizzle.__drizzle_migrations` hash is keyed on the
    **filename** (`0102_workforce_certifications`), so the **first** `0102_*`
    to sort wins the hash slot and the other `0102_*` still runs — fragile.
  - **Recommended fix (NOT done here — deletion is out of "append-only"
    scope):** delete `src/migrations/0102_workforce_certifications.sql` and
    `src/migrations/down/0102_down_workforce_certifications.sql` (keep `0110`),
    and extend the uniqueness test to scan `src/migrations/` (DR-T3). Tracked
    as DR-2.

### `.archive/migrations/` (BossNyumba property-domain — NOT applied)
- 259 `.sql`, numbers `0001`–`0273` (with internal `b/c/d/e` suffixes).
- **Not read by any runner.** Present only so the *deployed* DB history and
  the schema comments that cite those numbers remain traceable. This is the
  lineage that the deployed Supabase database actually ran (the gateway's GUC
  comments, the `down/_registry.json`, and CLAUDE.md's "183 migrations" all
  point here).

---

## 2b. Schema/comment references to migrations NOT on disk (Borjie dirs)

Method: extracted every `Migration[s] NNNN` / `migrations/NNNN` /
`drizzle/NNNN` citation in `src/schemas/`, `src/repositories/`,
`src/security/`, `src/services/`; subtracted the on-disk Borjie prefix set
(`drizzle/` ∪ `src/migrations/`).

**34 distinct cited numbers have no file in the Borjie dirs. ALL 34 exist in
`.archive/migrations/`** (i.e. none are truly lost — they are the archived
BossNyumba lineage still cited by Borjie schema headers):

| Cited # | Resolves to (`.archive/migrations/`) |
|---|---|
| 0123 | `0123_kernel_agency.sql` |
| 0158 | `0158_tenant_region.sql` |
| 0163 | `0163_phase_e_phase_f_constraints.sql` |
| 0164 | `0164_onboarding_sessions.sql` |
| 0165 | `0165_mdr_owner_timestamptz_clock_shift_guard.sql` |
| 0166 | `0166_reflexion_lessons.sql` |
| 0167 | `0167_aop_registry.sql` |
| 0168 | `0168_a2a_tasks.sql` |
| 0170 | `0170_carbon_market_book.sql` |
| 0181 | `0181_memory_layer.sql` |
| 0182 | `0182_section_layouts.sql` |
| 0183 | `0183_user_action_tracker.sql` |
| 0184 | `0184_reflexion_buffer_extend.sql` |
| 0185 | `0185_decision_traces.sql` |
| 0186 | `0186_core_entity.sql` |
| 0187 | `0187_entity_type_definition.sql` |
| 0188 | `0188_tenant_schema_extensions.sql` |
| 0189 | `0189_entity_ext_land.sql` |
| 0190 | `0190_entity_ext_building.sql` |
| 0191 | `0191_entity_ext_vehicle.sql` |
| 0192 | `0192_entity_ext_machinery.sql` |
| 0193 | `0193_entity_ext_it_asset.sql` |
| 0194 | `0194_entity_ext_person.sql` |
| 0208 | `0208_report_templates.sql` |
| 0209 | `0209_presentation_themes.sql` |
| 0210 | `0210_tutoring_skill_pack.sql` |
| 0216 | `0216_fix_entity_type_def_and_piecek_unify.sql` |
| 0217 | `0217_piecek_unify_documents.sql` |
| 0218 | `0218_piecem_unify_employees.sql` |
| 0220 | `0220_module_specs.sql` |
| 0229 | `0229_conversation_capture.sql` |
| 0230 | `0230_module_update_proposals.sql` |
| 0231 | `0231_tab_subscriptions.sql` |
| 0232 | `0232_tab_event_log.sql` |

Representative file:line citations (evidence; not exhaustive — every
`src/schemas/core-entity/*` and `src/schemas/connector-*` header carries one):

- `src/schemas/a2a-tasks.schema.ts:2` → `0168`
- `src/schemas/aop-registry.schema.ts:2` → `0167`
- `src/schemas/carbon-market-book.schema.ts:2` → `0170`
- `src/schemas/decision-traces.schema.ts:2` → `0185`
- `src/schemas/core-entity/core-entity.schema.ts:2,15,110,128,143` → `0186/0187`
- `src/schemas/core-entity/entity-ext-land.schema.ts:2` → `0189`
- `src/schemas/core-entity/entity-ext-vehicle.schema.ts:2` → `0191`
- `src/schemas/core-entity/tenant-schema-extensions.schema.ts:2` → `0188`
- `src/schemas/conversation-capture.schema.ts:2` → `0229`
- `src/schemas/bid-negotiations.schema.ts:72` → `0101` *(ambiguous: in-tree
  `0101_universal_provenance.sql` exists, but the cited subject — bid
  negotiations — matches the archive lineage, not the in-tree provenance
  migration; flagged as a cross-lineage citation, DR-4).*

Additional non-schema references to absent Borjie numbers (informational):

- `src/migrations/down/_registry.json` maps up-migrations
  `0252, 0253, 0264, 0266–0270, 0272, 0273` → all resolve to
  `.archive/migrations/` (e.g. `0273_payment_event_store.sql`,
  `0266_agency_missions.sql`). The matching `down/0252_down_*.sql` …
  `down/0273_down_*.sql` scripts **are** present under `src/migrations/down/`
  even though their `up` counterparts are not in `src/migrations/` — orphaned
  down-scripts (DR-5).
- `services/api-gateway/src/middleware/database.ts:272,328` cite "Migration
  0172 / 0172b" (`current_app_tenant_id()` GUC unifier) — resolves to
  `.archive/migrations/0172b_unify_rls_guc.sql`. This is **outside
  `packages/database/` scope** but is load-bearing for §3 and is recorded for
  completeness.

---

## 3. In-tree RLS policies still reading `current_setting('app.tenant_id')`

### Ground truth: which GUC is canonical

- The gateway request path sets **only** the canonical GUC:
  `services/api-gateway/src/middleware/database.ts:333-334` →
  `set_config('app.current_tenant_id', <tenant>, false)`.
- A few code paths *also* set the legacy name for back-compat
  (`workers/with-tenant-context.ts:75-76`, `routes/brain.hono.ts:137`), but the
  main authenticated HTTP path does **not**.
- The archived unifier `.archive/migrations/0172b_unify_rls_guc.sql` redefined
  `public.current_app_tenant_id()` to read `app.current_tenant_id` first
  (fallback `app.tenant_id`). **Crucially, 0172b only re-pointed policies that
  call the *helper function*, plus `kernel_cot_reservoir`'s two inline
  policies.** `.archive/migrations/0173_force_rls_sweep.sql:50-52` explicitly
  states it does **not** touch GUC names on inline policies.
- Therefore **inline** `current_setting('app.tenant_id', true)` policies
  (the entire Borjie-lineage style) are **not** rescued by the archived
  helper. Under FORCE RLS, the predicate evaluates `NULL = tenant_id` → NULL →
  treated as FALSE → **every authenticated read/write returns/affects zero
  rows**. This is the exact failure mode `0150` and `0156` were written to fix,
  and the one the security reviews flagged.

### 3a. In-tree migrations with a LITERAL `CREATE POLICY` on `app.tenant_id`

These are fixable in-tree (the `CREATE POLICY` statement is visible) and are
the subject of appended migration `0157`. Format: `file → table (policy)
[tenant_id type]`.

| Source migration | Table | Policy | tenant_id |
|---|---|---|---|
| `0077_pilot_feedback.sql:101-105` | `pilot_feedback` | `pilot_feedback_tenant_isolation` | uuid (`::text`) |
| `0079_owner_brief_snapshots.sql:98-102` | `owner_brief_snapshots` | `obs_tenant_isolation` | uuid (`::text`) |
| `0081_mining_escalations_approvals.sql:149-153` | `mining_escalations` | `mining_escalations_tenant_isolation` | uuid (`::text`) |
| `0081_mining_escalations_approvals.sql:233-237` | `mining_approval_items` | `mining_approval_items_tenant_isolation` | uuid (`::text`) |
| `0082_misc_pre_launch_tables.sql:193-197` | `mining_sic_pings` | `mining_sic_pings_tenant_isolation` | uuid (`::text`) |
| `0083_document_intelligence.sql:154-158` | `document_intelligence_sessions` | `dis_tenant_isolation` | text |
| `0083_document_intelligence.sql:210-214` | `document_corpus_links` | `dcl_tenant_isolation` | text |
| `0086_workforce_invitations.sql:152-156` | `workforce_invitations` | `workforce_invitations_tenant_isolation` | uuid (`::text`) |
| `0091_workforce_role_tab_configs.sql:102-106` | `workforce_role_tab_configs` | `workforce_role_tab_configs_tenant_isolation` | text |
| `0091_workforce_role_tab_configs.sql:169-173` | `workforce_tab_change_requests` | `workforce_tab_change_requests_tenant_isolation` | text |
| `0092_tenant_daily_brief_prefs.sql:172-176` | `daily_brief_dispatches` | `dbd_tenant_isolation` | uuid (`::text`) |
| `0093_full_mining_operations_scope.sql:96-100` | `external_parties` | `external_parties_tenant_isolation` | text |
| `0093_full_mining_operations_scope.sql:164-168` | `external_party_engagements` | `epe_tenant_isolation` | text |
| `0093_full_mining_operations_scope.sql:230-234` | `mineral_chain_of_custody` | `cco_tenant_isolation` | text |
| `0093_full_mining_operations_scope.sql:302-306` | `regulatory_filings` | `rf_tenant_isolation` | text |
| `0094_mining_estate_holdings.sql:85-89` | `estate_groups` | `estate_groups_tenant_isolation` | text |
| `0094_mining_estate_holdings.sql:157-161` | `estate_entities` | `estate_entities_tenant_isolation` | text |
| `0094_mining_estate_holdings.sql:223-227` | `estate_capital_movements` | `ecm_tenant_isolation` | text |
| `0094_mining_estate_holdings.sql:282-286` | `succession_plans` | `sp_tenant_isolation` | text |
| `0094_mining_estate_holdings.sql:353-357` | `estate_assets` | `estate_assets_tenant_isolation` | text |
| `0096_scope_nodes_taxonomy.sql:79-83` | `scope_nodes` | `scope_nodes_tenant_isolation` | text |
| `0096_scope_nodes_taxonomy.sql:111-115` | `scope_taxonomy_preferences` | `stp_tenant_isolation` | text |
| `0097_brain_ui_control.sql:59-63` | `owner_dashboard_layout` | `owner_dashboard_layout_tenant_isolation` | text |
| `0097_brain_ui_control.sql:140-144` | `ui_redesign_audit` | `ui_redesign_audit_tenant_isolation` | text |
| `0098_owner_contact_prefs.sql:71-75` | `owner_contact_prefs` | `owner_contact_prefs_tenant_isolation` | text |
| `0099_four_eye_requests.sql:94-98` | `four_eye_requests` | `four_eye_requests_tenant_isolation` | text |
| `0102_workforce_certifications.sql` **≡** `0110_workforce_certifications.sql:71-75` | `workforce_certifications` | `workforce_certifications_tenant_isolation` | text |
| `0102_workforce_certifications.sql` **≡** `0110_workforce_certifications.sql:110-114` | `workforce_cert_expiry_reminders` | `workforce_cert_expiry_reminders_tenant_isolation` | text |
| `0108_advisor_memory.sql:113-117` | `advisor_preferences` | `advisor_preferences_tenant_isolation` | text |
| `0108_advisor_memory.sql:204-208` | `advisor_observed_patterns` | `advisor_observed_patterns_tenant_isolation` | text |
| `0109_compliance_pccb_pdpa.sql:102-106` | `pccb_disclosures` | `pccb_disclosures_tenant_isolation` | text |
| `0109_compliance_pccb_pdpa.sql:177-181` | `pdpa_processing_records` | `pdpa_processing_records_tenant_isolation` | text |
| `0109_compliance_pccb_pdpa.sql:249-253` | `pdpa_subject_requests` | `pdpa_subject_requests_tenant_isolation` | text |
| `0111_share_links.sql:109-113` | `share_links` | `share_links_tenant_isolation` | text |
| `0112_undo_journal.sql:112-116` | `undo_journal` | `undo_journal_tenant_isolation` | text |
| `0113_pinned_items.sql:82-86` | `pinned_items` | `pinned_items_tenant_isolation` | text |
| `0114_outcome_telemetry.sql:133-137` | `outcome_predictions` | `outcome_predictions_tenant_isolation` | text |
| `0114_outcome_telemetry.sql:183-187` | `outcome_observations` | `outcome_observations_tenant_isolation` | text |
| `0114_outcome_telemetry.sql:253-257` | `outcome_reconciliations` | `outcome_reconciliations_tenant_isolation` | text |
| `0115_entity_index.sql:182-186` | `entity_index` | `entity_index_tenant_isolation` | text |
| `0115_entity_index.sql:241-245` | `entity_cross_references` | `entity_cross_references_tenant_isolation` | text |
| `0116_decision_journal.sql:146-150` | `decisions` | `decisions_tenant_isolation` | text |
| `0116_decision_journal.sql:217-221` | `decision_outcomes` | `decision_outcomes_tenant_isolation` | text |
| `0116_decision_journal.sql:282-286` | `decision_links` | `decision_links_tenant_isolation` | text |
| `0137_chat_handoffs.sql:142-146` | `chat_handoffs` | `chat_handoffs_tenant_isolation` | text |
| `0142_tab_proposals_inbox.sql:151-155` | `tab_proposals_inbox` | `tab_proposals_inbox_tenant_isolation` | text |

**Total: 46 unique table policies** (across 45 source files; `0102`≡`0110`
counted once). **All repointed by appended `0157`** (see §4).

**Already fixed — deliberately EXCLUDED from `0157`:**
- `0089_owner_reminders_and_tabs.sql` → `reminders`, `owner_tabs` — repointed
  by `0156_reminders_owner_tabs_rls_current_tenant.sql`.
- `request_for_bids`, `request_for_bid_responses`, `owner_delegation_prefs`,
  `mwikila_actions_inbox` — repointed by `0150_fix_tenant_id_text_drift.sql`.

### 3b. In-tree DYNAMICALLY-generated `app.tenant_id` policies (NOT fixed here)

`drizzle/` builds RLS via `EXECUTE format('… current_setting(''app.tenant_id'',
true) …')` loops over static table arrays, so the wrong GUC is generated at
runtime rather than written literally. These are **out of scope** for the
"literal in-tree policy" safe-fix rule and are tracked as **DR-3 / DR-7**:

- `drizzle/0003_mining_domain.sql:1091-1119` — a `FOREACH` loop over **35
  tenant tables** (`companies, directors, shareholders, bank_accounts,
  authorities, licences, licence_events, sites, site_sections, drill_holes,
  drill_hole_layers, samples, vein_models, employees, attendance, advances,
  assets, maintenance_events, fuel_logs, shift_reports, production_records,
  ore_parcels, buyers, sales, cash_balances, costs, forecasts, incidents,
  ppe_issues, csr_plans, grievances, village_meetings, marketplace_listings,
  fingerprint_events, tasks, risks`) + `intelligence_corpus_chunks` + `ratings`
  — all on `current_setting('app.tenant_id', true)`, **`ENABLE` only, no
  `FORCE`**.
- Same generator pattern in: `0004, 0005, 0007, 0011, 0013, 0016, 0017, 0018,
  0019, 0020, 0021, 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0029, 0030, 0031,
  0033–0074, 0076` (every `drizzle/*.sql` that declares RLS — see grep evidence
  in the audit run; ~70 files).

These are not fixed in this pass because (a) the rule is "literal in-tree
policy only", (b) `drizzle/` is applied by a *different* runner and the
correct fix is a single helper-function swap (mirror archived `0172b`) rather
than per-table DROP/CREATE, and (c) the deployed DB may already carry the
archived `0172b`/`0173` remediation. See §6 reconciliation plan (DR-3).

---

## 4. Forward migration appended (the only write to migration files)

**File:** `src/migrations/0157_rls_repoint_legacy_tenant_guc_intree.sql`

- Repoints all **46** §3a table policies from `current_setting('app.tenant_id',
  true)` → `current_setting('app.current_tenant_id', true)`.
- Mirrors the **0150 / 0156** precedent exactly: per policy,
  `DROP POLICY IF EXISTS <name> ON <table>;` then `CREATE POLICY <name> ON
  <table> FOR ALL USING (…) WITH CHECK (…)`.
- **Idempotent + shard-safe:** every block is wrapped in
  `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.tables WHERE
  table_schema='public' AND table_name='<t>') THEN … END IF; END $$;`
  so it is safe to re-run and safe on shards where a feature table is absent.
- **Cast fidelity preserved:** UUID-typed `tenant_id` columns keep the
  `::text` cast (`0077, 0079, 0081, 0082, 0086, 0092`); TEXT-typed columns
  compare bare — identical to each source migration, so the predicate types
  match and the SQL is valid.
- **Excludes** the already-fixed `0150` and `0156` tables (no double-fix).
- Carries explicit `BEGIN;`/`COMMIT;` (consistent with 77/82 in-tree
  migrations incl. the mirrored sources and `0150/0155`); verified that
  `run-migrations.ts`'s `stripWrappingTransaction()` cleanly removes the outer
  wrapper, leaving 46 balanced `DO/END` blocks.

Validation performed (no DB writes):
- 46 `DO $$ BEGIN` openers == 46 `END $$;` closers.
- 46 `CREATE POLICY … ON` across 46 distinct tables (matches §3a inventory).
- 92 canonical-GUC predicate occurrences (46 × USING+WITH CHECK); zero
  legacy-GUC predicates (the single `app.tenant_id` string is in the header
  comment only).
- Transaction-stripper dry-run leaves body intact and free of stray top-level
  `BEGIN;`.

> **Not done (out of append-only scope; requires deletion/edit — see §6):**
> deleting the duplicate `0102_workforce_certifications.sql` (DR-2), fixing the
> `drizzle/` dynamic-policy GUC (DR-3), pruning orphaned `down/0252–0273`
> scripts (DR-5), correcting CLAUDE.md / database.md counts (DR-1), and the
> tooling drift (DR-T1/T2/T3).

---

## 5. FORCE-RLS asserted but no in-tree creating migration

The security reviews flagged `sites`, `employees`, `ocr_extractions`. Findings
for the **Borjie lineage** (`drizzle/` + `src/migrations/`):

| Table | Created in-tree? | RLS in-tree? | FORCE in-tree? | Notes |
|---|---|---|---|---|
| `sites` | **Yes** — `drizzle/0003_mining_domain.sql:305` | Yes — `0003:1091` (`ENABLE`, dynamic policy, **wrong GUC**) | **No** | FORCE is applied only by archived `0173_force_rls_sweep.sql` (out of tree). DR-3/DR-8. |
| `employees` | **Yes** — `drizzle/0003_mining_domain.sql:437` | Yes — `0003:1091` (`ENABLE`, dynamic policy, **wrong GUC**) | **No** | Same as `sites`. Also separately created in archive (`0011_hr.sql`, `0241_employees.sql`) — different lineage. |
| `ocr_extractions` | **No** (Borjie) | n/a in tree | n/a in tree | Exists ONLY in archive `0014_outbox_and_intelligence.sql:346`; FORCE in archive `0173`. **But `src/schemas/documents.schema.ts` still references `ocr_extractions`** → orphaned cross-lineage schema reference (DR-4). |

Conclusion: for the Borjie lineage, **no in-tree migration FORCE-enables any of
the dynamically-RLS'd `0003` tables** — FORCE for that whole family lives only
in the archived `0173_force_rls_sweep.sql`. This is the "FORCE-RLS lives in
early migrations not in-tree" gap. It is **not** safe to blind-fix here
(requires the full table roster + a decision on whether the deployed DB already
carries `0173`); captured as DR-8 in the plan.

---

## 6. Drift register + reconciliation plan (for the team)

Priority: **P1** = security/correctness, **P2** = integrity/hygiene,
**P3** = docs.

| ID | P | Finding | Recommended action | Append-only? |
|---|---|---|---|---|
| **0157 (DONE)** | P1 | 46 in-tree literal RLS policies on legacy `app.tenant_id` GUC → fail-closed under FORCE RLS | Appended `0157` repoints all 46 to `app.current_tenant_id` (mirrors 0150/0156). | ✅ done |
| **DR-3** | P1 | ~70 `drizzle/*.sql` (incl. `0003`'s 35-table loop: `sites`, `employees`, …) generate RLS on `app.tenant_id` dynamically; not rescued by archived `0172b` (helper-only) | Append a `drizzle/0077_*` (next free in that dir) that **re-points via a helper**: install/`CREATE OR REPLACE` `public.current_app_tenant_id()` (port archived `0172b`), then re-`CREATE POLICY tenant_isolation` per table reading the helper. OR migrate `drizzle/` runner to set both GUCs. Verify against deployed DB first (it may already carry archived `0172b`+`0173`). | ✅ (append to `drizzle/`) |
| **DR-8** | P1 | `sites`/`employees`/`0003`-family are `ENABLE` but not `FORCE` in tree; FORCE only in archived `0173` | After confirming deployed state, append a `drizzle/` FORCE-sweep mirroring archived `0173` (idempotent `ALTER TABLE … FORCE` loop). | ✅ |
| **DR-2** | P2 | Duplicate `src/migrations/0102_workforce_certifications.sql` (byte-identical to `0110`) + matching `down/` | Delete the stale `0102_workforce_certifications.sql` and its `down/` (keep `0110`). Requires file deletion → not append-only. | ❌ delete |
| **DR-T3** | P2 | Uniqueness test scans `drizzle/` only; cannot catch DR-2 | Extend `migration-uniqueness.test.ts` to also scan `src/migrations/` (and assert cross-dir prefix-namespace safety since both share `drizzle.__drizzle_migrations`). | ❌ test edit |
| **DR-T1** | P2 | `run-migrations.ts` uses `drizzle.__drizzle_migrations`; `migrate-prod.ts` uses `_migrations` | Converge on ONE tracking table (recommend `drizzle.__drizzle_migrations`) or have `migrate-prod.ts` seed/read both. Document the chosen path in `Docs/DEPLOYMENT.md`. | ❌ code edit |
| **DR-T2** | P2 | CI `borjie-db-migrations-check.yml` only dry-runs `drizzle/0000–0076` | Extend the workflow to also run `src/run-migrations.ts` (or `migrate-prod.ts --dry-run`) against `src/migrations/` on an empty PG. | ❌ CI edit |
| **DR-5** | P2 | `src/migrations/down/0252–0273` (+ `_registry.json`) reference up-migrations that live only in `.archive/` | Either restore the matching `up` scripts into a tracked dir, or move these `down/` scripts + registry entries into `.archive/` so the down-set matches the up-set. | ❌ move |
| **DR-4** | P2 | Borjie schema/headers cite archive-lineage tables/numbers (`ocr_extractions` in `documents.schema.ts`; `0101` bid-negotiations; the 34 numbers in §2b) | Decide per reference: (a) if the table is genuinely used by Borjie, add a tracked Borjie migration that creates it; (b) else correct the schema header to cite the real in-tree migration or mark it archive-only. | ❌ schema edit |
| **DR-6** | P3 | `drizzle/` gaps `0006/0014` have no creating file and no skip marker (only `RAISE NOTICE` strings) | Add a one-line `0006/0014 absorbed into 000X` note to this doc / a `drizzle/README`. | n/a doc |
| **DR-1** | P3 | `CLAUDE.md` ("183 migrations") + `Docs/CODEMAPS/database.md` count the archived lineage; repo runners apply ≤ `0156` | Update both to state the lineage split (e.g. "Borjie lineage: drizzle/0000–0076 + src/migrations/0077–0157; archived BossNyumba lineage 0001–0273 in `.archive/`, deployed but not re-applied"). | ❌ docs edit |

### Suggested sequencing
1. **Confirm deployed DB state** (one read-only query against prod/staging):
   does `public.current_app_tenant_id()` exist and read `app.current_tenant_id`
   first? Are the `0003`-family tables `relforcerowsecurity=true`? This decides
   whether DR-3/DR-8 are no-ops in prod (only the *repo* is behind) or real
   prod gaps.
2. Land `0157` (this PR) — closes the in-tree literal-policy P1.
3. DR-3 + DR-8 as a paired `drizzle/` append (helper + FORCE sweep), idempotent.
4. DR-2 + DR-T3 together (delete dup + tighten the guard so it can't recur).
5. DR-T1/DR-T2/DR-5 (tooling + CI + down-set hygiene).
6. DR-4/DR-1/DR-6 (docs + cross-lineage citation cleanup).

### Invariants honored by this pass
- Migrations are **append-only**: no shipped numbered file was edited; only
  `0157` was added (next free number after the disk max `0156`).
- All appended SQL is **idempotent** (`DROP … IF EXISTS` + existence-guarded
  `CREATE`) and **valid** (cast-faithful, balanced blocks, stripper-compatible).
- No data paths touched; no `LedgerService`, RLS-disable, or GUC-name change in
  application code.
