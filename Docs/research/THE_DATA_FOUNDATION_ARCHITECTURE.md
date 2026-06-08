# THE DATA FOUNDATION ARCHITECTURE

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Scope:** the unified data-foundation architecture for Mr. Mwikila — the brain layer inside Borjie (mining estate OS) and BossNyumba (real-estate OS, same brain, only the domain layer differs).
**Mandate:** synthesize INV-I (the MD is a PhD-grade data scientist) + INV-J (lossless total capture / total recall / complete observability) into ONE coherent foundation, with PRESENT / PARTIAL / ABSENT file evidence and the exact wiring to extend our existing organs into the full system.
**Source dossiers:** `data-analytical-intelligence.md`, `data-viz-sota.md`, `data-total-capture-recall.md`, `data-foundation-code-audit.md`, `frontier-unified-surfaces.md`, and `MASTER_GAP_REGISTER.md` (INV-I/INV-J rows).
**Bar:** SOTA, best-in-the-world, PhD/MIT.

---

## 0. The thesis in one paragraph

A world-class estate data foundation is **one append-only event-sourced spine** feeding **four read-organs** (memory, bi-temporal knowledge graph, lineage graph, the resident situational model) that an **autonomous estate data-scientist** queries — never raw SQL, always through a **governed semantic layer == lens** — to run the full **descriptive → diagnostic → predictive → prescriptive** ladder, guarded by a **statistical-rigor gate** that abstains rather than narrate confident nonsense, and rendered as a **beautiful-AND-correct inline lens** (right chart, faithful, drill-down-able, evidence-cited) that the user can drill, refine, and that the system can surface unprompted. The remarkable repo finding (`data-foundation-code-audit.md`): **we already own world-class parts for every layer.** The gap is almost entirely **wiring and automation**, not capability — the analytic libraries are built-but-dark, the capture spine is money-only, the memory/lineage/situational organs are built-but-unwired, and the viz layer renders views without grounding selection, proving faithfulness, or going interactive. This document is the architecture that binds them into one foundation, identical for both products.

---

## 1. The four pillars and how they compose

```
                            ┌──────────────────────────────────────────────┐
  every consequential write │   (A) TOTAL-CAPTURE SUBSTRATE  (INV-J)        │
  (ledger/licence/assay/KYC/│   transactional outbox · EstateEvent ·        │
   bid/tonnage/doc/decision/│   co-commit · append-only · CDC/WAL relay     │
   turn/sensor/FX/UI) ──────┤   at-least-once + idempotent inbox            │
                            └───────────────┬──────────────────────────────┘
                                            │  losslessly fans to ↓
        ┌──────────────────┬────────────────┼──────────────────┬──────────────────┐
        ▼                  ▼                ▼                  ▼                  ▼
   EVENT STORE        MEMORY (2-plane)  BI-TEMPORAL KG     LINEAGE GRAPH    CURRENT SITUATIONAL
   fold→any past      verbatim Plane A  facts w/ validity  PROV + OpenLineage   MODEL (resident,
   state at time t    + consolidated B  (supersede≠delete) per decision/      read first each turn)
                      w/ source_event_id  point-in-time     transform
        └──────────────────┴────────────────┴──────────────────┴──────────────────┘
                                            ▼
                      (D) TOTAL-RECALL: graph-rag-router  — vector + BM25 + graph
                      + temporal + event-log → reranked, traceable, time-aware
                                            ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │   (B) ANALYTICAL-INTELLIGENCE ENGINE  (INV-I)                                │
   │   arbiter: run_modality=ANALYZE → PLAN(question-tree D→D→P→P, SMART)         │
   │   GROUND(semantic-layer==lens, tenant-scoped) → COMPUTE(data-analysis/       │
   │   forecast/causal/anomaly as TOOLS) → WHY-router(DML/IV/DiD/synthetic+refute)│
   │   → STAT-RIGOR GUARD(Simpson/BH/pre-reg/name-strip → pass|ABSTAIN)           │
   │   → PREDICT(forecast+conformal) → PRESCRIBE(LP/MIP→solver→ΔY,CI)             │
   │   → VERIFY(LLM-judge + Auditor evidence ≥1 id)                               │
   └────────────────────────────────────────────────┬───────────────────────────┘
                                                     ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │   (C) SOTA VIZ LAYER  (INV-H inline · INV-B live lens)                       │
   │   L1 grounded selection (Draco/Mackinlay + rationale) → L2 encoding →        │
   │   L3 FAITHFULNESS GATE (axis honesty, no area-for-quantity, mark→evidence_id)│
   │   → L4 perceptual post-pass (WSR/legibility/saliency) → L5 delivery          │
   │   (Vega-Lite inline, atomic render, selections→chat-event bus, annotated,    │
   │    a11y) ── every chart ships why-this-chart + why-it's-faithful             │
   └────────────────────────────────────────────────────────────────────────────┘
```

**Invariant chain (no link may silently lose data or narrate a falsehood):** capture (A) → never-drop → consolidate-without-loss → time-travel → trace → always-aware → recall-anything → analyze-rigorously (B) → render-faithfully (C). Every read-organ is an immutable, append-only **projection of the same source events** — so any past state, thread, or decision is a deterministic reconstruction, and every analytical claim is attributable back to ground truth.

**The keystone dependencies** (from `MASTER_GAP_REGISTER.md`): the analytical engine lands as a `run_modality: ANALYZE` decision on the **modality-arbiter (COG-07/AUT-14)** — the keystone everything in Wave B/D lands on; the capture spine's durable producer is the **outbox money-path (RSS-01)**; the situational model and the lens engine depend on the **event fabric (G2)** and the **system-graph body-model (EA-01)**.

---

## 2. PILLAR A — The lossless TOTAL-CAPTURE substrate (INV-J)

### 2.1 What "world-class" is (June 2026)
The textbook reliable-events baseline is the **transactional outbox**: co-commit a domain event into an `outbox` table **inside the same DB transaction** as the business write, so a crash can never leave "state changed but event lost." The 2026 refinement is **CDC-first** — Debezium tails Postgres logical decoding (or `pg_logical_emit_message` straight into the WAL) and replaces the bespoke relay, giving the *database-is-the-event-bus* property. The delivery contract is **at-least-once + idempotent inbox** (UNIQUE on event-id, dedup at the DB boundary), never exactly-once. **Event sourcing** makes the event *the state* (current state = a fold over events), enabling point-in-time reconstruction; **saga + compensation** handle cross-aggregate consistency. (`data-total-capture-recall.md` §1.)

### 2.2 The leap
Make the **outbox the single capture chokepoint for the whole estate, not just money** — every consequential write co-commits an immutable
`EstateEvent{tenant, aggregate, type, payload, t_occurred, causation_id, correlation_id, source}` in the *same* transaction. A CDC/WAL relay (eliminating the in-process drainer's drop window) fans these to the bus, the memory consolidator, the KG ingest, the lineage emitter, and the world-model. **The estate becomes event-sourced by construction:** any past estate state at time *t* is a deterministic fold of the log up to *t*. Durable execution (Temporal/DBOS-class) wraps every long loop; its replayable journal is itself a capture stream and doubles as operational memory (INV-G uncapped horizon).

### 2.3 Our substrate — PRESENT / PARTIAL / ABSENT

| Element | Status | Evidence | Note |
|---|---|---|---|
| Generic event-store schema | **PRESENT** | `packages/database/src/schemas/outbox.schema.ts` (`event_outbox`: eventType/aggregateType/aggregateId/payload/sequenceNumber/version/status + retry/DLQ) | Proper event-store shape exists. |
| Durable producer dual-write | **PARTIAL** | `services/payments-ledger/src/server.ts:316` historically `InMemoryEventPublisher`; `drizzle-outbox.repository.ts` now present (RSS-01 closure landing) | Money-path durable enqueue is the only durable producer. |
| Estate-wide producers (non-money) | **ABSENT** | producers grep = `payments-ledger/*`, `monthly-close-wiring.ts`, `monthly-close/disbursement-adapter.ts`, `payouts-worker.ts`, `owner/superpowers-dispatchers.ts` only | **No licence/assay/KYC/bid/tonnage/doc/turn/sensor/FX/UI mutation emits a domain event.** Capture is money-only. |
| `emitDomainEvent()` seam | **ABSENT** | no general seam called by domain mutations (`SPEC_outbox-producer-dualwrite.md` unbuilt for non-money tables) | The single largest INV-J gap. |
| Idempotent inbox (`inbox`, UNIQUE event-id) | **ABSENT** | hard rule says consumers idempotent, but no first-class inbox table | Needed for at-least-once dedup. |
| CDC/WAL relay | **ABSENT** | drainer publishes on in-process bus, no leader election (RSS-02) | Drop window + N-replica fan-out. |
| Append-only conversation capture | **PRESENT** | `packages/database/src/repositories/brain-thread.repository.ts` (`thread_events` append-only: user_message/persona_message/tool_call/tool_result/handoff) | Conversation thread IS event-sourced even though business state is not. |
| Durable execution | **PARTIAL** | `services/api-gateway/src/composition/durable/*` (Temporal files + Inngest opt-in) | No worker deployed (RSS-23); journal not used as capture. |

### 2.4 Exact wiring
1. **Land the durable producer (RSS-01):** swap `InMemoryEventPublisher` → `DurableEventPublisher.enqueueToOutbox(events, tx)` co-commit + the Drizzle `IOutboxRepository` already at `drizzle-outbox.repository.ts`; leader-elect the drainer (RSS-02 + cluster-lock RSS-06).
2. **Build the `emitDomainEvent()` seam (G2):** one helper that domain mutations call inside their transaction. Wire it at the licence/assay/KYC/bid/tonnage/document/turn/sensor/FX/UI write sites → one lossless capture spine.
3. **Idempotent inbox (G3):** `inbox(event_id UNIQUE, processed_at, outcome)` table; consumers dedup at the DB boundary and commit the outcome atomically.
4. **CDC/WAL relay (§1.2 leap):** Debezium tail of `event_outbox` (or `pg_logical_emit_message`) replacing the in-process drainer's drop window.
5. **Durable journal as capture (RSS-23, §2 leap):** deploy the durable worker; DBOS-class co-located journal so durable history and the event store live in one ACID universe.

---

## 3. PILLAR B — The analytical-intelligence engine (INV-I)

### 3.1 What "world-class" is (June 2026)
The frontier has converged on an **agentic estate data-scientist**: DS-STAR's **Planner→Coder→Verifier→Router** loop with an **LLM-judge sufficiency gate** (note SOTA on hard DS benchmarks is still only ~38–45% — verification + grounding matter more than raw model). InsightBench/AgentPoirot prove the ladder is a generated **question-tree (3 roots × 5)**, each insight tagged **Descriptive/Diagnostic/Predictive/Prescriptive**, judged for actionability — and **SMART goals beat generic by ~20 pts**. A **governed semantic layer** lifts NL-analytics accuracy from ~40% (raw text-to-SQL) to ~83–95% — the single biggest reliability lever. **Causal-Copilot** routes a NL "why" to the right estimator (DML/IV/DiD/matching) and refutes. **BARO** runs multivariate Bayesian online change-point detection → RobustScorer root-cause ranking. **CausalPitfalls** is the alarm bell: the best LLM scores ~45% on statistical traps, flips conclusions on a *renamed* variable, and confounds random noise — **code-assisted beats pure reasoning**, so run real statistics, never "reason" a number. Prescriptive is the immature frontier: SOTA wraps the **LLM as a planning layer around an optimization solver** (formulate LP/MIP → OR-Tools → narrate), not as the optimizer. (`data-analytical-intelligence.md` §1–3.)

### 3.2 The ladder, grounded and guarded (target flow)
```
owner asks (or a standing-drive fires) → arbiter: run_modality = ANALYZE
  PLAN     question-tree (D→D→P→P), tagged + SMART-goaled (from the Motivational Subsystem)
  GROUND   every step compiles through the semantic layer (metric==lens), tenant-scoped
  COMPUTE  Coder calls @borjie/data-analysis / forecast-engine / causal-inference as TOOLS
           (code-assisted, never "reasoned numbers")
  WHY      WHY-router auto-selects DML/IV/DiD/synthetic-control, then REFUTES (placebo/E-value) as a HARD gate
  GUARD    Statistical-Rigor Guard: Simpson subgroup re-check · BH/Bonferroni · pre-registered
           subgroups · name-stripped causal call → pass or ABSTAIN
  PREDICT  forecast-engine + conformal interval (beats-the-floor or rejected)
  PRESCRIBE formulate LP/MIP → solver → "do X, ΔY, 90% CI [a,b]" via prepare→ask→execute
  VERIFY   LLM-judge sufficiency (DS-STAR) + Auditor evidence-chain (≥1 evidence_id)
  NARRATE  inline live lens + "what/why/so-what" prose, EN/SW-pure, cited
  CLOSE    proactive sink if unprompted; durable capture (INV-J); APPEND, never replace
```

### 3.3 Our substrate — PRESENT / PARTIAL / ABSENT

| Rung | Status | Evidence | Gap |
|---|---|---|---|
| Descriptive (lib) | **PRESENT** | `packages/data-analysis/src/index.ts:38-120` (mean…kurtosis, t/Welch/ANOVA/chi²/Mann-Whitney/Kruskal-Wallis, OLS/logistic/poly, Pearson/Spearman/Kendall, kmeans/DBSCAN/hier, PCA/UMAP, bootstrap, domain wrappers) | Wired to brain by ONE hard-coded tool only (`brain-tools/data-analysis-tools.ts` → site-performance); no generic `data.describe(entity, metric)`. |
| Diagnostic / WHY | **PARTIAL** | `packages/causal-inference/src/index.ts:1-90` (Granger, PCMCI+, back-door/front-door, DiD, synthetic control, RDD, twin-network counterfactual, placebo/E-value refute) | **DARK** — 0 gateway imports; no brain tool, no route. MD cannot answer "did the royalty change *cause* the filing delay?" through any wired path. |
| Predictive | **PRESENT** | `@borjie/forecast-engine` (4 gateway imports), `conformal-calibration-online`, `world-model/trajectory.ts`, `forecast.run` tool | Residual: `world-model/state-vectors.ts` still exports RE-shaped type names (`PropertyState`/`avgRentMajor`). |
| Prescriptive | **PARTIAL** | `routes/mining/recommendations.hono.ts:57` (content-based + bandit); `brain-tools/opportunity-scanner-tools.ts` (33 rules), `risk-scanner-tools.ts` | No recommend→world-model-simulate→prescribe closed loop; no LP/MIP-over-solver bridge. |
| Anomaly | **PARTIAL** | `packages/anomaly-detection/src/index.ts:1-60` (z/MAD/iForest/LOF/OC-SVM/AE + ADWIN/KSWIN/Page-Hinkley), migration 0070 | **DARK** — no brain tool / no route import; proactive-intel re-implements 3 detectors itself. No BARO-style change-point→root-cause sensor. |
| Cohort / segmentation | **PARTIAL** | `buyerCohortAnalysis` wrapper, memory-v2 `cohort-cache/`, `recommendations` segmentation | No generic cohort/funnel/uplift brain tool. |
| Auto-insight (unprompted) | **ABSENT (wired) / PARTIAL (built)** | `packages/proactive-intel/src/index.ts` (tick scheduler, anomaly/opportunity detectors, composer, fatigue policy) | **NOT wired** (0 gateway importers); no "standing-drive" construct exists; 4/7 detectors + notifier deferred. |
| Statistical guardrails | **PARTIAL** | bootstrap CI + no-fabrication `no_data` path in `data-analysis-tools.ts` | No global "every number carries a CI/significance flag"; no Simpson/BH/pre-registration/name-strip guard. |
| Semantic layer | **PRESENT** | `packages/analytics/src/semantic/` (`define.ts`/`compile.ts`/`evaluate-memory.ts` — `defineMetric/defineDimension/defineCube/compileQuery`, tenant-scoped by construction) | Not the *mandatory* analysis path; not fused with the lens engine. |

### 3.4 Exact wiring
1. **Un-dark the three libraries** (highest leverage, smallest surface — `data-foundation-code-audit.md` §5.1): add `brain-tools/causal-inference-tools.ts`, `brain-tools/anomaly-tools.ts`, and a generic `brain-tools/describe-tools.ts` (+ cohort) mirroring `data-analysis-tools.ts`; gate by persona. Unblocks diagnostic + anomaly + cohort in one wave.
2. **WHY-router + hard refute gate** behind the causal tool (Causal-Copilot pattern): auto-select back-door/front-door/DiD/synthetic-control from the org-graph's known confounders; the refute step (placebo/E-value) is a hard gate, not an option.
3. **Statistical-Rigor Guard middleware** every analytical claim must pass: Simpson subgroup re-check across candidate confounder subgroups, BH/Bonferroni for multiple comparisons, pre-registered subgroups (anti-p-hacking/HARKing), name-stripping before the causal call (defeat semantic manipulation). **Failure → abstain** (reuse conformal-abstention + the Auditor evidence gate).
4. **Make the semantic layer the only analysis path** (the 40%→83% lever): route ALL analytical queries through `compileQuery`; fuse `metric == lens` so every answer is an inline drill-down lens (Pillar C + INV-B). The agent literally cannot compute an ungoverned number.
5. **Estate-data-scientist orchestrator** (DS-STAR): a `kernel`-bound Planner→Coder→Verifier→Router loop whose Coder emits semantic-layer queries + `data-analysis` tool-calls, with an LLM-judge sufficiency Verifier, landing as `run_modality: ANALYZE` on the modality-arbiter (COG-07).
6. **Wire `@borjie/proactive-intel` + a standing scheduler** (the "standing-drive"): re-point its detectors at `@borjie/anomaly-detection`; the SMART goals from the Motivational Subsystem seed the question-tree each sleep cycle so insights arrive pre-prioritized and cited.
7. **BARO change-point/root-cause standing sensor** on the estate metric bus (depends EA-07 event-stream subscriber): a change-point auto-triggers a diagnostic+causal investigation → proactive sink.
8. **Prescriptive bridge:** OR-Tools/HiGHS port; juniors' objective functions (NPV/cutoff-grade/LOM/fleet-match/FX-hedge) → formulate→solve→narrate with the conformal CI as the confidence — best-in-world on the rung everyone is weakest on.

---

## 4. PILLAR C — The SOTA viz layer (INV-H inline · INV-B live lens)

### 4.1 What "world-class" is (June 2026) — five stacked decisions
- **L1 Selection** — grounded, not vibed: Mackinlay APT effectiveness ranking + **Draco 2** hard/soft constraints in ASP re-rank the LLM's candidates; emit a one-line *rationale* ("ranked bar over pie: 9 categories exceed the 6-slice angle limit"). No product explains its chart choice.
- **L2 Encoding** — effectiveness ordering `position > length > angle > area > colour` by data type.
- **L3 Correctness** — structural validity ≠ faithfulness. **ChartAttack** shows structurally-valid charts can mislead (truncated y-axis, dual-axis illusions, area-for-quantity); the defense is an explicit **anti-misleader rule set** + **mark→source-row attribution** (faithfulness = attributability).
- **L4 Aesthetic** — optimizable, not vibes: **ChartOptimiser** Bayesian-optimizes white-space/colour/saliency/legibility against a perceptual objective (3–6s/chart, beats LLM-only).
- **L5 Delivery** — inline-in-chat (atomic render on complete payload, never piece-by-piece), interactive (Vega-Lite **selections** = the native OLAP roll-up/drill-down/slice/dice/pivot mechanism), annotated narrative (Analyzer→Presenter), accessible (WCAG 2.2 AA: multi-channel encoding, Wong/Viridis CVD-safe palette, data-table fallback). (`data-viz-sota.md` §1–5.)

### 4.2 The leap
A **Faithfulness Gate** runs after spec generation, before render — axis honesty (bar/area include zero unless justified, truncation flagged in subtitle), encoding honesty (no area-for-quantity, no rogue dual-axis), and **aggregation faithfulness** (every aggregated mark carries an `evidence_id` chain back to source rows; the **Auditor Agent, which already rejects empty evidence chains, is extended to reject charts whose marks don't attribute**). This makes "the chart cannot lie" a hard invariant, not a hope. Then Vega-Lite selections feed a **chat-aware event bus**: a click on a mark emits `{lens_id, selection, predicate}` back into the conversation, so the MD reacts to a chart interaction *as a turn* — the chart becomes a bidirectional control surface (the literal INV-B "live lens"). And an **Analyzer→Presenter loop wired to the standing-drives** surfaces *annotated* charts unprompted, the annotation carrying an `evidence_id` — unifying INV-I (auto-insight) + INV-H (inline) + INV-J (provenance) in one artifact.

### 4.3 Our substrate — PRESENT / PARTIAL / ABSENT

| Layer | Status | Evidence | Gap |
|---|---|---|---|
| Chart grammar | **PRESENT** | `packages/analytics` Vega-Lite v6 builders (`barChart…sankeyChart`, `VEGA_LITE_V6_SCHEMA`); genui `catalog.ts` (21 zod artifacts); `graph-viz` (ECharts/Cytoscape/Sigma/ReactFlow/Sankey + OKLCH theme); bespoke SVG `TimeSeriesWithForecast` (conformal-band) | Multi-substrate posture correct but not formalized as a router. |
| Right-chart selection | **PARTIAL** | `analytics/src/ai-chart-author/author.ts:1-50` (NL+schema→Vega via injected brain, deterministic `pickTemplate` fallback that always renders) | **LLM-vibes only** — no Draco/Mackinlay constraint re-rank, no rationale. |
| Correctness / faithfulness | **ABSENT** | `VegaChart` ajv-validates + strips `expr`/`signal` (security) | Structural only — no anti-misleader rules, no mark→`evidence_id` attribution, no rendered-output validation. |
| Aesthetic | **PARTIAL** | `oklch-brand-theme` (perceptually-uniform OKLCH) | Static theme — no WSR/legibility/saliency optimization. |
| Inline-in-chat | **PARTIAL→PRESENT** | persona prompt lists `inline_chart/inline_dashboard/inline_table/metric_strip` as first-class replies (`public-chat.hono.ts:454,711-731`); `board-element-parser.ts:87` parses `chart`; owner-web renders genui | **No wired turn-path runs `ai-chart-author` on live tenant data → streams Vega inline** (prompt instruction, not a verified pipe); `md-agentic.hono.ts` emits no chart UiParts; pre-signup charts suppressed (`public-chat.hono.ts:458`). |
| Interactivity (drill-down) | **ABSENT** | charts render `actions={false}`, no selections | Biggest INV-B gap — charts are pictures, not live lenses; no chat-aware event bus. |
| Insight / annotation | **PARTIAL** | narration is separate prose | No Analyzer→Presenter loop; no insight scored + annotated *on the mark* with evidence; not surfaced unprompted. |
| Accessibility | **PARTIAL** | `role="img"`/`<title>`/`<desc>` on bespoke SVG | Vega renders opaque canvas; no CVD-proven palette guarantee; no data-table fallback; no keyboard a11y. |

### 4.4 Exact wiring (build order, lowest-risk → highest-leverage)
1. **Faithfulness Gate** first — a pure function over the Vega-Lite spec + data profile; reuses the Auditor/evidence chain (highest trust-per-effort).
2. **Grounded selector** — embed Draco2 (or a hand-port of its core soft constraints) as a re-ranker behind the existing LLM proposal in `ai-chart-author/author.ts`; emit the one-line rationale.
3. **Interactivity bus** — wire Vega-Lite `params`/selections to the chat-aware event bus → drill-down as a chat turn (the single most visible "wow", unlocks INV-B live-lenses).
4. **Analyzer→Presenter + annotation** — wire into the standing-drives so annotated charts surface unprompted (Pillar B auto-insight).
5. **Perceptual post-pass + accessibility** — WSR/legibility/saliency nudges (<50ms, deterministic, explainable) + Wong/Viridis palette + SVG+`<desc>` + data-table sibling.
6. **Inline-chart turn-path** — a brain tool that runs `ai-chart-author` on live tenant query results (via the semantic layer) and streams the validated Vega spec as a genui UiPart inside the chat turn (closes the INV-H/INV-B end-to-end pipe).

---

## 5. PILLAR D — The TOTAL-RECALL layer (INV-J) — memory · lineage · situational model · retrieval-of-anything

### 5.1 What "world-class" is (June 2026)
- **Memory is a first-class component, not a longer prompt.** "Storage is not memory" — a database returns what was written; a memory returns what is *reconstructed at recall*. **Retrieval-centered, verbatim-preserving** beats extraction-on-ingest (it discards the source). The four competencies (accurate retrieval / test-time learning / long-range understanding / **selective forgetting**) — **no system masters all four; most fail selective forgetting.** Resolution: bi-temporal validity (invalidate, never delete). mem0 production numbers: LoCoMo 92.5 / BEAM-1M 64.1; tiers episodic/semantic/procedural; async-first writes + reranker; **actor-aware storage** separates "what the user said" from "what the agent inferred." (`data-total-capture-recall.md` §3.)
- **Lineage = the trust signal for explainable AI.** **W3C PROV** (Entity/Activity/Agent — *meaning*) + **OpenLineage** (datasets/jobs/runs + facets — *runtime collection*) compose. Provenance (origin/authenticity) ≠ lineage (flow); a complete system needs both. (`data-total-capture-recall.md` §4.)
- **Point-in-time = bi-temporal KG.** Zep v2 + Graphiti: two time axes (`t_valid`/`t_invalid` + ingested-at), every edge a validity window, **supersede never overwrite** — answer "what did we believe on date D?" *and* "what's true now?" Temporal-KG memory beats vector memory on agent benchmarks. (`data-total-capture-recall.md` §5.)
- **Situational awareness = a resident world-model** the agent reads first, updated Kalman-style (predicted vs observed); the **blackboard** is the shared substrate. (`data-total-capture-recall.md` §6.)
- **Retrieval-of-anything = hybrid GraphRAG** — dense vectors + sparse BM25 + graph traversal + temporal validity, fused and reranked; **retrieval, not storage, is the differentiator.** (`data-total-capture-recall.md` §7.)
- **Retention = archive-first, WORM/legal-hold, erase-by-crypto-shred** — never silent loss. (`data-total-capture-recall.md` §8.)

### 5.2 The leaps
- **Two-plane memory:** Plane A = immutable verbatim (every turn/document/event, append-only, never summarized-away — thread always reconstructable token-for-token); Plane B = consolidated recall (memory-v2 tiers + cognitive-memory cells holding *derived* facts, each with a `source_event_id` back-pointer and a bi-temporal validity). Consolidation **enriches without destroying**: a stale fact is `t_invalid`-marked, source retained — we forget by **superseding**, never deleting.
- **Every decision a PROV graph, every dataset an OpenLineage run:** the audit hash-chain already gives tamper-evident decision lineage; bind a W3C-PROV emitter so each decision materializes `Activity(think) ⟵ used ⟵ Entity(evidence_id…) ⟵ wasAttributedTo ⟵ Agent(junior)`, and render lineage as a live lens ("why do you believe X?").
- **Resident Current Situational Model (CSM):** a continuous world-model projected from the event log, updated on every outbox event, read first each turn — cash, open loops, licence clocks, shipments, KYC queue, FX, blind-spots — never recomputed from scratch, never lost.
- **Un-orphan `graph-rag-router`** as the single recall plane fusing vector + BM25 + graph + temporal + event-log, reranked and traceable.
- **Per-event-class retention engine** → WORM/Object-Lock + legal-hold + crypto-shred erasure; even erased data leaves a lineage skeleton.

### 5.3 Our substrate — PRESENT / PARTIAL / ABSENT

| Element | Status | Evidence | Gap |
|---|---|---|---|
| Memory tiers (durable) | **PARTIAL→PRESENT** | `packages/memory-v2` (6 layers + Drizzle stores landed, tasks #5–8); `packages/cognitive-memory` (observe/recall, `observe()` writer wired #6, real consolidator #7) | Verify restart-persistence on integration; no two-plane verbatim/consolidated split with `source_event_id` back-pointer yet. |
| Total-recall (thread) | **PRESENT** | `brain-thread.repository.ts` append-only `thread_events` | Literal conversation thread fully reconstructable. |
| Total-recall (memory) | **PARTIAL** | cognitive-memory `recall` top-K; memory-v2 narrative/reflective consolidation; `contradict` marks not deletes | No single cross-store "reconstruct full situation for thread X" API. |
| Bi-temporal + PROV-O | **PARTIAL** | `packages/knowledge-graph/src/temporal/bi-temporal.ts`, `provenance/prov-o.ts` (built) | **Unused by ingest** (MEM-07) — facts overwrite, no point-in-time, no validity window. |
| Lineage (AI/memory/money) | **PRESENT** | `audit-hash-chain/src/chain.ts` (sha256/HMAC prev-hash); consumers in cognitive-memory/workflow/language-sota/blackboard-intel; `data-analysis-tools.ts` stamps `tonnage_event:<id>` | Strong where outbox/audit-chain reach. |
| Lineage (non-AI data) | **PARTIAL** | — | No data-lineage graph for non-AI domain mutations (they emit no events — see Pillar A); no W3C-PROV / OpenLineage emission. |
| graph-rag-router (hybrid retrieval) | **ABSENT (wired)** | importers = `database/schemas/index.ts` + unwired `sleep-pass-orchestrator/passes/graph-rag-community-summaries.ts` only | **Orphan** (KI-graphrag) — reached by no request path. No retrieval-of-anything. |
| Current Situational Model | **PARTIAL** | `world-model/` wired into kernel (`self-awareness.ts`, `kernel/index.ts`, `kernel/tools/index.ts`); `user-context-store/situation/standing-brief.ts` wired | World-model is forecast-on-demand (linear extrapolator), not resident/event-fed; `belief-engine` UNWIRED in gateway; no six-facet `SituationalSelfModel` (COG-15); no blind-spot loop. |
| Retention / RTBF | **PARTIAL (built, UNWIRED)** | `data-protection/src/retention/retention-runner.ts`, `rtbf/rtbf-orchestrator.ts` | Not scheduled in any cron/worker — no live purge; no per-event-class WORM/legal-hold routing. |
| Durable execution journal | **PARTIAL** | `composition/durable/*` | No worker deployed (RSS-23); journal not used as capture. |

### 5.4 Exact wiring
1. **Two-plane memory (G4/G5):** keep the append-only thread/episodic store as Plane A (never summarized-away); add a `source_event_id` back-pointer + bi-temporal validity to memory-v2/cognitive-memory cells (Plane B); consolidation enriches, marks `t_invalid`, never deletes.
2. **Wire bi-temporal + PROV-O into ingest (MEM-07/G6):** every estate fact (royalty rate, licence status, assay grade, ownership, FX, role) becomes a bi-temporal edge `(t_valid, t_invalid, ingested_at, source_event_id)`; supersede≠delete → time-travel ("the cap table as we understood it on 2026-03-27").
3. **PROV / OpenLineage emitter (G7):** PROV graph per decision + OpenLineage facets per ingest/transform (corpus→KG→memory→forecast); render lineage as a live lens (Pillar C).
4. **Un-orphan `graph-rag-router` (KI-graphrag/G8):** route chat retrieval through it; fuse pgvector + BM25/`tsvector` (licence-IDs/assay-codes) + org-graph + bi-temporal KG + event-log; rerank; return traceable, time-aware answers.
5. **Resident CSM (COG-15/G9):** six-facet `SituationalSelfModel` (happened/doing/todo/future/blind-spots/caveats) projected from the event log, updated per outbox event, read first each turn; wire `belief-engine`; update Kalman-style via forecast-engine + conformal residuals.
6. **Schedule the retention runner (G11):** wire `data-protection/retention-runner` into a worker; per-event-class WORM/Object-Lock + legal-hold + crypto-shred erasure; lineage skeleton survives erasure (INV-E ∩ INV-J).
7. **Event-fold reconstruction (G12, the flagship):** fold the event store + bi-temporal replay → "reconstruct any past estate state/thread/decision on demand."

---

## 6. The lens — where Pillar B and Pillar C fuse with the org-graph (INV-B)

The semantic layer and the viz layer are not two systems — they are **one lens**. A `LensDefinition` `{ metrics[], dimensions[], hierarchy(roll-up axes), bindingToCoreEntity, plane: 'control'|'data' }` is authored over `core_entity`/`org-graph`, exposed **headless** so owner-web + both mobiles + chat consume one governed definition. **Roll-up and drill-down are one definition evaluated at two points on the dimension hierarchy** (KG-OLAP merge+abstraction / slice+coverage), with the reconciliation invariant `Σ(operation cells) ≡ estate cell` as a renderability gate. (`frontier-unified-surfaces.md` §2–3.)

- **HAVE:** `packages/core-entity` (polymorphic org-graph row-store, `parentEntityId` hierarchy, BM25+dense+geo+JSONB retrieval = the KG-OLAP substrate), `packages/org-graph`, `packages/portal-genui` (intent→view), `packages/dynamic-sections` (tab auto-appears when entity type exists = the auto-expand primitive), `packages/analytics/src/semantic/` (the metric definition layer).
- **LACK (GAP-LENS-1..8):** the `LensDefinition` object; roll-up/drill-down operators over `core_entity`; online re-categorization (self-organizing taxonomy → bodyChange proposal); auto-contract; the headless multi-consumer guarantee; the context-graph back-link on surfaces; INV-A plane-typing; predictive warm-expansion into blackboard slots.
- **Wiring:** build `LensDefinition` + a KG-OLAP operator kernel over `core_entity` (with the reconciliation gate); make `metric == lens` so every analytical answer (Pillar B) renders as a faithful inline lens (Pillar C) the user can drill (the interactivity bus); the arbiter routes "intent → lens → rendered view." Sequencing: GAP-LENS-1/2 are the keystone, depend on EA-01 (system-graph) and pair with COG-07 (a lens is a modality the arbiter lands on); GAP-LENS-3/8 are Wave-D (self-re-categorization + warm expansion via EA-07/EA-05).

---

## 7. One foundation for Borjie AND BossNyumba

Same brain, only the domain layer differs. The capture spine (outbox/inbox/CDC), the memory/lineage/situational/retrieval organs, the analytical ladder, the viz layer, and the lens are **all domain-agnostic** — defined over the abstract `core_entity` + event log. A lens like "exposure roll-up by jurisdiction" serves *royalty exposure across mines* (Borjie) and *rent-arrears exposure across buildings* (BossNyumba) by swapping only the dimension binding.

| Element | Borjie | BossNyumba | Action |
|---|---|---|---|
| analytics (semantic + Vega + ai-chart-author + dashboards) | PRESENT | **PRESENT (parity)** | shared; build the viz gate/selector/bus once, both consume. |
| data-analysis / causal-inference / anomaly-detection / recommendations / cognitive-memory / graph-viz | PRESENT | **ABSENT in BN** | **port these Borjie-only analytical assets back to BN.** |
| world-model / memory-v2 / belief-engine / proactive-intel / audit-hash-chain | PRESENT | PRESENT (parity) | shared wiring; same deferral risk (auto-insight unwired). |
| outbox / event store | PARTIAL (money-only) | PARTIAL (money-only, same shape) | build the `emitDomainEvent()` seam in both. |
| data-protection / retention | PRESENT | **ABSENT in BN** | port retention engine to BN. |

The diagnostic/causal/anomaly/cohort/statistics depth is a **Borjie-only asset BN must inherit**; the shared gaps (auto-insight unwired, money-only capture, belief-engine/graph-rag wiring) come from the common brain lineage and are fixed once for both.

---

## 8. The full-code roadmap (dependency-ordered waves, flag-default-safe)

Every wave ships behind a default-OFF flag; existing rule-based paths remain the default until a wave is verified, honoring "predictions APPEND to rule-based decisions, never replace." **BLOCKER** = gates later waves.

### WAVE 1 — Durable capture spine (the foundation everything compounds on)
- **[BLOCKER] DF-1.1** Land the durable outbox producer (RSS-01): swap `InMemoryEventPublisher` → `DurableEventPublisher.enqueueToOutbox(events, tx)` + Drizzle `IOutboxRepository`; leader-elect the drainer (RSS-02/RSS-06). *Blocks all org-wide capture.*
- **[BLOCKER] DF-1.2** Build the `emitDomainEvent()` seam (G2) + wire it at licence/assay/KYC/bid/tonnage/doc/turn/sensor/FX/UI write sites. *Blocks lineage, CSM, time-travel.*
- **DF-1.3** Idempotent `inbox` table (G3, UNIQUE event-id) + DB-boundary dedup.
- **DF-1.4** CDC/WAL relay (Debezium / `pg_logical_emit_message`) replacing the in-process drop window.
- **DF-1.5** Deploy the durable-execution worker (RSS-23); treat its journal as a capture stream.

### WAVE 2 — Un-dark the analytical libraries + memory persistence
- **[BLOCKER] DF-2.1** Brain-tool wrappers for `causal-inference`, `anomaly-detection`, generic `data.describe` + cohort (mirror `data-analysis-tools.ts`); persona-gate. *Blocks diagnostic/anomaly/cohort + the DS-agent.*
- **DF-2.2** WHY-router + hard refute gate behind the causal tool.
- **[BLOCKER] DF-2.3** Statistical-Rigor Guard middleware (Simpson/BH/pre-reg/name-strip → pass|ABSTAIN), wired to conformal-abstention + Auditor. *Blocks any auto-narrated claim.*
- **DF-2.4** Make the semantic layer the mandatory analysis path (`compileQuery` only); `metric == lens`.
- **DF-2.5** Verify memory-v2/cognitive-memory restart-persistence (tasks #5–8); add two-plane `source_event_id` back-pointer + bi-temporal validity (G4/G5/MEM-07).

### WAVE 3 — The estate data-scientist + the lens (depends modality-arbiter COG-07, EA-01)
- **[BLOCKER] DF-3.1** Estate-data-scientist orchestrator (DS-STAR Planner→Coder→Verifier→Router) landing as `run_modality: ANALYZE`. *Depends COG-07.*
- **DF-3.2** `LensDefinition` + KG-OLAP operator kernel over `core_entity` with the `Σ cells ≡ estate` reconciliation gate (GAP-LENS-1/2). *Depends EA-01.*
- **DF-3.3** Prescriptive bridge (OR-Tools/HiGHS; formulate→solve→narrate w/ conformal CI).
- **DF-3.4** Resident CSM (COG-15/G9): six-facet `SituationalSelfModel` projected from the event log, read first each turn; wire `belief-engine`.

### WAVE 4 — The SOTA viz layer (depends Wave 2 semantic-path + Wave 1 evidence chain)
- **[BLOCKER for INV-H trust] DF-4.1** Faithfulness Gate (axis honesty + no area-for-quantity + mark→`evidence_id`); extend the Auditor to reject non-attributing charts.
- **DF-4.2** Grounded selector (Draco/Mackinlay re-rank + rationale) in `ai-chart-author/author.ts`.
- **DF-4.3** Inline-chart turn-path (run `ai-chart-author` on live tenant data via the semantic layer → stream Vega UiPart in the turn).
- **DF-4.4** Interactivity bus (Vega selections → chat-event → drill as a turn) = INV-B live lens.
- **DF-4.5** Perceptual post-pass + accessibility (WSR/legibility/saliency + Wong/Viridis + SVG/`<desc>` + data-table fallback).

### WAVE 5 — Lineage, retrieval, retention (close the INV-J loop)
- **DF-5.1** Wire bi-temporal + PROV-O into ingest (MEM-07/G6); PROV + OpenLineage emitter (G7); render lineage as a live lens.
- **[BLOCKER for total-recall] DF-5.2** Un-orphan `graph-rag-router` (KI-graphrag/G8): vector + BM25 + graph + temporal + event-log fused, reranked, traceable.
- **DF-5.3** Schedule the retention runner (G11): per-event-class WORM/legal-hold + crypto-shred erasure; lineage skeleton survives.
- **DF-5.4** Event-fold reconstruction (G12 flagship): "reconstruct any past estate state/thread/decision on demand."

### WAVE 6 — Standing-drive auto-insight + self-improvement + BN parity
- **DF-6.1** Wire `@borjie/proactive-intel` + a standing scheduler (the "standing-drive"); re-point detectors at `anomaly-detection`; SMART goals from the Motivational Subsystem seed the question-tree each sleep cycle.
- **DF-6.2** BARO change-point/root-cause standing sensor on the metric bus (depends EA-07) → diagnostic+causal auto-run → proactive sink.
- **DF-6.3** Analyzer→Presenter annotation loop wired to the standing-drives (annotated charts surface unprompted, evidence-cited).
- **DF-6.4** Self-re-categorizing lens (GAP-LENS-3/4) + predictive warm-expansion (GAP-LENS-8) via bodyChange + blackboard (depends EA-04/EA-05/EA-07).
- **DF-6.5** Port the Borjie-only analytical assets (data-analysis/causal/anomaly/recommendations/cognitive-memory/data-protection) back to BossNyumba.
- **DF-6.6** DS-agent eval harness (InsightBench/DABStep-style planted-insight estate fixtures + LLM-judge) as a standing CI gate.

**Critical path:** DF-1.1 → DF-1.2 → (DF-2.1 + DF-2.3) → DF-3.1 → DF-3.2 → DF-4.1 → DF-5.2 → DF-6.1. The three highest-leverage un-wirings (each "module built, never connected") are **DF-2.1** (analytic libraries → brain tools), **DF-5.2** (graph-rag-router), and **DF-1.1/1.2** (durable + estate-wide capture).

---

## 9. Source ledger
All sources are the five repo dossiers (`data-analytical-intelligence.md`, `data-viz-sota.md`, `data-total-capture-recall.md`, `data-foundation-code-audit.md`, `frontier-unified-surfaces.md`) and `MASTER_GAP_REGISTER.md` (INV-I/INV-J rows + the wave structure), grounded in repo greps confirming: the analytic libraries exist and are dark (0 gateway imports for causal-inference/anomaly-detection/proactive-intel), the semantic layer exists (`packages/analytics/src/semantic/`), outbox producers are money/close-path only, `graph-rag-router` is reached only by the unwired sleep-pass + schema index, and the bi-temporal/PROV-O modules exist but are unused by ingest. Every external SOTA citation (DS-STAR, InsightBench/AgentPoirot, Causal-Copilot, BARO, CausalPitfalls, Draco2/Mackinlay, ChartAttack, ChartOptimiser, Zep/Graphiti, mem0, W3C-PROV/OpenLineage, Temporal/DBOS, OSI/MetricFlow/Cube, KG-OLAP/Graph-Cube) is carried with its link in the originating dossier.
