# Borjie

> **Borjie is an AI-native mining estate operating system. Mr. Mwikila
> is its brain layer.**
>
> Purpose-built for Tanzanian (and pan-African) artisanal-to-mid-tier
> mining — licences, royalty, workforce, treasury, compliance, marketplace,
> holdings, subsidiaries, ancillary businesses, family office, succession,
> and the full asset register.

[![CI](https://github.com/GeorgeMwiki/BORJIE-101/actions/workflows/borjie-ci.yml/badge.svg?branch=main)](https://github.com/GeorgeMwiki/BORJIE-101/actions/workflows/borjie-ci.yml)
[![License: MIT](https://img.shields.io/github/license/GeorgeMwiki/BORJIE-101)](./LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/GeorgeMwiki/BORJIE-101)](https://github.com/GeorgeMwiki/BORJIE-101/commits/main)
[![Release](https://img.shields.io/github/v/release/GeorgeMwiki/BORJIE-101?include_prereleases&sort=semver)](https://github.com/GeorgeMwiki/BORJIE-101/releases)
[![Open issues](https://img.shields.io/github/issues/GeorgeMwiki/BORJIE-101)](https://github.com/GeorgeMwiki/BORJIE-101/issues)
[![Stars](https://img.shields.io/github/stars/GeorgeMwiki/BORJIE-101?style=flat)](https://github.com/GeorgeMwiki/BORJIE-101/stargazers)

---

## What is Borjie

Borjie is an AI-native mining estate operating system. Mr. Mwikila is its
brain layer.

Tanzanian artisanal-to-mid-tier mining runs on paper, WhatsApp screenshots, and
the owner's memory. Shift logs sit in notebooks, licences expire silently,
weighbridge tickets get reconciled weeks late, and treasury sits long in USD
or TZS without anyone modelling the FX exposure. Regulators (Tumemadini, TRA,
NEMC) ask for the same evidence packs over and over, and each export is a
two-week scramble through filing cabinets.

Borjie is the AI-native operating system that replaces that chaos. A
Master-Brain orchestrator routes every owner question through eight CEO modes
(Build · Strategy · Operations · Document · Finance · Risk · Board-Investor ·
Compliance) and delegates to 28 mining-domain juniors — geology, mine
planning, fleet, fuel, KYC, FX/treasury, regulator drafting. Every answer is
backed by a citation from your own corpus (licences, drill-hole logs, shift
reports, assay results) or refuses to answer. Multi-tenant from row one, with
row-level security baked into Postgres.

Borjie is the AI-native mining operations OS for Tanzania — 48 mining
tables, 63 mining API endpoints, 28 mining-domain juniors, and the
Living Mining Business Map (LMBM) graph. The product evolves
independently against its own roadmap; see `PROJECT_BOUNDARY.md` for
the brand boundary and `Docs/BRAND/SEPARATION_AUDIT_2026_05_27.md` for
the post-fork separation audit.[^lineage]

[^lineage]: Historical footnote — the brain-layer scaffolding (Master-Brain orchestrator, juniors substrate, evidence-required answer pipeline, bi-temporal memory) originated as a hard-fork from a sibling property-management codebase. That scaffolding has since been re-grounded around mining domain primitives and the two products evolve independently. There is no ongoing parity goal; see `Docs/BRAND/SEPARATION_AUDIT_2026_05_27.md`.

## Four surfaces

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ apps/admin-web      │  │ apps/owner-web      │  │ apps/workforce-     │  │ apps/buyer-mobile   │
│ :3020   Next.js 15  │  │ :3010   Next.js 15  │  │ mobile   Expo SDK   │  │           Expo SDK  │
│                     │  │                     │  │                     │  │                     │
│ Borjie internal —   │  │ Mining owner —      │  │ Field workforce —   │  │ Mineral buyers &    │
│ tenant ops, prompt  │  │ Master-Brain chat,  │  │ owner / manager /   │  │ off-takers — KYC,   │
│ promotion, kill-    │  │ cockpit, licence    │  │ employee, role-     │  │ marketplace bids,   │
│ switch, audit log   │  │ health, FX cliff    │  │ gated, offline-OK   │  │ contract sign       │
│ (20 screens)        │  │ (22 screens)        │  │ (47 screens)        │  │                     │
└──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
           │                        │                        │                        │
           └────────────────────────┴───────────┬────────────┴────────────────────────┘
                                                │
                                  ┌─────────────▼──────────────┐
                                  │  services/api-gateway      │
                                  │  Hono :3001 · authz · RLS  │
                                  └─────────────┬──────────────┘
                                                │
                              ┌─────────────────┴─────────────────┐
                              │                                   │
                    ┌─────────▼─────────┐               ┌─────────▼─────────┐
                    │ packages/         │               │ services/         │
                    │ ai-copilot        │               │ consolidation-    │
                    │ Master-Brain +    │               │ worker — 9-stage  │
                    │ 28 mining juniors │               │ memory pipeline   │
                    └─────────┬─────────┘               └─────────┬─────────┘
                              │                                   │
                              └───────────────┬───────────────────┘
                                              │
                       ┌──────────────────────▼──────────────────────┐
                       │ Postgres 15 + PostGIS + pgvector +          │
                       │ TimescaleDB + Apache AGE (graph)            │
                       │ Bi-temporal Living Mining Business Map      │
                       └─────────────────────────────────────────────┘
```

## Demo in 5 commands

```bash
git clone https://github.com/GeorgeMwiki/BORJIE-101.git borjie && cd borjie
cp .env.example .env.local              # dev defaults are pre-seeded
pnpm install && docker compose up -d    # Postgres + Redis + extensions
pnpm migrate && pnpm tsx packages/database/src/seeds/borjie-test-users.seed.ts
pnpm dev                                # owner :3010 · admin :3020 · gateway :3001
```

Open `http://localhost:3010` and sign in as one of the seeded users. All test
passwords live in `.env.local` (gitignored); the seed script refuses to run
when `NODE_ENV=production`.

| Role | Email | Password env var |
|---|---|---|
| Borjie admin | `admin@borjie.dev` | `SEED_TEST_BORJIE_ADMIN_PASSWORD` |
| Mining owner | `owner@borjie.dev` | `SEED_TEST_OWNER_PASSWORD` |
| Site manager | `manager@borjie.dev` | `SEED_TEST_MANAGER_PASSWORD` |
| Employee / driver | `employee@borjie.dev` | `SEED_TEST_EMPLOYEE_PASSWORD` |
| Buyer / off-taker | `buyer@borjie.dev` | `SEED_TEST_BUYER_PASSWORD` |

## The Master-Brain — 8 CEO modes

Every owner interaction routes through the Master-Brain operating in one of
eight modes. The orchestrator picks the mode, fans out to the relevant juniors,
gathers their cited answers, and returns a single streamed response.

| Mode | What it does |
|---|---|
| **Build** | Bootstrap a new mining business — company registration, licence apps, site setup |
| **Strategy** | Portfolio decisions, JV / off-take simulations, expansion modelling |
| **Operations** | Shift reports, production tracking, site issues, weighbridge reconciliation |
| **Document** | Chat-with-PDF, document generation, citation lookup with full provenance |
| **Finance** | Cash runway, P&L, unit economics, FX / treasury, 27-Mar-2026 USD-cliff remediation |
| **Risk** | Safety incidents, regulatory exposure, geological uncertainty |
| **Board-Investor** | Investor decks, board-pack generation, KPI roll-ups, audit-pack export |
| **Compliance** | Regulatory checklists, audit-pack assembly, TRA / NEMC / Tumemadini exposure |

## Architecture at a glance

**Brain**
- `packages/ai-copilot` — Master-Brain orchestrator + 28 mining juniors
- `packages/agent-orchestrator` — fan-out, citation gather, refuse-when-no-evidence guard
- `services/consolidation-worker` — 9-stage memory pipeline (raw → summarised → indexed)

**Backend**
- `services/api-gateway` — Hono on port `:3001`, authz + tenant-RLS + audit-hash-chain
- `services/identity` — auth, NIDA verification, biometric template hashing
- `services/document-intelligence` — OCR, PDF parsing, citation extraction
- `services/payments-ledger` — TZS / USD double-entry, GePG reconciliation

**Data**
- `packages/database` — Drizzle schemas, migrations, RLS policies (48 tables)
- Postgres 15 + PostGIS (geometry) + pgvector (embeddings) + TimescaleDB (time-series) + Apache AGE (graph)
- Bi-temporal Living Mining Business Map (LMBM) — every fact carries `valid_time` + `transaction_time`

**Frontend**
- `apps/owner-web` (`:3010`) + `apps/admin-web` (`:3020`) — Next.js 15 App Router, Tailwind, `@borjie/design-system`
- `apps/workforce-mobile` + `apps/buyer-mobile` — Expo SDK 51, expo-router, offline-first
- `packages/design-system` — shared tokens, components, Swahili-first copy

**Ops**
- Turbo + pnpm 8 workspaces, TypeScript 6, Node 20
- GitHub Actions: `borjie-ci.yml`, OpenAPI drift, migration safety, semgrep, trivy, SBOM
- Helm charts under `k8s/`, Docker Compose for local dev

## Mining domain coverage

**6 plan tiers** — Postgres enum `borjie_plan`, plus the Borjie internal tier
served by `admin-web`.

| Tier | Audience |
|---|---|
| `mwanzo` | Pre-licence aspiring miner — "I want to start a mining business" |
| `mkulima` | Single-licence owner-operator |
| `mfanyabiashara` | Multi-site trader / dealer |
| `kampuni` | Registered mining company |
| `group` | Group / holding with subsidiaries |
| Borjie internal | Staff tenant for ops, audit, prompt promotion |

**9 mining roles** — Postgres enum `borjie_user_role`.

| Role | Surface |
|---|---|
| `owner` | owner-web |
| `admin` | owner-web (delegated) |
| `site_manager` | owner-web + workforce-mobile |
| `supervisor` | workforce-mobile |
| `driver` | workforce-mobile |
| `geologist` | workforce-mobile |
| `stores` | workforce-mobile |
| `qc_officer` | workforce-mobile |
| `buyer` | buyer-mobile |
| `borjie_team` | admin-web |

**48 database tables** — grouped by domain.

| Domain | Tables |
|---|---|
| Identity / tenancy | `tenants`, `organizations`, `users` |
| Company registry | `companies`, `directors`, `shareholders`, `bank_accounts` |
| Licences | `authorities`, `licences`, `licence_events` |
| Sites & geology | `sites`, `site_sections`, `drill_holes`, `drill_hole_layers`, `samples`, `vein_models`, `ore_grade_snapshots`, `ore_stockpiles` |
| Workforce | `employees`, `attendance`, `advances`, `fingerprint_events` |
| Fleet & maintenance | `assets`, `maintenance_events`, `fuel_logs` |
| Production | `shift_reports`, `production_records`, `ore_parcels` |
| Marketplace | `buyers`, `sales`, `marketplace_listings`, `marketplace_bids`, `bid_negotiations`, `ratings`, `buyer_risk_reports` |
| Finance | `cash_balances`, `fx_rates`, `mineral_prices`, `costs`, `forecasts` |
| HSE & community | `incidents`, `ppe_issues`, `csr_plans`, `grievances`, `village_meetings` |
| Intelligence | `intelligence_corpus_chunks`, `tasks`, `risks` |

Source: `packages/database/drizzle/0000_*.sql`, `0003_*.sql`, `0004_*.sql`, `0005_*.sql`.

**28 juniors** — grouped by responsibility. Implementations in
`packages/ai-copilot/src/juniors/`.

| Responsibility | Juniors |
|---|---|
| Orchestration | `master-brain`, `notifications-router` |
| Geology & planning | `geology-agent`, `drill-hole-logger`, `lab-assay-agent`, `metallurgy-agent`, `mine-planner` |
| Operations | `operations-sic-agent`, `asset-fleet-agent`, `maintenance-agent`, `safety-agent` |
| Finance & FX | `fx-treasury-agent`, `cost-engineer`, `forecast-modeler`, `contract-currency-auditor` |
| Marketplace & sales | `sales-offtake-agent`, `marketplace-stakeholder-agent`, `buyer-kyc-agent` |
| Compliance & legal | `licence-agent`, `compliance-agent`, `auditor-agent` |
| Workforce & community | `hr-agent`, `community-agent`, `village-csr-agent`, `procurement-agent` |
| Documents & reporting | `document-agent`, `report-writer`, `risk-modeler` |

## API

- **OpenAPI spec** — [`Docs/openapi/borjie-mining.yaml`](./Docs/openapi/borjie-mining.yaml) (49 paths, 34 schemas, generated from route source)
- **Swagger UI (local)** — `http://localhost:3001/api/v1/mining/docs` once the gateway is running
- **Coverage** — 63 endpoints mounted under `/api/v1/mining/*` (cockpit, licences, sites, drill-holes, samples, shift-reports, ore-parcels, sales, marketplace, fuel-logs, maintenance, incidents, grievances, KYC, LMBM graph, internal admin)

OpenAPI drift is enforced in CI via `.github/workflows/openapi-drift.yml` — the
spec must regenerate cleanly from the Hono route source on every PR.

## Status

| What works | What's stubbed | What's next |
|---|---|---|
| Chat SSE with citations (Master-Brain → juniors → owner-web) | LLM calls (mock provider in dev — wire Anthropic in prod) | [GitHub Issues](https://github.com/GeorgeMwiki/BORJIE-101/issues) — 17 open |
| Postgres live with PostGIS + pgvector + TimescaleDB + AGE | Embedding provider (returns deterministic dev vectors) | Pilot acceptance test ([#27](https://github.com/GeorgeMwiki/BORJIE-101/issues/27)) |
| All 4 apps build green (`pnpm build` clean) | Mapbox tiles (placeholder map in dev) | OCR pipeline swap to `@borjie/document-analysis` ([#23](https://github.com/GeorgeMwiki/BORJIE-101/issues/23)) |
| 63 mining API endpoints mounted + tenant-scoped | Innovatrics / Suprema biometric SDKs (mocked) | RBAC for two-operator killswitch ([#25](https://github.com/GeorgeMwiki/BORJIE-101/issues/25)) |
| Drizzle migrations, RLS, seed users | TRA / NEMC / Tumemadini gov-API connectors | Prune 45 legacy pre-fork workflows ([#26](https://github.com/GeorgeMwiki/BORJIE-101/issues/26)) |
| 17 prioritised backlog issues filed | Voice (Whisper STT / ElevenLabs TTS scaffold only) | Releases — [v0.1.0](https://github.com/GeorgeMwiki/BORJIE-101/releases/tag/v0.1.0) |

## Tanzania-first design choices

- **Swahili as the default UI language**, English as a switch — copy lives in `packages/design-system/src/i18n/`
- **TZS-primary currency** everywhere, USD as a secondary view; treasury runs a 27-Mar-2026 USD-cliff remediation mode by default
- **PostGIS** for licence polygons, site boundaries, and the LMBM spatial graph — not WKT-in-text
- **Mining-specific juniors**, designed for the domain — geology, mine planning, fuel, weighbridge, KYC, off-take
- **Offline-first mobile** for field workers — `workforce-mobile` queues shift reports, fingerprint events, and fuel logs locally and reconciles when a tower appears
- **Regulator pack export** native — Tumemadini / TRA / NEMC schedules drop straight from the audit-hash chain into `services/reports`

## Contributing

Setup, branching model, commit conventions, and PR checklist are in
[CONTRIBUTING.md](./CONTRIBUTING.md). Bug reports and feature requests go to
[GitHub Issues](https://github.com/GeorgeMwiki/BORJIE-101/issues). Security
disclosures: see `Docs/SECURITY.md`.

## License

MIT — see [LICENSE](./LICENSE).
