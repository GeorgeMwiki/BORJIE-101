# Data & Analytical Intelligence — the MD as a world-class data scientist

**Lane:** analytical-intelligence (INV-I)
**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** SOTA survey + repo-grounded gap analysis for the analytical-intelligence lane.
**Mandate (INV-I, MASTER_GAP_REGISTER.md L500–507):** the MD answers ANY analytical question about the estate with PhD-grade rigour — descriptive → diagnostic (WHY) → predictive (the calibrated forecast-engine) → prescriptive (what to do), plus causal inference, cohort/segmentation, anomaly detection, statistical guardrails against spurious findings, and AUTOMATED insight generation surfaced unprompted via the standing-drives. Visualizations beautiful AND correct, right-chart-for-the-question, inline in chat (INV-H) as live lenses (INV-B). Same bar for BossNyumba.

---

## 0. The one-sentence verdict

**We have a world-class box of analytical *primitives* (descriptive stats, causal pipeline, anomaly detectors, the calibrated forecast-engine, a Cube-style semantic layer, a Vega-Lite chart author) but we do NOT yet have the *agent* that drives them — the autonomous estate data-scientist that runs the full descriptive→diagnostic→predictive→prescriptive ladder unprompted, grounds every step in the semantic layer, guards itself against spurious findings, and narrates a proven, cited insight inline in chat.** The lane is ~70% built as parts, ~15% wired, and the orchestration + statistical-rigor + auto-insight spine is the gap.

---

## 1. What "world-class" means in June 2026 (the bar)

The frontier has converged on one shape: an **agentic data-scientist** that plans iteratively, writes+runs code in a sandbox, verifies its own sufficiency with an LLM-judge, grounds metrics in a semantic layer (not raw SQL), runs the four-quadrant ladder, and proactively surfaces proven insights. Concretely:

### 1a. Autonomous data-science agents (the executor pattern)
- **DS-STAR** (Google Research, Sep 2025) is the current SOTA versatile DS agent: a **Planner → Coder → Verifier → Router** loop. A dedicated *Data File Analyzer* textually summarizes heterogeneous files (CSV/JSON/markdown/unstructured); the **Verifier is an LLM-judge** asking "is the current plan sufficient?"; the **Router** decides correct-error vs add-step; max 10 rounds. It tops **DABStep (45.2%), KramaBench (44.7%), DA-Code (38.5%)** — note how *low* SOTA accuracy still is, which is itself a finding (verification + grounding matter more than raw model). Hard tasks averaged 5.6 refinement rounds; >50% of easy tasks solved round-one. ([Google Research](https://research.google/blog/ds-star-a-state-of-the-art-versatile-data-science-agent/), [arXiv 2509.21825](https://arxiv.org/html/2509.21825v3))
- **DA-Code** (500 tasks: wrangling/ML/EDA) and **Data Interpreter** (graph-decomposed sub-tasks) are the benchmark + decomposition references; a **code interpreter sandbox** (pandas/numpy/sklearn/matplotlib pre-installed, dynamic pip) is the table-stakes substrate. ([DA-Code review](https://www.themoonlight.io/en/review/da-code-agent-data-science-code-generation-benchmark-for-large-language-models), [Together.ai](https://www.together.ai/blog/building-an-autonomous-and-open-data-scientist-agent-from-scratch))
- 2026 framing (KDnuggets): the year of the *agentic workflow* — specialized **Data-Cleaning / EDA / Modelling agents in parallel**, not one monolith. ([KDnuggets](https://www.kdnuggets.com/how-ai-agents-will-transform-data-science-work-in-2026))

### 1b. The descriptive→diagnostic→predictive→prescriptive ladder + automated insight
- **InsightBench** (ServiceNow, 100 datasets with *planted* insights) is the canonical benchmark for **multi-step insight generation** — not single-query answering but "formulate questions → interpret → summarize insights + actionable steps." Its baseline **AgentPoirot** builds a **question tree**: 3 root questions → for each, code+exec+insight-extraction → **4 follow-ups → a 5-question tree per root (15 insights)** → a *Question-Selection* prompt picks the best branch to deepen. It explicitly tags each insight **Descriptive (what) / Diagnostic (why) / Predictive (what's next) / Prescriptive (what to do)**, scored by a **LLaMA-3-70B G-Eval-style judge** at insight-level (best-match to ground truth) + summary-level. Failure modes: multi-dataset joins, subtle trends (slope < 0.1), and **generic goals cost ~20 points vs SMART goals**. ([arXiv 2407.06423](https://arxiv.org/html/2407.06423v1), [ServiceNow/insight-bench](https://github.com/ServiceNow/insight-bench))
- **Agentic analytics** is now a named market category (Gartner: task-specific agents in enterprise apps jump from <5% in 2025 to **40% by end-2026**). The shared loop is **Sense → Analyze → Explain → Recommend → Act** (GoodData), or Databricks' "explore → insight → context-aware action." Proactive insight push is the default: anomaly-band agents, retention-risk cohort agents, Monday-morning briefing agents. ([GoodData](https://www.gooddata.ai/blog/agentic-analytics-complete-guide-to-ai-driven-data-intelligence/), [Databricks](https://www.databricks.com/blog/what-is-agentic-analytics), [Tableau Agentic Analytics](https://www.tableau.com/agentic-analytics))
- Vendor reference points: **Tableau Pulse / Power BI Copilot** auto-narrate dashboards into executive summaries + anomaly alerts; **ThoughtSpot SpotIQ**, **Anomalo "self-driving data"**, **Tellius** push analyst-grade reports unprompted. ([NeenOpal](https://www.neenopal.com/blog/NaturalLanguageProcessing), [Anomalo](https://www.hpcwire.com/bigdatawire/this-just-in/anomalo-launches-agentic-self-driving-data-system-to-automate-data-operations/))

### 1c. Causal inference for "WHY" (the diagnostic engine done right)
- The 2026 stack pairs **DoWhy** (model → identify → estimate → refute) + **EconML** (heterogeneous treatment effects via **Double ML**) + CausalML/Tetrad. ([ML Journey](https://mljourney.com/causal-inference-in-machine-learning-dowhy-and-econml/), [pywhy DoWhy](https://www.pywhy.org/dowhy/v0.8/example_notebooks/tutorial-causalinference-machinelearning-using-dowhy-econml.html))
- **Causal-Copilot** (Wang et al. 2025) is the agentic frontier: an LLM orchestrator interprets a NL causal query, preprocesses, an **Algorithm-Selection Module** picks from a library (DML variants, doubly-robust, IV, matching), runs discovery + estimation for tabular AND time-series, and reports. This is the pattern we should mirror for "did the royalty change cause filing delays?" ([Causal MAS survey arXiv 2509.00987](https://arxiv.org/pdf/2509.00987), [confounder-discovery agents arXiv 2508.07221](https://arxiv.org/pdf/2508.07221))

### 1d. Anomaly + change-point + root-cause attribution
- **BARO** (FSE'24 Best Artifact) is the reference: **Multivariate Bayesian Online Change-Point Detection (BOCPD)** continuously watches multivariate metrics, and on detection triggers a **RobustScorer** that ranks the root-cause service/metric. The same shape maps to estate ops: detect a change-point in production/royalty/FX, then attribute it. ([BARO arXiv 2405.09330](https://arxiv.org/pdf/2405.09330), [github](https://github.com/phamquiluan/baro))
- **Bayesian online collective anomaly + change-point** (2025) jointly detects anomalies and changepoints recursively online: **+35% precision/F1/detection-delay** over baselines. ([arXiv 2508.06385](https://arxiv.org/html/2508.06385v1))

### 1e. Statistical RIGOR — guardrails against confident nonsense (the differentiator)
- **"Ice Cream Doesn't Cause Drowning" / CausalPitfalls** (arXiv 2505.13770) is the alarm bell: LLMs fail 6 pitfall families (Simpson's paradox & selection/Berkson bias, intervention reasoning, counterfactuals, mediation, discovery, external validity) — **best model only 44.63% code-assisted, 40% direct**. Two damning failures: (1) labeling temperature a confounder in *random noise* (prior-knowledge override of evidence), (2) flipping a causal conclusion when a drink was renamed "HealthPlus" vs "UltraSugar" (**semantic manipulation**). **Code-assisted beat direct across all models** — running real statistics, not "reasoning," is what helps. ([arXiv 2505.13770](https://arxiv.org/html/2505.13770v1))
- **Simpson's paradox**: an association reverses inside confounder-defined subgroups; LLMs over-rely on aggregates and miss it. Mitigations are *procedural*: pre-register which subgroups you'll examine (anti-p-hacking/HARKing), kernel-partition de-paradox checks, multilevel models. ([De-paradox Tree arXiv 2603.02174](https://arxiv.org/pdf/2603.02174), [validity-guided LLM workflow arXiv 2507.04491](https://arxiv.org/pdf/2507.04491))

### 1f. Semantic-layer-grounded analysis (analyze via metrics, not raw SQL)
- The single biggest accuracy lever of 2026: **a governed semantic layer raises NL-query accuracy to ~83% vs ~40% for raw text-to-SQL** against undecorated tables. The LLM's job collapses from "write correct SQL" to "decompose the question into the right metrics + dimensions." ([dbt Semantic Layer vs Text-to-SQL 2026 benchmark](https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026), [Cube AI API + MCP](https://cube.dev/articles/best-bi-tools-for-dbt-teams-2026))
- Every agentic-analytics architecture (GoodData, Databricks/Unity-Catalog metrics, Cube) makes the **semantic layer the trust/governance backbone** so all agents compute "revenue/royalty/grade" identically — driving a $1.73B semantic-layer+KG market. This is the analytics counterpart of our lens engine (INV-B). ([Atlan semantic-layer tools 2026](https://atlan.com/know/best-semantic-layer-tools/))

### 1g. Prescriptive — the still-immature frontier
- Prescriptive (what-to-DO) is the *least* solved: 2026 work positions the **LLM as a planning layer wrapped around an optimization solver** (formulate the LP/MIP, hand to OR-Tools, narrate the result) rather than the LLM "deciding." **SOLID** (arXiv 2511.15202) and interactive-optimization agents are the references. This is where we can leap, because prescriptive on a mining estate = NPV/cutoff-grade/LOM/fleet/hedge optimization the domain juniors already partly model. ([SOLID arXiv 2511.15202](https://arxiv.org/pdf/2511.15202), [interactive optimization agents arXiv 2604.02666](https://arxiv.org/pdf/2604.02666))

---

## 2. What WE already have (repo-grounded — strong parts inventory)

| Capability | Package | State |
|---|---|---|
| Descriptive stats (mean/median/quantile/skew/kurtosis/IQR/histogram), inferential (t/Welch/ANOVA/chi²/Mann-Whitney/Kruskal-Wallis), regression (OLS/logistic/polynomial), correlation (Pearson/Spearman/Kendall/matrix), clustering (kmeans/DBSCAN/hierarchical), PCA/UMAP, distributions, lightweight DataFrame | `@borjie/data-analysis` | **DEEP, pure-TS, reference-validated. 1 gateway import.** |
| Causal pipeline model→identify→estimate→refute (Granger, Pearl back-door/front-door, DiD, synthetic control, RDD, twin-network counterfactual, placebo/bootstrap/E-value refutation; PCMCI+/DoWhy behind Python sidecar) + hash-chained `causal_runs` audit | `@borjie/causal-inference` | **DEEP, mirrors DoWhy + Causal-Copilot. 0 gateway imports (DARK).** |
| Anomaly + drift: Isolation-Forest/LOF/OC-SVM/autoencoder ports, z-score/MAD, **ADWIN/KSWIN/Page-Hinkley** drift, online stream wrapper, voting ensembles, mining-domain wrappers, hash-chained verdict repo | `@borjie/anomaly-detection` | **DEEP, online-capable. 0 gateway imports (DARK).** |
| Calibrated forecasting: classical floor (SeasonalNaive/ETS-Theta/Croston-TSB), TS-foundation-model provider port, **split-conformal/CQR** wrapper, horizon/regime router that rejects models failing the floor, MinT-lite hierarchical reconciliation, prediction-APPEND port, typed mining + RE targets | `@borjie/forecast-engine` | **DEEP. 4 gateway imports (the predictive rung is the most-wired).** |
| Online conformal — **ACI** (Gibbs & Candès 2021) α-update to hit coverage as data arrives | `@borjie/conformal-calibration-online` | Built; the calibration spine for predictive. |
| Cube-style **semantic layer** — `defineMetric/defineDimension/defineCube/compileQuery`, **tenant-scoped by construction** (`tenantScoped: true` type-proof), SQL-injection-safe identifier validation, params-only values | `@borjie/analytics/semantic` | **This IS our metrics layer (matches §1f).** Compiles to SQL/API/memory queries. |
| **Vega-Lite v6 chart author** — NL→chart-spec via injectable multi-LLM brain, chart builders, dashboard templates, realtime streaming bridge | `@borjie/analytics/ai-chart-author` + `charts` | The "beautiful + correct" viz half of INV-I, inline-ready. |
| World-model / scenario / stochastic forecasting "imagination" | `@borjie/forecasting-engine` | Built; 0 gateway imports (DARK). |
| Proactive insight surfacing (rate-limited, prioritized, cooldowns) | `@borjie/ai-copilot/proactive-insights` | **RULE-BASED only** (`INSIGHT_RULES`); imports NONE of the analytics ladder. |

**Net:** the rungs of the ladder exist as world-class parts; conformal calibration (the hardest part of predictive) is already shipped; the semantic layer (the §1f accuracy lever) already exists and is tenant-safe.

---

## 3. SOTA findings → "beyond-today" leaps (the survey output)

1. **DS-STAR-style Planner→Coder→Verifier→Router loop with an LLM-judge sufficiency gate is the current SOTA executor; SOTA accuracy is still only ~38–45% on hard DS benchmarks.** *Beyond-today:* an **estate-grounded DS agent** whose Coder emits typed *semantic-layer queries* (not free SQL) and calls our `@borjie/data-analysis` primitives as deterministic tools, so the Verifier checks "did we answer with a metric that balances against the ledger?" — replacing the open benchmark's brittle code with grounded, auditable steps and pushing past the 45% ceiling on *our* domain.

2. **InsightBench/AgentPoirot prove the ladder is a generated question-TREE (3 roots × 5), each insight tagged D/D/P/P, judged for actionability — and SMART goals beat generic ones by ~20 pts.** *Beyond-today:* the MD's **standing-drives (Motivational Subsystem) emit SMART goals per estate domain** ("explain the 12% royalty-filing slippage in Geita") that seed the question-tree automatically each sleep cycle, so insights arrive pre-prioritized and actionable, never "find something interesting."

3. **Semantic-layer grounding lifts NL-analytics accuracy from ~40% (raw SQL) to ~83%; it's the trust backbone of every 2026 agentic-analytics stack.** *Beyond-today:* make our existing `@borjie/analytics/semantic` cube the **only** path the DS agent can query through — fuse it with the lens engine (INV-B) so a "metric" and a "lens" are one object: every analytical answer is *automatically* a live, drill-down-able inline lens, and the agent literally cannot compute an ungoverned number.

4. **Causal-Copilot pattern: an Algorithm-Selection Module routes a NL "why" question to the right estimator (DML / IV / DiD / matching) over tabular + time-series.** *Beyond-today:* wire our already-built `@borjie/causal-inference` four-step pipeline behind a **WHY-router** so every diagnostic turn auto-selects back-door vs front-door vs DiD vs synthetic-control from the org-graph's known confounders, and **refutes itself** (placebo/E-value) before it's allowed to narrate — the refute step becomes a hard gate, not an option.

5. **BARO: multivariate Bayesian online change-point detection → RobustScorer root-cause ranking is SOTA for "what changed and why."** *Beyond-today:* run BOCPD as a **standing sensor over the estate metric bus** (production, royalty, FX, fuel, safety) so a change-point *auto-triggers* a diagnostic+causal investigation and a ranked root-cause, fed straight into the proactive-insight sink — the MD notices the dip *and* explains it before the owner opens the app.

6. **CausalPitfalls: the best LLM scores only ~45% on statistical traps; code-assisted beats pure reasoning; LLMs flip conclusions on a renamed variable (semantic manipulation) and confound random noise.** *Beyond-today:* a mandatory **Statistical-Rigor Guard** middleware on every analytical claim — runs the test in code (never "reasons" a number), auto-checks for Simpson's paradox (re-run inside every candidate confounder subgroup from the org-graph), Benjamini-Hochberg/Bonferroni for multiple comparisons, pre-registers subgroups to block p-hacking/HARKing, and strips variable *names* before the causal call to defeat semantic manipulation. **An insight that fails the guard is abstained-on, not narrated** (ties to the conformal abstention spine + the Auditor evidence rule).

7. **Agentic analytics = proactive Sense→Analyze→Explain→Recommend→Act loop; insights are pushed, not pulled (Gartner 40% adoption by end-2026).** *Beyond-today:* the MD's perceive-rung (INV-D) *is* the Sense step; bind it to the full ladder so the Monday-briefing / anomaly-band / retention-cohort agents are not three products but **one standing data-scientist** running on the sleep-pass, writing cited insights into chat ambiently (INV-H) and proposing the prescriptive action through the prepare→ask→execute rail (INV-F).

8. **Prescriptive is the immature frontier: SOTA wraps the LLM as a planning layer around an optimization solver (SOLID), not as the optimizer.** *Beyond-today:* our domain juniors already encode the objective functions (NPV/cutoff-grade/LOM/fleet-match/FX-hedge); add a thin **prescriptive bridge** that formulates the LP/MIP and hands it to a solver (OR-Tools/HiGHS port), then narrates "do X, expected Δ = Y, 90% CI [a,b]" with the *forecast-engine's conformal interval* as the confidence — making us best-in-world on the rung everyone else is weakest on.

9. **Auto-narration is now table-stakes (Tableau Pulse / Power BI Copilot / SpotIQ turn metrics into executive prose).** *Beyond-today:* our `ai-chart-author` already does NL→chart; add the reverse — **chart+stats→narration** — so every inline lens ships with a one-paragraph "what/why/so-what" in the active locale (EN/SW purity per CLAUDE.md), evidence-cited, never a bare number.

---

## 4. Our gaps vs the bar (the buildable closure list)

> Severity follows the register's convention. These are NET-NEW analytical-intelligence gaps not yet enumerated as DA-* rows in MASTER_GAP_REGISTER (they sit alongside, and depend on, the modality-arbiter keystone COG-07/AUT-14 and the proactive sink EA-07).

- **[BLOCKER] No autonomous DS-agent orchestrator (the executor is missing).** The ladder exists as parts; nothing runs Planner→Coder→Verifier→Router over them. *Closure:* build `kernel`-bound **estate-data-scientist** loop whose Coder emits semantic-layer queries + `@borjie/data-analysis` tool-calls, with an LLM-judge sufficiency Verifier (DS-STAR pattern), landing as a `run_modality: ANALYZE` decision on the arbiter. Depends COG-07.
- **[BLOCKER] Causal + anomaly + forecasting-engine are DARK (0 gateway imports).** `@borjie/causal-inference`, `@borjie/anomaly-detection`, `@borjie/forecasting-engine` are built-but-unreachable; only `forecast-engine` (4) and `data-analysis` (1) touch the gateway. *Closure:* register all three as brain tools behind a WHY-router + a standing anomaly sensor; this is the single highest-leverage wiring in the lane.
- **[BLOCKER] No Statistical-Rigor Guard.** Nothing enforces Simpson-paradox subgroup re-checks, multiple-comparison correction, pre-registration, or code-over-reasoning. Per CausalPitfalls this is *the* reliability gap. *Closure:* middleware that every analytical claim must pass; failure → abstain (reuse conformal-abstention + Auditor evidence gate).
- **[HIGH] Proactive insight engine is rule-based and ladder-blind.** `proactive-insights/insight-engine.ts` evaluates static `INSIGHT_RULES` and imports NONE of analytics/causal/forecast/anomaly. *Closure:* replace/augment with the standing DS-agent driven by SMART goals from the Motivational Subsystem; the rules become the *trigger* layer, the ladder becomes the *content* layer.
- **[HIGH] Semantic layer not the mandatory analysis path.** The cube exists but the agent can still go around it; it isn't fused with the lens engine. *Closure:* route ALL analytical queries through `compileQuery`; make metric==lens so every answer is an inline drill-down lens (INV-B/INV-H). This is the ~40%→~83% accuracy lever.
- **[HIGH] No prescriptive bridge (LLM-as-planning-layer over a solver).** Juniors encode objectives but nothing formulates+solves an optimization and narrates with a calibrated interval. *Closure:* OR-Tools/HiGHS port + formulate→solve→narrate, conformal CI as the confidence.
- **[HIGH] No change-point/root-cause standing sensor.** Anomaly detectors exist but no BARO-style BOCPD→RobustScorer over the estate metric bus auto-triggering a causal investigation. *Closure:* BOCPD sensor on the event/metric bus → diagnostic+causal auto-run → proactive sink (depends EA-07 event-stream subscriber).
- **[MED] No auto-narration of charts/stats.** `ai-chart-author` does NL→chart but not chart+stats→prose; no "what/why/so-what" paragraph per lens, EN/SW-pure, evidence-cited. *Closure:* narration step in the chart pipeline.
- **[MED] Cohort/segmentation/funnel/uplift not first-class.** Clustering primitives exist (kmeans/DBSCAN) but no cohort-retention/funnel/uplift-modeling templates as named analyses the agent can invoke. *Closure:* add cohort/funnel/uplift analysis templates over the semantic layer (buyer-marketplace retention, workforce attrition cohorts).
- **[MED] No DS-agent eval harness.** No InsightBench/DABStep-style regression asserting the ladder produces correct, actionable, *proven* insights. *Closure:* planted-insight estate fixtures + LLM-judge (insight-level + summary-level) as a standing CI gate (folds into the Wave-D eight-axis harness).

---

## 5. How the MD answers ANY analytical question rigorously (target flow)

```
owner asks (or a standing-drive fires)  →  arbiter: run_modality = ANALYZE
  PLAN     decompose into a question-tree (D→D→P→P), tagged + SMART-goaled
  GROUND   every step compiles through the semantic layer (metric==lens), tenant-scoped
  COMPUTE  Coder calls @borjie/data-analysis / forecast-engine / causal-inference as TOOLS
           (code-assisted, never "reasoned numbers")
  WHY      diagnostic turn → WHY-router auto-selects DML/IV/DiD/synthetic-control,
           then REFUTES (placebo/E-value) as a hard gate
  GUARD    Statistical-Rigor Guard: Simpson subgroup re-check · BH/Bonferroni ·
           pre-registered subgroups · name-stripped causal call → pass or ABSTAIN
  PREDICT  forecast-engine + conformal interval (calibrated, beats-the-floor or rejected)
  PRESCRIBE formulate LP/MIP → solver → "do X, ΔY, 90% CI [a,b]" via prepare→ask→execute
  VERIFY   LLM-judge sufficiency (DS-STAR) + Auditor evidence-chain (≥1 evidence_id)
  NARRATE  inline live lens (Vega-Lite) + "what/why/so-what" prose, EN/SW-pure, cited
  CLOSE    proactive sink if unprompted; durable capture (INV-J); APPEND, never replace
```

This is INV-D's perceive→orient→organize→create→execute→learn cycle *specialized to analysis*, with the statistical-rigor guard as the thing that makes it PhD-grade rather than a confident-nonsense generator.

---

## 6. Source ledger

All sources are real June-2026-reachable; titles + links inline above and consolidated in the schema `sources` array.
