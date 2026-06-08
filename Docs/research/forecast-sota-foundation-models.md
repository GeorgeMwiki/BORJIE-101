# Time-Series Forecasting SOTA — Foundation Models, Classical Baselines, and a Decision Matrix (2026)

**Lane:** `forecast-foundation-models`
**Date:** 2026-06-08
**Audience:** Borjie brain-layer engineers wiring a quantitative forecasting capability into Mr. Mwikila (price/royalty/FX/production/demand forecasting for mining-estate operations).
**Status:** Research dossier — no code. Survey of the current (mid-2026) state of the art in time-series (TS) forecasting, covering zero-shot foundation models, strong classical baselines, benchmarks, and a deployment decision matrix.

> **Borjie rail alignment (read first).** Borjie's hard rails (CLAUDE.md) say **predictions APPEND to rule-based decisions and NEVER replace them**, every AI output **cites ≥1 `evidence_id`**, and **conformal calibration is already in the codebase**. This dossier's recommendation respects all three: any TS forecast model is an *advisory signal* that feeds the rule-based decision layer, every forecast must be wrapped with provenance (which model, which horizon, which input window = the `evidence_id`), and the probabilistic outputs of these models must be **conformalized** (split-conformal / conformalized quantile regression) before they are surfaced as decision-grade intervals. Treat foundation-model point forecasts as *priors*, never as authority.

---

## 0. TL;DR / Executive Summary

1. **Zero-shot TS foundation models are now genuinely strong and production-viable.** As of mid-2026 the open leaderboards (GIFT-Eval, fev-bench, BOOM) are led by a cluster of pretrained transformers/xLSTMs whose **zero-shot** accuracy is competitive with, and frequently beats, a *tuned* per-series classical pipeline — especially on medium/long horizons, regular-frequency data, and many-series portfolios. The strongest single-model open weights right now are **Toto-2.0** (Datadog), **TiRex** (NX-AI, xLSTM), **Chronos-2** (Amazon), **Moirai 2.0** (Salesforce), **TimesFM-2.5** (Google), **Sundial** (Ant/Tsinghua), and **TabPFN-TS** (Prior Labs). ([GIFT-Eval leaderboard](https://tsfm.ai/benchmarks/gift-eval), [fev-bench](https://arxiv.org/abs/2509.26468))

2. **But the "foundation models always win" claim is overstated.** A controlled 2025–26 study ("How Foundational are Foundation Models for Time Series Forecasting?", [arXiv:2510.00742](https://arxiv.org/pdf/2510.00742)) and the observability/finance literature show that **strong statistical baselines (AutoETS/AutoARIMA/Theta, SeasonalNaive) and gradient-boosted models still match or beat foundation models** on: very high-frequency data (minutely/secondly), narrow stable workloads, short series, heavy intermittency, and any regime far from the pretraining distribution. Classical methods also win decisively on **cost, latency, interpretability, and on-prem control**.

3. **The right answer for Borjie is a portfolio / router, not a single model.** Run cheap classical baselines as the floor and as the *rule-based decision input*, add one self-hosted foundation model (Apache-2.0, CPU-capable) as an advisory overlay, conformalize everything, and reconcile hierarchical aggregates (estate → subsidiary → site → mineral). Use an external API (TimeGPT-2) only if you want zero MLOps and accept vendor + data-residency tradeoffs.

4. **Licensing matters for a multi-tenant SaaS.** Toto-2.0, Chronos-2, Moirai 2.0, TimesFM, TiRex are open weights (Apache-2.0 / similarly permissive) and self-hostable. TimeGPT is **API-only / closed** (enterprise self-host by contract). TabPFN's core has a non-standard license to check. Pick Apache-2.0 weights to avoid per-tenant licensing exposure.

---

## 1. The 2026 benchmark landscape (read the leaderboards critically)

There are now three benchmarks that matter, plus the legacy Monash archive. **No single benchmark is decisive** — they stress different regimes and all have leakage caveats.

### 1.1 GIFT-Eval (Salesforce) — the general-purpose standard
- **What:** 23 datasets, ~144k series, ~177M points, **7 domains, 10 frequencies**, short→long horizons, probabilistic. Ships a separate ~230B-point non-leaking pretraining corpus so models can be trained without contaminating the test set. ([Salesforce blog](https://www.salesforce.com/blog/gift-eval-time-series-benchmark/), [arXiv:2410.10393](https://arxiv.org/abs/2410.10393), [HF Space](https://huggingface.co/spaces/Salesforce/GIFT-Eval))
- **Metrics:** ranked by **average rank across slices**; **MASE** (point) and **CRPS / Weighted Quantile Loss** (probabilistic).
- **Live mirror** (TSFM.ai, refreshed ~12h; 91 models tracked): as of June 2026 the top of the board is dominated by **agentic ensembles and fine-tuned entries**, not raw single zero-shot models. ([tsfm.ai/benchmarks/gift-eval](https://tsfm.ai/benchmarks/gift-eval))

  | ~Rank | Entry | Type | Note |
  |---|---|---|---|
  | 1 | Cobra-Agent | agentic ensemble | model-selection agent over many TSFMs |
  | 2–3 | Toto-2.0-FnF, RAES-Conductance-Ensemble | agentic/ensemble | |
  | 4 | Toto-2.0-2.5B-FT | fine-tuned | best single-family fine-tuned |
  | 13 | **Toto-2.0-2.5B** | pretrained (zero-shot) | best single zero-shot pretrained near top |
  | 15/18 | STRIDE (+Chronos-2 / +Timer-S1) | pretrained | |
  | 21 | **Chronos-2** | pretrained | |
  | 24/28 | Granite-FlowState, FlowState-r1.1 | zero-shot | IBM/others |
  | 26 | Timer-S1 | pretrained | |
  | 27 | **TimesFM-2.5** | zero-shot | |
  | 30 | **TiRex** | zero-shot (xLSTM) | |

  > **Caveat — leakage flags.** GIFT-Eval added a flag for models that likely saw test data during pretraining; flagged entries are filtered from the "clean" view. **Moirai 2.0** is reported #1-by-MASE *among non-leaking models* in Salesforce's own framing, and many high-leaderboard "agentic" entries are model-pickers that wrap the same underlying TSFMs. **Read the non-leaking, single-model slice — not the raw top-10 — when choosing a model to ship.** ([Moirai 2.0 paper, arXiv:2511.11698](https://arxiv.org/pdf/2511.11698))

### 1.2 fev-bench (Amazon/AutoGluon) — realistic, covariate-heavy
- **What:** **100 forecasting tasks, 7 domains, 46 tasks with covariates**; backed by the lightweight `fev` Python lib (HF datasets + pydantic only, no pinned torch/numpy). YAML task specs, rolling-window eval, **bootstrapped CIs**, reported as **win rates + skill scores**. ([arXiv:2509.26468](https://arxiv.org/abs/2509.26468), [HF dataset](https://huggingface.co/datasets/autogluon/fev_datasets))
- **Result:** **TiRex and TimesFM-2.5 are the top two**, but their CIs **overlap** — no statistically significant gap. **Chronos-2** posts the largest gains on the *covariate-informed* subset. **TabPFN-TS** is SOTA on covariate-informed tasks despite being tiny + synthetic-only-pretrained. The headline lesson: with proper CIs, the "winner" margins between leading TSFMs are mostly noise.

### 1.3 BOOM (Datadog) — observability / many-variate
- **What:** large real-world **observability** forecasting dataset; **median series has 60 variates** (vs GIFT-Eval's median of 1). Pairs with the contamination-resistant **TIME** benchmark. ([Datadog: Toto + BOOM](https://www.datadoghq.com/blog/ai/toto-boom-unleashed/), [arXiv:2505.14766](https://arxiv.org/abs/2505.14766))
- **Result:** **Toto-2.0** sweeps BOOM (purpose-built for multivariate observability) and also leads TIME. Most relevant if your data looks like metrics/telemetry (many correlated channels, spikes, regime shifts) — which **mining IoT / sensor / production telemetry resembles**.

### 1.4 Monash (legacy) & a methodological note
- The **Monash Time Series Forecasting Archive** (30+ datasets) remains the historical reference; modern TSFMs report on it but it is largely "solved"/saturated and is a known pretraining source (leakage risk). Use GIFT-Eval/fev-bench/BOOM for current decisions.
- **Always benchmark on *your own* held-out series** with rolling-origin evaluation. Leaderboard rank does not transfer guarantees to mining price/FX/production data, which is out-of-distribution for most pretraining corpora.

---

## 2. Foundation / zero-shot TS models — capability matrix

| Model (vendor) | Params | Arch | Zero-shot | Multivariate | Covariates | Probabilistic | License / access | Self-host | Best for |
|---|---|---|---|---|---|---|---|---|---|
| **Toto-2.0** (Datadog) | 4m → 2.5B (5 sizes) | decoder, contiguous-patch masking, μP-scaled, single-pass | ✅ | ✅ (strong) | partial | ✅ quantiles | **Apache-2.0**, HF + GitHub | ✅ | **Observability / many-variate telemetry, IoT, metrics**; best single open model on GIFT-Eval near top |
| **TiRex** (NX-AI, Hochreiter) | **35M** | **xLSTM** (recurrent), enhanced ICL | ✅ | parallel univariate | limited | ✅ quantiles | open weights, HF + GitHub | ✅ (CPU-friendly, tiny) | **Best accuracy-per-param**; short+long horizons; edge/cheap deploy |
| **Chronos-2** (Amazon) | ~120M | T5-style **encoder**, group-attention ICL | ✅ | ✅ (universal) | ✅ past+known-future+categorical | ✅ quantiles | open source, HF + AutoGluon + SageMaker | ✅ | **Covariate-informed + multivariate** with one model; >90% win vs Chronos-Bolt |
| **Moirai 2.0** (Salesforce) | (compact, "less is more") | **decoder-only**, any-freq/any-var/any-horizon | ✅ | ✅ | ✅ | ✅ | open, `uni2ts` + HF | ✅ | #1-by-MASE among non-leaking; fast, general-purpose default |
| **Moirai-MoE** (Salesforce) | sparse MoE | MoE transformer, token-level expert specialization | ✅ | ✅ | ✅ | ✅ | open, `uni2ts` | ✅ | Heterogeneous mixed-frequency portfolios; ~17% over Moirai-1 at same size, up to **65× fewer active params** than Chronos/TimesFM |
| **TimesFM-2.5** (Google) | **200M** (down from 500M) | decoder-only, patch tokens, **16k context** (8× larger) | ✅ | univariate | ✅ via XReg | ✅ optional 30M quantile head | open weights, HF; **BigQuery GA** | ✅ + cloud | **Very long context**, GCP-native enterprises; largest pretrain corpus (~400B points) |
| **Sundial** (Ant/Tsinghua) | family | **generative**, flow-matching (TimeFlow Loss), no discrete tokenization | ✅ | ✅ | — | ✅ (samples multiple futures) | open, HF | ✅ | **Generative scenario fans** in ms; native continuous values; probabilistic scenario planning |
| **TabPFN-TS** (Prior Labs) | **~11M** (TabPFN-v2/v3 core) | TS-as-tabular-regression + PFN in-context | ✅ | via features | ✅ exogenous | ✅ | PyPI `tabpfn_time_series`; **check TabPFN core license** | ✅ (small) | **Short series, covariate-informed, small-data**; SOTA on covariate fev-bench despite synthetic-only pretrain |
| **TimeGPT-2 / 2.1** (Nixtla) | closed | proprietary GPT-for-TS | ✅ | ✅ | ✅ | ✅ + anomaly detection | **closed, API**; enterprise self-host by contract | ⚠️ contract-only | Zero-MLOps API; enterprise SLA; up to ~60% accuracy lift over v1 (vendor claim) |
| **Lag-Llama** (Morgan Stanley/ServiceNow/Mila) | small | decoder-only, **lags as covariates** | ✅ (weaker) | univariate | lag-based | ✅ full distributions | permissive OSS, HF + GitHub | ✅ (CPU/GPU) | Fully-open probabilistic baseline; strong **few-shot when fine-tuned** on small data |
| **Timer-S1 / Time-MoE / others** | varies | varies | ✅ | varies | varies | varies | mostly open | ✅ | Research frontier; appear mid-leaderboard |

**Key cross-cutting facts**
- **Zero-shot vs fine-tune.** All of the above run zero-shot. **Fine-tuning still helps** (the GIFT-Eval top entries `Toto-2.0-2.5B-FT`, LoRA-Chronos-2 beat their zero-shot versions). For Borjie, prefer zero-shot first; only fine-tune (LoRA/PEFT) if you have enough in-domain mining history and a clear accuracy gap to close.
- **In-context learning (ICL) is the 2026 unlock.** Chronos-2 (group attention) and TabPFN-TS (PFN) forecast *new related series and covariates with no retraining* — directly useful for **cold-start** new mining sites / new mineral SKUs.
- **Agentic ensembling is the new top of the board.** "Cobra-Agent", "TimeCopilot", "TSOrchestra" are *model-routers/ensembles* that pick or blend TSFMs per series. This is the same architectural pattern Borjie should adopt internally (a router), rather than betting on one model.

---

## 3. Strong classical & deep baselines (do NOT skip these)

### 3.1 Statistical (the real floor — and Borjie's rule-based decision input)
- **Nixtla `statsforecast`**: `AutoARIMA`, `AutoETS`, `AutoTheta`, `AutoCES`, `AutoMFLES`, `AutoTBATS`, plus baselines `SeasonalNaive`, `Naive`, `RandomWalkWithDrift`, `WindowAverage`, `HistoricAverage`. AutoARIMA is ~**20× faster than pmdarima**, AutoETS ~**4× faster than statsmodels**, scales to millions of series. ([GitHub](https://github.com/Nixtla/statsforecast), [models](https://nixtlaverse.nixtla.io/statsforecast/src/core/models.html))
- **Why they still matter:** they are the **mandatory accuracy floor**. A foundation model that can't beat `AutoETS` / `SeasonalNaive` on your data is not worth its cost. The literature repeatedly shows SARIMAX with good features ties TimeGPT, and statistical models win at very high frequency and on narrow stable workloads. ([Nixtla: baselines](https://www.nixtla.io/blog/baseline-forecasts), parity findings in [arXiv:2510.00742](https://arxiv.org/pdf/2510.00742))

### 3.2 Intermittent / sparse demand (critical for spare parts, consumables, low-volume minerals)
- **Croston, SBA, TSB** — classical heuristics; still the deployment default for intermittent SKUs.
- **2026 SOTA upgrade:** **TSB-HB** (Taxonomy-Conditioned Hierarchical Bayesian TSB) — Beta-Binomial occurrence × Log-Normal size with hierarchical priors → **partial pooling stabilizes sparse/cold-start series**; lowest RMSE/RMSSE on UCI Online Retail, improves MAE/RMSE over classical intermittent baselines on an M5 sample. ([arXiv:2511.12749](https://arxiv.org/abs/2511.12749))
- **Note:** general TSFMs are **weak on heavy intermittency / zero-inflation** unless explicitly handled — route intermittent series to Croston/TSB/TSB-HB, not to a transformer.

### 3.3 Gradient-boosted (tabular-feature) models
- **LightGBM / XGBoost / CatBoost** over engineered lag/calendar/exogenous features (the `mlforecast` pattern). Won M5; remain the pragmatic SOTA for **many-series retail/demand with rich covariates** and tight latency/cost. Cheap to train, easy to explain, native categorical/holiday handling.

### 3.4 Deep models (specialist, fine-tuned)
- **PatchTST** — patching + channel-independence; strong long-horizon univariate; widely available (HF `transformers`). ([HF docs](https://huggingface.co/docs/transformers/model_doc/patchtst))
- **N-BEATS / N-HiTS** — pure-DL basis expansion; **N-HiTS** adds multi-rate sampling + hierarchical interpolation → efficient long-horizon, very fast inference.
- **TFT (Temporal Fusion Transformer)** — LSTM encoder + multi-head attention; **best when you have rich known-future covariates + need interpretability** (variable-selection weights). Strong fit for mining where you know future prices forwards, shift schedules, planned maintenance.
- **iTransformer / TimeMixer / TimeXer / TSMixer** — 2024–26 efficient architectures competitive on long-horizon multivariate; `TimeMixer` good short+long, `iTransformer` inverts the attention over variates.
- **Tradeoff:** these need per-dataset training and tuning. They beat zero-shot TSFMs *when you invest the training*, but lose the zero-shot/cold-start advantage and add MLOps.

---

## 4. Decision matrix — which method for which regime

Pick by **data regime**, not by leaderboard rank. Rows = your data; columns = recommended approach.

| Data regime | First choice | Strong alternative | Avoid | Why |
|---|---|---|---|---|
| **Short series** (< ~2–3 seasonal cycles) | **TabPFN-TS** or **AutoETS/AutoTheta** | TiRex (zero-shot), Chronos-2 ICL | training-heavy deep nets (TFT/PatchTST) | Not enough data to fit/learn; PFN ICL + statistical shrinkage win |
| **Cold-start new entity** (new site/SKU, no history) | **Chronos-2 / TabPFN-TS** (in-context related series) | hierarchical pooling (TSB-HB), global GBM | per-series ARIMA | ICL borrows strength from related series; pooling stabilizes |
| **Many similar series, rich covariates** (demand, royalty by SKU) | **LightGBM/`mlforecast`** | **Chronos-2** (covariate ICL), TFT | per-series ARIMA (too slow) | Global model + features is the M5-proven workhorse |
| **Intermittent / sparse demand** (spare parts, consumables) | **Croston/SBA/TSB** → **TSB-HB** | global GBM with zero-inflation | vanilla TSFMs, plain ARIMA | Transformers + ARIMA mishandle zeros |
| **Hierarchical / coherent aggregates** (estate→subsidiary→site→mineral) | base forecaster + **MinT reconciliation** (`HierarchicalForecast`) | bottom-up, temporal hierarchies | unreconciled independent forecasts | Coherence across levels is a business requirement; MinT is theory-backed |
| **High-frequency** (minutely/secondly telemetry) | **statistical baselines** / lightweight DL | Toto-2.0 (if multivariate metrics) | large TSFMs as default | Lit shows classics hard to beat at very high freq; cost explodes |
| **Many correlated channels / observability / IoT** | **Toto-2.0** (BOOM-SOTA) | Chronos-2, Moirai (multivariate) | univariate-only TSFMs (TimesFM, TiRex single) | Purpose-built for many-variate metrics |
| **Very long context / long lookback** | **TimesFM-2.5** (16k ctx) | Toto-2.0, Moirai 2.0 | short-context models | Only some models accept very long history |
| **Long horizon, single high-value series, can train** | **PatchTST / N-HiTS / TFT** (fine-tuned) | Toto-2.0-FT, Chronos-2 LoRA | zero-shot only (leaves accuracy on table) | Fine-tuned specialists peak when you invest |
| **Need scenario fans / probabilistic planning** | **Sundial** (generative samples) or any quantile TSFM + **conformal** | Lag-Llama (full distributions) | point-only models | Mining treasury/FX needs distributional, not point |
| **Need interpretability / regulator-facing** | **AutoETS/ARIMA, TFT** (var-selection), GBM (SHAP) | — | black-box TSFM as sole basis | Borjie evidence/audit rails demand explainable basis |
| **Zero-MLOps, fastest to ship, accept vendor** | **TimeGPT-2 API** | self-host Toto/Chronos via AutoGluon | building everything in-house first | Trade control/residency for speed |
| **Default open self-host single model** | **Toto-2.0 (313m/1B)** or **Moirai 2.0** | TiRex (tiny), Chronos-2 (covariates) | — | Apache-2.0, strong, CPU/GPU flexible |

**Horizon quick-rule:** very-short/short → statistical + TabPFN-TS; medium → TSFM (Toto/Chronos/Moirai) or GBM; long → TimesFM-2.5 (context), Toto-2.0, or fine-tuned PatchTST/N-HiTS. **Always reconcile** if forecasts roll up a hierarchy, and **always conformalize** the intervals.

---

## 5. Self-host vs API; latency & cost

- **Self-host open weights (recommended for Borjie):** Toto-2.0, Chronos-2, Moirai 2.0/MoE, TimesFM-2.5, TiRex, Sundial, TabPFN-TS, Lag-Llama. **TiRex (35M)** and **TabPFN-TS (~11M)** and **Toto-4m/22m** run on **CPU** with low latency — viable in the api-gateway/worker tier without GPUs. Sundial advertises **ms-scale** zero-shot inference. Toto-2.0 313m runs at latency comparable to Chronos-2 (120M); single-pass mode keeps latency flat to ~768-step horizons. Larger sizes (Toto-1B/2.5B, TimesFM-200M) want a GPU for batch throughput.
- **AutoGluon-TimeSeries** is the easiest harness to host/ensemble Chronos-2 + classical + GBM behind one API and auto-select.
- **API (TimeGPT-2/2.1, Nixtla):** no MLOps, enterprise SLA, anomaly detection included, supports self-host/Azure by contract; **pricing is enterprise sales-led (no public per-call tiers; typical enterprise budgets cited in the $50k–200k+/yr range)**. Tradeoff: **data leaves your tenancy unless you contract self-host** — a concern for mining/financial data residency and Borjie's RLS/tenant-isolation posture. ([TimeGPT-2](https://www.nixtla.io/blog/timegpt-2-announcement), [pricing](https://www.nixtla.io/docs/introduction/timegpt_subscription_plans))
- **Cost discipline:** classical baselines are ~free per call; a CPU TSFM is cents; GPU TSFMs and APIs are the expensive tail. The **router pattern** (cheap floor first, escalate to TSFM only when it demonstrably beats the floor on held-out data) is the cost-optimal design.

---

## 6. Recommendation for Borjie (brain-layer wiring)

Treat forecasting as an **advisory portfolio behind a router**, append-only to the rule-based decision layer, fully conformalized, with provenance per forecast:

1. **Floor (always on, rule-input):** `statsforecast` `AutoETS` + `SeasonalNaive` (+ `Croston/TSB-HB` for intermittent SKUs). Cheap, explainable, the accuracy floor every model must beat. These feed the **rule-based decision** directly — predictions only *append* on top.
2. **Advisory TSFM (self-hosted, Apache-2.0):** start with **one** — **Toto-2.0 (313m/1B)** if data is many-variate telemetry/observability-like (mining IoT/production), or **Chronos-2** if you need **covariate-informed** forecasts (prices, FX, planned events) and cold-start ICL for new sites. **TiRex (35M)** as the CPU-cheap zero-shot fallback. Host via **AutoGluon-TimeSeries** so you can blend + auto-select.
3. **Conformal wrapper (rail-mandated):** wrap every model's quantiles with **split-conformal / CQR** using Borjie's existing conformal calibration so intervals carry coverage guarantees. Never surface raw TSFM quantiles as decision intervals.
4. **Hierarchical reconciliation:** apply **MinT** (`HierarchicalForecast`) so estate→subsidiary→site→mineral roll-ups are coherent.
5. **Evidence + provenance:** every forecast emits an `evidence_id` capturing {model, version, input window, horizon, conformal coverage, baseline-beaten?}. The Auditor rejects forecasts that don't beat the floor or lack provenance — consistent with the "evidence-required AI output" rail.
6. **Defer:** TimeGPT-2 API unless a stakeholder explicitly wants zero-MLOps and accepts the residency tradeoff. Fine-tuning (LoRA Chronos-2 / Toto-FT / PatchTST) only after you've measured a real, persistent accuracy gap on in-domain mining series.

**Why this and not "just use the #1 leaderboard model":** the leaderboard top is agentic ensembles and leakage-flagged/fine-tuned entries; single-model zero-shot margins are within bootstrapped CIs (fev-bench); and the controlled critique ([arXiv:2510.00742](https://arxiv.org/pdf/2510.00742)) shows classics still win in several regimes Borjie will hit (high-freq telemetry, intermittent parts, OOD mining prices). A router with a classical floor + one strong open TSFM + conformal + reconciliation is the robust, rail-compliant, cost-aware choice.

---

## 7. Sources

**Foundation models**
- TimesFM-2.5 (Google): https://www.marktechpost.com/2025/09/16/google-ai-ships-timesfm-2-5-smaller-longer-context-foundation-model-that-now-leads-gift-eval-zero-shot-forecasting/ · https://research.google/blog/a-decoder-only-foundation-model-for-time-series-forecasting/
- Chronos-2 (Amazon): https://www.amazon.science/blog/introducing-chronos-2-from-univariate-to-universal-forecasting · https://huggingface.co/amazon/chronos-2 · https://arxiv.org/html/2510.15821v1 · https://github.com/amazon-science/chronos-forecasting
- Toto-2.0 + BOOM (Datadog): https://www.datadoghq.com/blog/ai/toto-2/ · https://www.datadoghq.com/blog/ai/toto-boom-unleashed/ · https://arxiv.org/abs/2505.14766 · https://huggingface.co/Datadog/Toto-2.0-4m · https://github.com/datadog/toto
- Moirai 2.0 / Moirai-MoE (Salesforce): https://www.salesforce.com/blog/moirai-2-0/ · https://www.salesforce.com/blog/time-series-morai-moe/ · https://arxiv.org/abs/2410.10469 · https://arxiv.org/pdf/2511.11698 · https://github.com/SalesforceAIResearch/uni2ts
- TiRex (NX-AI, xLSTM): https://huggingface.co/NX-AI/TiRex · https://github.com/NX-AI/tirex · https://tsfm.ai/blog/tirex-nx-ai-xlstm-forecasting
- Sundial (Ant/Tsinghua): https://arxiv.org/abs/2502.00816 · https://arxiv.org/html/2502.00816v1
- TabPFN-TS (Prior Labs): https://github.com/PriorLabs/tabpfn-time-series · https://arxiv.org/abs/2501.02945 · https://docs.priorlabs.ai/capabilities/forecasting
- TimeGPT / TimeGPT-2 (Nixtla): https://www.nixtla.io/blog/timegpt-2-announcement · https://www.nixtla.io/blog/timegpt-2-1-announcement · https://www.nixtla.io/docs/introduction/about_timegpt · https://www.nixtla.io/docs/introduction/timegpt_subscription_plans · https://github.com/Nixtla/nixtla
- Lag-Llama: https://arxiv.org/abs/2310.08278 · https://github.com/time-series-foundation-models/lag-llama

**Benchmarks**
- GIFT-Eval: https://www.salesforce.com/blog/gift-eval-time-series-benchmark/ · https://arxiv.org/abs/2410.10393 · https://huggingface.co/spaces/Salesforce/GIFT-Eval · https://tsfm.ai/benchmarks/gift-eval
- fev-bench: https://arxiv.org/abs/2509.26468 · https://arxiv.org/html/2509.26468v1 · https://huggingface.co/datasets/autogluon/fev_datasets
- BOOM/TIME (Datadog): https://www.datadoghq.com/blog/ai/toto-boom-unleashed/

**Classical / deep baselines & critique**
- "How Foundational are Foundation Models for Time Series Forecasting?": https://arxiv.org/pdf/2510.00742
- statsforecast (Nixtla): https://github.com/Nixtla/statsforecast · https://nixtlaverse.nixtla.io/statsforecast/src/core/models.html · https://www.nixtla.io/blog/baseline-forecasts
- Intermittent demand / TSB-HB: https://arxiv.org/abs/2511.12749
- PatchTST: https://huggingface.co/docs/transformers/model_doc/patchtst
- Hierarchical reconciliation / MinT: https://nixtlaverse.nixtla.io/hierarchicalforecast/examples/nonnegativereconciliation.html · https://otexts.com/fpppy/nbs/11-hierarchical-forecasting.html
- TSFM strengths/limitations & zero/few/full-shot evals: https://aihorizonforecast.substack.com/p/time-series-foundation-models-a-deep · https://www.mdpi.com/2813-0324/11/1/32
