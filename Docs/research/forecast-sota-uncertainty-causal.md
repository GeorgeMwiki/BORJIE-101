# Forecasting, Uncertainty & Causal Inference — 2026 SOTA Dossier

**Lane:** forecast-uncertainty-causal
**Date:** 2026-06-08
**Audience:** Borjie brain-layer engineers (Mr. Mwikila), ai-copilot juniors,
forecasting / causal / autonomy packages.
**Purpose:** Survey current (2025–2026) state-of-the-art in probabilistic
forecasting, conformal prediction for time series, Monte-Carlo scenario
simulation + stress testing, causal inference for decisions, decision-focused
(prescriptive) forecasting, and agentic / LLM forecasting — then map each to
what Borjie already has and the precise, hard-rail-compliant extensions to
build.

> **Hard-rail anchors (CLAUDE.md, non-negotiable).** Predictions **APPEND**
> to rule-based decisions and never replace them. Every AI output cites
> ≥1 `evidence_id`. Conformal calibration already exists in-repo. Money via
> `formatCurrency` / `LedgerService.post()`. EN/SW absolute toggle.
> RLS + append-only migrations. Every recommendation below is additive and
> respects these rails.

---

## 0. What Borjie already has (grounding the gap analysis)

The repo is far past green-field. Inventory of the relevant substrate
(verified by source inspection):

| Capability | Location | State |
|---|---|---|
| Adaptive Conformal Inference (ACI, Gibbs & Candès 2021) — pure online state machine | `packages/conformal-calibration-online/src/aci.ts` | Real, tested |
| Inductive Conformal Prediction (ICP) wrapper, per-horizon-step residual quantiles | `packages/forecasting/src/conformal/time-series.ts` | Real, tested |
| Foundation-model forecaster **ports** (Chronos, Moirai, TimeGPT/Nixtla, N-BEATS, Prophet, ARIMA) + ensemble + walk-forward backtest + metrics | `packages/forecasting/src/sota/` | Ports + ensemble real; external models behind adapters |
| Calibrated-confidence adapter — shrinks raw LLM confidence to conformal coverage ceiling before autonomy gating | `packages/autonomy-governance/src/decision/calibrated-confidence.ts` | Real, tested |
| Causal stack (DoWhy-shaped): backdoor/frontdoor identify, DML/DoWhy estimate **port**, synthetic control, diff-in-diff, RDD, Granger, PCMCI+ discovery, placebo/sensitivity/bootstrap **refutation**, twin-network counterfactual | `packages/causal-inference/src/` | Real estimators + sidecar ports |
| Causal-fusion (PCMCI+ client, DAG builder, refutation) for co-scientist | `packages/scientific-discovery/src/causal-fusion/` | Real |
| Monte-Carlo scenario engine — world-model (cashflow/compliance/market/tenant-graph), scenario-builder, sandbox runtime, Pareto-frontier scoring, owner-intent scoring, reflexion feedback | `packages/forecasting-engine/src/` | Real |
| Demand forecaster, market intelligence | `packages/market-intelligence/`, `packages/forecasting-engine/src/forecasters/` | Real |
| Conformal calibration schema + Brier/ECE monitor | `packages/database/src/schemas/conformal-calibration.schema.ts`, `@borjie/calibration-monitor` | Real |

**Implication.** The dossier's job is **not** "build forecasting." It is
"upgrade each existing component to 2026 SOTA and close named gaps." The
biggest, highest-leverage gaps (detailed in §7) are: (a) ACI → **DtACI /
conformal-PID** (no learning-rate tuning, forward-looking scorecaster),
(b) **decision-focused** wiring (forecast → optimal action, not forecast →
dashboard), and (c) **agentic LLM forecasting** with retrieval grounding +
ensemble aggregation for the narrative/event questions Mr. Mwikila answers.

---

## 1. Probabilistic forecasting — distributional, quantile, foundation models

### 1.1 The 2026 frontier is zero-shot foundation models with native distributions

The field has shifted decisively from per-series training to **pretrained
time-series foundation models (TSFMs)** evaluated zero-shot on probabilistic
metrics (CRPS / weighted-quantile-loss, MASE).

- **GIFT-Eval** (Salesforce) is the canonical 2026 leaderboard: 23 dataset
  groups, 7 domains, 10 frequencies, ~144k series / 177M points, ranked by
  **Average Weighted Quantile Loss** and **Average Rank** (geo-mean of MASE +
  CRPS). Refreshes every 12 h. Live board:
  `huggingface.co/spaces/Salesforce/GIFT-Eval`. (arXiv 2410.10393)
- **Leaders (mid-2026):** **TiRex** (NX-AI, xLSTM backbone, strong in-context
  learning) currently tops GIFT-Eval; the high-probabilistic tier also
  includes **TabPFN-TS**, **Sundial**, **Moirai-2**, **Toto**, **TimesFM-2.5**,
  **Chronos-2**, **YingLong**, **FlowState**, **VisionTS**.
- **Probabilistic quality:** **TabPFN-TS** (PriorLabs; "From Tables to Time",
  arXiv 2501.02945) **surpasses TimesFM-2.0 and Chronos-Bolt on WQL** because
  it emits a **native posterior predictive distribution** (a discretised
  *Riemann distribution* over the target) rather than a fixed set of quantile
  heads — strictly better tail / multimodal behaviour. It ranked #1 on
  GIFT-Eval on first release.
- **Distributional objectives are the differentiator.** **Sundial** (Liu et
  al. 2025) uses a **flow-matching "TimeFlow" loss** for continuous,
  non-parametric, **multi-modal** next-patch distributions (no tokenisation).
  This is the cleanest current answer to "give me a full predictive density,
  not three quantiles."

### 1.2 The takeaways that matter for Borjie

1. **Prefer models with native predictive distributions** (TabPFN-TS,
   Sundial) over quantile-head models when you need calibrated tails — mineral
   price shocks, FX cliffs, royalty cash-flow swings live in the tails.
2. **Patch-based decoder-only** (TimesFM) and **xLSTM in-context** (TiRex) are
   the two strong zero-shot architecture families; a generic transformer is a
   surprisingly strong baseline (arXiv 2602.06909 "Revisiting the Generic
   Transformer").
3. **Finance-specific evaluation must be risk-aware** — naive accuracy hides
   tail failure (ACM 2025 survey, "Time-Series Foundation Models in Finance",
   doi 10.1145/3785706.3785728). Borjie's mineral/FX/royalty series are
   finance-shaped: backtest on **CRPS + Winkler + pinball**, not MAPE.
4. **Borjie fit:** `packages/forecasting/src/sota/` already has Chronos /
   Moirai / TimeGPT / N-BEATS ports. The gap is **(a)** no TabPFN-TS or TiRex
   port and **(b)** the ensemble combines point forecasts, not distributions.
   See §7-A.

---

## 2. Conformal prediction for time series — and how to extend the in-repo ACI

This is the most directly actionable lane because the repo **already runs
ACI** (`conformal-calibration-online/src/aci.ts`) and **ICP**
(`forecasting/src/conformal/time-series.ts`).

### 2.1 The method family, ranked by 2026 evidence

- **ICP / split conformal** (what `time-series.ts` does): exchangeability
  assumption, per-step residual quantiles. Correct, but **frozen `alpha`** and
  no adaptation to distribution shift — exactly the FX-cliff / harvest-season
  failure mode the code comments flag.
- **ACI** (Gibbs & Candès 2021; in-repo): `alpha_{t+1} = alpha_t + γ(target −
  covered_t)`. Guarantees long-run coverage under **arbitrary** distribution
  shift. **Critical weakness: sensitive to the learning rate γ.** The repo
  hard-codes `DEFAULT_LEARNING_RATE = 0.05`.
- **DtACI** (Gibbs & Candès 2024, JMLR 25): runs a **grid of ACI experts**
  with different γ and aggregates them online — **removes the γ-tuning
  problem**. **AgACI** (Zaffran et al. 2022) and **SAOCP** (Bhatnagar et al.
  2023, "Improved Online CP via Strongly Adaptive Online Learning", arXiv
  2302.07869) are the same idea via different meta-aggregators. **This is the
  single highest-value upgrade to the repo's ACI** (§7-B).
- **Conformal PID control** (Angelopoulos, Candès & Tibshirani, NeurIPS 2023 /
  arXiv 2307.16895) — the **current SOTA** for online TS conformal. Frames
  set-sizing as a **P-I-D controller**:
  - **P (quantile tracking)** — track quantile loss, long-run coverage if
    scores bounded.
  - **I (error integration)** — accumulate coverage error; gives long-run
    coverage under **no assumptions** (scores may be unbounded). **ACI is a
    special case of just the I-term.**
  - **D (scorecasting)** — a **second model forecasts the next nonconformity
    score**, making the controller **forward-looking** (vs ACI's purely
    reactive update). This yields tighter sets that "hug" the truth. The repo's
    ICP residuals are exactly the training signal a scorecaster needs.
  - **MPID** (multi-step conformal PID, arXiv 2410.13115) extends PID to
    multi-horizon — matches Borjie's per-horizon-step ICP layout.
- **2026 benchmarking** ("Conformal Prediction Algorithms for Time Series
  Forecasting: Methods and Benchmarking", arXiv 2601.18509, Jan 2026; >3000
  monthly-sales series, evaluated on marginal/joint coverage + Winkler):
  - **Hit 90% coverage:** Global-CP, **AcMCP**, **MSCP**, **ACI**,
    Parametric-PI.
  - **Failed coverage:** Nixtla-CP, **EnbPI**, **SPCI** (SPCI worst).
  - **Winner on efficiency:** **MSCP** (multi-step split CP, horizon-specific
    calibration) — "most effective balance of coverage validity and interval
    efficiency for multi-horizon forecasting." Parametric-PI 2nd, ACI 3rd.
  - **Note:** EnbPI (often cited as a default) **under-covered** here — do not
    adopt it blindly for Borjie's irregular mineral/cashflow series.
- **Other 2025–2026 advances worth tracking:** Neural Conformal Control (arXiv
  2412.18144); Universal-Portfolio online CP (arXiv 2602.03168); retrospective
  adjustment for faster shift adaptation (arXiv 2511.04275); group-conditional
  parameter-free online CP / POGO (arXiv 2606.00419); **Extreme Conformal
  Prediction** for high-impact tail events (arXiv 2505.08578) — directly
  relevant to mineral-price / FX tail risk; conformal under change-points
  (arXiv 2509.02844); regime-switching state-space + CP (arXiv 2512.03298).

### 2.2 Concrete extension path for the repo's conformal layer

The repo's `OnlineConformalState` is a clean pure state machine. The
generalisation is mechanical and **fully backward-compatible**:

1. **ACI → DtACI** (no API break): replace the single `alpha` with a vector of
   experts `{γ_k, alpha_k}` plus exponential-weight aggregation; current ACI is
   the 1-expert case. Keeps the same `diagnostic()` shape that
   `calibrated-confidence.ts` consumes (it reads `alpha`/`observedCoverage`
   structurally — see `ConformalCoverageView`).
2. **Add the I-term + D-term (conformal-PID)** as an opt-in mode: the I-term is
   essentially today's ACI update; add a **scorecaster** that consumes the ICP
   per-step residual history already computed in `time-series.ts` to predict
   next-step score → forward-looking sets.
3. **Per-horizon (MSCP/MPID)**: the ICP wrapper already keeps per-step residual
   vectors — promote each horizon-step to its own online conformal state.
4. **Extreme-CP tail mode** for mineral price / FX series: GPD-tail conformal
   for the 99th-percentile sets that drive treasury / kill-switch thresholds.
5. **Keep the rail:** conformal output **calibrates** confidence (it already
   feeds `calibratedConfidenceFromConformal`), it never replaces a rule-based
   decision — consistent with "predictions APPEND."

---

## 3. Monte-Carlo scenario simulation & stress testing

### 3.1 SOTA practice (2025–2026)

- **Three classical pillars** still frame everything: historical simulation,
  hypothetical scenarios, **Monte-Carlo**. Borjie's `forecasting-engine`
  scenario sandbox is squarely in the MC pillar.
- **Reverse stress testing (RST)** is the 2025–2026 emphasis: instead of
  "given shock X, what happens," ask **"which joint configuration of drivers
  plausibly produces failure state F?"** — surfaces hidden vulnerabilities
  conventional testing misses. Formal frameworks: vine-copula multivariate RST
  (arXiv 2404.00109); geopolitical-risk RST for credit portfolios (arXiv
  2601.03983, 2026). **Highly relevant to Borjie:** "what FX path + royalty
  schedule + price drop bankrupts this estate?" is a reverse-stress question.
- **Climate / ESG scenario stress testing** is now standard (UNEP-FI good-
  practice guide; MathWorks climate-stress-testing). Borjie has an
  `esg-disclosure-agent` — climate scenario pathways (e.g., NGFS) map onto
  mining-licence and tailings/water-risk drivers.
- **Generative & quantum acceleration** are the leading-edge directions
  (generative scenario synthesis; quantum Monte-Carlo for portfolio stress,
  World Quantum Summit 2025) — note but **do not adopt** yet; classical MC with
  good copulas is the pragmatic SOTA.

### 3.2 Borjie fit and extension

The `forecasting-engine` already has scenario-builder + sandbox + Pareto +
reflexion. Gaps:

1. **Add reverse stress testing** — invert the world-model: search the driver
   space (FX rate, mineral price, royalty timing, vacancy) for minimal-
   plausibility paths to a target failure (covenant breach, NOI < threshold,
   liquidity wall). Use the existing Pareto/outcome-scorer as the failure
   oracle.
2. **Couple MC scenarios with conformal intervals** — sample scenario drivers
   from the **conformally-calibrated** predictive distribution (§2), so MC fans
   inherit coverage guarantees rather than ad-hoc Gaussian assumptions.
3. **Dependence structure** — use copulas (vine) for joint FX × price × demand
   shocks; independent marginals understate tail co-movement (the 2008 / FX-
   cliff lesson).
4. **Climate pathway scenarios** feed `esg-disclosure-agent`.

---

## 4. Causal inference for decisions

### 4.1 SOTA stack (2025–2026)

The **PyWhy** ecosystem is the de-facto standard, and the repo already mirrors
it:

- **DoWhy** — the **model → identify → estimate → refute** four-step
  discipline. Borjie's `causal-inference` package **is** this shape
  (identify/, estimate/, refute/). Keep it; it's the right backbone.
- **EconML** (Microsoft) — heterogeneous treatment effects via **Double /
  Debiased ML (DML)**, **causal forests**, **orthogonal/dynamic DML**,
  **doubly-robust** & **meta-learners** (S/T/X/R-learner), **DeepIV /
  orthogonal IV**. Borjie has a `dowhy-port` + DML-shaped estimators but not
  the full HTE meta-learner family.
- **CausalML** (Uber) — **uplift modelling** for "who is positively affected by
  an intervention" (which buyer responds to a price change, which site
  benefits from an equipment upgrade). **Borjie has no explicit uplift
  layer** — a clear gap given the marketplace / off-take advisory juniors.
- **Causal discovery** — PCMCI+ (in-repo, `causal-inference` and
  `causal-fusion`) for time-series causal graphs; Granger as a weaker screen.
- **Counterfactual / twin-network** (in-repo `counterfactual/twin-network.ts`)
  — Pearl's abduction-action-prediction for "what would NOI have been had we
  not suspended the licence."
- **HTE calibration is a live 2025 sub-field** and a rail-relevant gap: raw HTE
  estimators are poorly calibrated. **Causal isotonic calibration** (arXiv
  2302.14011), **multi-calibrated HTE** (2024), and **conformal / calibrated
  propensity scores** (arXiv 2306.00382) make uplift estimates trustworthy —
  this is the causal analogue of the conformal-calibration rail Borjie already
  enforces for forecasts.
- **Market context:** causal-AI is mainstreaming fast (Fortune Business
  Insights: causal-AI market ~$81B 2025 → ~$116B 2026) — Borjie's investment
  here is well-aligned with the trajectory.

### 4.2 Borjie fit and extension

1. **Add uplift / HTE layer** (CausalML-style meta-learners on top of the
   existing DML port) so juniors can answer "which intervention moves *this*
   tenant/buyer/site," not just average effects. Cite `evidence_id` from the
   causal run.
2. **Calibrate HTE** with causal-isotonic / conformal calibration — reuse the
   existing conformal substrate; this extends the "calibration precedes gating"
   rule from forecasts to causal effects.
3. **Always run the refute step** (placebo / sensitivity / bootstrap already
   in-repo) before a causal claim drives an action — make it a hard gate, same
   spirit as the Auditor rejecting empty evidence chains.
4. **Decisions, not just estimates** — feed HTE/uplift into the decision layer
   (§5), e.g., target only positive-uplift counterparties.

---

## 5. Decision-focused / prescriptive forecasting (forecast → optimal action)

This is where Borjie has the **most strategic upside** and the **biggest
current gap**: forecasts today largely feed dashboards, not optimisation.

### 5.1 SOTA paradigm

- **Predict-then-optimize (PtO)** classically trains the predictor for
  accuracy, then optimises — but **accuracy ≠ decision quality** under
  misspecification.
- **Smart "Predict, then Optimize" (SPO / SPO+)** (Elmachtoub & Grigas,
  *Management Science* 2022) — train the predictor against the **decision
  (regret) loss** induced by the downstream optimisation, using the convex
  **SPO+ surrogate**. Big gains exactly when the model is misspecified (always,
  in messy mining/FX data).
- **Decision-Focused Learning (DFL)** — the umbrella; comprehensive benchmark
  and survey in *JAIR* 2024 (foundations, SOTA, open problems). 2025 frontier:
  **online DFL** (arXiv 2505.13564), **smart surrogate losses for contextual
  stochastic linear optimisation with robust constraints** (arXiv 2505.22881),
  **distribution-free robust PtO in function spaces** (arXiv 2602.08215),
  **learning shortest paths when data is scarce** (arXiv 2601.03629).
- **Prescriptive analytics** — Bertsimas & Kallus learn decision policies as
  functions of context with asymptotic optimality vs a full-information oracle;
  Ban & Rudin embed ML directly in the **data-driven newsvendor**.
- **Conformal-robust decisions (the rail-perfect bridge):** wrap the predictor
  output in a **conformal uncertainty set**, then solve a **contextual robust
  optimisation (CRO)** that minimises worst-case decision loss over that set —
  giving a **distribution-free guarantee on decision quality**:
  - Conformal feature-based newsvendor under misspecification (arXiv
    2412.13159).
  - Conformalized Robust Optimization + **Model Selection (CROMS)** (arXiv
    2507.04716) — picks the model that minimises averaged decision risk.
  - Decision-theoretic foundations of conformal prediction for **risk-averse**
    agents (ICML 2025, arXiv 2502.02561) — *coverage alone is not enough for
    good decisions; the set must be decision-informative*.
  - Optimal decision-making based on prediction sets (arXiv 2602.00989);
    tightening optimality gap with CP confidence (arXiv 2503.04071);
    chance-constrained / contextual inventory under demand uncertainty.

### 5.2 Borjie fit and extension

Borjie's `forecasting-engine` already has **Pareto-frontier** + **owner-intent
scoring** + **outcome-scorer** — the skeleton of a decision layer. Build the
prescriptive bridge:

1. **Wrap forecasts in conformal sets, then robust-optimise** (CRO/CROMS): for
   royalty timing, inventory of consumables, FX hedge sizing, off-take
   acceptance — choose the action minimising worst-case loss over the conformal
   set. Distribution-free decision guarantee, fully append-only (the
   optimisation **recommends**; the rule-based / four-eyes gate **decides**).
2. **Newsvendor pattern** for any "how much to stock / commit" decision
   (consumables, spare parts, working-capital buffer) — feature-based,
   conformal-robust.
3. **SPO+ / DFL** as a later upgrade where a dedicated decision exists and
   training data is rich — train forecasters against regret, not MAPE.
4. **Rail compliance:** the prescriptive layer outputs a *recommended* action
   with its conformal set, expected regret, and ≥1 `evidence_id`; the existing
   policy-gate / kill-switch / four-eyes path remains the authority. Predictions
   **append**.

---

## 6. Agentic / LLM forecasting (the layer Mr. Mwikila most needs)

Mr. Mwikila answers many **narrative/event** questions ("will the licence
renew," "will this counterparty default," "will FX breach X by Q3") that are
not pure numeric time series — this is the **agentic LLM forecasting** frontier.

### 6.1 SOTA findings (2025–2026)

- **ForecastBench** (Karger et al., arXiv 2409.19839; Wharton, updated Feb
  2026) is the canonical dynamic benchmark — 1000 real, future-resolving
  questions, no look-ahead leakage, refreshed continuously.
  - **Superforecasters still lead:** difficulty-adjusted **Brier 0.081** vs
    best model (GPT-4.5) **0.101**. Gap is **closing**: projected
    **LLM-superforecaster parity in late 2026** (95% CI Dec-2025 – Jan-2028).
- **Retrieval grounding is decisive.** The winning architecture has **two
  phases: research (retrieve current news/evidence) → predict.** Naive
  closed-book LLMs are materially worse; retrieval-augmentation closes much of
  the gap (FutureSearch-style narrative forecasting; ForecastBench RAG
  baselines).
- **Ensemble aggregation works for LLMs like crowds do.** LLM ensembles get the
  same wisdom-of-crowds boost as human crowds, **and improve further when the
  human-median is injected** as an extra signal. → run **multiple model /
  prompt experts and aggregate**, don't trust a single completion.
- **Base-rate / reference-class reasoning** + explicit scenario decomposition
  are the superforecaster habits that transfer to LLMs.
- **Tournament evidence (2025):** **Mantic** placed **8th of 549** in the
  Metaculus Summer Cup (first bot in the top 10) and in Fall-2025 **beat the
  community prediction and most professional forecasters**; Metaculus runs
  bot-only AIB tournaments quarterly. Mantic + Metaculus describe the same
  **research-phase → prediction-phase, daily-refreshed** pipeline (Thinking
  Machines Lab guest post; `metaculus/forecasting-tools` framework).
- **Human-AI:** frontier LLM assistants improve **human** forecast accuracy by
  **24–28%** (ACM TiiS, doi 10.1145/3707649) — the *assistant* framing, not
  full autonomy, is the proven-safe deployment.

### 6.2 Borjie fit and extension

1. **Build a research-then-predict event forecaster** as an ai-copilot junior /
   kernel tool: phase 1 retrieves from the intelligence corpus + live
   connectors; phase 2 produces a probability + interval. **Every forecast
   cites `evidence_id`** — the rail and the SOTA recipe coincide exactly.
2. **Ensemble + aggregate** across model/prompt experts (and, where available,
   the rule-based estimate as the "human-median" anchor) — append, don't
   replace, the deterministic signal.
3. **Calibrate event probabilities** with the existing conformal /
   Brier-ECE monitor before they drive autonomy gating
   (`calibrated-confidence.ts` already does this for confidence).
4. **Score continuously** against resolved outcomes (a ForecastBench-style
   internal harness using `predicted-vs-actual` + reflexion feedback already in
   `forecasting-engine`) → Brier/CRPS track record feeds the calibration
   ceiling.
5. **Deploy as assistant-to-MD** for the highest-stakes calls (parity not yet
   reached) — autonomy only where the calibrated track record earns it.

---

## 7. Prioritised extension backlog (rail-compliant, additive)

| # | Upgrade | Where | Why / SOTA basis | Effort |
|---|---|---|---|---|
| **A** | **DtACI / conformal-PID** replacing single-γ ACI; add scorecaster from existing ICP residuals; per-horizon MSCP | `conformal-calibration-online`, `forecasting/conformal` | C-PID is online-TS SOTA; MSCP won 2026 benchmark; DtACI removes γ-tuning. Backward-compatible with `ConformalCoverageView`. | M |
| **B** | **Distributional ensemble + TabPFN-TS / TiRex ports**; backtest on CRPS/Winkler/pinball | `forecasting/sota` | GIFT-Eval leaders; native predictive distributions beat quantile heads on tails (mineral/FX). | M |
| **C** | **Conformal-robust decision layer** (CRO/CROMS, conformal newsvendor) on top of Pareto/outcome-scorer | `forecasting-engine`, autonomy | Distribution-free *decision* guarantee; forecast→action is the strategic gap. Append-only. | L |
| **D** | **Reverse stress testing** + copula-coupled MC sampled from conformal distributions | `forecasting-engine/scenarios` | 2025–2026 RST emphasis; surfaces FX×price×royalty failure paths. | M |
| **E** | **Uplift/HTE layer + HTE calibration** (CausalML meta-learners, causal-isotonic) | `causal-inference` | Answer "who responds," calibrated, refute-gated. | M |
| **F** | **Agentic research-then-predict event forecaster** w/ retrieval grounding + ensemble aggregation + continuous scoring | ai-copilot junior / kernel tool | ForecastBench/Mantic recipe; parity ~late-2026; rail = evidence_id. | L |
| **G** | **Extreme-conformal tail mode** for kill-switch / treasury thresholds | conformal + treasury | Tail events drive HIGH-risk gates; marginal CP under-covers tails. | S |

**Sequencing.** A and B first (cheap, upgrade the substrate everything else
sits on). Then C + D (decision + scenario value). E and F in parallel (causal
& agentic). G as a targeted hardening pass for HIGH-risk policy prefixes.

---

## 8. Net assessment

Borjie's forecast/uncertainty/causal substrate is **unusually mature** — it
already embodies several rails that the 2026 literature independently
validates: conformal calibration before autonomy gating, evidence-cited
output, append-not-replace predictions, the DoWhy four-step causal discipline.
The frontier gaps are not foundational; they are **upgrades**: single-γ ACI →
**DtACI/conformal-PID**, point ensembles → **distributional foundation
models**, forecast-to-dashboard → **conformal-robust decision optimisation**,
and pure numeric forecasting → **retrieval-grounded agentic event forecasting**
with crowd-style ensemble aggregation. Every one is additive and rail-safe.
Executed, they put Mr. Mwikila at or above the 2026 state of the art for an
autonomous estate brain.

---

## Sources

**Probabilistic forecasting / foundation models**
- GIFT-Eval benchmark — arXiv 2410.10393; leaderboard `huggingface.co/spaces/Salesforce/GIFT-Eval`; `tsfm.ai/benchmarks/gift-eval`; Salesforce blog.
- TabPFN-TS "From Tables to Time" — arXiv 2501.02945; `github.com/PriorLabs/tabpfn-time-series`.
- TimesFM (Das et al. 2024); Chronos (Ansari et al. 2024); TiRex (Auer et al. 2025); Sundial flow-matching (Liu et al. 2025).
- "Revisiting the Generic Transformer" — arXiv 2602.06909.
- TSFMs in Finance survey — ACM doi 10.1145/3785706.3785728; "The 2026 Time Series Toolkit" (MachineLearningMastery).

**Conformal prediction for time series**
- Conformal PID Control — Angelopoulos, Candès, Tibshirani, NeurIPS 2023 / arXiv 2307.16895; multi-step MPID arXiv 2410.13115.
- ACI — Gibbs & Candès 2021 (arXiv 2208.08401); DtACI — JMLR 25 (2024); AgACI — Zaffran et al. 2022; SAOCP — Bhatnagar et al. 2023 (arXiv 2302.07869).
- CP-for-TS benchmark (MSCP/AcMCP/Global-CP/ACI/EnbPI/SPCI) — arXiv 2601.18509 (Jan 2026).
- Neural Conformal Control — arXiv 2412.18144; Universal-Portfolio online CP — arXiv 2602.03168; retrospective adjustment — arXiv 2511.04275; group-conditional/POGO — arXiv 2606.00419; Extreme Conformal Prediction — arXiv 2505.08578; change-points — arXiv 2509.02844; regime-switching SSM+CP — arXiv 2512.03298.

**Monte-Carlo scenario / stress testing**
- Reverse stress testing: vine copulas — arXiv 2404.00109; geopolitical credit RST — arXiv 2601.03983; Zanders climate RST.
- UNEP-FI Good Practice Guide to Climate Stress Testing; MathWorks Climate Stress Testing; Quantum Monte-Carlo portfolio stress (World Quantum Summit 2025).

**Causal inference**
- PyWhy: DoWhy + EconML (`pywhy.org`); CausalML (`github.com/uber/causalml`).
- HTE calibration: causal isotonic — arXiv 2302.14011; multi-calibrated HTE (2024); calibrated/conformal propensity — arXiv 2306.00382; calibration error for HTE — arXiv 2203.13364.
- Causal-AI market sizing — Fortune Business Insights (2025/2026).

**Decision-focused / prescriptive**
- Smart "Predict, then Optimize" — Elmachtoub & Grigas, *Management Science* 2022.
- DFL benchmark/survey — *JAIR* 2024; online DFL — arXiv 2505.13564; smart surrogate losses — arXiv 2505.22881; distribution-free robust PtO — arXiv 2602.08215; scarce-data shortest paths — arXiv 2601.03629.
- Conformal newsvendor — arXiv 2412.13159; CROMS — arXiv 2507.04716; decision-theoretic CP for risk-averse agents (ICML 2025) — arXiv 2502.02561; optimal decisions from prediction sets — arXiv 2602.00989; tightening optimality gap w/ CP — arXiv 2503.04071.

**Agentic / LLM forecasting**
- ForecastBench — arXiv 2409.19839 (Wharton, updated Feb 2026); Forecasting Research substack analysis.
- LLM-augmented human forecasting (+24–28%) — ACM TiiS doi 10.1145/3707649.
- Metaculus AIB tournaments (`metaculus.com/aib/`); `github.com/Metaculus/forecasting-tools`; Mantic (`mantic.com`); "Training LLMs to Predict World Events" — Thinking Machines Lab; TIME coverage of AI vs human forecasting.
