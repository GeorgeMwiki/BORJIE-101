# Consolidation Worker Codemap

**Last Updated:** 2026-05-22
**Module:** `services/consolidation-worker/`
**Public entry:** `services/consolidation-worker/src/index.ts`
**Tier scope:** cognitive core (4-pass sleep consolidation)

## Purpose

The "sleep consolidation" worker — runs offline four-pass memory
consolidation against recorded conversations and decision traces.
Inspired by Reflexion: extract lessons, compile skills, prune
redundant memories, and refresh embeddings. Mirror of LITFIN's
F11 pattern.

## Entry points

- `src/index.ts` — composition root + cron scheduler.
- `src/orchestrator.ts` — pass orchestrator.
- `src/consolidation.ts` — main consolidation entry.
- `src/stages/` — per-pass stage handlers.
- `src/prompt-compile/` — prompt compilation step.
- `src/observability/` — pass-level metrics.
- `src/consolidation.test.ts` — pass tests.

## Internal structure

- `stages/` — four passes: extract → reflect → distill → embed.
- `prompt-compile/` — generates compiled prompts from skill graph.
- `orchestrator.ts` — sequences passes with checkpoints.

## Dependencies

- Upstream: `@borjie/central-intelligence`,
  `@borjie/observability`, `@borjie/database`.
- Downstream: kernel memory layer (writes consolidated artifacts).

## Common workflows

- **Run a consolidation cycle** →
  `consolidation.run({ tenantId, since, until })`.
- **Resume from checkpoint** → orchestrator picks up from
  last completed stage.
- **Schedule** → cron via composition root.

## Anti-patterns to avoid

- Never run consolidation against a tenant without isolation.
- Never run two concurrent consolidations per tenant (race).
- Never overwrite consolidated artifacts without versioning.
- Never bypass observability — every pass emits metrics.

## Related codemaps

- [central-intelligence.md](./central-intelligence.md) — primary consumer
- [observability.md](./observability.md) — pass metrics
- [database.md](./database.md) — memory tables
