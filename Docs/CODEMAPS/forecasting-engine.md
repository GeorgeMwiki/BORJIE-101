# Forecasting Engine Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/forecasting-engine/`
**Public entry:** `packages/forecasting-engine/src/index.ts`
**Tier scope:** cognitive core (scenario + world model)

## Purpose

The orchestration layer that turns the `forecasting` toolkit into
production decisions. Adds a **scenario sandbox** (counterfactual
simulation), a **world-model** wrapper (long-horizon recurrent
prediction), a **feedback** loop (online learning from actuals),
and a **scoring** layer that grades each forecaster's track record
so the orchestrator can pick the best for a given context.

## Entry points

- `src/index.ts` — barrel.
- `src/orchestrator/` — picks + ensembles forecasters.
- `src/forecasters/` — wrapped models (adapters over `forecasting`).
- `src/scenarios/` — counterfactual scenario engine.
- `src/sandbox/` — isolated execution for user-supplied scenarios.
- `src/world-model/` — long-horizon recurrent model.
- `src/scoring/` — track-record + winner selection.
- `src/feedback/` — online updates from actuals.

## Internal structure

- One sub-folder per concern; each owns its types.
- `__tests__/` — scenario + feedback regression tests.

## Dependencies

- Upstream: `@borjie/forecasting`, `@borjie/observability`.
- Downstream: central-intelligence (decision tools),
  admin-platform-portal forecasts UI, reports.

## Common workflows

- **Run a forecast** → `orchestrator.forecast({ target, horizon, ctx })`.
- **Run a scenario** → `sandbox.run({ scenario, baseline })`.
- **Feed an actual** → `feedback.observe({ forecastId, actual })`.
- **Pick a model** → `scoring.pickWinner({ target, ctx })`.

## Anti-patterns to avoid

- Never execute user-supplied scenarios outside the sandbox.
- Never feed actuals before forecast horizon closes (lookahead leak).
- Never expose orchestrator scoring to untrusted clients (gameable).
- Never run the world-model without a memory cap.

## Related codemaps

- [forecasting.md](./forecasting.md) — primitives
- [central-intelligence.md](./central-intelligence.md) — consumer
- [observability.md](./observability.md) — bench + traces
