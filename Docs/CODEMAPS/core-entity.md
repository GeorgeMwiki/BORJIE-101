# Core Entity Codemap (Piece A — Universal Asset & Entity Model)

**Last Updated:** 2026-05-22
**Module:** `packages/database/src/schemas/core-entity/` +
            `packages/database/src/repositories/core-entity.repository.ts`
**Migrations:** `0186_core_entity.sql` .. `0194_entity_ext_person.sql`
**Tier scope:** all (FORCE RLS via `app.current_tenant_id` GUC)

## Purpose

Single polymorphic row-store for **every** tangible or intangible
asset / actor a tenant owns or manages:

- Land parcels (LAND_PARCEL, PLOT, BARELAND) — subdividable into
  sub-parcels via `parent_entity_id`.
- Buildings (BUILDING, HOTEL, WAREHOUSE, GODOWN) — sub-units attach
  as separate SUB_UNIT rows.
- Vehicles + locomotives (VEHICLE, LOCOMOTIVE).
- Machinery (MACHINERY) — installed on a BUILDING or LAND_PARCEL.
- IT assets (IT_ASSET) — assigned to PERSON entities.
- Intangibles (INTANGIBLE, CONTRACT, VENDOR, ORG_UNIT).
- People (PERSON) — landlords, tenants, staff, contacts, dependants.

Tenant-defined custom fields are persisted on `core_entity.custom_fields`
(JSONB) and validated against `tenant_schema_extensions` at write time
via a re-hydrated Zod parser. **No DDL needed** when a tenant adds a
new field — purely a row insert into the registry.

## Entry points

- `core_entity` table — polymorphic root (migration 0186).
- `entity_type_definition` — type catalog with platform built-ins +
  per-tenant types (migration 0187).
- `tenant_schema_extensions` — per-(tenant, module, entity_type,
  field_name) custom-field catalog (migration 0188).
- `entity_ext_land`, `entity_ext_building`, `entity_ext_vehicle`,
  `entity_ext_machinery`, `entity_ext_it_asset`, `entity_ext_person` —
  thin per-type extensions, FK'd to `core_entity.id` (migrations
  0189-0194).
- `properties_view` + `units_view` — UNION ALL of legacy
  `properties`/`units` tables with BUILDING-/SUB_UNIT-flavoured
  `core_entity` rows, so existing `SELECT * FROM properties` callers
  keep working (migration 0194).

## Internal structure

```
packages/database/src/
  schemas/core-entity/
    core-entity.schema.ts                       — polymorphic root
    entity-type.schema.ts                       — type catalog
    tenant-schema-extensions.schema.ts          — custom-field registry
    entity-ext-land.schema.ts                   — land extension
    entity-ext-building.schema.ts               — building extension
    entity-ext-vehicle.schema.ts                — vehicle extension
    entity-ext-machinery.schema.ts              — machinery extension
    entity-ext-it-asset.schema.ts               — IT asset extension
    entity-ext-person.schema.ts                 — person extension
    index.ts                                    — barrel export
  repositories/
    core-entity.repository.ts                   — CoreEntityRepository
  helpers/
    postgis-install.ts                          — runtime PostGIS probe
    tsv-trigger.ts                              — tsv trigger SQL generator
  __tests__/
    core-entity.repository.test.ts              — schema + simulator tests
  migrations/
    0186_core_entity.sql                        — root table + tsv trigger
    0187_entity_type_definition.sql             — type catalog + seeds
    0188_tenant_schema_extensions.sql           — custom-field registry
    0189_entity_ext_land.sql                    — land extension table
    0190_entity_ext_building.sql                — building extension table
    0191_entity_ext_vehicle.sql                 — vehicle extension table
    0192_entity_ext_machinery.sql               — machinery extension table
    0193_entity_ext_it_asset.sql                — IT asset extension table
    0194_entity_ext_person.sql                  — person + compat views
```

## How subdivision works

Every entity carries `parent_entity_id text NULL`, a self-reference
into `core_entity(id)` with `ON DELETE CASCADE`. Subdivision is a
recursive parent-child tree.

```
LAND_PARCEL (100 ha "Original Title")
   ├─ LAND_PARCEL (50 ha, fractional_area=0.5)
   ├─ LAND_PARCEL (25 ha, fractional_area=0.25)
   │     ├─ PLOT (5 ha, fractional_area=0.2)
   │     └─ PLOT (20 ha, fractional_area=0.8)
   └─ LAND_PARCEL (25 ha, fractional_area=0.25)

BUILDING (Acacia Towers)
   ├─ SUB_UNIT (1A)
   ├─ SUB_UNIT (1B)
   └─ SUB_UNIT (2A)
```

The repository's `findAllDescendants(rootId, tenantId)` uses a
Postgres recursive CTE so the work happens server-side in one round
trip. `fractional_area` on `entity_ext_land` is a hint, not a
constraint — the sum of live children should equal 1.0, enforced at
the application layer (not DB) to allow transient mid-subdivision
states.

## Hybrid search ranking

`CoreEntityRepository.searchHybrid({ tenantId, query, entityTypes,
geoNear, embedding, customFieldsContains, topK, mmrLambda })`
combines four signals:

1. **BM25** — `ts_rank_cd(ce.tsv, plainto_tsquery('simple', :query))`.
   The `tsv` column is maintained by the `core_entity_tsv_trigger`
   (migration 0186) over `display_name` (weight A), `discriminator`
   (B), `entity_type` (B), and `custom_fields::text` (C).
2. **Dense** — `1.0 - (ce.embedding <=> :embedding::vector)`. Index:
   HNSW with `vector_cosine_ops` (fall back to IVFFlat with
   `lists=100` on pgvector <0.5).
3. **Geo** — `1.0 - (ST_Distance(...) / :radius_meters)` clamped to
   `[0, 1]`. Source column: `geo_geog geography(GEOMETRY, 4326)`.
4. **JSONB containment** — `ce.custom_fields @> :predicate::jsonb`.
   Index: `GIN (custom_fields jsonb_path_ops)`.

After the per-signal scores are added, the top `topK * 3` rows are
re-ranked with **MMR** (`mmrLambda` default 0.3) — diversification by
`display_name` token-Jaccard. This prevents three near-duplicate
"plot 42 acacia road / plot 42 acacia road north / ..." hits from
dominating the result list.

If pgvector / PostGIS is unavailable, the path catches the SQL error
and falls back to a tenant-filtered scan (zero scores; ordering by
created_at). Search degrades but never throws.

## How legacy properties view-aliases

`properties_view` is a `WITH (security_invoker = true)` view —

- Branch 1: every row of the legacy `properties` table, with `source =
  'legacy'`.
- Branch 2: every `core_entity` row whose `entity_type IN ('BUILDING',
  'WAREHOUSE', 'GODOWN', 'HOTEL')`, LEFT JOINed to
  `entity_ext_building`, with `source = 'core_entity'`.

Existing `SELECT * FROM properties` queries are **unchanged** — the
legacy table is untouched. New code that wants the unified surface
reads from `properties_view`. Once every reader is migrated, a
separate piece will retire the legacy table.

`units_view` follows the same pattern over the legacy `units` table
and SUB_UNIT-flavoured `core_entity` rows.

## Custom-field flow

```
┌──────────────────────────────────────────────────────────────────┐
│ Tenant admin defines a custom field in the console:              │
│                                                                  │
│   addCustomField({                                               │
│     tenantId: 'tnt-acme',                                        │
│     entityType: 'LAND_PARCEL',                                   │
│     fieldName: 'irrigation_score',                               │
│     fieldKind: 'number',                                         │
│     zodSchema: z.number().min(0).max(10),                        │
│     required: true,                                              │
│   });                                                            │
│                                                                  │
│ ↓ Insert into tenant_schema_extensions (no DDL)                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Tenant inserts a LAND_PARCEL:                                    │
│                                                                  │
│   insertEntity({                                                 │
│     entityType: 'LAND_PARCEL',                                   │
│     customFields: { irrigation_score: 7 },                       │
│     land: { hectares: 1.5, ... },                                │
│   }, 'tnt-acme');                                                │
│                                                                  │
│ ↓ Repository calls validateCustomFields() first                  │
│ ↓ Looks up tenant_schema_extensions → field_kind = 'number'      │
│ ↓ Re-hydrates a Zod number validator                             │
│ ↓ Parses customFields.irrigation_score → passes / throws         │
│ ↓ Then writes core_entity + entity_ext_land in one transaction   │
└──────────────────────────────────────────────────────────────────┘
```

## RLS pattern

Gold-standard pattern from migrations 0182/0183/0184/0185:

```sql
ALTER TABLE core_entity ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_entity FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON core_entity
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id());

CREATE POLICY tenant_isolation_modify ON core_entity
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_app_tenant_id())
  WITH CHECK (tenant_id = public.current_app_tenant_id());

REVOKE ALL ON core_entity FROM anon;
```

All extension tables (`entity_ext_*`) and the registry
(`tenant_schema_extensions`) install the same policy set.

`entity_type_definition` has a carve-out: platform built-ins
(`tenant_id IS NULL`) are visible to every authenticated user but
mutable only by service-role.

## PostGIS + pgvector availability

Migration 0186 installs both extensions inside `DO $$ EXCEPTION` blocks:

- **pgvector** present → `core_entity.embedding` is a real `vector(1536)`
  column; HNSW index installed.
- **pgvector** missing → `core_entity.embedding` is `TEXT`; dense
  search disabled.
- **PostGIS** present → `core_entity.geo_geog` is a real
  `geography(GEOMETRY, 4326)`; GIST index installed.
- **PostGIS** missing → `core_entity.geo_geog` is `JSONB`; geo search
  disabled.

The repository's `searchHybrid` catches missing-extension errors and
falls back to a tenant-filtered scan. The CI dev-Postgres image has
both extensions pre-installed; managed Postgres (Supabase / RDS /
Neon) ships them by default.

## Common workflows

- **Add a new platform-tier entity type** → insert into
  `entity_type_definition` with `tenant_id = NULL`, `is_built_in =
  TRUE`. Done. No code change.
- **Add a tenant-tier custom field** →
  `CoreEntityRepository.addCustomField({ tenantId, entityType,
  fieldName, fieldKind, zodSchema })`.
- **Subdivide a parcel** → insert child rows with `parent_entity_id =
  <parent>.id`; ON DELETE CASCADE means removing the parent removes
  all descendants atomically.
- **Hybrid search** → `CoreEntityRepository.searchHybrid({...})`.
- **Read legacy + new** → `SELECT * FROM properties_view WHERE
  tenant_id = $1`.

## Anti-patterns to avoid

- Don't write directly into `entity_ext_*` without writing the
  matching `core_entity` row first — the FK by `entity_id` requires
  it.
- Don't store money on `core_entity.custom_fields`. Money path goes
  through `LedgerService.post()` in `services/payments-ledger/`.
- Don't add new columns to `core_entity` for tenant-specific fields —
  use `custom_fields` + `tenant_schema_extensions`. Adding columns
  breaks the polymorphism promise.
- Don't query `core_entity` without a tenant filter — RLS will deny,
  but explicit tenant_id keeps the planner cheap.
- Don't edit migrations 0186-0194 after merge — fix-forward with new
  numbered migrations.

## Related codemaps

- [database.md](./database.md) — overall schema layout + migration discipline
- [api-gateway.md](./api-gateway.md) — `app.current_tenant_id` GUC binding
- [domain-models.md](./domain-models.md) — Zod schema helpers
- [payments-ledger.md](./payments-ledger.md) — money path (NEVER through core_entity)

## Acceptance notes (Piece A done-for-real)

- 9 migrations land cleanly against a fresh Postgres-15 + pgvector
  + PostGIS.
- All 9 Drizzle schemas exported via `core-entity/index.ts`.
- `CoreEntityRepository` covers insert + recursive descent + custom-
  field validation + hybrid search + MMR rerank.
- `properties_view` and `units_view` read-through both legacy + new
  rows; `security_invoker = true` so RLS honours the calling role.
- `core-entity.repository.test.ts` covers schema introspection +
  simulator-based RLS / parent-chain / custom-field invariants + MMR
  rerank.
