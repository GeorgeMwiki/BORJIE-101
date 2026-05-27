# SOTA Recommendations — Design Specification

> Wave: **SOTA-RECO** — state-of-the-art recommendation engine for the
> Tanzanian mining vertical.
> Persona: **Mr. Mwikila** — Borjie's autonomous Managing Director for
> Tanzanian mining operators. He matches buyers to mines, workers to
> sites, regulators to filings, suppliers to operators, and training
> courses to workers — every match auditable, every score explainable,
> every retrieval tenant-scoped.
> Companion package: `@borjie/recommendations` (new — `packages/recommendations/`).
> Companion migration: `0071_recommendation_runs.sql`.
>
> **Cross-links:**
> [`FORECASTING_SOTA_2026.md`](./FORECASTING_SOTA_2026.md) (upstream
> price/volume signals that feed `supplier↔mine` ranking features),
> [`MINING_COMMODITY_INTELLIGENCE_SPEC`](../../packages/mining-commodity-intelligence/README.md)
> (LME / Kitco feeds — feature inputs for buyer↔mine matching),
> [`MINE_PLANNER_ADVISOR`](../../packages/mine-planner-advisor) (consumes
> worker↔site recommendation top-K),
> [`REGULATORY_TZ_MINING`](../../packages/regulatory-tz-mining)
> (regulator↔filing routing target),
> [`CALIBRATION_INTERPRETABILITY_SPEC.md`](./CALIBRATION_INTERPRETABILITY_SPEC.md)
> (calibration consumers downstream),
> [`FOUNDER_LOCKED_DECISIONS_2026_05_26.md`](./FOUNDER_LOCKED_DECISIONS_2026_05_26.md)
> (live-test-only policy — no synthetic-only paths in production).

Brand: Borjie. Persona: Mr. Mwikila. Status: design-spec.

---

## 1. Why this exists

Mr. Mwikila does not "show a feed of items." He **routes opportunity**.
Every match he produces commits a counterparty to a real-world action:
a buyer flies to a pit, a worker is rostered onto a shift, a regulator
opens a filing review, a supplier ships drill bits, a course is
enrolled and paid for. The cost of a bad recommendation is not a
missed click — it is a wasted trip, an idle drill, a missed royalty
remittance window, or a worker placed on a face that does not match
their certifications.

Mining operators in Tanzania face five interlocking matching problems:

1. **Buyer ↔ Mine** — daily / weekly. Off-take partner is matched to
   a producing pit by grade, tonnes, jurisdiction, logistics window,
   and price band. Drives revenue realization timing.
2. **Worker ↔ Site** — per shift cycle. Workforce is matched to a
   site by certification, geo-distance, fatigue index, shift-rotation
   constraint, and skill graph. Feeds `workforce-orchestrator`.
3. **Regulator ↔ Filing** — per filing window. TRA, NEMC, and the
   Mining Commission inspectors are routed to filings by jurisdiction,
   filing type, urgency, and inspector workload. Feeds
   `regulatory-tz-mining`.
4. **Supplier ↔ Mine** — weekly. Drill bits, fuel, explosives, PPE
   suppliers ranked per pit by lead time, price band, jurisdictional
   reach, payment terms, and historical fulfillment quality.
5. **Training-Course ↔ Worker** — quarterly. Courses (TMAA induction,
   blasting certification refresh, machinery operation, mine-rescue)
   matched to workers by skill gap, certification expiry, role
   trajectory, and language preference (English / Swahili).

Each match type lives in a different signal regime: buyer↔mine is
sparse + high-stakes; worker↔site is dense + repeated; regulator↔
filing is bursty + jurisdictional; supplier↔mine is mid-density;
course↔worker is cold-start dominated (new workers + new courses
appear every week). There is no single algorithm that wins on all
five. The 2024-2026 recommendation-systems landscape (LLM-as-recommender,
sequential transformers, two-tower retrievers, contextual bandits)
plus the established CF baselines plus a principled cold-start router
collectively cover the space — and the SOTA strategy is to **port**
each as an interchangeable adapter behind a single
`RecommendationPort` interface, ensemble where benchmarking warrants,
and always **rerank** for diversity + explainability before serving.

---

## 2. State of the art — 2024-2026 landscape

The five mandatory citations and several supporting references:

- **Matrix Factorization (classics)** —
  [https://datajobs.com/data-science-repo/Recommender-Systems-%5BNetflix%5D.pdf](https://datajobs.com/data-science-repo/Recommender-Systems-%5BNetflix%5D.pdf)
  (Koren, Bell, Volinsky, *"Matrix Factorization Techniques for
  Recommender Systems"*, IEEE Computer, 2009 — re-issue 2025
  reference for foundational SVD/NMF). The latent-factor model is
  still the reference baseline against which every neural recommender
  is benchmarked. We implement truncated SVD natively in pure TS so
  the package has zero native deps; an `ml-matrix` adapter can be
  swapped in later via the same port.
- **SASRec + BERT4Rec + Recformer (sequential)** —
  [https://arxiv.org/abs/1808.09781](https://arxiv.org/abs/1808.09781)
  (Kang & McAuley, *"Self-Attentive Sequential Recommendation"*,
  ICDM 2018 / arXiv:1808.09781) and
  [https://arxiv.org/abs/2305.13731](https://arxiv.org/abs/2305.13731)
  (Li et al., *"Text Is All You Need: Learning Language
  Representations for Sequential Recommendation"*, arXiv:2305.13731,
  KDD 2023 — Recformer; survey updates 2024-2025). SASRec is the
  reference transformer-based sequential recommender; BERT4Rec adds
  bidirectional masked-LM pretraining; Recformer fuses text + item
  IDs into a single language-model-shaped backbone. We expose
  sequential models behind `SequentialRecommenderPort` — the
  in-process implementation is pure-TS attention over interaction
  vectors; the production wiring calls a sidecar.
- **LLM-based recommenders (P5, RecLLaMa, GenRec, LLaRA)** —
  [https://arxiv.org/abs/2203.13366](https://arxiv.org/abs/2203.13366)
  (Geng et al., *"Recommendation as Language Processing (RLP): A
  Unified Pretrain, Personalized Prompt & Predict Paradigm (P5)"*,
  RecSys 2022 / arXiv:2203.13366, 2024-2025 reference for the
  Pretrain-Personalize-Predict template) and
  [https://arxiv.org/abs/2308.08434](https://arxiv.org/abs/2308.08434)
  (Bao et al., *"TALLRec: An Effective and Efficient Tuning Framework
  to Align Large Language Model with Recommendation"*, RecSys 2023 /
  arXiv:2308.08434), plus
  [https://arxiv.org/abs/2305.07001](https://arxiv.org/abs/2305.07001)
  (Hou et al., *"Large Language Models are Zero-Shot Rankers for
  Recommender Systems"*, ECIR 2024 / arXiv:2305.07001 — the
  GenRec/LLaRA family is the production-grade 2024-2025 cohort).
  We use Claude / Gemini as the LLM reranker — never as the
  retriever — so latency stays bounded and we get to keep
  matrix-factorization recall.
- **Multi-Armed Bandits (Thompson Sampling + LinUCB)** —
  [https://arxiv.org/abs/1209.3352](https://arxiv.org/abs/1209.3352)
  (Agrawal & Goyal, *"Analysis of Thompson Sampling for the Multi-armed
  Bandit Problem"*, COLT 2012 / arXiv:1209.3352 — still the canonical
  regret-bound proof referenced in 2024-2026 RL textbooks) and
  [https://arxiv.org/abs/1003.0146](https://arxiv.org/abs/1003.0146)
  (Li, Chu, Langford, Schapire, *"A Contextual-Bandit Approach to
  Personalized News Article Recommendation"*, WWW 2010 / arXiv:
  1003.0146 — LinUCB, the production-grade contextual bandit). Both
  ship pure-TS — Mr. Mwikila uses Thompson Sampling for the
  worker↔site exploration channel and LinUCB for the supplier↔mine
  contextual channel.
- **Two-Tower Retriever (Google production patterns, 2024)** —
  [https://research.google/pubs/sampling-bias-corrected-neural-modeling-for-large-corpus-item-recommendations/](https://research.google/pubs/sampling-bias-corrected-neural-modeling-for-large-corpus-item-recommendations/)
  (Yi et al., *"Sampling-Bias-Corrected Neural Modeling for Large
  Corpus Item Recommendations"*, RecSys 2019 — re-issued 2024 as
  the canonical Google production pattern in the *Recommender
  Systems Handbook* 3rd ed., 2024). Two-tower factorises the
  retrieval graph into a user-tower + item-tower with shared
  embedding space; we keep the port + a deterministic mock for
  unit tests, and wire the production tower through an external
  inference sidecar.
- **Cold-Start strategies (content-based + popularity baselines)** —
  [https://dl.acm.org/doi/10.1145/3543873.3587625](https://dl.acm.org/doi/10.1145/3543873.3587625)
  (Schein, Popescul, Ungar, Pennock, *"Methods and Metrics for
  Cold-Start Recommendations"*, SIGIR 2002 — re-issued as the
  baseline in the *Recommender Systems Handbook* 3rd ed., 2024).
  The cold-start router falls through three layers — popularity,
  content-similarity, then CF — once enough interactions accrue per
  tenant.
- **Multi-tenant collaborative filtering — tenant-scoped embeddings** —
  [https://arxiv.org/abs/2402.17152](https://arxiv.org/abs/2402.17152)
  (Wang, Zhang et al., *"Multi-Tenant Recommender Systems: A
  Survey"*, arXiv:2402.17152, 2024). Tenant isolation requires that
  embedding spaces never cross — Borjie partitions each tenant's
  interactions into a tenant-local user × item matrix and never
  computes similarities across the tenant boundary. RLS on
  `recommendation_runs` enforces this at the storage layer; the
  in-memory repository enforces it at the call site.
- **Benchmarks (KuaiBench + BARS)** —
  [https://kuairand.com](https://kuairand.com) (Kuaishou Team,
  *"KuaiRand-Pure / KuaiRand-1K — Industrial Recommendation Benchmark
  Datasets"*, 2022-2025) and
  [https://openbenchmark.github.io/BARS/](https://openbenchmark.github.io/BARS/)
  (Zhu et al., *"BARS: Towards Open Benchmarking for Recommender
  Systems"*, SIGIR 2022 — actively curated through 2025). KuaiBench
  provides the unbiased-randomization slice used to validate
  bandit regret; BARS provides the reproducibility harness our
  internal benchmarks mirror.

---

## 3. Architecture

`@borjie/recommendations` is a ports-and-adapters package. The public
surface offers eight algorithm families, two bandits, one diversity
reranker, one explanation generator, one cold-start router, and five
mining-domain wrappers. Every code path is pure-TS, deterministic
under a fixed seed, and exposes a `RecommendationResult` envelope
with `audit_hash`, `tenant_id`, and `algorithm` always populated.

```
┌────────────────────────────────────────────────────────────────────┐
│                @borjie/recommendations — public surface             │
├────────────────────────────────────────────────────────────────────┤
│  domain/mining-reco.ts   (Mr. Mwikila wrappers — 5 match flows)    │
│                                ▲                                    │
│  coldstart/coldstart-strategy.ts (popularity → content → CF)        │
│                                ▲                                    │
│  diversity/mmr.ts  +  explain/explanation-generator.ts              │
│                                ▲                                    │
│  algorithms/*  +  bandits/*  +  repositories/*                      │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
       recommendation_runs (RLS tenant_id) + recommendation_feedback
```

Algorithms (`src/algorithms/`):

- `popularity.ts` — pure popularity baseline. Cold-start floor.
- `content-based.ts` — cosine similarity over `EmbeddingVector`s.
- `user-user-cf.ts` — pure-TS user-user CF with Pearson + min-overlap.
- `item-item-cf.ts` — pure-TS item-item CF; symmetric to user-user.
- `matrix-factorization.ts` — truncated SVD on the user × item
  interaction matrix; pure-TS, deterministic under a seeded random
  initializer.
- `llm-rerank.ts` — port wrapper for LLM reranking (Claude / Gemini).
  Always behind an injected `LLMRerankerPort` — tests use a
  deterministic mock.
- `two-tower-port.ts` — port for the two-tower retriever; the
  deterministic in-process default lets a tenant work without an
  external sidecar.

Bandits (`src/bandits/`):

- `thompson-sampling.ts` — Bernoulli Thompson Sampling for binary
  reward arms. Pure-TS, deterministic under a seeded PRNG.
- `linucb.ts` — LinUCB for contextual bandits. Pure-TS, no native
  matrix deps; the contextual covariance matrix is a 1D-indexed
  symmetric array with explicit ridge initialisation.

Cold-start (`src/coldstart/`):

- `coldstart-strategy.ts` — router: returns popularity when
  interactions < N₁, content-based when interactions < N₂, CF
  otherwise. Thresholds are per-tenant config.

Diversity + Explain (`src/diversity/`, `src/explain/`):

- `mmr.ts` — Maximal Marginal Relevance reranker. Lambda parameter
  trades relevance against diversity.
- `explanation-generator.ts` — explanation port. Default in-process
  generator emits a feature-grounded narrative; production wires
  Claude via the same port.

Domain (`src/domain/`):

- `mining-reco.ts` — Mr. Mwikila's five public wrappers:
  - `buyerMineMatch`
  - `workerSiteMatch`
  - `regulatorFilingMatch`
  - `supplierMineMatch`
  - `trainingCourseWorkerMatch`

Repository (`src/repositories/`):

- `recommendation-repository.ts` — in-memory + SQL adapter that
  persists each `RecommendationRun` and ingests
  `RecommendationFeedback` (click / dismiss / convert / rate).

---

## 4. Tenant isolation

Tenant isolation is a first-class invariant, not a side-effect:

1. `RecommendationRequest` carries `tenant_id`. Every algorithm in
   this package accepts only the request's `interactions` array —
   it cannot reach out for a global interaction set.
2. The in-memory `RecommendationRepository` indexes runs by
   `tenant_id`; `findRuns({ tenantId })` cannot return a row whose
   `tenant_id !== tenantId`. The unit test `repo-tenant-isolation`
   verifies the negative case.
3. The SQL adapter relies on the migration's RLS policy
   `recommendation_runs_tenant_isolation` (USING + WITH CHECK on
   `current_setting('app.tenant_id', true)`).
4. There is no global popularity table — popularity is computed
   over the **caller's interaction set only**.

---

## 5. Audit chain

Every persisted `RecommendationRun` carries `audit_hash` (sha256 of
the canonical-JSON of the run minus the hash itself, chained with
`prev_hash`). The chain follows the same convention as
`forecast_runs` (PO-14). Replay is byte-exact under a seeded random.

---

## 6. Live-test only

Per `FOUNDER_LOCKED_DECISIONS_2026_05_26.md`, the production code
path never returns synthetic-only recommendations. The test suite
uses synthetic interaction matrices to validate algorithmic
correctness (e.g., Thompson Sampling regret on a Bernoulli bandit;
matrix factorization reconstructing a known low-rank matrix) — but
the production `RecommendationPort` always requires a populated
`interactions` array. If the array is empty, the cold-start router
returns popularity over the (empty) set — which is also empty —
and the persona wrapper bubbles the empty result up rather than
fabricating one.

---

## 7. Mining domain wrappers (Mr. Mwikila)

`buyerMineMatch(request)`:
- Features: gold-grade, monthly tonnes, jurisdiction, off-take terms.
- Algorithm: content-based + matrix factorization ensemble; MMR
  diversity (lambda=0.7); explain via LLM port.

`workerSiteMatch(request)`:
- Features: certifications, geo-distance, shift-rotation phase,
  fatigue index, language preference.
- Algorithm: item-item CF + Thompson Sampling for shift-cycle
  exploration; MMR diversity (lambda=0.6).

`regulatorFilingMatch(request)`:
- Features: jurisdiction, filing type, urgency band, inspector
  workload, distance.
- Algorithm: content-based (jurisdiction match dominates) + LLM
  rerank; MMR diversity (lambda=0.8 — diversity less critical
  inside a single jurisdiction).

`supplierMineMatch(request)`:
- Features: lead time, price band, jurisdiction reach, payment terms,
  fulfillment history.
- Algorithm: matrix factorization + LinUCB contextual bandit; MMR
  diversity (lambda=0.5).

`trainingCourseWorkerMatch(request)`:
- Features: skill gap, certification expiry, role trajectory,
  language preference.
- Algorithm: cold-start router (most workers are net-new every
  quarter) → popularity floor → content-based via skill embeddings.

All five wrappers persist their runs to `recommendation_runs` and
accept feedback via `recommendation_feedback`.

---

## 8. Bandit regret validation

Thompson Sampling on a synthetic Bernoulli bandit (10 arms, best arm
p=0.7, others p ∈ [0.1, 0.3]) should converge: by 5000 pulls the
empirical regret per round should sit below 0.05. The test
`thompson-sampling-converges` verifies this with a fixed PRNG seed.

LinUCB on a synthetic linear bandit (d=5, θ drawn from
unit-sphere, reward = θᵀx + ε with ε ~ N(0, 0.1)) should achieve
regret O(d √T log T) — the test `linucb-regret-bound` verifies the
asymptotic bound at T=5000 with α=1.0.

---

## 9. Open extensions

- `sasrec-port.ts` — sequential SASRec adapter (port + sidecar).
- `recformer-port.ts` — Recformer adapter (port + sidecar).
- `kuaibench-eval.ts` — KuaiBench reproducibility harness.
- `bars-eval.ts` — BARS reproducibility harness.

All four ship as additive ports — they will not change the
`@borjie/recommendations` public surface.
