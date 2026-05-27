# Boji AI — Data model

> Postgres-first; PostGIS for geometry; pgvector (HNSW) for embeddings; Timescale for time-series; S3 for binary; Apache AGE (graph-on-Postgres) optional for v1, with Neo4j Aura as the promotion target if traversal cost grows. Every table carries `tenant_id` with RLS.
>
> The schema below is the **runtime-essential subset** — the rest follows naturally from the spec entity model. Comments tag every table to its junior consumer.

---

## 0 · Conventions

- `id` — ULID (sortable + globally unique) unless noted.
- `tenant_id` — fk → `tenants(id)`, RLS enforced.
- `created_at`, `updated_at` — `timestamptz default now()`.
- Soft-deletes via `invalidated_at` not `deleted_at` (bi-temporal pattern).
- All money columns: `numeric(18,2)` + `currency` (ISO 4217); reject domestic non-TZS at the API layer.
- All geometry: PostGIS `geography(POLYGON, 4326)` for boundaries, `geography(POINT, 4326)` for locations.
- All embeddings: `vector(1024)` (Cohere embed-v3 multilingual).

---

## 1 · Tenants & users

```sql
create table tenants (
  id              text primary key,                -- ULID
  name            text not null,
  country         text not null default 'TZ',
  plan            text not null default 'mkulima', -- mwanzo|mkulima|mfanyabiashara|kampuni|group
  created_at      timestamptz default now()
);

create table users (
  id              text primary key,
  tenant_id       text not null references tenants(id),
  full_name       text not null,
  phone           text,                            -- E.164
  nida_id         text,                            -- TZ National ID via Smile ID
  preferred_lang  text not null default 'sw',      -- sw|en|fr|zh|pt
  role            text not null,                   -- owner|admin|site_manager|supervisor|driver|geologist|stores|qc_officer|boji_team
  biometric_template_hash text,                    -- irreversible hash
  created_at      timestamptz default now()
);
create index on users (tenant_id);
```

---

## 2 · Living Mining Business Map — the temporal entity graph (bi-temporal)

> Cloned verbatim from BossNyumba's `temporal-entity-graph.schema.ts`. Every fact about the business sits here.

```sql
create table temporal_entities (
  id              text primary key,
  tenant_id       text not null references tenants(id),
  entity_type     text not null,                   -- owner|company|director|shareholder|licence|site|drill_hole|sample|vein_model|employee|asset|inventory_item|document|cost|production_record|ore_parcel|sale|buyer|risk|task|...
  entity_key      text not null,                   -- stable business key (e.g. licence number)
  attributes      jsonb not null default '{}',
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz,                     -- null = currently valid
  recorded_at     timestamptz not null default now(),
  invalidated_at  timestamptz,
  community_id    text,                            -- Louvain output from nightly consolidation
  confidence      numeric(3,2) not null default 1.00,
  evidence_ids    text[] not null default '{}',
  source          text not null,                   -- doc:UUID | agent:NAME | sensor:ID | user:UUID
  unique (tenant_id, entity_type, entity_key, valid_from)
);
create index on temporal_entities (tenant_id, entity_type);
create index on temporal_entities using gin (attributes);
create index on temporal_entities (valid_from, valid_to);

create table temporal_relationships (
  id              text primary key,
  tenant_id       text not null references tenants(id),
  from_entity_id  text not null references temporal_entities(id),
  to_entity_id    text not null references temporal_entities(id),
  rel_type        text not null,                   -- OWNS | HOLDS_LICENCE | COVERS_SITE | ASSIGNED_TO | PRODUCED | SOLD_TO | LIVES_IN | PAYS | REQUIRES_RENEWAL_OF | ...
  attributes      jsonb default '{}',
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz,
  recorded_at     timestamptz not null default now()
);
create index on temporal_relationships (tenant_id, from_entity_id);
create index on temporal_relationships (tenant_id, to_entity_id);
create index on temporal_relationships (tenant_id, rel_type);

create table temporal_communities (
  id              text primary key,
  tenant_id       text not null references tenants(id),
  algo            text not null default 'louvain',
  modularity      numeric(5,4),
  run_at          timestamptz not null default now()
);
```

Used by: **every junior**. Master Brain reads via recursive CTE traversals.

---

## 3 · Domain-specific specialised tables

Specialised tables exist alongside the generic graph for the high-frequency queries the agents make. They are **kept in sync** with `temporal_entities` via writes-through.

### 3.1 Companies, licences, sites, assets, employees

```sql
create table companies (
  id text primary key, tenant_id text references tenants(id),
  name text not null, registration_no text, tin text, vrn text,
  registered_address text, country text default 'TZ', created_at timestamptz default now()
);

create table licences (
  id text primary key, tenant_id text references tenants(id),
  company_id text references companies(id),
  type text not null,                              -- PL|PML|ML|SML|DEALER|BROKER|PROCESSING|SMELTING|REFINING
  number text not null,
  mineral text not null,                           -- Au|Ag|Cu|Zn|Pb|Ni|Sn|Al|Fe|Mn|Li|Co|graphite|U|coal|He|diamond|tanzanite|ruby|sapphire|emerald|... see minerals corpus
  holder_user_id text references users(id),
  grant_date date, expiry_date date,
  area_ha numeric(10,4),
  polygon geography(POLYGON, 4326),
  status text default 'active',                    -- active|pending|expired|surrendered|cancelled|disputed
  fees jsonb default '{}', obligations jsonb default '{}',
  dormancy_score smallint default 0,
  created_at timestamptz default now()
);
create index on licences using gist (polygon);
create index on licences (tenant_id, expiry_date);

create table licence_events (
  id text primary key, tenant_id text, licence_id text references licences(id),
  kind text,                                       -- renewal_due|payment_due|notice_of_breach|relinquishment|...
  due_date date, status text default 'open',
  evidence_ids text[] default '{}'
);

create table sites (
  id text primary key, tenant_id text, licence_id text references licences(id),
  name text, mineral text,
  location geography(POINT, 4326),
  polygon geography(POLYGON, 4326),
  phase text,                                      -- pre_licence|exploration|access_prep|sampling|trenching|shafting|vein_search|confirmation|expansion|extraction|sorting|processing|transport|sale|rehab|renewal_conversion
  manager_user_id text references users(id),
  geology_confidence numeric(3,2) default 0.10,
  status text default 'active'
);
create index on sites using gist (polygon);

create table site_sections (
  id text primary key, tenant_id text, site_id text references sites(id),
  kind text,                                       -- start|camp|fuel_store|magazine|ore_stockpile|waste_dump|qc|wash_bay|road|emergency_assembly|env_buffer|rehab_nursery|section_n
  polygon geography(POLYGON, 4326)
);

create table assets (
  id text primary key, tenant_id text, company_id text references companies(id),
  kind text,                                       -- excavator|compressor|generator|pump|crusher|truck|vehicle|drill_rig|tool|ppe
  make text, model text, year smallint,
  owned boolean default true,
  current_site_id text references sites(id),
  current_operator_user_id text references users(id),
  total_hours numeric(10,1) default 0,
  status text default 'operational'
);

create table employees (
  id text primary key, tenant_id text, company_id text references companies(id),
  user_id text references users(id),
  role text, site_id text references sites(id),
  wage_rate_tzs numeric(12,2), wage_basis text,    -- daily|monthly|production_share
  type text,                                       -- PML_employee|contractor|pit_holder_worker|casual
  nationality text default 'TZ',                   -- for Local Content tracking
  status text default 'active',
  start_date date, end_date date
);
```

### 3.2 Geology & lab

```sql
create table drill_holes (
  id text primary key, tenant_id text, site_id text references sites(id),
  hole_id_external text,                           -- supervisor-readable ID
  kind text,                                       -- pit|shaft|rc|diamond|hand_augur|trench|channel
  collar_location geography(POINT, 4326),
  azimuth_deg numeric(5,2), dip_deg numeric(5,2),
  total_depth_m numeric(8,2),
  created_at timestamptz default now(),
  supervisor_user_id text references users(id)
);

create table drill_hole_layers (
  id text primary key, hole_id text references drill_holes(id),
  depth_from_m numeric(8,2), depth_to_m numeric(8,2),
  lithology text, colour text, grain_size text,
  is_vein_intersect boolean default false,
  vein_width_m numeric(6,3),
  vein_dip_deg numeric(5,2),
  host_rock text,
  mineralisation_indicators text[],                -- visible_au, sulphide, garnet, chrome, quartz, etc.
  photo_url text,
  notes text
);

create table samples (
  id text primary key, tenant_id text, drill_hole_id text references drill_holes(id),
  depth_m numeric(8,2),
  sample_tag text,
  mass_g numeric(8,2),
  lab_id text,
  sent_at timestamptz, received_at timestamptz, results_at timestamptz,
  results jsonb,                                   -- {Au_g_t, Cu_pct, ...}
  qa_qc jsonb,                                     -- standard|blank|duplicate|client
  passed_qaqc boolean
);

create table vein_models (
  id text primary key, tenant_id text, site_id text references sites(id),
  length_m numeric(10,2), width_m numeric(8,3), thickness_true_m numeric(8,3),
  dip_deg numeric(5,2), strike_deg numeric(5,2), plunge_deg numeric(5,2),
  volume_m3 numeric(14,2),
  density_t_per_m3 numeric(5,2) default 2.7,
  estimated_tonnes numeric(14,2),
  grade_estimate jsonb,                            -- {Au_g_t: 2.4, Cu_pct: 0.6, ...}
  confidence numeric(3,2),
  computed_at timestamptz default now()
);
```

### 3.3 Production, sales, treasury

```sql
create table shift_reports (
  id text primary key, tenant_id text, site_id text references sites(id),
  supervisor_user_id text references users(id),
  shift_date date, shift_kind text default 'day', -- day|night
  workers_present smallint,
  machine_hours jsonb,                            -- {asset_id: hours}
  fuel_litres numeric(10,2),
  metres_advanced numeric(8,2),
  bcm_overburden numeric(12,2),
  rom_tonnes numeric(12,2),
  blasts_fired smallint default 0,
  delays jsonb,                                   -- [{code, minutes, description}]
  incidents jsonb,
  photos text[],
  next_shift_plan text,
  signed_off_at timestamptz, signed_off_fingerprint_event_id text
);

create table production_records (
  id text primary key, tenant_id text, site_id text references sites(id),
  kind text,                                      -- rom|concentrate|dore|gem|crushed|run_of_mine
  mass_kg numeric(12,3), grade jsonb,
  recovery_pct numeric(5,2),
  ts timestamptz default now()
);

create table ore_parcels (
  id text primary key, tenant_id text, site_id text references sites(id),
  mass_kg numeric(12,3), grade jsonb,
  storage_location text,
  status text default 'in_stockpile',
  photos text[]
);

create table sales (
  id text primary key, tenant_id text,
  parcel_id text references ore_parcels(id),
  buyer_id text,
  route text,                                     -- BoT|MTC|export_direct|trader
  weighbridge_doc_id text,
  vehicle_plate text, driver_user_id text,
  gross_price_usd numeric(14,2), gross_price_tzs numeric(18,2),
  fx_at_sale_tzs_per_usd numeric(10,4),
  royalty_pct numeric(5,2), inspection_pct numeric(5,2),
  vat_pct numeric(5,2), other_levies jsonb,
  net_tzs numeric(18,2),
  payment_status text default 'pending',
  payment_received_at timestamptz,
  ts timestamptz default now()
);

create table cash_balances (                       -- Timescale hypertable
  ts timestamptz not null,
  tenant_id text not null, company_id text not null,
  account_id text not null,
  balance_tzs numeric(18,2)
);
select create_hypertable('cash_balances', 'ts');

create table fx_rates (
  ts timestamptz not null,
  pair text not null,                             -- TZS_USD, TZS_EUR, ...
  rate numeric(12,6), source text                 -- BoT|LBMA|LME|Fastmarkets|...
);

create table mineral_prices (
  ts timestamptz not null,
  mineral text not null,
  unit text not null,                             -- USD/oz|USD/t|USD/kg|USD/dmtu|...
  price numeric(14,4),
  source text
);
```

### 3.4 Costs & forecasts

```sql
create table costs (
  id text primary key, tenant_id text, site_id text references sites(id),
  category text,                                   -- wages|fuel|food|water|equipment|repairs|land|transport|processing|security|admin|debt|advance|royalty|inspection|levy|other
  amount_tzs numeric(18,2), amount_currency text default 'TZS', amount_native numeric(18,2),
  state text default 'actual',                    -- actual|forecast|committed|unpaid|disputed|hidden|document_blocked|idle_time
  ts timestamptz default now(),
  evidence_id text
);

create table forecasts (
  id text primary key, tenant_id text, scope_kind text, scope_id text,
  metric text,                                     -- production_t | cash_runway_d | fuel_days | excavator_failure_p | mineral_price | fx | recoverable_g | demurrage_risk_p | demand | npv | break_even
  horizon_days int,
  low numeric, mid numeric, high numeric,
  basis text, model_version text,
  computed_at timestamptz default now()
);
```

### 3.5 Documents, fingerprints, audit

```sql
create table documents (
  id text primary key, tenant_id text,
  kind text,                                       -- PML|PL|ML|SML|EPP|EIA|village_minutes|csr_plan|receipt_*|kyc_*|...
  status text default 'received',
  file_url text, content_type text,
  ocr_text text, embedding vector(1024),
  extracted jsonb,
  related_to text[],                               -- LMBM node IDs
  source_actor_user_id text references users(id),
  sha256 text, perceptual_hash text,
  created_at timestamptz default now()
);
create index on documents using ivfflat (embedding vector_cosine_ops);

create table fingerprint_events (                  -- signed events; immutable
  id text primary key, tenant_id text,
  user_id text references users(id),
  document_id text references documents(id),
  biometric_hash text,                             -- irreversible
  signed_at timestamptz, geo geography(POINT, 4326),
  device_attestation jsonb
);

create table audit_log (                           -- append-only
  id bigserial primary key, ts timestamptz default now(),
  tenant_id text, actor text, action text, target text, payload jsonb,
  evidence_ids text[]
);

create table decision_log (
  id text primary key, tenant_id text, ts timestamptz default now(),
  prompt text, mode text,
  juniors_called text[],
  confidence numeric(3,2),
  recommendation text,
  evidence_ids text[],
  owner_action text
);
```

### 3.6 Tasks, risks

```sql
create table tasks (
  id text primary key, tenant_id text,
  owner_user_id text references users(id),
  title text, kind text, priority smallint,
  site_id text references sites(id), licence_id text references licences(id),
  due_date date,
  required_evidence text[],
  dependencies text[],
  cost_implication_tzs numeric(18,2),
  risk_if_delayed text,
  status text default 'open',
  ai_followup_cadence text                         -- daily|every_3d|weekly
);

create table risks (
  id text primary key, tenant_id text, site_id text references sites(id),
  kind text,                                       -- licence|safety|environmental|community|cash|fx|geology|equipment|...
  severity text,                                   -- low|medium|high|critical
  description text, mitigations text[],
  status text default 'open'
);
```

### 3.7 Marketplaces, ratings, KYC

```sql
create table marketplace_listings (
  id text primary key, tenant_id text,
  category text,                                   -- worker|equipment|qc_tool|lab|expert|buyer
  title text, description text,
  price_tzs numeric(18,2), location geography(POINT, 4326),
  contact_user_id text references users(id),
  visibility text default 'tanzania'               -- private|tanzania|regional|global
);

create table ratings (
  id text primary key, subject_id text, subject_kind text,
  rater_user_id text, score smallint,              -- 1-5
  comment text, ts timestamptz default now()
);
```

---

## 4 · Vector store (pgvector — bootstrap brain)

```sql
create table intelligence_corpus_chunks (
  id text primary key, tenant_id text,             -- NULL = global Boji corpus
  source_file text,                                -- e.g. research/01_TZ_MINING_REGULATION_2025_2026.md
  section text, page int,
  text text not null,
  embedding vector(1024),
  url text,                                        -- live citation URL
  ingested_at timestamptz default now(),
  superseded_by_id text
);
create index on intelligence_corpus_chunks using ivfflat (embedding vector_cosine_ops);
create index on intelligence_corpus_chunks (source_file, section);
```

On first-boot of each tenant: ingest `Docs/primary_sources/*`, `Docs/research/*.md`, `Docs/research/minerals/*.md` into this table with `tenant_id = NULL` (global) so every tenant shares the same corpus baseline.

Tenant-specific chunks (uploaded documents) go into the same table with `tenant_id = <theirs>`. RLS enforces visibility.

---

## 5 · Multi-tenant boundary

```sql
alter table tenants enable row level security;
alter table users enable row level security;
-- ... and every other table

create policy tenant_isolation on companies
  for all to authenticated
  using (tenant_id = current_setting('app.current_tenant_id'));
-- ... same template per table
```

Backend sets `app.current_tenant_id` per request from JWT claim. Postgres enforces.

---

## 6 · Migration & seeding strategy

1. **Schema migrations** via Drizzle (TypeScript) — same toolchain as BossNyumba.
2. **Tenant onboarding migration** — when a new tenant signs up:
   - row in `tenants`
   - default `intelligence_corpus_chunks` already in place (global)
   - row in `users` for the owner
   - empty `companies`, `licences`, `sites` etc.
3. **Bootstrap brain ingestion** — runs on first sign-in; ingests the global corpus into tenant's vector namespace if using Qdrant; otherwise the global rows are already queryable.

---

## 7 · Why this schema

- **Bi-temporal facts** in `temporal_entities` give Boji defensible audit and time-travel.
- **Specialised tables** alongside the graph give the agents fast, typed queries (a Geology Agent calling `drill_hole_layers` is faster and more typed than a generic graph traversal).
- **pgvector inline** means Boji's runtime is one Postgres + one bucket — minimal ops overhead.
- **PostGIS first-class** — mining is geo-first.
- **Timescale** for the high-frequency series (cash, FX, prices, shift telemetry).
- **Append-only audit + immutable fingerprint events** — non-repudiation for regulators.
- **Row-level security** at the database — defence in depth.

— end of data model v0.1 —
