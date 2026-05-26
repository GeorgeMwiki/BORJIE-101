# Data Onboarding — Design Specification

> Wave 18U / persistence layer — the canonical contract for "the MD knows
> where to put the data." Owner drops an Excel file in chat and says
> *"this is a list of my employees"*; Mr. Mwikila reads the structure,
> compares it against the tenant's existing schema, proposes the new
> columns/tables/tabs that should land in the database, persists the
> rows with full provenance, walks the schema to build a profile-chain
> graph, and enriches every row with deep online research. This is the
> layer that **places data where it belongs**.

Status: design-spec. Phase 2 ships `packages/data-onboarding/` +
migration `0022_data_onboarding.sql` + four api-gateway routes + one
persona-kernel tool (`onboard_data_v1`). Reuses (does NOT duplicate)
Wave 18T cognitive-engine parsing, Wave 18S mutation-authority
schema-evolution approvals, Wave 18D research-tools enrichment
adapters, Wave 17B / 18B `compose_tab_v1` composition, Wave 18Q
universal-creator dispatch, and the pre-existing `file-ingest`
schema-sniff inference.

Brand: Borjie. Persona: Mr. Mwikila (Managing Director).
Charter: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Sibling specs:

- Cognitive engine (parse + reason): [`Docs/DESIGN/COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md) (Wave 18T) — parses a file into a temporary `DataJoinRef` for a single turn. This spec is the **persistent counterpart**.
- Mutation authority (write gate): [`Docs/DESIGN/MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) (Wave 18S). All schema evolutions ride the Tier-2 approval queue defined here.
- Observability (read side): [`Docs/DESIGN/UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md) (Wave 18R) — the situational awareness substrate that makes onboarding decisions meaningful.
- Capabilities unification: [`Docs/DESIGN/CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) (Wave 18Q). Onboarding routes from `compose_anything_v1` when the cognitive engine classifies an attachment as "data to persist."
- Anticipatory UX: [`Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md). Onboarding emits `compose_tab_v1` proposals once a profile chain is built.
- Deep research: [`Docs/DESIGN/DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md). Enrichment runs through the existing research-tools adapter contract.

---

## 1. Vision

Founder, verbatim (transliterated from caps):

> "User says 'this is a list of my employees' — Boss Nyumba
> (Mr. Mwikila) knows what to do, where to add data, fields, rows,
> columns, tabs to populate, layout of tabs to use, linkage of data
> between tabs to get full profile chain etc. All SOTA deep online
> research."

Mr. Mwikila as universal-creator (Wave 18Q) already composes
**tabs**, **documents**, **media**, **campaigns**, **mutations**. What
he could not yet do is the most foundational creator-act of all:
**place the owner's raw data where it belongs in the tenant's
operational substrate**. Until now, file uploads either landed in
attached-blob storage (without becoming queryable rows) or were
parsed for a single chat turn (Wave 18T) and forgotten.

This spec closes that gap. It defines a 7-stage pipeline that takes
an uploaded tabular file (Excel, CSV, PDF table, image-OCR table)
and walks it through:

1. **Intent + entity recognition** — what kind of entity is this?
2. **Schema discovery** — what columns/types/keys does the file
   actually contain?
3. **Existing-schema matching** — which of these columns already exist
   in the tenant's tables? Which need to be added?
4. **Schema evolution proposals** — every new column/table/tab rides
   the Tier-2 mutation-authority queue (Wave 18S) with double-verify
   on irreversible drops.
5. **Row persistence** — actual writes to the tenant's tables, with
   row-level provenance back to the source file.
6. **Cross-table linkage + profile chain** — the MD walks the schema
   to find every entity a worker (parcel, buyer, site, …) joins to;
   suggests a new "People" tab layout if the owner doesn't have one;
   composes via `compose_tab_v1`.
7. **Deep online research enrichment** — NIDA registry, NSSF,
   LinkedIn, cert verifications, salary benchmarks — Tier 0
   read-only research, findings attached to each row's audit hash.

Every stage carries an **owner-touch point**: Mr. Mwikila proposes,
the owner confirms or corrects, the persistence proceeds. Nothing
irreversible happens without explicit, double-verified approval.

The four temperament words of the manifesto bottom out here too:
*obsessed* is the entity-recognition catalogue's resolution
(workers vs parcels vs licences vs incidents — Mr. Mwikila knows the
difference from the column signature alone); *autonomous* is the
Tier-1 row persistence; *anticipatory* is the unprompted "I notice
you uploaded a worker list — should I also build a People tab?";
*accountable* is the `data_onboarding_row_provenance` table that
binds every persisted row back to the original spreadsheet cell.

---

## 2. The 7 Onboarding Stages

### Stage 1 — Intent + Entity Recognition

Owner uploads `Employees Q3 2025.xlsx` to chat and says "this is my
employee list." Wave 18T (cognitive-engine) parses the file into a
temporary `DataJoinRef`. The new onboarding layer takes that
DataJoinRef + the chat-turn intent and classifies the inbound feed
as an entity-type from a closed catalogue (§5). Confidence floor:
**0.7** — below that, the MD asks a clarifying question
("This looks like it could be either workers or contractor assignments
— which?") rather than guess.

Invocation: `onboard_data_v1({ attachment_id, intent_hint })`
returns `{ session_id, inferred_entity_type, entity_confidence }`.

### Stage 2 — Schema Discovery

Sample the first **N = 50** rows (configurable per recipe). For each
column, infer:

- **Inferred type** from the closed taxonomy: `string | number | date
  | datetime | boolean | enum | email | phone | nida | tin | coordinate | url`.
- **Cardinality** — unique (per-row), high (>0.5 unique fraction),
  low (≤0.5), or unknown.
- **Nullability** — fraction of rows with null.
- **Enum values** if cardinality is low and value set ≤ 12.
- **Sample values** — up to 8 deduped, non-PII-redacted samples.

Detect candidate primary keys: columns with cardinality `unique` and
nullability ≤ 0.05. In a worker file, NIDA is almost always the
correct key. The output is a typed `DiscoveredSchema`.

Reuses `packages/file-ingest/src/schema-sniff/*` heuristic
inference. Adds LLM-driven type refinement for borderline cases
(e.g. `"+255 712 ..."` → phone; `"19990321-12345-67890-12"` → NIDA).

### Stage 3 — Existing Schema Matching

Load the tenant's relevant table catalog (gated by `entity_type` → a
short list of target tables; for `worker`: `workers`,
`safety_workers`, `shift_assignments`). For each inbound column,
attempt to match against an existing field by:

- **Name similarity** (Levenshtein on snake_case-normalised names)
  ≥ 0.7 = candidate
- **Type compatibility** — `string→text`, `phone→text + format
  check`, `nida→text + 20-digit regex`
- **Value distribution similarity** — Jensen-Shannon divergence
  against the existing column's distribution sample ≤ 0.3 = strong
  signal

Three outcomes per source column:

- **exact match** — name + type identical → use as-is.
- **fuzzy match** (similarity ≥ 0.8 but < 1.0) — propose mapping +
  optional transform (e.g. `dd/mm/yyyy` → ISO 8601), owner confirms.
- **no match** — propose a new column or table (Stage 4).

Output: `SchemaMatchResult` carrying the target table, the per-column
mappings, the unmatched columns, and a list of `JoinCandidate`s
detected by foreign-key heuristics.

### Stage 4 — Schema Evolution Proposals

For unmatched columns / missing tables / suggested tabs, the MD
builds one or more `SchemaEvolutionProposal`s. Each proposal carries:

- **DDL diff** — `ALTER TABLE workers ADD COLUMN next_of_kin_phone text`
- **Drizzle delta** — TypeScript schema change to be added to
  `packages/database/src/schemas/<entity>.schema.ts`
- **Migration filename** — next available number, e.g.
  `0025_add_worker_emergency_info.sql`
- **RLS policy** — if a new table, default `app.tenant_id` GUC
  isolation
- **Side-effects summary** — every tab that surfaces this column,
  every report that aggregates it
- **Reversibility flag** — `ALTER TABLE ADD COLUMN` is **fully**
  reversible; `DROP COLUMN` is **irreversible** (second authoriser
  required); `MODIFY COLUMN TYPE` is **partial** (reversible only
  if the new type's domain is a superset of the old)
- **Research evidence ids** — every proposal must cite at least one
  artefact (the owner's chat message or the source file row)

Every proposal flows through Wave 18S `MutationRecipeRegistry` →
`buildProposal` → owner-approval queue. `authority_tier: 2` always
for schema changes. Irreversible proposals trigger
`DoubleVerifyGuard`.

### Stage 5 — Row Persistence

Once the owner has approved (a) the column mappings from Stage 3
and (b) the schema evolutions from Stage 4, actual row writes
proceed. The persister:

- **UPSERT** by the resolved primary key (NIDA for workers, parcel_id
  for parcels, etc). Existing rows whose values changed get an
  `UPDATE` with audit-chain entry. New rows get `INSERT`.
- **Tier 2** if total rows > 100, or if any row carries a conflicting
  key (potential merge — owner must decide).
- **Each persisted row** carries a `provenance` row in
  `data_onboarding_row_provenance` naming the file, sheet, row
  number, operation, and audit hash.
- **PII fields** (NIDA, bank account, salary) pass through
  `pii-redactor` before being shown in any owner-facing preview.

Owner-facing diff preview before commit: `{ rows_inserted: 15,
rows_updated: 32, rows_skipped: 0 }` plus a sample of 5 example diffs.

### Stage 6 — Cross-Table Linkage + Profile Chain

Once rows have landed, Mr. Mwikila walks the tenant schema to find
every table that joins to the newly-onboarded entity. For workers:
`incidents` (via `worker_id`), `shift_assignments`, `certifications`,
`payroll_entries`, `safety_inspections`, `next_of_kin_records`,
`training_completions`. The result is a `ProfileChainGraph`:

- `root_entity` and `root_table`
- `chain_nodes` — each with `join_to_root`, `cardinality`, and a list
  of `aggregates` to surface (count, latest, sum, min/max)
- `suggested_tab_layout` — list-view fields + detail-view groups +
  drill-through targets

The MD proposes a layout for the new entity tab (or improves the
existing one) and dispatches `compose_tab_v1` via Wave 18B. Owner
sees the rendered tab preview before promotion to live. A "Worker
Profile" detail page is composed as a sibling document recipe
(Wave 18C `compose_doc_v1`) if owner approves.

### Stage 7 — Deep Online Research Enrichment

For each persisted row, optionally enrich via the existing
`packages/research-tools` adapter contract. The orchestrator
dispatches a fan-out to:

- **NIDA registry** (TZ public lookup) — verify identity, return
  full name + DOB match
- **NSSF** (Tanzania Social Security Fund) — confirm enrollment
  status + employer history
- **LinkedIn** (via Exa / Tavily search) — find professional profile,
  prior employers, certifications listed
- **OSHA-equivalent professional cert databases** — verify any
  certifications claimed in the source file
- **Bank verification** (for payroll bank accounts) — micro-deposit
  challenge or instant verification API
- **Salary benchmarking** — market data feed via Wave 18D research-tools

Each enrichment is **Tier 0** (read-only research, no mutation).
Findings get attached to the row's audit-chain entry. Owner-visible
badge on the worker profile: `Verified via NIDA, LinkedIn, NSSF`
or `Unverified — research pending` or `Verification failed —
NIDA mismatch`.

Budget reservation through `@borjie/llm-budget-governor` before any
paid-API call.

---

## 3. The DataOnboardingRecipe Contract

```typescript
export interface DataOnboardingRecipe {
  readonly id: string;                          // 'workers_onboarding', 'parcels_onboarding'
  readonly entity_type: EntityType;
  readonly version: number;
  readonly status: 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';
  readonly discover: (sample: TabularSample) => Promise<DiscoveredSchema>;
  readonly match: (discovered: DiscoveredSchema, ctx: TenantSchemaCtx) => Promise<SchemaMatchResult>;
  readonly propose_evolution: (match: SchemaMatchResult) => Promise<ReadonlyArray<SchemaEvolutionProposal>>;
  readonly persist: (rows: ReadonlyArray<Row>, approved_schema: AppliedSchema) => Promise<PersistResult>;
  readonly build_chain: (entity_type: EntityType, ctx: TenantSchemaCtx) => Promise<ProfileChainGraph>;
  readonly enrich: (rows: ReadonlyArray<PersistedRow>, ctx: EnrichmentCtx) => Promise<EnrichmentResult>;
  readonly authority_tier: 0 | 1 | 2;            // schema changes are 2; row-only is 1
  readonly brand: 'borjie';
}

export type EntityType =
  | 'worker' | 'parcel' | 'contract' | 'site' | 'buyer' | 'asset'
  | 'incident' | 'payroll_entry' | 'certification' | 'shift'
  | 'inspection' | 'licence' | 'kpi' | 'unknown';

export interface DiscoveredSchema {
  readonly source_file: { id: string; name: string; sheet?: string };
  readonly columns: ReadonlyArray<DiscoveredColumn>;
  readonly sample_rows_count: number;
  readonly inferred_entity_type: EntityType;
  readonly inferred_primary_key: string | null;
  readonly entity_confidence: number;
}

export interface DiscoveredColumn {
  readonly name: string;
  readonly inferred_type:
    | 'string' | 'number' | 'date' | 'datetime' | 'boolean'
    | 'enum' | 'email' | 'phone' | 'nida' | 'tin'
    | 'coordinate' | 'url';
  readonly cardinality: 'unique' | 'high' | 'low' | 'unknown';
  readonly nullability: number;
  readonly enum_values?: ReadonlyArray<string>;
  readonly sample_values: ReadonlyArray<unknown>;
}

export interface SchemaMatchResult {
  readonly target_table: { schema: string; table: string };
  readonly column_mappings: ReadonlyArray<ColumnMapping>;
  readonly unmatched_columns: ReadonlyArray<DiscoveredColumn>;
  readonly join_keys_to_other_tables: ReadonlyArray<JoinCandidate>;
}

export interface ColumnMapping {
  readonly source_column: string;
  readonly target_field: string;
  readonly match_kind: 'exact' | 'fuzzy' | 'rename_proposed' | 'transform_proposed';
  readonly transform?: TransformSpec;
  readonly confidence: number;
}

export interface SchemaEvolutionProposal {
  readonly id: string;
  readonly kind: 'add_column' | 'add_table' | 'add_index' | 'add_join_view' | 'add_tab' | 'modify_column';
  readonly ddl: string;
  readonly drizzle_delta: string;
  readonly migration_filename: string;
  readonly side_effects: ReadonlyArray<string>;
  readonly reversibility: 'fully' | 'partial' | 'irreversible';
  readonly authority_tier: 2;
  readonly research_evidence_ids: ReadonlyArray<string>;
}

export interface ProfileChainGraph {
  readonly root_entity: EntityType;
  readonly root_table: string;
  readonly chain_nodes: ReadonlyArray<ChainNode>;
  readonly suggested_tab_layout: SuggestedTabLayout;
}

export interface ChainNode {
  readonly entity_type: EntityType;
  readonly table: string;
  readonly join_to_root: { local_field: string; foreign_field: string };
  readonly cardinality: 'one' | 'many';
  readonly aggregates: ReadonlyArray<AggregateSpec>;
}

export interface SuggestedTabLayout {
  readonly tab_recipe_id: string;
  readonly list_view_fields: ReadonlyArray<string>;
  readonly detail_view_groups: ReadonlyArray<DetailGroup>;
  readonly drill_through_targets: ReadonlyArray<DrillThrough>;
}

export interface EnrichmentResult {
  readonly per_row: ReadonlyArray<RowEnrichment>;
  readonly overall_quality: 'high' | 'medium' | 'low';
  readonly audit_hash: string;
}

export interface RowEnrichment {
  readonly row_id: string;
  readonly verifications: ReadonlyArray<{ source: string; confirmed: boolean; details?: unknown }>;
  readonly enriched_fields: ReadonlyArray<{ field: string; value: unknown; source: string; confidence: number }>;
  readonly flagged_issues: ReadonlyArray<string>;
}
```

---

## 4. The 7-Stage Flow

```
upload ─▶ S1 Intent ─▶ S2 Discover ─▶ S3 Match ─▶ S4 Propose Evolution ─▶ (Owner approves Tier 2)
                                              │
                                              └▶ S5 Persist Rows ─▶ S6 Build Chain ─▶ S7 Enrich (Tier 0 research)
                                                                              │
                                                                              ▼
                                                                       compose_tab_v1
                                                                       (via 18B)
                                                                              │
                                                                              ▼
                                                                       compose_doc_v1 (per worker profile sheet)
                                                                       (via 18C, optional)
```

Stages 1–3 are read-only; the cognitive engine plus the schema-sniff
inference can run inside a single owner turn. Stage 4 emits Tier-2
proposals — wall-clock-asynchronous. Stage 5 runs once approvals
land. Stages 6 and 7 fan out from Stage 5 and report back via the
notifications channel.

---

## 5. Entity-Type Recognition Catalogue

```
| File content signature                  | Entity type      | Target table              |
|-----------------------------------------|------------------|---------------------------|
| Cols include NIDA, name, role           | worker           | workers                   |
| Cols include grade, location, weight    | parcel           | ore_parcels               |
| Cols include licence_no, expiry         | licence          | mining_licences           |
| Cols include site_name, coords          | site             | sites                     |
| Cols include buyer_name, KYB status     | buyer            | buyers                    |
| Cols include incident_date, severity    | incident         | incidents                 |
| Cols include cert_id, issued_at         | certification    | certifications            |
| Cols include shift_date, worker_id      | shift            | shift_assignments         |
| Cols include amount_minor, period       | payroll_entry    | payroll_entries           |
| Cols include drill_hole_id, depth       | drill_hole       | drill_holes               |
| Cols include sample_id, grade           | assay            | assays                    |
| Cols include asset_tag, asset_type      | asset            | assets_fleet              |
| Cols include inspection_date, score     | inspection       | safety_inspections        |
```

Recognition runs as a deterministic-first pass (regex / column-name
matching) with a confidence score; below threshold, an LLM step
re-classifies using sample-row content. The MD never silently
guesses — below 0.7 confidence, it asks the owner.

---

## 6. Profile-Chain Examples (Mining Domain)

**Worker profile chain.**
`workers → shift_assignments → drill_teams → incidents (last 90d) →
certifications → payroll_entries → safety_inspections →
next_of_kin_records`.

Surfaced as: a list-view "People" tab with `name | role | site |
last_shift | training_status`; drill into detail → a multi-section
worker profile (Identity, Employment, Compensation, Compliance,
Safety, Next of Kin, Verifications); aggregate KPIs (training
compliance %, incident rate per worker, payroll burn rate).

**Parcel profile chain.**
`ore_parcels → drill_holes (origin) → assays (latest 3) →
buyer_offers → marketplace_listings → contract_signs →
settlements → fx_positions`.

Surfaced as: a "Parcels" tab with `parcel_id | grade | weight |
status | latest_offer`; drill into detail → Provenance, Assays,
Marketplace, Buyers, Settlement.

**Site profile chain.**
`sites → workers (current) → drill_holes → ore_parcels (YTD) →
licences (active) → inspections → incidents → kpis`.

Surfaced as: a "Sites" tab with each site's KPI dashboard,
production YTD, active workforce headcount, licence-validity badge.

---

## 7. Owner-Touch Points

- **After Stage 1+2.** "I think this is a worker feed (confidence
  0.91, primary key looks like NIDA). Confirm or correct?"
- **After Stage 3.** "Here's the column mapping I propose: 28 fields
  match your existing schema, 4 need new columns, 1 needs a new table
  (`worker_emergency_info`). Any corrections before I persist?"
- **At Stage 4.** Tier-2 schema evolution proposals → owner-approval
  queue. New-table-with-PII triggers second-authoriser
  (Tier-2-Critical).
- **At Stage 5.** Row-level diff preview (`15 inserts, 32 updates,
  0 skips`) → owner approves persist.
- **At Stage 6.** Tab layout preview (rendered storybook screenshot)
  → owner approves; promoted from shadow to live.
- **At Stage 7.** "I can verify identities via NIDA, NSSF, LinkedIn.
  Should I? (Budget: 47 rows × $0.02 = $0.94.)"

All touch points are async-ok — owner can respond on next session.
Pending sessions appear in the morning briefing.

---

## 8. Anti-Patterns

- **Auto-persist rows without owner approval.** Even Tier-1 row
  inserts require Stage 5 confirmation.
- **Create a new column / new table without Tier 2 approval.** Schema
  evolutions always go through the mutation-authority queue.
- **Drop a column or DELETE rows without explicit owner direction.**
  Irreversible — second authoriser required.
- **Persist data with PII fields unredacted in previews.** NIDA, bank
  account, salary all pass through `pii-redactor` before owner
  display (raw values still land in the actual row, encrypted via
  the field-encryption-at-rest port).
- **Enrich a row via paid API without budget reservation.** Wave 18D
  budget governor must approve.
- **Build a profile chain with circular joins.** The chain-graph
  validator must catch and reject before composing the tab.
- **Bypass schema-sniff and feed raw CSV to the persister.** The
  pipeline is mandatory; alternative entry points are an attack
  surface.

---

## 9. Schema Additions

Most existing infrastructure is reused; only two new tables are
introduced:

```sql
CREATE TABLE data_onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  attachment_id uuid NOT NULL,
  inferred_entity_type text NOT NULL,
  entity_confidence numeric(3,2) NOT NULL,
  status text NOT NULL DEFAULT 'discovering',
  discovered_schema jsonb,
  schema_match_result jsonb,
  evolution_proposals jsonb,
  persist_result jsonb,
  profile_chain_graph jsonb,
  enrichment_result jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE data_onboarding_row_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  target_table text NOT NULL,
  target_row_id text NOT NULL,
  source_session_id uuid NOT NULL REFERENCES data_onboarding_sessions(id),
  source_file_name text,
  source_sheet text,
  source_row_number int NOT NULL,
  operation text NOT NULL,
  audit_hash text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE data_onboarding_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_onboarding_sessions
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE data_onboarding_row_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_onboarding_row_provenance
  USING (tenant_id = current_setting('app.tenant_id', true));
```

`data_onboarding_sessions.status` lifecycle:
`discovering → matching → proposing → awaiting_owner → persisting →
enriching → complete | failed`.

Every status transition appends to `ai_audit_chain` with the session
id as the anchor entity. RLS uses the canonical `app.tenant_id` GUC
(migration 0003). The two tables are tenant-scoped; schema-evolution
proposals themselves live in the existing
`mutation-authority`-owned proposals tables (no duplication).

---

## 10. Phase 2 Implementation Map

- **New package** `packages/data-onboarding/` (this wave creates
  scaffold) — 7-stage modules + 3 seed recipes
  (`worker_onboarding`, `parcel_onboarding`, `buyer_onboarding`).
- **New api-gateway routes**:
  - `POST /api/v1/data-onboarding/start` — kicks off Stages 1–3
  - `POST /api/v1/data-onboarding/:session_id/approve-schema` —
    owner approves Stage 4 proposals
  - `POST /api/v1/data-onboarding/:session_id/persist` — owner
    triggers Stage 5
  - `GET /api/v1/data-onboarding/:session_id/status` — polling /
    SSE channel for owner dashboard
- **Wire into `compose_anything_v1`** (Wave 18Q) — when the cognitive
  engine classifies an uploaded attachment as "data to persist"
  (vs "data to use for one turn"), it dispatches to `onboard_data_v1`.
- **Persona kernel tool** `onboard_data_v1({ attachment_id, intent_hint
  })` — entry point in the persona-runtime.
- **Migration** `0022_data_onboarding.sql` — two tables + RLS.
- **Reuses**:
  - Wave 18T cognitive-engine ingest pipeline (file parsing,
    DataJoinRef construction).
  - Wave 18S mutation-authority for schema-evolution approvals.
  - Wave 18D research-tools for enrichment adapters.
  - Wave 18B `compose_tab_v1` for the suggested tab layout.
  - Existing `packages/file-ingest/src/schema-sniff` for heuristic
    column-type inference.
  - Existing `packages/audit-hash-chain` for provenance and
    enrichment audit links.

Out-of-scope for Phase 2 (explicitly): automatic schema-evolution
**without owner approval** (never), recipe self-authoring (deferred
to Wave 18M dynamic recipe author), bulk re-onboarding of previously
imported files (deferred).

---

## 11. Test Strategy

- **Unit** — entity-recognizer, column-type-inferer, column-matcher,
  proposal-builder, chain-graph-builder, persister, enrichment
  orchestrator. ≥70 % per file.
- **Integration** — seed recipes against fixture spreadsheets
  (workers / parcels / buyers, each with 5 rows). End-to-end pipeline
  from upload to enrichment.
- **Failure paths** — confidence floor below 0.7 (asks instead of
  guesses), schema-evolution rejection by owner (cleans up), Tier-2
  expiry, NIDA-mismatch enrichment failure.
- **Coverage** — package ≥ 70 % at scaffold; ramps to 80 %+ once seed
  recipes harden.

---

## 12. Acceptance Criteria (Wave 18U exit)

1. `packages/data-onboarding/` typechecks clean under strict-flags
   regime; `pnpm -F @borjie/data-onboarding test` passes.
2. Migration `0022_data_onboarding.sql` lands; the two new tables
   exist with RLS and the `app.tenant_id` policy.
3. The three seed recipes (`worker_onboarding`, `parcel_onboarding`,
   `buyer_onboarding`) are wired into the registry and exercised by
   smoke tests.
4. Spec doc cross-references render in the `Docs/DESIGN/` index.
5. No modifications outside the new package, the migration, the
   database schema barrel, and this spec file.

Subsequent waves (18V / 18W) will:

- Add the four api-gateway routes.
- Wire `onboard_data_v1` into the persona kernel tool registry.
- Implement the four enrichment adapters that don't yet exist
  (NIDA, NSSF, OSHA-cert, salary-benchmark).
- Promote each seed recipe from `shadow` to `live` once owner-tested.

— *Mr. Mwikila does not move data without knowing where it belongs.*
