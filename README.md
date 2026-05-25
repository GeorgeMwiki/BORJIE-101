# Borjie

> Mining estate planning, management, and intelligence — an AI-native operating
> system for Tanzanian (and pan-African) artisanal-to-mid-tier mining.
> A hard-fork of BossNyumba's brain layer, wrapped around a mining-domain
> ground truth (sites, licences, drill-holes, ore parcels, FX/treasury,
> Tanzania regulatory rules).

[![Status](https://img.shields.io/badge/status-bootstrap-yellow)](.) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

---

## Four surfaces

```
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  apps/admin-web     │  │  apps/owner-web     │  │  apps/workforce-    │  │  apps/buyer-mobile  │
│  Borjie internal    │  │  Mining owner       │  │  mobile (Expo)      │  │  (Expo)             │
│  Next.js 15 :3020   │  │  Next.js 15 :3010   │  │  owner / manager /  │  │  Mineral buyers,    │
│                     │  │                     │  │  employee — role-   │  │  off-takers, KYC,   │
│  20 admin screens   │  │  22 cockpit screens │  │  gated, 47 screens  │  │  marketplace bids   │
└──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
           │                        │                        │                        │
           └────────────────────────┴───────────┬────────────┴────────────────────────┘
                                                │
                                  ┌─────────────▼──────────────┐
                                  │   services/api-gateway     │
                                  │   Hono :3001  · authz/RLS  │
                                  └─────────────┬──────────────┘
                                                │
                              ┌─────────────────┴─────────────────┐
                              │                                   │
                    ┌─────────▼─────────┐               ┌─────────▼─────────┐
                    │  packages/        │               │  services/        │
                    │  ai-copilot       │               │  consolidation-   │
                    │  (Master Brain +  │               │  worker (9-stage  │
                    │  28 mining        │               │  brain memory     │
                    │  juniors)         │               │  pipeline)        │
                    └─────────┬─────────┘               └─────────┬─────────┘
                              │                                   │
                              └───────────────┬───────────────────┘
                                              │
                       ┌──────────────────────▼──────────────────────┐
                       │  Postgres 15 + PostGIS + pgvector +         │
                       │  TimescaleDB + Apache AGE (graph)           │
                       │  Bi-temporal Living Mining Business Map     │
                       └─────────────────────────────────────────────┘
```

## The eight Master Brain CEO modes

Per `Docs/build/AGENT_PROMPT_LIBRARY.md` — every Borjie owner interaction routes
through the Master Brain operating in one of eight modes:

| Mode | What it does |
|---|---|
| **Build** | Bootstrap a new mining business — company registration, licence apps, site setup |
| **Strategy** | Portfolio decisions, JV/off-take simulations, expansion modelling |
| **Operations** | Shift reports, production tracking, site issues, weighbridge reconciliation |
| **Document** | Chat-with-PDF, document generation, citation lookup with full provenance |
| **Finance** | Cash runway, P&L, unit economics, FX/treasury, 27-Mar-2026 USD-cliff remediation |
| **Risk** | Safety incidents, regulatory exposure, geological uncertainty |
| **Board-Investor** | Investor decks, board pack generation, KPI roll-ups, audit-pack export |
| **Compliance** | Regulatory checklists, audit pack assembly, TRA/NEMC/Tumemadini exposure |

## Quick start (dev)

```bash
# 1. Copy env and seed secrets
cp .env.example .env.local
# .env.local already has dev defaults; for prod, generate fresh secrets

# 2. Install deps
pnpm install

# 3. Spin up Postgres + Redis via docker-compose
docker compose -f docker-compose.yml up -d

# 4. Run migrations + seed test users
pnpm migrate
pnpm tsx packages/database/src/seeds/borjie-test-users.seed.ts

# 5. Ingest the mining corpus (one-time)
pnpm tsx services/consolidation-worker/src/tasks/borjie-corpus-ingest.ts

# 6. Start everything
pnpm dev
```

### Test users (dev only)

| Role | Email | Password env var |
|---|---|---|
| Borjie admin | admin@borjie.dev | `SEED_TEST_BORJIE_ADMIN_PASSWORD` |
| Mining owner | owner@borjie.dev | `SEED_TEST_OWNER_PASSWORD` |
| Site manager | manager@borjie.dev | `SEED_TEST_MANAGER_PASSWORD` |
| Employee/driver | employee@borjie.dev | `SEED_TEST_EMPLOYEE_PASSWORD` |
| Buyer (off-taker) | buyer@borjie.dev | `SEED_TEST_BUYER_PASSWORD` |

All test passwords live in `.env.local` (gitignored). The seed script refuses
to run when `NODE_ENV=production`.

## Documentation

- **Build plan** — `Docs/build/BOJI_BUILD_PLAN.md` (Phase 0 → Phase 5, 13 weeks to pilot)
- **MVP1 week-by-week** — `Docs/build/MVP1_BUILD_PLAN.md`
- **Data model** — `Docs/build/DATA_MODEL.md` (all mining tables + bi-temporal graph)
- **Screen catalogue** — `Docs/build/UI_SCREEN_CATALOGUE.md` (89 screens across 4 surfaces)
- **Agent prompt library** — `Docs/build/AGENT_PROMPT_LIBRARY.md` (28 juniors)
- **AI spec (full)** — `Docs/BOJI_AI_SPEC.md` (165 KB master spec)

The intelligence corpus (`Docs/primary_sources/`, `Docs/research/`,
`Docs/research/minerals/`) is ingested into `intelligence_corpus_chunks` at
first boot with `tenant_id = NULL` so every tenant inherits the same Tanzanian
mining ground truth.

## Stack

- **Web** — Next.js 15 (App Router), Tailwind, `@borjie/design-system`
- **Mobile** — Expo SDK 51, expo-router, offline-first
- **Backend** — Hono (api-gateway), TypeScript 6, Node 20, pnpm 8 + Turbo
- **Data** — Postgres 15 + PostGIS + pgvector + TimescaleDB + Apache AGE
- **Schema** — Drizzle (Prisma fossils deleted — see `Docs/build/BOJI_BUILD_PLAN.md` §D3)
- **AI** — Anthropic Claude (Opus for Master, Sonnet for advisors, Haiku for juniors)
- **Voice** — Whisper v3 STT, ElevenLabs TTS (Swahili-first)
- **Bio** — Innovatrics / Suprema fingerprint SDKs (mocked in dev)

## License

MIT — see [LICENSE](./LICENSE).
