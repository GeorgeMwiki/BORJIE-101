# Boji Build Plan — From Zero to Pilot in 13 Weeks

**Date:** 2026-05-25
**Author:** Synthesis from BOJI_AI_SPEC.md + BOSSNYUMBA101_LIVE_MAP.md + BOJI_CORPUS_SYNTHESIS.md
**Status:** Draft v1 — awaiting founder sign-off

---

## TL;DR

Boji = BossNyumba's proven brain (13-step kernel + Junior Factory + Consolidation Worker + memory + agent platform) **wrapped around a mining domain layer** (sites, licences, drill-holes, ore parcels, FX/treasury, regulatory rules for Tanzania). The cheapest path is **hard-fork BOSSNYUMBA101, trim aggressively to a generic AI-OS skeleton, then build the mining layer on top.** Schema goes Drizzle-only (skip the Prisma fossils mid-migration in BossNyumba). 13 weeks to pilot: **1 week trim-and-bootstrap + 12-week MVP1 build per the existing week-by-week plan.**

---

## 0. Reality checks layered onto the spec

Three things the spec was written before that need a quick rewrite at the top:

1. **27-Mar-2026 USD cliff has passed by 8 weeks.** The spec frames Contract-Currency Auditor as a *prevention* feature. It is now a *remediation* feature: sweep tenant contracts, flag any still denominated in USD, draft backdated conversion addenda, raise penalty-exposure estimates. Same code, different prompt. The forcing function is now "get tenants compliant before BoT/TRA discover them," not "convert before the cliff."

2. **BossNyumba is mid Prisma→Drizzle migration.** `packages/database/` has both `prisma/schema.prisma` (legacy property entities) and `drizzle/` (newer, including the bi-temporal entity graph schemas Boji needs). Clone the Drizzle side, ignore Prisma fossils, do not migrate them.

3. **130+ packages is a lot of compile time.** Don't clone everything and "use what you need." Trim in Phase 1 *before* the first feature commit, or Turbo cache misses will hurt for the whole build.

---

## 1. Cloning strategy — recommendation

Three options considered:

| Option | Speed | Risk | Notes |
|---|---|---|---|
| A. Hard fork (git clone BOSSNYUMBA101, modify in place) | Fastest | High | Drags in property history + 130 packages of unknowns |
| B. Greenfield (empty repo, cherry-pick generic packages) | Slowest | Low | Loses 2 years of BossNyumba evolution & wiring |
| **C. Hard-fork + trim (recommended)** | **Fast** | **Low** | Snapshot BossNyumba code without git history, trim domain layer in Phase 1, then build |

**Recommend C.** Snapshot (not git-clone), so no property commits leak into Boji's history. After trim, Phase 1 ends with `pnpm build` and `pnpm test` green on a generic AI-OS skeleton with the kernel, agent platform, memory, knowledge graph, consolidation worker, and api-gateway intact.

---

## 2. Repo & environment

**Recommended repo location:** `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/Boji/` (consistent with BossNyumba neighbours).

The current `Claude Projects/Boji project/` folder stays as the **docs/intelligence corpus root** (it already holds 165KB of spec + 9 minerals files + 6 research dossiers). The Boji repo's first-boot ingestion job reads from there via a symlink or build-time copy — keeping docs versioned independently of code.

```
~/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/
├── Cursor Projects/
│   ├── BOSSNYUMBA101/          ← reference (read-only)
│   └── Boji/                    ← new code repo
└── Claude Projects/
    └── Boji project/            ← stays as docs corpus
        └── Docs/                ← ingested into Boji at first-boot
```

Stack inherited from BossNyumba: pnpm 8 + Turbo, TS 6.0, Node 20, Next.js 15, Hono api-gateway, Drizzle, Postgres 15 + pgvector + PostGIS + TimescaleDB, Redis 7, MinIO, Vitest + Playwright. Mobile: Expo RN (net-new — BossNyumba mobile is unfinished, build fresh).

---

## 3. Phase plan

### Phase 0 — Repo bootstrap (Week 0, 3 days)

| # | Task | Acceptance |
|---|---|---|
| 0.1 | Snapshot BOSSNYUMBA101 → new `Boji/` dir (`rsync -a --exclude=.git --exclude=node_modules`). `git init` from clean snapshot. | New repo at recommended path, no BossNyumba git history |
| 0.2 | Find-replace branding: `bossnyumba` → `boji`, `BossNyumba` → `Boji`, package.json `name:` fields, root README, env var prefixes (`BOSSNYUMBA_*` → `BOJI_*`) | `rg -i bossnyumba` returns zero hits outside intentional reference comments |
| 0.3 | `pnpm install`, `pnpm build`, `pnpm test` on the untrimmed snapshot to establish the green baseline | All three pass |
| 0.4 | Replace `.env.example` with mining-relevant vars (drop LPMS connector, add `BOT_GOLD_WINDOW_API_BASE`, `NEMC_PORTAL_BASE` placeholders) | New tenant can be created via env-only config |

### Phase 1 — Trim to AI-OS skeleton (Week 0, 5 days)

**Delete (property-domain coupled):**

| Path | Reason |
|---|---|
| `apps/customer-app/` | No customer surface in Boji (founder directive) |
| `apps/tenant-portal/` | No tenant surface |
| `apps/estate-manager-app/` | Replaced by net-new `apps/worker-mobile/` later |
| `apps/owner-portal/` | Replaced by `apps/owner-web/` (build fresh, Next.js 15 + new IA) |
| `apps/marketing/` | Out of scope MVP1 |
| `apps/bossnyumba_app/` | Mobile shell — Boji rebuilds in Expo |
| `packages/lifecycle-advisor/` | Tenant lifecycle — N/A |
| `packages/market-intelligence/` | Real-estate signals — replace with `mining-commodity-intelligence` in Phase 4 |
| `packages/acquisition-advisor/` | Property acquisition — N/A |
| `packages/expansion-advisor/` | Replace later as `capacity-expansion-advisor` |
| `packages/estate-auto-management/`, `packages/estate-department-advisor/` | Property estate — N/A |
| `packages/lpms-connector/` | Legacy PMS sync — N/A |
| `packages/green-angle-advisor/`, `packages/carbon-market/` | Re-evaluate post-MVP2 |
| `packages/database/prisma/` | Skip Prisma migration debt; Boji is Drizzle-only |

**Keep verbatim (generic AI-OS):**

`central-intelligence`, `agent-platform`, `agent-runtime`, `agent-orchestrator`, `ai-copilot` (incl. junior-ai-factory, voice, ambient-brain), `memory-v2`, `knowledge-graph`, `autonomy-governance`, `observability`, `security-audit`, `security-hardening`, `compliance-pack` (regulatory rule engine — adapt content, keep engine), `document-ai`, `document-analysis`, `document-quality-guarantor`, `anti-corruption-layer`, `aop-compiler`, `design-system`, `domain-models` (strip property types, keep generics), `mcp-server`, `mcp`, `realtime-adapter`, `realtime-rooms`, `prompt-evolution`, `skill-library`, `skill-promotion`, `learning-loop`, `reflexion`, `brain-llm-router`, `brain-self-awareness`, `extended-reasoning`, `reasoning-substrate`, `forecasting-engine`, `forecasting`, `audio-capture`, `storage-adapter`, `connectors`.

Services kept: `services/api-gateway`, `services/consolidation-worker`, `services/payments-ledger`.

**Acceptance for Phase 1:** `pnpm build` + `pnpm test` still pass on the trimmed monorepo. CI runs in <50% of the untrimmed time.

### Phase 2 — Mining schema (Week 1, 5 days)

Build `packages/database/drizzle/` to match `Docs/build/DATA_MODEL.md`:

1. **Drop residual property tables** from any Drizzle schemas (Property, Unit, Lease, Customer, Occupancy, Invoice, Arrears, Vendor).
2. **Add Postgres extensions** at migration 0001: `postgis`, `pgvector` (already present), `timescaledb`, optionally `age` (Apache AGE for graph; defer Neo4j Aura to MVP4+).
3. **Generate mining tables** in dependency order:
   - Multi-tenant: `tenants`, `users` (RLS policies)
   - Company layer: `companies`, `directors`, `shareholders`, `bank_accounts`, `authorities`
   - Licence layer: `licences`, `licence_events`
   - Site layer: `sites` (PostGIS polygon), `site_sections`
   - Geology: `drill_holes`, `drill_hole_layers`, `samples`, `vein_models`
   - People & assets: `employees`, `attendance`, `advances`, `assets`, `maintenance_events`, `fuel_logs`
   - Production & sales: `shift_reports`, `production_records`, `ore_parcels`, `sales`, `buyers`
   - Treasury & costs: `cash_balances` (Timescale hypertable), `fx_rates`, `mineral_prices`, `costs`, `forecasts`
   - Documents & audit: `documents`, `fingerprint_events`, `audit_log`, `decision_log`
   - Tasks & risks: `tasks`, `risks`
   - Marketplaces & KYC: `marketplace_listings`, `ratings`
   - Bi-temporal graph (clone from BossNyumba): `temporal_entities`, `temporal_relationships`, `temporal_communities`
   - Intelligence corpus: `intelligence_corpus_chunks` (with `tenant_id NULLABLE` for global bootstrap rows)
4. **RLS policies on every tenant-scoped table.** Pattern lifted from BossNyumba.

**Acceptance:** `drizzle-kit migrate` runs clean from empty DB → final schema. Seed script creates one demo tenant with PostGIS coords on a Tanzanian district.

### Phase 3 — Boot the brain on mining domain (Week 2, 5 days)

1. **Wire kernel composition root** (`services/api-gateway/src/composition/brain-kernel-wiring.ts`) for Boji. Inject the mining-domain corpus path; provide `BOT_GOLD_WINDOW`, `NEMC`, `GePG` tool stubs (return mock data — real API integration is MVP3+).
2. **Update Master Brain persona.** Mining CEO modes per spec §8.1: Build / Strategy / Operations / Document / Finance / Risk / Board-Investor / Compliance. Persona file replaces BossNyumba estate-manager persona.
3. **First-boot corpus ingestion job.** New service or `consolidation-worker` task: reads `Docs/primary_sources/`, `Docs/research/`, `Docs/research/minerals/`, chunks each markdown by H2, embeds via OpenAI text-embedding-3-large (or whatever BossNyumba uses), upserts into `intelligence_corpus_chunks` with `tenant_id = NULL` and full provenance tags (source_file, source_url where present, section_heading, ingested_at).
4. **Proof-of-life Junior: Document Agent v1.** Wire the smallest end-to-end mining junior. Input: PDF of a Tanzanian PML. Output: structured `{licence_no, holder, mineral, coords, granted_at, expires_at}` + 1 row into `licences` + 1 row into `temporal_entities`.
5. **Acceptance:** `curl POST /v1/chat` with `"What is a PML and what obligations does it carry?"` returns an answer that cites at least one chunk from `research/01_TZ_MINING_REGULATION_2025_2026.md`, with `evidence_ids` populated. Auditor Agent rejects any response with empty evidence.

### Phase 4 — MVP1 weeks 1-12 (12 weeks)

Follow `Docs/build/MVP1_BUILD_PLAN.md` exactly. The critical path is already laid out in BOJI_CORPUS_SYNTHESIS.md §H. One adjustment to the 12-week plan from this reality-check pass:

- **Week 9 reframe.** Contract-Currency Auditor ships as a **remediation** workflow (cliff has passed): scan existing tenant contracts → flag USD-denominated ones → draft backdated conversion addendum → estimate TRA exposure → owner approves → fingerprint sign → fileable PDF. Same code surface, different copy and prompt.

The rest of weeks 1-12 stand as written.

### Phase 5 — Pilot (Week 13)

Acceptance criterion from MVP1_BUILD_PLAN.md, unchanged:

> A real Tanzanian mining owner uses Boji daily for 5 days, submits 5 documents, 5 shift reports, 1 EPP, 1 village-meeting record, sees daily brief every morning, signs ≥3 documents biometrically.

---

## 4. Decisions made in this plan (push back if any are wrong)

| # | Decision | Why | Easy to reverse? |
|---|---|---|---|
| D1 | Repo lives at `/Cursor Projects/Boji/`; docs stay at `/Claude Projects/Boji project/Docs/` | Consistency with BossNyumba neighbour; docs independently versionable | Yes |
| D2 | Hard-fork-then-trim, no git history from BossNyumba | Cleaner audit trail; no property commits in Boji blame | Hard once committed |
| D3 | Drizzle-only schema; skip Prisma legacy folder | BossNyumba is mid-migration; cloning both = inheriting migration debt | Medium |
| D4 | Apache AGE in MVP1; Neo4j Aura at MVP4+ | Simpler infra (Postgres-only); spec already allows this | Easy (Neo4j slots in via existing graph package) |
| D5 | Contract-Currency Auditor pivots prevention → remediation | Cliff was 8 weeks ago | N/A — date-driven |
| D6 | Delete `apps/marketing/` in Phase 1 | Out of scope MVP1; can add post-pilot | Easy |
| D7 | Mobile (worker + owner) built fresh in Expo, not cloned from `bossnyumba_app` | BossNyumba mobile is unfinished per LIVE_MAP §1; cleaner to start fresh | Medium |

---

## 5. Open questions still to answer

These are the spec's pre-existing TBDs (BOJI_CORPUS_SYNTHESIS §I) plus three new ones surfaced by this reality-check pass. None block Phase 0-3; all need answers by Week 6 of MVP1 at latest.

**Pre-existing (from spec):**
1. Government API integration timeline (tumemadini.go.tz, NEMC, GePG) — likely MVP3
2. Drone imagery ingestion pipeline (Sentinel-2 / Planet / DJI) — MVP6
3. Geological triangulation algorithm (multi-shaft vein) — needs QP geologist in loop
4. Metallurgy Agent operational scope — MVP3-4
5. Marketplace depth vs External-Stakeholder Window relationship
6. Multi-company / group portfolio data model
7. Off-take / streaming / JV simulator algorithm
8. Forecast model versioning + CI/CD
9. Regulatory change ingest pipeline (gazette → rules)
10. Marketplace moderation & dispute resolution
11. Swahili STT latency target (Whisper v3 confirmed?)
12. Fingerprint enrolment cadence for officials

**New (this plan):**
13. Does the founder want a thin Boji landing page (marketing surface) by pilot, or strictly internal to start?
14. CI/CD target — keep BossNyumba's full workflow set (12 workflows) or trim to a Boji minimum (ci + cd-staging + cd-production + db-migrations-check + codeql) until team grows?
15. LLM budget — what monthly Anthropic spend cap should `llm-budget-governor` enforce per tenant during pilot?

---

## 6. What's NOT in this plan

- **No detailed prompt engineering** — AGENT_PROMPT_LIBRARY.md already covers all 28 juniors; treat as authoritative.
- **No screen-by-screen UI specs** — UI_SCREEN_CATALOGUE.md owns the 89 screens; we follow it.
- **No infra deployment plan beyond local dev** — staging + production deployment is a separate Phase 6 spec, post-pilot.
- **No team / hiring / cost plan** — out of scope; this is engineering plan only.

---

## 7. Immediate next actions (if this plan is approved)

1. Confirm decisions D1-D7 (or push back).
2. Phase 0 day 1: snapshot BOSSNYUMBA101 into `/Cursor Projects/Boji/`, init clean git.
3. Phase 0 day 2-3: branding find-replace, `.env.example` mining rewrite, baseline `pnpm build` green.
4. Phase 1 day 1: delete the property-coupled apps/packages listed in §3 Phase 1. Re-baseline build.
5. Phase 1 day 2-5: confirm all retained packages still build and test green; commit "skeleton baseline" as the trunk starting point.
