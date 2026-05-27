# Boji AI — Build folder

> The engineering bridge from spec (`../BOJI_AI_SPEC.md`) to a shippable repo. Read these four files in this order:

1. [`MVP1_BUILD_PLAN.md`](./MVP1_BUILD_PLAN.md) — week-by-week tickets for the first 12 weeks; concrete acceptance criteria.
2. [`DATA_MODEL.md`](./DATA_MODEL.md) — Postgres + PostGIS + pgvector schema + RLS pattern. Use this to bootstrap Drizzle migrations.
3. [`AGENT_PROMPT_LIBRARY.md`](./AGENT_PROMPT_LIBRARY.md) — production-grade system prompts + tool surfaces + evidence requirements for all 28 named juniors. This is Boji's operational IP.
4. [`UI_SCREEN_CATALOGUE.md`](./UI_SCREEN_CATALOGUE.md) — 89 screens across 4 surfaces (Owner mobile · Owner web · Worker mobile · Boji internal); each named with primary junior, LMBM nodes touched, success metric.

## Why these four files exist

The main spec (`BOJI_AI_SPEC.md`) describes *what* Boji is and *why*. These four files describe *exactly how* engineers and designers build it.

- A frontend engineer can pick a screen from the UI catalogue and know which junior to call and which LMBM nodes to render.
- A backend engineer can take the data model, run the migrations, and the API layer types itself.
- An AI engineer can take an agent prompt, register the tools, and the junior is live in production.
- A PM can take the build plan and know exactly what ships in week N.

## Versioning

Each file is v0.1 — first draft. Updates land via PR; the spec changelog (`BOJI_AI_SPEC.md` top) tracks the cross-cutting version bumps. The minerals corpus (`../research/minerals/`) and the regulation dossier (`../research/01_TZ_MINING_REGULATION_2025_2026.md`) are append-only and re-ingested on every change.

## Definition of Done for MVP 1

See `MVP1_BUILD_PLAN.md` § Definition of Done — 12 explicit user-completable workflows + 6 hard constraints. The pilot tenant must complete all 12 before MVP 1 is declared shipped.

— end of build/README v0.1 —
