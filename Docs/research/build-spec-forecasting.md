# Build Spec — Forecasting Engine + "See-the-Future" Surfaces (Borjie + BossNyumba)

**Lane:** `build-spec-forecasting` (file-level ARCHITECT spec — no code in this doc)
**Date:** 2026-06-08
**Branch target:** `integration/parity-final`
**Synthesises:** `forecast-sota-foundation-models.md`, `forecast-sota-uncertainty-causal.md`,
`forecast-targets-domains.md`, `forecast-existing-substrate-audit.md`, and the
forecasting rows of `MASTER_GAP_REGISTER.md` (KI-DEBT-001, MEM-selfimp, RSS-07 fx-feed,
RSS-22 conformal-abstention, COG-03 calibrated-confidence, gh-#29 tenant-predictions stub).

> **Prime directive — EXTEND, never replace.** The substrate audit is unambiguous: there
> are already FOUR forecasting subsystems, a live online-conformal loop, a closed-loop
> predict→reconcile telemetry chain, and a proactive-loop signal contract that forecasts
> already emit into. This spec adds **one provider-abstraction engine package**, **one
> external-feed ingestion package**, **append-only storage**, and **the missing surfaces**.
> It introduces **no** second conformal implementation, **no** parallel prediction path,
> **no** non-hash-chained persistence.

> **Hard rails honoured (CLAUDE.md), restated as build constraints.**
> 1. **Predictions APPEND** — every forecast routes through the existing
>    `wrapWritesWithOutcomePrediction` / proactive-loop seams; the rule-based engine
>    (royalty A6, licence A10, statutory deadlines) stays authoritative. The engine
>    NEVER writes the ledger (`LedgerService.post()` only) and NEVER mutates a rule output.
> 2. **Evidence-required** — every forecast envelope carries ≥1 typed `evidence_id`
>    (feed snapshot id / corpus chunk id / model-run id). The Auditor rejects empty chains.
> 3. **Conformal already exists** — wrap, do not rebuild: extend `aci.ts` (DtACI/PID) and
>    reuse `conformal-calibration-loop.ts`. Raw model quantiles are NEVER surfaced.
> 4. **Multi-currency** — every money render via `formatCurrency(amount, currencyCode)`;
>    money lives only in `metadata` jsonb on forecast tables (currency-neutral columns).
> 5. **EN/SW absolute toggle** — all forecast narrative + surface copy fully bilingual.
> 6. **RLS FORCE + append-only migrations + canonical GUC** — new tables follow the
>    `forecast_runs` / `conformal_predictions` hash-chain + `app.current_tenant_id` pattern;
>    new migration numbers are forward-only (`0314+`, current head is `0312`/`0313`).

---

## 1. The Forecasting ENGINE package — `@borjie/forecast-engine`

**New package:** `packages/forecast-engine/` (NOTE: distinct from the existing
`@borjie/forecasting` time-series/graph package and `@borjie/forecasting-engine` scenario
package — this is the **provider-abstraction + routing + conformal-wrap orchestration**
layer that sits *above* both and unifies them behind one port). It is the "Cobra-Agent
router" pattern the foundation-models dossier recommends: a classical floor + one
self-hosted TSFM advisory overlay + causal + Monte-Carlo + conformal wrapper.

### 1.1 Provider abstraction (`src/providers/`)

A single `ForecastProviderPort` interface so every backend is swappable; the **router**
(`src/router/forecast-router.ts`) picks per-series by data regime (the decision matrix in
the foundation-models dossier §4), never by leaderboard rank.

| File | Role |
|---|---|
| `src/providers/port.ts` | `ForecastProviderPort` (`forecast(series, horizon, covariates?) → RawForecast{quantiles, modelVersion, latencyMs}`), `ProviderKind` enum, `ProviderHealth`. |
| `src/providers/tsfm-api-provider.ts` | Adapter over hosted TS-foundation-model APIs (Nixtla TimeGPT-2 / external). **Off by default** (data-residency rail); env-gated, degrades to 503 like the existing TGN router — never fabricates. |
| `src/providers/tsfm-selfhost-provider.ts` | Adapter over a **self-hosted sidecar** (AutoGluon-TimeSeries harness fronting **Toto-2.0 313m** for many-variate telemetry / **Chronos-2** for covariate-informed). Reuses the existing `SidecarPort` shape from `packages/forecasting/src/sota/`. CPU-capable fallback = **TiRex 35M**. |
| `src/providers/classical-provider.ts` | The **mandatory accuracy floor** + rule-based decision input. Wraps the existing in-repo classical models (`packages/forecasting/src/models/{holt-winters,naive-seasonal,moving-average,linear-regression}.ts`) and adds `statsforecast`-shaped `AutoETS`/`SeasonalNaive`/`AutoTheta` + `Croston/TSB` for intermittent SKUs (spare parts, low-volume minerals). |
| `src/providers/causal-provider.ts` | Bridges `@borjie/causal-inference` (DoWhy-shaped identify→estimate→refute) + the structural/DAG forecasters in `packages/forecasting-engine/src/forecasters/causal/` for "what-if / policy-lever" targets (royalty formula overlay, licence-slippage classifier). |
| `src/providers/montecarlo-provider.ts` | Bridges `@borjie/forecasting-engine` scenario sandbox + the stochastic forecasters (`forecasters/stochastic`: GBM/jump-diffusion price paths, GARCH vol bands) for fan-charts and liquidity-at-risk. Adds **copula-coupled** joint sampling (vine) and **reverse-stress-testing** search (uncertainty dossier §3.2). |

### 1.2 Router + regime classifier (`src/router/`)

| File | Role |
|---|---|
| `src/router/regime-classifier.ts` | Maps a `TimeSeries` + target to a `DataRegime` (short / cold-start / many-series-covariate / intermittent / hierarchical / high-frequency / many-variate / long-context / scenario-fan). Pure, table-driven from the §4 decision matrix. |
| `src/router/forecast-router.ts` | Selects provider(s) per regime, runs the **classical floor always**, escalates to a TSFM **only when it beats the floor on held-out rolling-origin backtest** (reuses `packages/forecasting/src/backtesting/`). Records "baseline-beaten?" on the envelope. |
| `src/router/hierarchical-reconciler.ts` | **MinT reconciliation** (`HierarchicalForecast`-shaped) so estate→subsidiary→site→mineral (and portfolio→building→unit for RE) roll-ups are coherent. |

### 1.3 Conformal wrapper (`src/conformal/` — EXTENDS, does not duplicate)

The wrapper is a thin orchestration over the **existing** online-conformal substrate. It
imports `@borjie/conformal-calibration-online` and the gateway's
`conformal-calibration-loop.ts`; it does NOT re-implement ACI.

| File | Role |
|---|---|
| `src/conformal/conformal-wrap.ts` | Takes any provider's raw quantiles, looks up `getCalibratedAlpha(tenantId, predictionType)`, applies split-conformal / CQR to produce decision-grade `ConformalInterval` (matches `packages/forecasting/src/types.ts`). Surfaces NEVER see raw quantiles. |
| `packages/conformal-calibration-online/src/aci.ts` (**EDIT, backward-compatible**) | Upgrade single-γ ACI → **DtACI** (grid of γ-experts + exponential-weight aggregation; current ACI = 1-expert case) and add opt-in **conformal-PID** (I-term = today's ACI; D-term scorecaster consumes the per-step ICP residuals already kept in `packages/forecasting/src/conformal/time-series.ts`). Keep `diagnostic()` shape so `conformal-confidence-gate.ts` / `calibrated-confidence.ts` consumers are untouched. (Gap MASTER §7-A.) |
| `src/conformal/extreme-tail.ts` | **Extreme-conformal (GPD-tail)** mode for the 99th-percentile sets that drive treasury / kill-switch HIGH-risk thresholds (A1 price shock, A2 FX cliff). Marginal CP under-covers tails — this is the targeted hardening pass (MASTER §7-G). |

### 1.4 Engine entry + envelope (`src/index.ts`, `src/envelope.ts`)

`createForecastEngine(deps)` returns `{ forecast(request): Promise<ForecastEnvelope> }`.
`ForecastEnvelope` = `{ forecastId, tenantId|null, target, horizon, point, interval,
drivers: ForecastDriver[], evidenceIds: EvidenceId[], modelVersion, baselineBeaten,
conformalCoverage, scenarioRunId?, currency? (metadata only) }`. The envelope reuses the
existing `Forecast` / `ForecastResult` types from `@borjie/forecasting` — additive fields
only.

---

## 2. Forecasts enter the brain as PREDICTIONS THAT APPEND

No new path. Three existing seams (substrate audit §8) carry the forecast:

1. **Action-coupled forecasts** → routed through
   `services/api-gateway/src/composition/brain-tools/outcome-predictor.ts`
   (`wrapWritesWithOutcomePrediction`). The prediction is recorded into `outcome_predictions`
   and **extends the `ai_audit_chain`** BEFORE the rule-based handler runs unchanged. This is
   the literal embodiment of "predictions APPEND." If no model is wired it writes
   `{ unmodeled: true }` (confidence 0) — never fabricates.
2. **Confidence gating** → forecast confidence passes through
   `services/api-gateway/src/composition/conformal/conformal-confidence-gate.ts`
   (`applyConformalConfidence(rawConfidence, alpha)`) — already the load-bearing seam that
   re-grades to a tier. Wires the RSS-22 / COG-03 fix (brain no longer hard-stamps
   confidence=1) into the same gate.
3. **Evidence citation (NEW — tighten the seam, substrate audit §4).** New file
   `services/api-gateway/src/composition/conformal/forecast-evidence-binder.ts`: converts the
   engine's `evidenceIds[]` (feed-snapshot id, corpus chunk id, model-run id) into the typed
   `evidence_id` the Auditor checks — replacing the free-form `sources[]` strings
   (`'lme-rest'`, `'tra-royalty-policy'`). Every forecast that reaches a surface or a junior
   recommendation MUST carry ≥1.

**Wiring file (NEW):** `services/api-gateway/src/composition/forecast/forecast-engine-wiring.ts`
— composition-root binder: constructs `createForecastEngine` with the conformal loop, the
feed registry (§3), the hash-chained repository (§4), and registers the brain tool
`forecast_target` (append-only, advisory) alongside the existing world-model kernel tools.
Replaces the market-intel `forecastBaseline` stub (KI-DEBT-001) with the real engine.

---

## 3. External-feed ingestion — `@borjie/forecast-feeds`

**New package:** `packages/forecast-feeds/`. Commodity-price / FX / weather / macro adapters
with caching and a **`tenant_id = NULL` global-vs-tenant split** (same pattern as the mining
corpus: global ground truth every tenant inherits, tenant rows for tenant-private series).

| File | Feed | Source (from targets dossier) |
|---|---|---|
| `src/adapters/commodity-feed.ts` | A1/A3/A6/A7 — gold/silver/PGM/copper/tin | LBMA fixings, LME/TradingEconomics, Metals-API/MetalpriceAPI, World Bank Pink Sheet (backtest anchor). |
| `src/adapters/fx-feed.ts` | A2/A5/A6 — TZS/KES/UGX/NGN | Central banks (BoT/CBK/BoU/CBN) as official anchor, TradingEconomics, OANDA. **Reuses + de-dups the existing `services/api-gateway/src/workers/fx-feed-cron.ts`** — fixes RSS-07 (`ON CONFLICT (ts,pair)` + cluster-lock) rather than adding a second FX writer. |
| `src/adapters/macro-feed.ts` | A5/B1/B3/B6 | FRED, World Bank Open Data, IMF WEO, DBnomics. |
| `src/adapters/weather-feed.ts` | A9 (safety) / B5 (construction) | NOAA, NASA POWER, national met services. |
| `src/cache/feed-cache.ts` | TTL cache + provenance stamping — each fetch yields a `FeedSnapshot{snapshotId, source, fetchedAt, hash}` that becomes the forecast's `evidence_id`. |
| `src/registry.ts` | `createFeedRegistry()` — global feeds default `tenant_id = NULL`; tenant-private series (drill assays, plant historian, HRIS) carry the tenant id. |
| `src/ports.ts` | `FeedAdapterPort`, `FeedSnapshot`, `FeedCachePort` (Redis-backed in prod, in-memory dev). |

**Caching + split rule:** global feeds (commodity/FX/macro/weather) are fetched **once per
tenant_id=NULL** by a leader-elected cron (use the cluster-lock fix, RSS-06) and shared; a
tenant never re-fetches a public price. Tenant-private series are RLS-scoped. Backtests anchor
on neutral ground truth (Pink Sheet / central-bank fixings / USGS) to avoid self-referential
drift.

---

## 4. Storage / migration (append-only, RLS+FORCE, canonical GUC)

Three new forward-only migrations (head is `0312`/`0313`; use `0314`–`0316`). All follow the
`conformal_predictions` (0299) + `forecast_runs` (0067) pattern: RLS FORCE-enabled,
currency-neutral columns (money only in `metadata` jsonb), hash-chained on insert via
`@borjie/audit-hash-chain` (GENESIS per tenant), `app.current_tenant_id` GUC bound by gateway
middleware. **Never edit a shipped numbered file.**

| Migration | Table(s) | Purpose |
|---|---|---|
| `packages/database/src/migrations/0314_forecast_series.sql` | `forecast_series`, `forecast_series_points` | Reusable **historical feature-series store** — the audit's named "no generic timeseries table" gap (substrate §7). Feeds providers without ad-hoc recomputation. `tenant_id` nullable (global vs tenant split). |
| `packages/database/src/migrations/0315_forecast_intervals.sql` | `forecast_intervals` | Per-emission conformal interval + `alpha_at_emit` + `evidence_ids[]` + `baseline_beaten` + `model_version`, hash-chained. Joins to the existing `forecast_runs` + `conformal_predictions`. |
| `packages/database/src/migrations/0316_scenario_runs.sql` | `scenario_runs`, `scenario_run_drivers` | Monte-Carlo / reverse-stress runs: driver config, sampled paths summary, failure-oracle outcome, hash-chained. Backs the scenario simulator surface (§5). |

**Schema files (Drizzle, append to `packages/database/src/schemas/`):**
`forecast-series.schema.ts`, `forecast-intervals.schema.ts`, `scenario-runs.schema.ts` —
exported from `packages/database/src/schemas/index.ts`. Each declares
`.enableRLS()` FORCE + `tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id')`
USING + a `WITH CHECK` on writes (apply the DP-02 lesson: global rows written only by service
role; tenant writes checked against the GUC).

**Restore the stubbed mining prediction persistence (gh-#29 / MASTER tenant-predictions):**
`packages/database/src/services/tenant-predictions.service.ts` currently returns `[]` (tables
dropped with property domain). New migration is NOT needed for a parallel store — instead point
the predictive-interventions engine at `forecast_series` + `forecast_intervals` (ore-grade
drift / production-shortfall as forecast targets).

---

## 5. "See-the-future" SURFACES

### 5.1 owner-web (Next.js, port 3010)

The substrate audit's biggest surfacing gap: `services/api-gateway/src/routes/owner/forecasts.hono.ts`
(`/api/v1/owner/forecasts/{cash-flow,production,royalty}`) is **wired backend-only, no UI**.

| File (NEW) | Surface |
|---|---|
| `apps/owner-web/src/app/(routes)/forecasts/page.tsx` | **Forecast tab** — cash-flow / production / royalty / FX / commodity bands (p10/p50/p90), each a conformal fan-chart. Consumes the already-mounted owner endpoints. |
| `apps/owner-web/src/components/forecast/ForecastFanChart.tsx` | Reusable conformal-band chart; money via `formatCurrency`; bilingual axis/legend. |
| `apps/owner-web/src/components/forecast/ScenarioSimulator.tsx` | **Scenario simulator** — driver sliders (FX path, price drop, royalty timing) → calls a new route that runs `@borjie/forecasting-engine` sandbox + `montecarlo-provider`; renders Pareto/outcome bands + a **reverse-stress** "what bankrupts this estate?" mode. |
| `apps/owner-web/src/lib/queries/forecasts.ts` | TanStack queries for `/owner/forecasts/*` and the new scenario route. |
| `apps/owner-web/src/components/forecast/EarlyWarningPanel.tsx` | **Early-warning / anomaly alerts** rendered from the existing proactive sink — subscribes to the proactive-loop signals already emitted by `packages/ai-copilot/src/graph-signals/graph-signal-emitter.ts` (source `'forecasting'`). |

**New gateway route (NEW):** `services/api-gateway/src/routes/owner/scenarios.hono.ts`
(`POST /api/v1/owner/scenarios/run`, `GET /:id`) — RLS-scoped, persists to `scenario_runs`,
returns conformal-banded outcomes; never invents synthetic data (`source:'insufficient'` under
threshold history, matching the existing forecasts route discipline).

### 5.2 workforce-mobile + buyer-mobile (Expo)

| File (NEW) | Surface |
|---|---|
| `apps/workforce-mobile/src/forecast/ForecastTab.tsx` | Manager/owner forecast tab — production yield (A3), equipment RUL (A4), safety-incident risk (A9), attrition (A8). Advisory + human-gated (safety/licence fail-closed, never auto-halt). |
| `apps/buyer-mobile/src/forecast/MarketForecastTab.tsx` | Buyer demand / clearing-price (A7) + commodity reference bands (A1) for marketplace lots. |
| `apps/{workforce,buyer}-mobile/src/forecast/EarlyWarningBanner.tsx` | Proactive-sink early-warning banner (cashflow-dip, royalty-arrears-spike, safety hotspot). |

**Anomaly/early-warning path (EXTEND):** new detectors in
`packages/proactive-intel/src/detectors/` (`forecast-anomaly.ts`, `forecast-band-breach.ts`)
consume the `forecast-input.ts` contract (`ForecastBand` p10/p50/p90); a band breach or a
conformal-miscoverage spike raises a `Signal` through the existing
`proactive-orchestrator` → policy-gate → approval/notify. No new alerting infrastructure.

---

## 6. Mining-estate AND real-estate target coverage

The forecasting spine is shared (targets dossier). The engine is domain-agnostic; coverage is
a **registry mapping target → regime → provider config**, registered once.

| File (NEW) | Coverage |
|---|---|
| `packages/forecast-engine/src/targets/mining-targets.ts` | A1 price, A2 FX, A3 yield/grade, A4 RUL, A5 treasury, A6 royalty (rule-based formula + probabilistic overlay = the canonical APPEND pattern), A7 demand/offtake, A8 attrition, A9 safety, A10 licence-deadline, A11 prospectivity. |
| `packages/forecast-engine/src/targets/real-estate-targets.ts` | B1 AVM, B2 rent/occupancy/vacancy, B3 absorption, B4 maintenance/capex, B5 construction cost+schedule (Monte-Carlo QSRA + reference-class), B6 market-cycle turning points. (BossNyumba shares the package — `conformal-calibration-online` docstring already names rent/vacancy/maintenance calibration.) |
| `packages/forecast-engine/src/targets/registry.ts` | `FORECAST_TARGETS` registry binding each target to its regime + default provider + horizon + leading-indicator feeds; extends the existing `FORECAST_TARGETS` / `RISK_KINDS` enums (build fails until each new kind is routed in `domainForRiskKind`). |

Royalty (A6) and licence (A10) stay **rule-based authoritative** with a probabilistic overlay
that only bands the uncertain inputs — HIGH-risk policy prefixes hit literal rules, no
reason-resolver generalisation.

---

## 7. Test plan + reversible rollout

### 7.1 Tests (TDD, 80%+; reuse existing harnesses)

| Layer | Files | Asserts |
|---|---|---|
| Unit — engine | `packages/forecast-engine/src/**/__tests__/*` | regime-classifier table correctness; router runs floor-first + escalates only on backtest win; conformal-wrap never emits raw quantiles; envelope always carries ≥1 evidenceId. |
| Unit — conformal upgrade | `packages/conformal-calibration-online/src/__tests__/dtaci.test.ts` | DtACI reduces to single-γ ACI in 1-expert case (backward-compat); PID I-term == legacy ACI; `diagnostic()` shape unchanged (consumer contract). |
| Unit — feeds | `packages/forecast-feeds/src/**/__tests__/*` | cache TTL + provenance stamp; tenant_id=NULL global vs tenant split; fx-feed `ON CONFLICT` no dup rows (RSS-07). |
| Integration — gateway | `services/api-gateway/src/composition/forecast/__tests__/*`, `routes/owner/__tests__/scenarios.test.ts` | RLS-scoped reads; `wrapWritesWithOutcomePrediction` records prediction + extends hash-chain BEFORE handler; evidence-binder produces typed `evidence_id`; Auditor rejects empty chain. |
| Backtest / eval | extend `packages/forecasting/src/backtesting/` + a `forecast-eval.yml` CI workflow (mirror `kernel-eval.yml`) | rolling-origin CRPS / Winkler / pinball (NOT MAPE) per target; conformal coverage ≥ target on held-out; foundation-model must beat classical floor to ship. |
| Migration | `migration-apply-check.yml` (existing) | `0314`–`0316` apply on fresh PG17+pgvector in lex order; RLS FORCE + WITH CHECK present; backfill-safe. |
| E2E (Playwright) | `apps/owner-web` forecast + scenario flows | fan-chart renders bands; scenario simulator round-trips; EN/SW toggle leaves zero opposite-language strings; `formatCurrency` on every money render. |

### 7.2 Reversible rollout

1. **Flag-gated, dark-launch.** Engine behind `FORECAST_ENGINE_ENABLED` (default off);
   classical floor + existing routes keep serving. TSFM-API provider stays off (residency).
2. **Shadow mode.** Engine runs alongside the live `forecastBaseline` stub, writing to
   `forecast_intervals` only; compare via the eval workflow before cutover (KI-DEBT-001
   replacement is the first cutover).
3. **Append-only by construction.** Because every forecast routes through
   `wrapWritesWithOutcomePrediction` and writes hash-chained append-only rows, a rollback is a
   flag flip — no data to unwind, no rule-based decision was ever overwritten.
4. **Surface behind feature flags** per app; mobile tabs and scenario simulator ship dark,
   enabled per-tenant after the eval gate passes.
5. **Auto-demote.** Reuse the existing kill-switch / canary path: a conformal-miscoverage
   tripwire or backtest regression flips the engine back to the classical floor (fail-closed
   for HIGH-risk treasury/licence targets).

---

## 8. DSCHEMA (file-level summary)

**New packages:** `packages/forecast-engine/`, `packages/forecast-feeds/`.
**Edited (backward-compatible):** `packages/conformal-calibration-online/src/aci.ts`,
`packages/market-intelligence/src/demand-forecaster.ts` (replace `forecastBaseline` stub),
`packages/proactive-intel/src/detectors/` (+2 detectors),
`packages/database/src/schemas/index.ts`, `services/api-gateway/src/workers/fx-feed-cron.ts`,
`packages/database/src/services/tenant-predictions.service.ts`.
**Migrations (forward-only):** `0314_forecast_series.sql`, `0315_forecast_intervals.sql`,
`0316_scenario_runs.sql`.
**Append (never replace):** all brain entry goes through existing
`outcome-predictor.ts` / `conformal-confidence-gate.ts` / `graph-signal-emitter.ts` seams.
