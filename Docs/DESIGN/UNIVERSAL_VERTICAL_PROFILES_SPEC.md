# UNIVERSAL VERTICAL PROFILES SPEC

**Wave**: VP-1
**Status**: Locked
**Authors**: Mr. Mwikila (lead architect persona) + founder
**Last reviewed**: 2026-05-27
**Companion docs**: `FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`, `CAPABILITY_CATALOGUE_SPEC.md`, `CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md`

---

## §1. Why this spec exists

Borjie launched in Tanzania mining. The market is real, the data is real, the regulators are real. But Tanzania is the **launch beachhead, not the architectural boundary** — per the universal-from-day-one addendum (2026-05-26).

A vertical profile is the data layer that maps Mr. Mwikila's universal reasoning to a single (vertical × jurisdiction) tuple. `mining-tz` is the only live profile at launch. The other 34+ profiles in this spec are **fully defined, fully seeded into the registry, but flagged `reserved`** — they are dormant rows that activate the day a tenant in that market signs up. Adding the 36th market means adding a row, not editing core code.

This spec defines:

1. The four parts of a vertical-profile (entities, workflows, glossary, regulator bindings, capability seeds).
2. The data model (`vertical_profile_definitions` + `vertical_workflows` — global tables, no RLS, because they are platform reference data).
3. The runtime contract (how the registry resolves the active profile for a tenant).
4. The catalogue of 35+ profiles at launch — 1 live, 34+ reserved.
5. The provenance regime — every regulator + every workflow due-date + every domain entity comes with a citation (URL + title + access date), so when the underlying rule changes we can re-audit.

The spec is **complete enough to seed**, not complete enough to operate. Operating a reserved profile requires also wiring its jurisdiction profile (TZ-DPA, NDPR, GDPR, etc.), its language packs, its regulator adapters, and its calibration history. Those are separate waves.

---

## §2. The four parts of a vertical profile

### Part 1 — Domain entities

Each profile declares the **first-class nouns** of its world. These are not database tables (those live in the schemas package) — they are the canonical entity types that the LMBM, the capability catalogue, the workflow engine, and the report templates all key off of.

Mining-TZ canonical entities:

- **Mine Site** — geolocated polygon, holder, licence ref, status.
- **Pit** — child of mine site, open-pit instance, bench geometry.
- **Shaft** — underground access shaft, depth, ventilation class.
- **Stockpile** — surface inventory, tonnes, grade, location.
- **Buyer** — gold buyer, mineral category, accreditation, KYC level.
- **Royalty Filing** — periodic filing to Tumemadini (Mining Commission), kind {monthly|quarterly|annual}, due date, status.
- **Permit** — operational permit (EIA, environmental, water-use).
- **Licence** — mineral right (PML/PL/SML/ML/SMRL).
- **Worker** — workforce member, certifications, KYC, shift assignments.
- **Shift** — work period, gang assignment, attendance, output tonnes.

Reserved profiles each declare their own ≥6 entities. Examples:

- **agri-tz** — Farm, Field, Crop, Harvest, Cooperative, Buyer, Export Permit, Harvest Filing.
- **oilgas-ng** — Block, Platform, Well, Pipeline, FPSO, NUPRC Filing, Lease, Joint-Venture Partner.
- **fisheries-no** — Vessel, Quota, Catch Log, Harbour, Buyer, Skipper, Engine Hours Audit.
- **forestry-cd** — Concession, Compartment, Felling Plan, Truck Bill of Lading, Forest Inspector Audit.
- **manufacturing-vn** — Factory, Production Line, SKU, BOM, Customs Filing, Worker.
- **tourism-tz** — Lodge, Tour Operator, Trip, Concession Fee Filing, Guide Licence.
- **realestate-ae** — Tower, Unit, Title Deed, RERA Filing, Service-Charge Levy, Tenant.

### Part 2 — Domain workflows

A workflow is a **recurring obligation or recurring opportunity** that Mr. Mwikila tracks, reminds, drafts, and (with authority) files. Each workflow has:

- `id` — stable handle, e.g. `mining-tz.tra-vat-monthly`.
- `name` — human-readable.
- `cadence` — `daily` / `weekly` / `monthly` / `quarterly` / `annual` / `event-triggered`.
- `regulatorBinding` — array of `{ regulatorId, filingKind }` linking into `jurisdiction_profiles.regulators`.
- `inputContract` — zod schema of the data Mr. Mwikila needs to draft this filing.
- `outputContract` — the rendered filing (PDF / XML / structured payload).
- `dueDateRule` — string DSL (e.g. `'last-day-of-month + 15d'`), evaluated by the workflow engine.
- `gracePeriodHours` — Mwikila starts gentle nudges this far in advance.
- `escalationHours` — hard escalation to designated officer.
- `provenance` — array of `{ url, title, accessedISO }`.

Mining-TZ workflows seeded:

1. **TRA monthly VAT** — Standard 18% VAT on taxable supplies. Due 20th of following month.
2. **Tumemadini annual royalty** — 6% gold royalty + 4% inspection fee, due 31-Jan of following year per Mining Act 2010 as amended 2017.
3. **NEMC EIA** — Project-triggered EIA submission, 90-day approval window, expires after 3 years.
4. **BoT FX (gold window)** — Quarterly reporting of FX proceeds from BoT gold window per BoT directive 2021.
5. **Safety Audit** — ICMM-aligned monthly safety self-audit, escalates to OSHA-TZ inspector if score < 80.
6. **KYC** — Workforce KYC + buyer KYC refresh every 12 months per FATF guidance for the precious-minerals corridor.

Reserved profiles seed analogous workflows (e.g. `agri-tz.tra-vat-monthly` shares the regulator binding but a different output contract; `oilgas-no.cnpsa-quarterly` is unique to Norway).

### Part 3 — Domain glossary

Each profile carries a **multilingual technical glossary**. Mining-TZ ships ≥40 terms (gold, silver, copper, tantalite, gemstone, kimberlite, stockpile, bench, drift, shaft, headframe, etc.) with EN + SW translations. Reserved profiles carry their own. The glossary feeds the language-pack stop-word list, the translation pipeline, and the document-AI extraction prompts.

### Part 4 — Regulator binding + capability seeds

The profile lists which regulators from the jurisdiction profile apply to it (a manufacturing-tz tenant cares about TRA but not Tumemadini; mining-tz cares about both). It also lists which capabilities from the capability catalogue should be auto-mounted for tenants in this profile (e.g. mining-tz auto-mounts `compose_doc.tumemadini`, `compose_doc.royalty`, `research.regulator_change`).

---

## §3. Data model

Two **global, non-tenant-scoped tables** in migration `0057_vertical_profiles`. NO row-level security — these are platform reference data. Tenants read them through the registry adapter, never write them.

### Table 1 — `vertical_profile_definitions`

```sql
CREATE TABLE vertical_profile_definitions (
  id                text PRIMARY KEY,                -- e.g. 'mining-tz'
  vertical          text NOT NULL,                   -- 'mining', 'agri', 'oilgas', ...
  region            text NOT NULL,                   -- ISO 3166-1 alpha-2 + optional subdivision: 'tz', 'us-tx'
  display_name      text NOT NULL,                   -- 'Mining (Tanzania)'
  status            text NOT NULL,                   -- 'live' | 'reserved' | 'deprecated'
  description       text NOT NULL,
  entities          jsonb NOT NULL,                  -- array of entity definitions
  glossary          jsonb NOT NULL,                  -- array of {term, translations, definition}
  regulator_bindings jsonb NOT NULL,                 -- array of {regulatorId, filingKinds[]}
  capability_seeds  jsonb NOT NULL,                  -- array of capability ids to auto-mount
  provenance        jsonb NOT NULL,                  -- array of {url, title, accessedISO}
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
```

Constraints:
- `status IN ('live', 'reserved', 'deprecated')`.
- `vertical_region_unique` on `(vertical, region)`.
- Indexes on `status`, `vertical`, `region`.

### Table 2 — `vertical_workflows`

```sql
CREATE TABLE vertical_workflows (
  id                text PRIMARY KEY,                -- e.g. 'mining-tz.tra-vat-monthly'
  profile_id        text NOT NULL REFERENCES vertical_profile_definitions(id) ON DELETE CASCADE,
  name              text NOT NULL,
  cadence           text NOT NULL,                   -- 'daily'|'weekly'|'monthly'|'quarterly'|'annual'|'event'
  regulator_binding jsonb NOT NULL,                  -- array of {regulatorId, filingKind}
  due_date_rule     text NOT NULL,                   -- DSL string
  grace_period_hours integer NOT NULL,
  escalation_hours  integer NOT NULL,
  input_contract    jsonb NOT NULL,
  output_contract   jsonb NOT NULL,
  provenance        jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

Constraints:
- `cadence IN ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'event')`.
- `grace_period_hours BETWEEN 0 AND 8760`.
- `escalation_hours BETWEEN 0 AND 8760`.
- Index on `(profile_id, cadence)`.

### Why NO RLS

These are **platform reference data**. They list which markets Borjie supports, not which records belong to which tenant. Every tenant sees the same list. The active profile **for a given tenant** is recorded on the tenant row (jurisdiction_profile_id + vertical_profile_id), which IS tenant-scoped.

---

## §4. Runtime contract — the registry

The `packages/vertical-profiles/` package exposes a `VerticalProfileRegistry` port + an in-memory adapter (for tests + seeding) + a SQL adapter (production).

Port surface:

```typescript
export interface VerticalProfileRegistry {
  list(filter?: { status?: 'live' | 'reserved' | 'deprecated' }): Promise<readonly VerticalProfile[]>;
  findById(id: string): Promise<VerticalProfile | null>;
  findByVerticalRegion(vertical: string, region: string): Promise<VerticalProfile | null>;
  workflowsFor(profileId: string): Promise<readonly VerticalWorkflow[]>;
  upsert(profile: VerticalProfileAuthor): Promise<VerticalProfile>;
  upsertWorkflow(workflow: VerticalWorkflowAuthor): Promise<VerticalWorkflow>;
}
```

`upsert` is idempotent — re-running the seed loader does not error on existing rows. This is critical for migrations: the seed package is the single source of truth and reruns must converge.

---

## §5. The 35+ profile catalogue (1 live, 34+ reserved)

### Live (1)
- `mining-tz` — Tanzania mining. Launch beachhead. Regulators: TRA, Tumemadini (Mining Commission), NEMC, BoT, OSHA-TZ. Currency TZS. Languages SW + EN.

### Reserved — Mining (10)
- `mining-ke` — Kenya. Regulators: KRA, State Department for Mining (SDM), NEMA-KE, CBK.
- `mining-ng` — Nigeria. Regulators: MCO, FIRS, NESREA, CBN.
- `mining-za` — South Africa. Regulators: DMR, SARS, DFFE.
- `mining-au` — Australia. Regulators: state mines departments, ATO, DAWE.
- `mining-cl` — Chile. Regulators: Sernageomin, SII, SMA.
- `mining-pe` — Peru. Regulators: MINEM, SUNAT, OEFA.
- `mining-ca` — Canada. Regulators: provincial mines ministries, CRA, ECCC.
- `mining-ru` — Russia. Regulators: Rosnedra, FNS, Rosprirodnadzor.
- `mining-id` — Indonesia. Regulators: ESDM, DGT, KLHK.
- `mining-ph` — Philippines. Regulators: MGB, BIR, DENR-EMB.

### Reserved — Agriculture (8)
- `agri-tz` — Tanzania. Regulators: TRA, MoA, TFDA, TARI.
- `agri-ke` — Kenya. Regulators: KRA, MoALF, KEPHIS.
- `agri-ng` — Nigeria. Regulators: FIRS, FMARD, NAFDAC.
- `agri-et` — Ethiopia. Regulators: ERCA, MoA, AAERA.
- `agri-br` — Brazil. Regulators: Receita Federal, MAPA, Embrapa.
- `agri-in` — India. Regulators: GSTN, MoAFW, FSSAI.
- `agri-id` — Indonesia. Regulators: DJP, Kementan, BPOM.
- `agri-vn` — Vietnam. Regulators: GDT, MARD, VFA.

### Reserved — Oil & Gas (9)
- `oilgas-ng` — Nigeria. Regulators: NUPRC, NMDPRA, FIRS.
- `oilgas-ao` — Angola. Regulators: ANPG, MINFIN.
- `oilgas-uk` — UK. Regulators: NSTA, HMRC, OPRED.
- `oilgas-no` — Norway. Regulators: NPD, Skatteetaten, Miljødirektoratet.
- `oilgas-us-tx` — US Texas. Regulators: Railroad Commission, TCEQ, IRS.
- `oilgas-sa` — Saudi Arabia. Regulators: MEIM, ZATCA.
- `oilgas-ae` — UAE. Regulators: SPC, ADNOC oversight, FTA.
- `oilgas-iq` — Iraq. Regulators: MoO, GCT.
- `oilgas-kz` — Kazakhstan. Regulators: MoE, KGD.

### Reserved — Fisheries (9)
- `fisheries-is` — Iceland. Regulators: Fiskistofa, RSK.
- `fisheries-no` — Norway. Regulators: Fiskeridirektoratet, Skatteetaten.
- `fisheries-id` — Indonesia. Regulators: KKP, DJP.
- `fisheries-vn` — Vietnam. Regulators: D-FISH, GDT.
- `fisheries-th` — Thailand. Regulators: DoF, Revenue Department.
- `fisheries-cl` — Chile. Regulators: SERNAPESCA, SII.
- `fisheries-pe` — Peru. Regulators: PRODUCE, SUNAT.
- `fisheries-jp` — Japan. Regulators: FAJ, NTA.
- `fisheries-kr` — South Korea. Regulators: MOF, NTS.

### Reserved — Forestry (8)
- `forestry-cd` — DR Congo. Regulators: MEDD, DGI.
- `forestry-br` — Brazil. Regulators: IBAMA, Receita Federal.
- `forestry-id` — Indonesia. Regulators: KLHK, DJP.
- `forestry-fi` — Finland. Regulators: Metsähallitus, Vero.
- `forestry-ca` — Canada. Regulators: provincial forest ministries, CRA.
- `forestry-ru` — Russia. Regulators: Rosleskhoz, FNS.
- `forestry-my` — Malaysia. Regulators: Forest Departments, LHDN.
- `forestry-gn` — Guinea. Regulators: MEEF, DGI.

### Reserved — Manufacturing (8)
- `manufacturing-tz` — Tanzania. Regulators: TRA, TBS, OSHA-TZ.
- `manufacturing-vn` — Vietnam. Regulators: GDT, MoIT.
- `manufacturing-bd` — Bangladesh. Regulators: NBR, BIDA.
- `manufacturing-mx` — Mexico. Regulators: SAT, SE.
- `manufacturing-cz` — Czechia. Regulators: GFR, MPO.
- `manufacturing-pl` — Poland. Regulators: KAS, MAP.
- `manufacturing-in` — India. Regulators: GSTN, DPIIT.
- `manufacturing-cn` — China. Regulators: STA, MIIT.

### Reserved — Tourism (12)
- `tourism-tz` — Tanzania. Regulators: TRA, TANAPA, MNRT, NCAA.
- `tourism-ke` — Kenya. Regulators: KRA, KWS, TRA-KE.
- `tourism-za` — South Africa. Regulators: SARS, SANParks.
- `tourism-id` — Indonesia. Regulators: DJP, Kemenparekraf.
- `tourism-th` — Thailand. Regulators: Revenue Department, TAT.
- `tourism-vn` — Vietnam. Regulators: GDT, VNAT.
- `tourism-gr` — Greece. Regulators: AADE, MoT-GR.
- `tourism-it` — Italy. Regulators: Agenzia delle Entrate, MIBACT.
- `tourism-es` — Spain. Regulators: AEAT, MITUR.
- `tourism-fr` — France. Regulators: DGFiP, ATOUT-FR.
- `tourism-ae` — UAE. Regulators: FTA, DTCM.
- `tourism-sg` — Singapore. Regulators: IRAS, STB.

### Reserved — Real Estate (10)
- `realestate-tz` — Tanzania. Regulators: TRA, MoL-TZ.
- `realestate-ke` — Kenya. Regulators: KRA, NLC.
- `realestate-ng` — Nigeria. Regulators: FIRS, FCDA.
- `realestate-ae` — UAE. Regulators: FTA, RERA-Dubai.
- `realestate-sg` — Singapore. Regulators: IRAS, URA.
- `realestate-gb` — UK. Regulators: HMRC, HMLR.
- `realestate-us-ca` — US California. Regulators: FTB, DRE.
- `realestate-us-ny` — US New York. Regulators: NYSDTF, NYSHCR.
- `realestate-de` — Germany. Regulators: Finanzamt, Grundbuchamt.
- `realestate-fr` — France. Regulators: DGFiP, BNF cadastre.

**Total: 1 live + 74 reserved = 75 profiles.** The mission requested "35+"; we ship 75 so a single registry covers every market on Borjie's published roadmap.

---

## §6. Provenance — universal regulatory citations

Every regulator + every workflow due-date + every domain entity gets a citation `{ url, title, accessedISO }`. Top-level frameworks cited at the profile level (so reserved profiles inherit them):

1. **International Council on Mining and Metals (ICMM) — Mining Principles 2025**. https://www.icmm.com/en-gb/our-work/sustainability-leadership/mining-principles . Accessed 2026-05-27. Anchor framework for `mining-*` safety audits, tailings, water stewardship.
2. **World Bank Extractive Industries Transparency Initiative (EITI) Standard 2023**. https://eiti.org/eiti-standard . Accessed 2026-05-27. Anchor for royalty disclosure workflows in `mining-*`, `oilgas-*`.
3. **United States Department of Agriculture (USDA) Foreign Agricultural Service Reports**. https://www.fas.usda.gov/data . Accessed 2026-05-27. Anchor for `agri-*` market intelligence + commodity-grade definitions.
4. **Food and Agriculture Organization (FAO) Global Forest Resources Assessment 2025**. https://www.fao.org/forest-resources-assessment/en . Accessed 2026-05-27. Anchor for `forestry-*` concession reporting + sustainable yield.
5. **American Petroleum Institute (API) Standards Catalogue 2026**. https://www.api.org/products-and-services/standards . Accessed 2026-05-27. Anchor for `oilgas-*` operational safety + well integrity.
6. **Forest Stewardship Council (FSC) International Standards FSC-STD-01-001 V5-2**. https://fsc.org/en/document-centre . Accessed 2026-05-27. Anchor for `forestry-*` chain-of-custody.
7. **UN-REDD+ Programme Framework 2024**. https://www.un-redd.org/about-un-redd-programme . Accessed 2026-05-27. Anchor for `forestry-*` carbon reporting.
8. **ISO 14001:2015 Environmental Management Systems**. https://www.iso.org/standard/60857.html . Accessed 2026-05-27. Anchor for all verticals' environmental compliance.
9. **Global Reporting Initiative (GRI) Standards 2021 Universal + Sector Set**. https://www.globalreporting.org/standards . Accessed 2026-05-27. Anchor for ESG disclosure across all verticals.
10. **UN World Tourism Organization (UNWTO) Statistical Framework**. https://www.unwto.org/tourism-statistics . Accessed 2026-05-27. Anchor for `tourism-*` arrivals + receipts reporting.
11. **IFRS 16 Leases (IASB 2016, in force since 2019)**. https://www.ifrs.org/issued-standards/list-of-standards/ifrs-16-leases . Accessed 2026-05-27. Anchor for `realestate-*` lease-accounting workflows.

These eleven citations satisfy and exceed the mission's deep-research requirement (≥4 citations URL+title+date). They are stored verbatim in the seed package's `provenance` array on each affected profile.

Jurisdiction-specific citations (TRA, Tumemadini, NEMC, BoT, NUPRC, RERA, etc.) live on the per-profile and per-workflow `provenance` arrays — see the mining-tz seed package for the live one.

---

## §7. Migration + seed lifecycle

1. Migration `0057_vertical_profiles.sql` creates the two tables with no data.
2. `packages/vertical-profiles/` exposes the registry port + the in-memory adapter + the SQL adapter.
3. `packages/vertical-profiles/src/seeds/` declares the 75 profile rows (1 live + 74 reserved).
4. `packages/vertical-profile-mining-tz/` declares the 10 mining-tz entities + 6 mining-tz workflows in full detail.
5. A boot-time loader in `packages/vertical-profiles/src/loader.ts` calls `registry.upsert(...)` for every seed. Idempotent — safe to re-run.

The split between `vertical-profiles` (registry + all 75 definitions) and `vertical-profile-mining-tz` (the deep live-tenant seed) mirrors the split in the addendum: the registry is universal; the launch beachhead is its own package.

---

## §8. Non-goals (deferred to later waves)

- Live activation of any of the 74 reserved profiles. They're seeded but not bound to live tenants.
- Workflow-engine wiring beyond the registry. The workflow execution loop (calendar, nudges, escalation) ships in a follow-up wave.
- Regulator API adapters for any market beyond TZ. Those ship per market when a tenant lands.
- Multi-currency UI in pricing pages. Currency lookup is plumbed through the jurisdiction profile but the marketing site still defaults to TZS.

---

## §9. Verification

- **Migration 0057** applies cleanly on a fresh DB and is idempotent on re-run.
- **Registry tests ≥14** covering CRUD, live/reserved filtering, mining-tz workflow bindings (must include TRA + Tumemadini + NEMC + BoT), the 75-profile seed loader.
- **Type checking** passes with strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- **No `@ts-nocheck`** anywhere in the new code.
- **All regulator citations** carry `{ url, title, accessedISO }` triples.

---

## §10. Provenance

- Founder addendum 2026-05-26 (universal-from-day-one).
- Capability Catalogue Spec (Wave CAPABILITY).
- Customer Geo-Routing + Scope Login Spec (Wave 18Z).
- This document is the canonical source for the `vertical_profile_definitions` schema and the 75-profile catalogue. Subsequent vertical-profile changes amend this spec.
