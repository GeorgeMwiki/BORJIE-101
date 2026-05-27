# @borjie/market-intelligence

Tanzania mining market intelligence for the Borjie LMBM. Tracks gold,
copper, and tanzanite, produces 90-day demand forecasts with p5/p50/p95
prediction bands, surfaces disruption alerts (logistics, regulatory,
weather, geopolitics), and emits buy/sell/hold signals with bulleted
causal reasoning.

Persona: Mr. Mwikila. Brand: Borjie.

## Why this exists

The other intelligence packages are general-purpose primitives —
`@borjie/forecasting-engine` knows how to forecast time series,
`@borjie/proactive-intel` knows how to emit recommendations,
`@borjie/anomaly-detection` knows how to spot outliers,
`@borjie/causal-inference` knows how to attribute cause. This package
is the Tanzania mining narrative layer that ties them together:

- Gold tracks LBMA AM/PM fix with USD/TZS conversion via
  `@borjie/fx-treasury-advisor`.
- Copper tracks LME 3-month with the Mwadui/Mbeya regional spread.
- Tanzanite tracks Block C/D production reports out of
  Karatu/Mererani.

Every output is tenant-isolated and stamped with the relevant
regulatory context tags (OSHA-TZ, TMAA, TRA-ROYALTY, EWURA-FUEL,
BOT-FX) so downstream compliance overlays can audit which rules apply.

## Public surface

```ts
import { createMarketIntelligence } from '@borjie/market-intelligence';

const intel = createMarketIntelligence({
  priceProvider, // PriceProviderPort — wire your LBMA / LME / Block C adapter
  fxProvider, // FxProviderPort — wire @borjie/fx-treasury-advisor
  tenantPermission, // TenantPermissionPort — wire your RBAC port
  disruptionSource, // DisruptionSignalSourcePort — wire your feeds
  alertSink, // AlertSinkPort — wire @borjie/proactive-intel.compose
});

await intel.trackCommodity('gold', 'mwikila-co');
await intel.forecast90Day({ commodity: 'copper', tenantId: 'mwikila-co', history, horizonDays: 90 });
await intel.getDisruptionAlerts('mwikila-co');
await intel.getSellSignals('mwikila-co', 'tanzanite');
```

All public input is validated with Zod at the boundary; the public
errors are `UnknownCommodityError`, `ForecastUnavailableError`, and
`TenantPermissionError`.

## Wiring map

| Port | Wave-1 wiring target |
| --- | --- |
| `PriceProviderPort` | `@borjie/mining-commodity-intelligence` adapters (LME, Kitco) + Block C/D production-report ingestor |
| `FxProviderPort` | `@borjie/fx-treasury-advisor.FxRateFeedPort` |
| `TenantPermissionPort` | `@borjie/authz-policy` (TODO(wire)) |
| `DisruptionSignalSourcePort` | RSS / gov feeds / weather / OSINT (TODO(wire)) |
| `AlertSinkPort` | `@borjie/proactive-intel.compose` + notification adapter |
| `TelemetryPort` | `@borjie/observability.PlatformMetrics` + `@borjie/ocsf-emitter.emitEvent` |

Inside `demand-forecaster.ts` there is a TODO to swap the small
in-package linear-regression baseline for
`@borjie/forecasting.createHoltWintersForecaster` wrapped with
`wrapWithConformalIntervals`.

## Constraints

- Pure-TS, no network in unit tests — all external calls go through
  Ports with deterministic in-memory defaults.
- Immutable patterns only — every transform returns a new object.
- Files <800 lines, functions <50 lines.
- Tenant isolation enforced at every public method.
