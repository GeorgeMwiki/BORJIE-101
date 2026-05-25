# Market Intelligence Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/market-intelligence/`
**Public entry:** `packages/market-intelligence/src/index.ts`
**Tier scope:** cognitive core (external market signal)

## Purpose

External market-data layer: pulls rental comparables, occupancy
seasonality, and area benchmarks from third-party feeds, normalises
them to the canonical schema, and exposes a clean port for the
Brain's pricing-advisor and market analytics. Adapters per data
source (e.g. property-portal scrapers, partner APIs) live in
`adapters/` and `feed-adapters/`.

## Entry points

- `src/index.ts` — barrel.
- `src/port.ts` — `MarketDataPort` interface.
- `src/market-data-service.ts` — port implementation.
- `src/comparable-finder.ts` — nearest-comparable matcher.
- `src/seasonality.ts` — seasonality decomposition.
- `src/adapters/`, `src/feed-adapters/` — concrete data adapters.
- `src/types.ts` — `MarketComparable`, `SeasonalityCurve`.

## Internal structure

- `adapters/` — paid-API adapters.
- `feed-adapters/` — RSS / public-feed adapters.
- `comparable-finder.ts` — geospatial + attribute matcher.
- `seasonality.ts` — STL-style decomposition.

## Dependencies

- Upstream: `@borjie/connectors` (resilience), `@borjie/observability`,
  `@borjie/domain-models`.
- Downstream: marketing-brain (pricing advisor), central-intelligence,
  reports-service.

## Common workflows

- **Find comparables** →
  `comparableFinder.search({ lat, lng, radius, type })`.
- **Decompose seasonality** → `seasonality.decompose(series)`.
- **Add a feed** → implement `MarketDataPort`, register.

## Anti-patterns to avoid

- Never query feeds without the resilience wrapper.
- Never persist scraped HTML — extract + discard.
- Never share API keys across tenants — scope per-tenant.
- Never expose raw seller data to other tenants.

## Related codemaps

- [marketing-brain.md](./marketing-brain.md) — pricing advisor
- [forecasting-engine.md](./forecasting-engine.md) — seasonality feeder
- [connectors.md](./connectors.md) — resilience
