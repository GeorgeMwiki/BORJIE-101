# Forecast / Prediction Substrate Audit — what ALREADY exists

**Lane:** `forecast-existing-substrate-audit` (repo read-only)
**Date:** 2026-06-08
**Purpose:** Map every piece of prediction/forecasting machinery that
already lives in the codebase so any new forecasting spec **EXTENDS** the
substrate rather than rebuilding (or worse, replacing) it. Particular
attention to the hard rails: predictions APPEND to rule-based decisions
(never replace), every AI output cites ≥1 `evidence_id`, conformal
calibration is already present and live-wired, multi-currency via
`formatCurrency`, append-only audit / migrations.

**Headline finding:** The substrate is unusually deep and ALREADY
mostly wired. There are **four distinct forecasting subsystems**, a
**live online-conformal calibration loop**, a **closed-loop
predict→reconcile telemetry chain**, and a **proactive-loop signal
contract** that forecasts already emit into. The gaps are at the
*surfacing* (owner-web has almost no forecast UI), the *graph TGN*
adapter (env-gated, degrades to 503), and one *stubbed* persistence
service (`tenant-predictions`). Almost nothing needs to be built from
zero.

---

## 1. The four forecasting subsystems (do not conflate)

There are FOUR packages with overlapping names. A spec must name which
one it extends.

### 1a. `@borjie/forecasting` — time-series + graph (the primary one)
`packages/forecasting/`
Two stacked layers in one package:

- **Graph / per-node layer** (`src/types.ts`, `src/models/tgn-forecaster.ts`,
  `src/features/extractor.ts`, `src/conformal/inductive.ts`): produces a
  `Forecast` per graph node — `forecastId`, `RiskKind`, `ForecastScope`
  (tenantId + nodeLabel + nodeId + horizonDays), a `ConformalInterval`
  (`point`/`lower`/`upper`/`alpha`), SHAP-like `ForecastDriver[]`,
  `modelVersion`, `featureFingerprint`. **10 canonical `RISK_KINDS`**
  (`outstanding_royalties_risk`, `churn_risk`, `incident_risk`,
  `vendor_decay`, `renewal_opportunity`, `compliance_drift`,
  `available_capacity_risk`, `repair_recurrence`, `payment_method_decay`,
  `litigation_exposure`) — a public contract that `@borjie/ai-copilot`
  graph-signals keys off. `PlatformForecast` is the cross-tenant moat
  product (DP-aggregated, no tenantId, carries `privacyCost` ε).
- **Time-series layer** (`src/models/{naive-seasonal,moving-average,holt-winters,linear-regression}.ts`,
  `src/models/adapters.ts`, `src/conformal/time-series.ts`,
  `src/ensembles/`, `src/backtesting/`, `src/anomaly/`,
  `src/re-forecasters/`): univariate `TimeSeries` → `TimeSeriesForecast`
  with per-step `ForecastInterval` (`conformal: boolean` flag),
  `ModelKind` enum incl. foundation-model adapters
  (`chronos`/`timesfm`/`timegpt`/`llm-zero-shot`). Six mining
  re-forecasters: `forecastRoyalty`, `forecastUtilisation`,
  `forecastChurn`, `forecastMaintenanceFailure`, `forecastEnergyConsumption`,
  `forecastMarketCycle` (+ deprecated real-estate aliases retained).
- **SOTA sublayer** (`src/sota/`): a newer wave (`Docs/DESIGN/FORECASTING_SOTA_2026.md`).
  `ForecastResult` with `intervals_80`/`intervals_95`, `SOTA_MODELS`
  (timegpt/chronos/moirai/prophet/arima/nbeats/naive-*), `FORECAST_TARGETS`
  (`gold_price`, `production_volume`, `royalty`, `demand`, `workforce`,
  `fuel`), walk-forward backtest metrics, foundation-model **ports**
  (`SotaForecastingPort`, `SidecarPort` for python prophet/arima/nbeats).
  Six mining-domain wrappers in
  `src/sota/domain/mining-forecasts.ts` (`forecastGoldPrice`,
  `forecastProductionVolume`, `forecastRoyaltyRevenue` — a Monte-Carlo
  composition price×volume×bps, seed 4221, deterministic — etc.), each
  returning a `MiningForecastNarrative` + `sources[]`.
  Persisted via `ForecastRunRepository` (`src/sota/repositories/forecast-runs-repository.ts`)
  — **hash-chained on insert** (`@borjie/audit-hash-chain`, GENESIS per
  tenant), in-memory + SQL adapters, backs migration `0067_forecast_runs`.

### 1b. `@borjie/forecasting-engine` — what-if scenario simulation
`packages/forecasting-engine/`
A DIFFERENT package: the brain's "imagination". A `WorldModel` over
`CashflowState`/`ComplianceState`/`TenantGraph`/`MarketCache`, sandboxed
ephemeral schema-clone simulation (`src/sandbox/`), a scenario library
(`raise-royalty`, `fire-vendor`, `refinance`, `water-main-crisis`,
`offtake-renewal-batch`, `acquire-site`), causal/stochastic/discrete-event
forecasters (`pricing-elasticity`, `retention-curve`,
`payment-timing-process`, `maintenance-queue-sim`,
`offtake-lifecycle-sim`, `outstanding-royalties-forecaster`), and a
`predicted-vs-actual` feedback loop with `reflexion-update` +
`world-model-update`. This is *scenario/counterfactual* forecasting, not
time-series projection.

### 1c. `@borjie/market-intelligence` — 90-day demand bands
`packages/market-intelligence/src/demand-forecaster.ts`
Tenant-scoped 90-day commodity demand forecast → p5/p50/p95 bands +
driver narrative + regulatory-context tags (`OSHA-TZ`, `TMAA`). **Already
surfaced in owner-web** (see §6). NOTE the inline `LATER(wire)` comment:
its `forecastBaseline` is a small deterministic impl that is *meant to be
replaced* by `@borjie/forecasting` Holt-Winters + conformal — tracked as
**KI-DEBT-001**. This is a concrete extension seam.

### 1d. central-intelligence world-model — trajectory extrapolation
`packages/central-intelligence/src/kernel/world-model/`
The kernel's in-brain forecaster: `forecastPropertyTrajectory`,
`forecastTenantArrearsTrajectory`, `forecastOwnerCashflow`,
`detectMarketRegime`, exposed as brain tools
(`createWorldModelKernelTools`). Deterministic linear extrapolation,
designed to be swapped for a learned JEPA/transformer behind the same
shapes. (Some names still property-era — migration residue.)

---

## 2. Conformal calibration — ALREADY present AND live-wired

This is the hard-rail "conformal calibration is already in the codebase",
and it is genuinely a closed loop, not a library sitting dark.

- **Pure ACI state machine:** `@borjie/conformal-calibration-online`
  (`packages/conformal-calibration-online/src/aci.ts`) — Adaptive
  Conformal Inference (Gibbs & Candès 2021). `updateConformal()` is a
  pure immutable update: `alpha_{t+1} = alpha_t + lr·(observed − target)`,
  clamped [0.01, 0.5], rolling window (default 200). Defaults:
  target coverage 0.9, initial alpha 0.1, lr 0.05.
- **Inductive conformal (ICP):** `packages/forecasting/src/conformal/inductive.ts`
  (`createAbsoluteResidualCalibrator`, `createProbabilityCalibrator`) and
  the time-series wrapper `src/conformal/time-series.ts`
  (`wrapWithConformalIntervals`).
- **Durable feedback loop (3 tables):**
  `packages/database/src/schemas/conformal-calibration.schema.ts`
  (migration `0299`): `conformal_predictions` (interval + `alpha_at_emit`),
  `conformal_observations` (`covered` bool), `conformal_calibration_state`
  (persisted alpha + rolling window so alpha survives restart). RLS
  FORCE-enabled, currency-neutral (money only in `metadata` jsonb).
- **Live wiring (api-gateway):** `services/api-gateway/src/composition/conformal/`
  - `conformal-calibration-loop.ts` — `recordPrediction` / `recordOutcome`
    / `getCalibratedAlpha(tenantId, predictionType)` / `getCalibration`.
  - `drizzle-conformal-store.ts` — RLS-scoped Drizzle persistence.
  - `conformal-confidence-gate.ts` — **the load-bearing seam**: turns the
    calibrated alpha into a LIVE change in the confidence a chat turn
    emits. `applyConformalConfidence(rawConfidence, alpha)` re-grades the
    LLM-emitted float against alpha-shifted tier thresholds and snaps to a
    tier. (Honest comment in-file: the kernel `scoreConfidence` /
    ai-copilot `scoreToConfidenceLevel` exist but have ZERO live consumers
    — this gate is how alpha actually moves the wire.)
  - `reconciliation-conformal-feed.ts` + `feedback-conformal-feed.ts` —
    feed `matched`/`divergent` outcomes back as coverage observations
    (`predictionType = action:<actionKind>`).
- **Mirror in cognitive-engine:** `packages/cognitive-engine/src/calibration/confidence-calibrator.ts`
  (`conformalAdjustedThresholds`, 13/13 tests) — the proven pure formula
  the gate re-implements.
- **Calibration monitor:** `@borjie/calibration-monitor`
  (`packages/calibration-monitor/`) — Brier score, ECE, reliability
  diagram, weekly report generator, observation-recorder, and an
  `outcome-resolver` that is **idempotent and forbids self-resolution**
  (outcome label must come from an external source). Backed by
  `calibration_observations` / `calibration_weekly_reports` /
  `sae_probe_features` (migration `0037`,
  `calibration-interpretability.schema.ts`).

**Extension seam:** a new forecast type plugs into the loop by choosing a
`predictionType` string and calling `recordPrediction` at emit +
`recordOutcome` at reconcile. Nothing new is needed in the ACI core.

---

## 3. Closed-loop predict→reconcile telemetry (the APPEND substrate)

`services/api-gateway/src/composition/brain-tools/outcome-predictor.ts`
+ `outcome-telemetry.schema.ts` (migration `0114`) +
`services/api-gateway/src/workers/outcome-reconciliation-worker.ts`.

- Every **WRITE** brain tool is wrapped (`wrapWritesWithOutcomePrediction`)
  so that BEFORE the tool runs, a `predicted_outcome` + confidence +
  horizon_days + rationale is recorded into `outcome_predictions`, and the
  prediction **extends the AI hash-chain** (`ai_audit_chain`) so tampering
  breaks `verify()`.
- The wrapper is **observation-only on the success path** — it records the
  prediction then calls the original handler *unchanged*. This is the
  literal embodiment of the hard rail: **the prediction is appended
  alongside the action; it never gates, replaces, or rewrites the
  rule-based execution.**
- **Never fabricates:** if no predictor is wired / it throws, it writes an
  explicit `{ unmodeled: true }` envelope with confidence 0 so the row is
  auditable and the reconciler skips it.
- The reconciliation worker walks predictions every 6h, scores
  predicted-vs-observed, and emits a learning signal back into calibration.

**This is the canonical "predictions APPEND to rule-based decisions"
enforcement point.** A forecasting spec should route any new
action-coupled prediction through this wrapper, not invent a parallel
path. The advisory-only / human-approval discipline is reinforced at the
constitution layer
(`packages/autonomy-governance/src/constitution/borjie-constitution.ts`:
suspension/termination artefacts are "advisory only … require human
approval").

---

## 4. Evidence / audit chain a forecast must cite

- **Audit hash-chain primitive:** `@borjie/audit-hash-chain`
  (`chainHash`, `GENESIS_HASH`) — used by `forecast_runs` inserts,
  outcome-predictions audit append, calibration observations. Append-only,
  hash-chained, tamper-evident. A new forecast persist path MUST chain
  through this (the SOTA `forecast-runs-repository` shows the pattern:
  `prevHash` = last tenant row's `audit_hash`, `auditHash` = sha256 of
  canonical-JSON(prev ‖ payload)).
- **Evidence requirement (hard rail):** every junior recommendation cites
  ≥1 `evidence_id`; the Auditor Agent rejects empty evidence chains.
  Today the forecasting outputs carry **narrative + `sources[]`**
  (`MiningForecastResult.sources`, market-intelligence driver narrative +
  regulatory tags) and **`ForecastDriver[]`** attributions — these are the
  natural evidence carriers, but a spec should make the
  `evidence_id`/LMBM-citation linkage explicit on the forecast envelope
  (currently `sources` are free-form strings like `'lme-rest'`,
  `'tra-royalty-policy'`, not typed evidence ids). **This is a real seam
  to tighten.**

---

## 5. Sensors / think-pipeline that would feed forecasts

- **Proactive-loop signal contract** — forecasts ALREADY emit into it.
  `packages/ai-copilot/src/graph-signals/graph-signal-emitter.ts` maps a
  `Forecast` → proactive-loop `Signal` (source always `'forecasting'`,
  deterministic `signalId` per `forecastId`, severity derived from point
  AND lower bound, domain via exhaustive `RiskKind`→`AutonomyDomain`
  mapper). Consumed by `proactive-loop/proactive-orchestrator` → routes to
  approval or auto-execute via the policy gate.
- **Detector layer:** `@borjie/proactive-intel`
  (`packages/proactive-intel/src/detectors/`): `cashflow-dip`,
  `churn-risk`, `compliance-deadline-near`, `cost-anomaly`,
  `royalty-arrears-spike`, `slo-breach`, `vendor-reliability-drop` — each
  consumes forecaster output via the
  `src/contracts/forecast-input.ts` contract (`ForecastBand` p10/p50/p90,
  `CashflowForecastSlice` with owner `safetyFloor`, `RoyaltyArrearsSeries`,
  etc.). This is the typed boundary between *forecaster output* and
  *detector consumption* — a clean place to add a new signal.
- **Predictive interventions engine:**
  `packages/ai-copilot/src/ai-native/predictive-interventions/index.ts` —
  nightly rolling per-customer probability distribution
  (pay-on-time/late/default/churn/dispute) over 30/60/90d. Has a **pure
  rule-based `baselinePrediction`** that is the answer when the LLM is
  unavailable (the LLM *refines* the baseline, doesn't replace it — same
  APPEND pattern). Emits `InterventionOpportunity` on threshold crossing.

---

## 6. Surfaces — where a forecast renders today

- **Owner-cockpit forecast API EXISTS but has almost no UI yet:**
  `services/api-gateway/src/routes/owner/forecasts.hono.ts`
  (`ownerForecastsRouter`, mounted at `/api/v1/owner/forecasts` in
  `services/api-gateway/src/index.ts:2186`): `GET /cash-flow`,
  `/production`, `/royalty` — real Holt-Winters + heuristic 95% intervals,
  RLS-scoped, never invents synthetic data (returns
  `source: 'insufficient'` under 14 days history). **But a repo-wide
  search finds NO owner-web page consuming `/owner/forecasts`** — only
  `market-intelligence` and `treasury-advisor` queries render forecast
  bands. **This is the biggest surfacing gap: the cash-flow/production/
  royalty forecast endpoint is wired backend-only.**
- **Market intelligence (surfaced):** `apps/owner-web/src/components/market/MarketIntelligencePanel.tsx`
  + `app/(routes)/market/page.tsx` + `src/lib/queries/market-intelligence.ts`
  (`useCommodityForecast` → `/api/v1/mining/market-intelligence/forecast/:commodity`,
  p5/p50/p95 `DemandForecast`). Fully rendered.
- **Treasury advisor (surfaced):** `apps/owner-web/src/lib/queries/treasury-advisor.ts`
  — day-by-day cash-runway projection (zero-crossing + min-balance).
- **Legacy graph forecast router:** `services/api-gateway/src/routes/forecast.router.ts`
  (`POST /api/v1/forecast/node`, `GET /api/v1/forecast/:id`) — env-gated;
  **degrades to 503 `FORECAST_SERVICE_UNAVAILABLE`** when the TGN inference
  adapter env vars are absent (no mock data, ever). This is the per-node
  graph forecaster path; currently dark in most environments.

---

## 7. Data already captured vs missing

**Captured / persisted (ready to feed forecasts):**
- `forecast_runs` (drizzle baseline `0067_forecast_runs.sql`) — point +
  80/95 intervals + metrics + hash-chain, per `ForecastTarget`.
- `conformal_predictions` / `conformal_observations` /
  `conformal_calibration_state` (`0299`) — live coverage feedback.
- `outcome_predictions` + reconciliation tables (`0114`) — every brain
  WRITE's predicted outcome.
- `calibration_observations` / `calibration_weekly_reports` /
  `sae_probe_features` (`0037`).
- Domain source series for owner forecasts: `sales` (`netTzs`,
  `grossPriceTzs`, `parcelId`), `shift_reports` (`romTonnes`, `shiftDate`),
  `ore_parcels` (`mass_kg`) — already aggregated daily by the owner
  forecasts route.

**Missing / stubbed / thin:**
- **`tenant-predictions` service is a STUB.**
  `packages/database/src/services/tenant-predictions.service.ts` — its
  tables (`tenant_predictions`, `predictive_intervention_opportunities`,
  migration `0106`) were **dropped with the property domain**; every
  method logs a warn and returns `[]`. The predictive-interventions engine
  (§5) therefore has no live persistence in mining. Needs a mining
  equivalent (ore-grade drift / production-shortfall) — gh-issue #29.
  **High-impact seam.**
- **No generic time-series / metrics store.** There is no `*_metrics` or
  `*_timeseries` table; each forecaster recomputes its series ad-hoc from
  domain tables (sales/shift_reports). A spec wanting reusable historical
  feature series would need one (currently absent — confirmed by grep).
- **TGN inference adapter unbound** → graph `forecast.router` is 503 in
  practice; only the Holt-Winters owner route + market-intelligence are
  live.
- **`evidence_id` not yet first-class on forecast envelopes** (§4) —
  `sources[]` are free-form strings, not typed LMBM/corpus evidence ids.
- **Owner-web has no cash-flow/production/royalty forecast page** (§6) —
  backend ready, frontend absent.

---

## 8. Integration seams a spec should target (extend, never replace)

1. **Conformal loop:** call `recordPrediction` / `recordOutcome` /
   `getCalibratedAlpha` with a new `predictionType`
   (`conformal-calibration-loop.ts`). Confidence shipped to the owner
   already passes through `applyConformalConfidence` — wire there.
2. **Closed-loop APPEND:** route action-coupled forecasts through
   `wrapWritesWithOutcomePrediction` (`outcome-predictor.ts`) — this is the
   enforcement point that keeps predictions advisory/appended.
3. **Proactive loop:** emit via `GraphSignalEmitter`
   (`graph-signals/graph-signal-emitter.ts`); new risk kinds go in
   `RISK_KINDS` (`forecasting/src/types.ts`) + the exhaustive
   `domainForRiskKind` mapper (build fails until routed).
4. **Detector boundary:** the `forecast-input.ts` contract
   (`@borjie/proactive-intel`) — add a `*ForecastSlice` + a detector.
5. **Persistence + audit:** new forecast tables follow the
   `forecast-runs-repository` hash-chain pattern; new migration is
   forward-only/append (never edit `0067`/`0114`/`0299`/`0037`).
6. **Replace the market-intel `forecastBaseline` stub** with
   `@borjie/forecasting` Holt-Winters + conformal (KI-DEBT-001) — the
   `LATER(wire)` is explicitly invited.
7. **Surface the owner forecast endpoints** in owner-web (cash-flow /
   production / royalty) — the API is built and mounted.

**Bottom line for the spec author:** the forecasting *engine room* is
built, conformal-calibrated, audit-chained, and proactive-loop-connected.
Extend by (a) adding forecast *kinds/targets* to existing enums and
loops, (b) restoring the stubbed mining prediction persistence, (c) making
`evidence_id` first-class on the forecast envelope, and (d) surfacing the
already-built owner forecast endpoints. Do **not** introduce a parallel
prediction path, a second conformal implementation, or a non-chained
persistence store.
