# Graph Privacy Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/graph-privacy/`
**Public entry:** `packages/graph-privacy/src/index.ts`
**Tier scope:** platform spine (differential privacy on graph reads)

## Purpose

Differential-privacy guard for queries that aggregate across the
knowledge graph. Wraps aggregator outputs with calibrated Laplace
or Gaussian noise (`noise.ts`), enforces a per-tenant privacy
budget (`budget-ledger.ts`), and blocks queries that would
exhaust the budget. Used whenever Brain produces cross-customer
statistics (benchmarks, market analytics).

## Entry points

- `src/index.ts` — barrel.
- `src/aggregators/` — DP-aware aggregator wrappers.
- `src/budget-ledger.ts` — `BudgetLedger` (per-tenant ε tracker).
- `src/noise.ts` — Laplace + Gaussian samplers with sensitivity scaling.
- `src/types.ts` — `Epsilon`, `Delta`, `AggregatorSpec`.

## Internal structure

- `aggregators/` — count, sum, mean, histogram each with sensitivity.
- `budget-ledger.ts` — atomic decrement + reject when exhausted.
- `noise.ts` — math + RNG seeding (deterministic for tests).
- `__tests__/` — calibration + budget exhaustion tests.

## Dependencies

- Upstream: `@borjie/observability`, deterministic RNG.
- Downstream: graph-sync (read paths), reports-service (benchmarks).

## Common workflows

- **Wrap an aggregator** →
  `dpAggregator.count(records, { epsilon: 0.5 })`.
- **Check budget** → `budgetLedger.consume({ tenantId, epsilon })`.
- **Reset budget** → policy-driven monthly rollover.

## Anti-patterns to avoid

- Never publish raw aggregates from cross-tenant queries — wrap first.
- Never share the same RNG seed across two queries in prod.
- Never exceed the budget — fail closed.
- Never log the noise sample (defeats DP if leaked).

## Related codemaps

- [graph-sync.md](./graph-sync.md) — read source
- [observability.md](./observability.md) — budget metrics
- [database.md](./database.md) — budget table
