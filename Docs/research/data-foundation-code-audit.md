# Data-Foundation Code Audit — Analytics · Viz · Capture · Recall vs INV-I / INV-J

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Lane:** `data-foundation-code-audit` (REPO READ-ONLY)
**Auditor question:** Against INV-I (the MD is a PhD-grade data scientist — descriptive→diagnostic→predictive→prescriptive + causal + cohort + anomaly + statistical guardrails + automated unprompted insight; viz beautiful AND correct, right-chart-for-the-question, inline-in-chat as live lenses) and INV-J (never lose a thread or datum; capture everything durably + event-sourced + retained + retrievable; always know everything = resident Current Situational Model + total-recall + lineage), what does the code actually have? PRESENT / PARTIAL / ABSENT, with file evidence.

**Headline verdict:** The *analytical-capability libraries are far richer than the gap-register premise assumed* — Borjie ships full, reference-validated packages for descriptive/inferential statistics, causal inference, anomaly detection, recommendations, and a Vega-Lite-v6 + genui visualization stack. **The structural gap is WIRING and AUTOMATION, not capability.** Most of the PhD-grade compute is built but reachable by the brain through only one narrow tool; auto-insight is built-but-dark; the "capture everything durably / event-source every state change" half of INV-J is **only honoured for the money path**, not for the org broadly.

---

## 0. Inventory — what exists (the packages are real, not stubs)

| Capability | Package | Evidence |
|---|---|---|
| Descriptive / inferential stats, regression, correlation, clustering, PCA, bootstrap | `packages/data-analysis/` | `src/index.ts:38-120` exports `mean…kurtosis`, `oneSampleTTest/welchTTest/anovaOneWay/mannWhitneyU/kruskalWallis`, `pearson/spearman/kendall`, `ols/polynomial/logistic`, `kmeans/dbscan/hierarchical`, `pca/umapLite`, `bootstrap`, domain wrappers `sitePerformanceStats/royaltyRateAnalysis/safetyIncidentCorrelation/buyerCohortAnalysis` |
| Causal inference (4-step model→identify→estimate→refute) | `packages/causal-inference/` | `src/index.ts:1-90` — Granger, PCMCI+, Pearl back-door/front-door, diff-in-diff, synthetic control, RDD, twin-network counterfactuals, placebo/bootstrap/E-value refutation |
| Anomaly + drift detection | `packages/anomaly-detection/` | `src/index.ts:1-60` — z-score, MAD, isolation-forest, LOF, one-class-SVM, autoencoder, ADWIN/KSWIN drift |
| Recommendations / bandits / cold-start | `packages/recommendations/` | dir `algorithms/ bandits/ coldstart/ diversity/ explain/` |
| Analytics semantic layer + chart builders + AI-chart-author + dashboards | `packages/analytics/` | `src/index.ts:1-80` — Cube-style `defineMetric/defineCube/compileQuery`; Vega-Lite v6 `barChart…sankeyChart`; `ai-chart-author/author.ts`; `dashboards/compose.ts` |
| Graph + chart viz primitives | `packages/graph-viz/`, `packages/genui/`, `packages/portal-genui/` | graph-viz wraps Cytoscape/react-flow/ECharts/D3; genui `catalog.ts:45-359` has 21 typed artifacts incl. kpi_tile/bar_chart/line_chart/pie_chart/heatmap/funnel/metric_grid; portal-genui `widgets/registry.ts:143-176` chart_line/chart_bar/chart_donut |
| Forecast engine + conformal calibration | `@borjie/forecast-engine`, `conformal-calibration-online`, `calibration-monitor` | (out of this lane's deep-read; confirmed present in `packages/`) |
| World-model / state-vectors / trajectory | `packages/central-intelligence/src/kernel/world-model/` | `index.ts`, `state-vectors.ts`, `trajectory.ts`, `world-model-tool.ts` |
| Belief / epistemic layer | `packages/belief-engine/` | `src/index.ts:1-40` reviseBelief/convinceLoop, migration 0274 |
| Proactive intelligence loop (auto-insight) | `packages/proactive-intel/` | `src/index.ts` — tick scheduler, anomaly/opportunity detectors, recommendation composer, fatigue policy |
| Memory (durable + semantic) | `packages/memory-v2/`, `packages/cognitive-memory/`, brain-thread store | memory-v2 6 layers + Drizzle stores; cognitive-memory observe/recall; `packages/database/src/repositories/brain-thread.repository.ts` |
| Transactional outbox (event store) | `packages/database/src/schemas/outbox.schema.ts` | generic `event_outbox` (eventType/aggregateType/aggregateId/payload/sequence) |
| Audit hash-chain (append-only) | `packages/audit-hash-chain/` | `src/chain.ts` sha256/HMAC prev-hash linkage |
| Retention / RTBF / data-lifecycle | `packages/data-protection/` | `src/retention/retention-runner.ts`, `src/rtbf/rtbf-orchestrator.ts` |

---

## 1. INV-I — Analytical capability (descriptive → diagnostic → predictive → prescriptive)

### 1a. Descriptive — **PRESENT (lib) / PARTIAL (wired)**
- Compute: `packages/data-analysis/src/descriptive/*` (mean/median/quantile/variance/skewness/kurtosis/iqr/histogram/summary) — reference-validated to ≥6 dp per the package header.
- Wired to brain: only via ONE tool — `mwikila.analytics.site_performance` (`services/api-gateway/src/composition/brain-tools/data-analysis-tools.ts:1-40`), computing a bootstrap-CI descriptive summary on a single site's tonnage. Registered at `brain-tools/index.ts:159,483`.
- Wired to UI: `services/api-gateway/src/routes/analytics.router.ts:58-81` produces live KPI tiles + a Vega-Lite bar from real Drizzle aggregations.
- **Missing:** the brain has NO general "describe this column / this table" tool; the 30+ statistical primitives are reachable only through the one hard-coded site-performance path. There is no generic `data.describe(entity, metric)` brain tool.

### 1b. Diagnostic ("WHY") — **PARTIAL**
- Diagnostic substrate exists: correlation matrix, ANOVA, chi-square, `safetyIncidentCorrelation` domain wrapper (`data-analysis/src/domain/mining-stats.ts`), AND the full causal package.
- **Missing wiring:** `@borjie/causal-inference` (the genuine "why" engine — Granger, back-door, diff-in-diff, counterfactual) has **no brain tool and no route**. `find services/api-gateway/src/routes -iname "*causal*"` → empty; grep for `@borjie/causal-inference` in services → only `package.json`. The MD cannot today answer "did the royalty change *cause* the filing delay?" through any wired path. The capability is shelf-ware.

### 1c. Predictive — **PRESENT**
- `@borjie/forecast-engine` + `conformal-calibration-online` + `calibration-monitor` (built, the prompt confirms live). World-model trajectory forecasters: `world-model/trajectory.ts` (`forecastPropertyTrajectory/forecastTenantArrearsTrajectory/forecastOwnerCashflow`), wired into the kernel (`self-awareness.ts`, `kernel/index.ts`, `kernel/tools/index.ts`). A `forecast.run` brain tool was landed (task #21).
- **Residual:** world-model `state-vectors.ts` still exports real-estate-shaped TYPE names (`PropertyState`, `avgRentMajor`, `conditionScore`, `forecastTenantArrearsTrajectory`) — comments at `state-vectors.ts:13-29` claim "mining vocabulary" but the type surface is unported from LITFIN. Domain-port residual, not a functional gap.

### 1d. Prescriptive — **PARTIAL**
- `@borjie/recommendations` IS wired: `services/api-gateway/src/routes/mining/recommendations.hono.ts:57` imports real content-based + bandit compute.
- Opportunity-scanner (33 rules) and risk-scanner ARE wired as brain tools: `brain-tools/opportunity-scanner-tools.ts:1-40` (`mining.opportunities.scan`), `brain-tools/risk-scanner-tools.ts`.
- **Missing:** no closed-loop "recommend → simulate consequence via world-model → prescribe action" chain; recommendations and world-model are not composed. Prescriptive output is rule/EV-ranked, not optimization/decision-theoretic.

### 1e. Anomaly — **PARTIAL (lib PRESENT, brain-wiring ABSENT)**
- Full detector suite in `packages/anomaly-detection/` (z-score/MAD/iForest/LOF/OC-SVM/autoencoder + ADWIN/KSWIN drift), migration 0070.
- **Missing:** no brain tool, no route imports `@borjie/anomaly-detection` in services (grep → `package.json` only). The proactive-intel loop re-implements 3 anomaly detectors itself (`proactive-intel/src/detectors/`) rather than calling this package, and proactive-intel itself is unwired (see 1g).

### 1f. Cohort / segmentation — **PARTIAL**
- `buyerCohortAnalysis` domain wrapper (`data-analysis/src/domain/mining-stats.ts`) + memory-v2 `cohort-cache/` store + `recommendations` segmentation primitives exist.
- **Missing:** no generic cohort/segmentation brain tool; only the one buyer-cohort wrapper, and it is not exposed as a brain tool.

### 1g. Automated insight generation (unprompted, via "standing-drives") — **ABSENT (as wired) / PARTIAL (as built)**
- The intended engine exists: `packages/proactive-intel/` (tick scheduler with 3 cadence tiers, anomaly + opportunity detectors, recommendation composer that emits an ag-ui part, fatigue-policy ratchet). `src/index.ts:1-60`.
- **Hard finding:** proactive-intel is **NOT wired** — `grep -rln "@borjie/proactive-intel" services/api-gateway/src` → **empty**. Its own header admits 4 of 7 anomaly detectors, all opportunity detectors, and the notification adapter are DEFERRED.
- There is **no "standing-drive" construct** in the codebase (grep `standing.drive|standingDrive|autoInsight|surfaceInsight` → only an unrelated KMS hit). The prompt's premise that insights surface "unprompted via standing-drives" is **aspirational, not built**. The closest live unprompted surface is the per-turn `mining.opportunities.scan` tool the owner-home prompt may call — but that fires only inside a chat turn, not on a standing schedule.
- Statistical guardrails: bootstrap CIs and the no-fabrication "no_data" path ARE enforced in `data-analysis-tools.ts`; but there is no global "every surfaced number carries a CI / significance flag" guarantee.

### 1h. Visualization — beautiful AND correct, right-chart, inline-in-chat (INV-H, live lenses INV-B) — **PARTIAL→PRESENT**
- Chart grammar: PRESENT. `@borjie/analytics` exposes Vega-Lite v6 builders (`barChart…sankeyChart`, `VEGA_LITE_V6_SCHEMA`) with a designed palette (`CATEGORICAL/DIVERGING/SEQUENTIAL_PALETTE`). genui `catalog.ts` has 21 zod-validated artifact schemas; `genui/projector.ts:99-115` maps `bar_chart/line_chart` artifacts → `chart-vega` renderer specs; portal-genui `widgets/registry.ts` registers chart_line/chart_bar/chart_donut/kpi_card/table/timeline.
- Right-chart-for-the-question: PRESENT (deterministic + LLM). `analytics/src/ai-chart-author/author.ts:1-50` — NL question + schema → Vega-Lite spec via injected brain, with a deterministic template fallback (`templates.ts pickTemplate`) that ALWAYS returns a renderable spec (Hex-Magic/Tableau-Pulse pattern). Never surfaces a non-renderable chart.
- Inline-in-chat: PARTIAL. The brain persona prompt explicitly instructs inline UI blocks — `public-chat.hono.ts:454,711-731` lists `inline_chart / inline_dashboard / inline_table / metric_strip` as first-class reply forms ("your chat replies are the entire UI for them"). `board-element-parser.ts:87` parses a `chart` element type. owner-web renders genui (`apps/owner-web/src/components/treasury/CommodityTrendPanel.tsx`, `fleet/MinePlannerAdvisorPanel.tsx`).
- **Missing / weak spots:**
  - The signed-out `public-chat` prompt deliberately **suppresses** inline charts pre-signup (`public-chat.hono.ts:458` — "If your impulse is to render a chart… RESIST it"), so the inline-lens behaviour is gated to authenticated cockpit surfaces only.
  - No brain tool ties `ai-chart-author` to live tenant query results inside a chat turn — the chart-authoring is reachable from analytics routes but I found **no SSE/turn path that runs author.ts on a tenant's data and streams the resulting Vega spec inline**. The "live lens spawned from a question" (INV-B) is a prompt instruction, not a verified end-to-end tool path.
  - `md-agentic.hono.ts` emits no genui/chart UiParts (grep → empty), so the agentic MD route is text-only.

---

## 2. INV-J — Capture everything durably · retain · retrieve · always-know

### 2a. Total-capture / event-sourcing — every state change captured? — **PARTIAL (money-only)**
- The transactional outbox is generic by SCHEMA: `outbox.schema.ts` `event_outbox(eventType, aggregateType, aggregateId, payload, sequenceNumber, version, status…)` — a proper event-store shape with retry/dead-letter.
- **Hard finding:** every PRODUCER is on the money/close path. `grep -rln "eventOutbox|event_outbox"` (excluding schema/migration/test) → `services/payments-ledger/*` (ledger.service, drizzle-ledger-entry.repository, event-publisher, outbox-row), `services/api-gateway/src/composition/monthly-close-wiring.ts`, `services/api-gateway/src/services/monthly-close/disbursement-adapter.ts`, `services/api-gateway/src/services/payouts/payouts-worker.ts`. **No non-financial domain (licence change, shift event, KYC state, bid, production-tonnage) writes a domain event to the outbox.** INV-J's "EVERY state change captured, event-sourced, no-drop" is therefore satisfied **only for money**, not org-wide. There is no general `emitDomainEvent()` seam called by domain mutations (the `SPEC_outbox-producer-dualwrite.md` lane is unbuilt for non-money tables).
- Brain-conversation capture: PRESENT and append-only — `brain-thread.repository.ts` writes `thread_events` as an "append-only log" (kinds: user_message/persona_message/tool_call/tool_result/handoff_out/handoff_in). So conversation state IS event-sourced even though business state is not.

### 2b. Total-recall — full thread always reconstructable, or lossy/consolidated-away? — **PRESENT (thread) / PARTIAL (memory)**
- Append-only thread log (`brain-thread.repository.ts` — "append-only status transitions", "append-only log") means the **literal conversation thread is fully reconstructable** — INV-J's "never lose a thread" holds for the transcript itself.
- Semantic memory is, by design, lossy-by-retrieval (not lossy-by-deletion): `cognitive-memory/src/index.ts` `recall` is a top-K semantic search over cells; `memory-v2` has narrative-arc building, reflective consolidation, and a procedural promotion threshold (`PROCEDURAL_PROMOTION_THRESHOLD`). Consolidation SUMMARIZES into narrative/reflective layers but the episodic store and the thread log are retained — so detail is recoverable from episodic+thread even after narrative consolidation. cognitive-memory `contradict` marks rather than deletes (append-only audit). **Net: recall is complete at the thread/episodic layer, summarized (not destroyed) at the narrative layer.**
- **Missing:** there is no single "reconstruct the entire situation for thread X across thread-log + memory cells + domain events" retrieval API; recall is per-store. No GraphRAG-over-thread total-recall path is wired (graph-rag-router is the known KI-graphrag orphan).

### 2c. Lineage / provenance — **PRESENT (AI + memory) / PARTIAL (data)**
- Hash-chained, append-only audit is REAL and used across AI paths: `audit-hash-chain/src/chain.ts` (sha256/HMAC prev-hash, secret rotation, Trillian/Rekor-modelled). Consumers: `cognitive-memory/src/audit/audit-chain-link.ts` ("every operation goes through audit-hash-chain; no out-of-band write path"), `language-sota/src/audit/`, `workflow-engine/src/audit/hash-chain.ts`, `blackboard-intel/src/audit/post-audit-chain.ts`, decision-journal (migration 0116), migration 0309 cognitive_memory_audit_chain.
- Evidence-required output: `data-analysis-tools.ts` stamps each statistic with the concrete `tonnage_event:<id>` row ids + jurisdiction provenance — real ground-truth lineage on analytic results.
- **Missing:** lineage covers AI decisions + memory + money. There is no general data-lineage graph for non-AI domain mutations (which rows produced which derived KPI), because those mutations don't emit events (2a). Provenance is strong where the outbox/audit-chain reach, absent where they don't.

### 2d. Retention / archival — **PARTIAL (built, UNWIRED)**
- `packages/data-protection/src/retention/retention-runner.ts` computes per-class purge sets respecting legal holds + RTBF "retain" markers; `rtbf/rtbf-orchestrator.ts` for right-to-be-forgotten.
- **Hard finding:** `grep -rln "@borjie/data-protection|retention-runner|RetentionRunner" services/api-gateway/src` → **empty**. The retention engine is built but **not wired into any cron/worker** — no scheduled purge runs. "Archive-first / retain" is policy-capable but not operationally enforced. (DP-encryption/PII tasks #18-19 landed, but the retention RUNNER is not scheduled.)

### 2e. Situational awareness — the resident Current Situational Model — **PARTIAL**
- World-model IS wired: `central-intelligence/src/kernel/world-model/` (state-vectors + trajectory + regime detector + `world-model-tool.ts`) is imported by `kernel/self-awareness.ts`, `kernel/index.ts`, `kernel/tools/index.ts`, `introspection/capability-cards.ts`. So the brain has a forward-simulating "where is this heading" faculty.
- Standing brief: `packages/user-context-store/src/situation/standing-brief.ts` exists and IS wired (`services/api-gateway/src/composition/user-context-data-port-adapter.ts`, `routes/ask/advisor-wiring.ts`).
- **Missing pieces vs a true "always-know" Current Situational Model:**
  - world-model state is **forecast-on-demand**, not a continuously-maintained resident model — it's a deterministic linear extrapolator (`world-model/index.ts` header: "linear-extrapolation forecaster that a learned model… can replace later"), invoked per-call, not a standing observed-state vector store updated by every event (which would require 2a's event fabric).
  - `belief-engine` (the epistemic "what do I believe and how confidently" layer, migration 0274) is **NOT wired** in gateway (`grep @borjie/belief-engine services/api-gateway/src` → empty). The situational model has no live belief substrate.
  - No blind-spot/uncertainty-surfacing loop is wired (the `agent-situational-awareness-sota.md` dossier frames this as the open frontier; PROBE-style proactivity caps at 40% even for frontier models — so this is a genuine SOTA gap, not just a Borjie gap).

---

## 3. Per-dimension scorecard

| Dimension | Status | Key evidence | What is missing |
|---|---|---|---|
| Descriptive analysis | PRESENT lib / PARTIAL wired | `data-analysis/src/descriptive/*`; `data-analysis-tools.ts` (1 tool) | generic `data.describe` brain tool over any entity/metric |
| Diagnostic ("WHY") | PARTIAL | correlation/ANOVA in data-analysis; full `causal-inference/` pkg | causal-inference has NO brain tool & NO route — unwired |
| Predictive | PRESENT | forecast-engine; `world-model/trajectory.ts` wired; `forecast.run` tool | state-vector TYPE names still real-estate (`PropertyState`/`avgRentMajor`) |
| Prescriptive | PARTIAL | `recommendations.hono.ts:57`; opportunity/risk scanner tools | no recommend→world-model-simulate→prescribe closed loop |
| Anomaly | PARTIAL | full `anomaly-detection/` pkg + migration 0070 | no brain tool / no route imports it; proactive-intel re-implements 3 |
| Cohort/segmentation | PARTIAL | `buyerCohortAnalysis`; memory-v2 cohort-cache | no generic cohort brain tool |
| Auto-insight (unprompted) | ABSENT wired / PARTIAL built | `proactive-intel/` full loop built | NOT wired (no importer); no "standing-drive" exists; 4/7 detectors + notifier deferred |
| Statistical guardrails | PARTIAL | bootstrap CI + no-fabrication "no_data" in `data-analysis-tools.ts` | no global "every number carries CI/significance" guarantee |
| Visualization (grammar + right-chart + inline) | PARTIAL→PRESENT | analytics Vega-Lite builders; `ai-chart-author/author.ts`; genui `catalog.ts`/`projector.ts:99-115`; portal-genui registry; prompt `public-chat.hono.ts:711-731` | no wired turn-path runs ai-chart-author on live tenant data → inline Vega; md-agentic emits no chart UiParts; pre-signup charts suppressed |
| Total-capture / event-sourcing | PARTIAL (money-only) | generic `event_outbox` schema; producers all in payments/close/payouts; thread log append-only | NO non-financial domain emits events; no general `emitDomainEvent()` seam |
| Total-recall | PRESENT (thread) / PARTIAL (memory) | `brain-thread.repository.ts` append-only thread_events; cognitive-memory append-only contradict | no single cross-store "reconstruct full situation" API; consolidation summarizes narrative layer |
| Lineage / provenance | PRESENT (AI/memory/money) / PARTIAL (data) | `audit-hash-chain/chain.ts`; cognitive-memory + workflow + language-sota audit links; evidence-id stamping | no data-lineage for non-AI domain mutations (they emit no events) |
| Retention / archival | PARTIAL (built, UNWIRED) | `data-protection/src/retention/retention-runner.ts`, `rtbf-orchestrator.ts` | not scheduled in any cron/worker — no live purge |
| Situational awareness (Current Situational Model) | PARTIAL | `world-model/` wired into kernel; `standing-brief.ts` wired | forecast-on-demand not resident; belief-engine UNWIRED; no blind-spot/uncertainty loop |

---

## 4. BossNyumba parity (`Cursor Projects/BOSSNYUMBA101`)

BN is the same brain over a narrower data foundation. **Borjie's analytical libraries are AHEAD of BN's** — several Borjie packages have no BN counterpart.

| Dimension | BN status | Evidence |
|---|---|---|
| Analytics (semantic + Vega builders + ai-chart-author + dashboards) | PRESENT (parity) | BN `packages/analytics/src/` mirrors Borjie exactly (ai-chart-author/charts/dashboards/parsers/semantic/streaming) |
| Descriptive/inferential statistics lib | **ABSENT in BN** | BN has NO `data-analysis` package |
| Causal inference | **ABSENT in BN** | no `causal-inference` package |
| Anomaly detection | **ABSENT in BN** | no `anomaly-detection` package |
| Recommendations / graph-viz / cognitive-memory | **ABSENT in BN** | none of these packages exist in BN |
| Visualization (genui + portal-genui) | PRESENT (parity) | BN has `genui` + `portal-genui` |
| World-model / state-vectors / trajectory | PRESENT (parity) | BN `packages/central-intelligence/src/kernel/world-model/` identical shape (index/regime-detector/state-vectors/trajectory/world-model-tool) — note Borjie's state-vector RE-named types are literally inherited from BN |
| Belief-engine | PRESENT package (wiring not audited) | BN `packages/belief-engine` |
| Proactive-intel | PRESENT package, same deferral risk | BN `packages/proactive-intel` |
| Memory-v2 | PRESENT (parity) | BN `packages/memory-v2` |
| Audit hash-chain | PRESENT (parity) | BN `packages/audit-hash-chain` |
| Outbox / event store | PARTIAL — same money-only shape | BN `packages/database/src/schemas/outbox.schema.ts` + migration `0014_outbox_and_intelligence.sql` |
| Data-protection / retention | **ABSENT in BN** | no `data-protection` package in BN |

**Parity reading:** the diagnostic/causal/anomaly/cohort/statistics depth is a **Borjie-only asset** (BN would need these ported back). The shared gaps (auto-insight unwired, money-only event capture, belief-engine wiring) are **inherited from the common brain/LITFIN lineage** and affect both products. Borjie's `data-protection` retention engine is a Borjie-only asset BN lacks entirely.

---

## 5. Closure priorities (highest leverage, smallest surface)

1. **Wire the analytic libraries to the brain as tools** (causal-inference, anomaly-detection, generic `data.describe`/cohort) — the compute is built; it needs `brain-tools/*.ts` wrappers + persona gating, mirroring `data-analysis-tools.ts`. Unblocks diagnostic + anomaly + cohort in one wave.
2. **Wire `@borjie/proactive-intel` + add a standing scheduler** so insights surface unprompted (the "standing-drive" the prompt assumes). Re-point its detectors at `@borjie/anomaly-detection` instead of re-implementing.
3. **Build the non-money domain-event seam** (`SPEC_outbox-producer-dualwrite.md`) so licence/shift/KYC/bid/tonnage mutations emit events → true org-wide capture + data lineage (closes the largest INV-J gap).
4. **Schedule `data-protection/retention-runner`** in a worker (currently dark) → operational retention/archival.
5. **Wire an inline-chart turn-path** that runs `ai-chart-author` on live tenant query results and streams the Vega spec as a genui UiPart inside the chat turn → INV-H/INV-B live lenses end-to-end (today it's a prompt instruction + offline authoring, not a verified pipe).
6. **Wire `belief-engine`** + make the world-model resident (event-fed) → a continuously-maintained Current Situational Model rather than forecast-on-demand.
7. **Port mining vocabulary into world-model `state-vectors.ts`** type surface (cosmetic/correctness residual from LITFIN).
