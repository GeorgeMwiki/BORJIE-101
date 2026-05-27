# SOTA Data Analysis for Borjie — 2026

**Persona owner:** Mr. Mwikila (mining operator, royalty analyst, safety officer)
**Package:** `@borjie/data-analysis`
**Status:** Phase 1 specification — pure-TypeScript SOTA statistical and analytical primitives, capability-catalogue addressable.
**Last reviewed:** 2026-05-27

---

## 1. Motivation

Mr. Mwikila runs a multi-site artisanal-to-mid-tier mining operation. His daily decisions hinge on statistics he cannot trust to spreadsheets:

- "Is Pit B genuinely under-performing Pit A, or did we just have a bad week?" — a Welch t-test, not eyeballing means.
- "Did the new royalty schedule statistically shift our effective rate?" — a paired-sample comparison with confidence intervals.
- "Are the lost-time injuries correlated with the night-shift roster, or with weather, or both?" — Pearson + partial-Spearman, plus a chi-square on categorical co-occurrence.
- "Which buyers cluster together by purchase cadence and grade preference?" — k-means + DBSCAN with silhouette validation.
- "Across the seven extraction sites, which dimensions explain 90 % of variance in throughput?" — PCA on standardised features.

The platform must surface these answers conversationally, but the **arithmetic must be unimpeachable**. That is the mandate of `@borjie/data-analysis`: every primitive validated against published reference vectors to ≥ 6 decimal places, every algorithm cited to a peer-reviewed source or a canonical implementation. No black-box LLM inference for numbers — the numbers are computed deterministically and the LLM only **describes** them.

This package is the analytical floor underneath every "Mr. Mwikila, what does the data say?" loop in the system.

## 2. Scope boundary

In scope:

- Descriptive statistics (mean, median, quantiles, variance, skewness, kurtosis, IQR, mode, histograms).
- Classical inferential tests (one-sample / two-sample / Welch t-tests, chi-square, one-way ANOVA, Mann-Whitney U, Kruskal-Wallis H).
- Correlation matrices (Pearson, Spearman, Kendall).
- Regression (ordinary least squares, polynomial via Vandermonde, logistic regression via IRLS).
- Continuous and discrete distributions (Normal, Beta, Binomial, Poisson, Exponential, Gamma, Uniform) with pdf / cdf / quantile / sample.
- Unsupervised clustering (k-means++, DBSCAN, agglomerative hierarchical).
- Dimensionality reduction (PCA via covariance SVD; UMAP-lite neighbour-graph port).
- Sampling (simple random, stratified, reservoir, bootstrap).
- A minimal in-process DataFrame (no pandas dependency) supporting `select / filter / groupby / aggregate`.
- Mining-domain wrappers: `sitePerformanceStats`, `royaltyRateAnalysis`, `safetyIncidentCorrelation`, `buyerCohortAnalysis`.

Out of scope (lives elsewhere):

- Time-series forecasting → `@borjie/forecasting` (TGN + conformal prediction).
- Anomaly detection → `@borjie/forecasting/anomaly`.
- Geo-spatial primitives → `@borjie/geo-platform`.
- LLM-based narrative generation → `@borjie/executive-brief-engine`.

## 3. Library landscape — citations

Each algorithm in this package is implemented against the canonical reference. All citations are URL + title + date-checked.

1. **simple-statistics 8.x** — A canonical, MIT-licensed library of descriptive and basic inferential statistics in pure JavaScript. Used here as a reference *implementation* for cross-checking, not as a runtime dependency. URL: <https://github.com/simple-statistics/simple-statistics>. Date checked: 2026-05-27.

2. **Danfo.js** — Pandas-style DataFrame for JavaScript built on TensorFlow.js. We deliberately **do not** depend on it (the TF.js footprint is wrong for our edge agents), but its DataFrame surface informed `lite-dataframe.ts`. URL: <https://danfo.jsdata.org/>. Date checked: 2026-05-27.

3. **ml.js (ml-matrix, ml-clust, ml-pca)** — A collection of MIT-licensed numerical and ML primitives. `ml-matrix` is the canonical reference for our OLS normal-equation solve; we re-implement to keep the dependency surface minimal. URL: <https://github.com/mljs>. Date checked: 2026-05-27.

4. **Apache Arrow JS + DuckDB-WASM** — Considered for the DataFrame layer. Decision: defer. Arrow buys columnar zero-copy, but Mr. Mwikila's working sets fit in ≤ 100 MB and the deploy footprint of WASM bindings is prohibitive for our agent runtimes. URLs: <https://arrow.apache.org/docs/js/> and <https://duckdb.org/docs/api/wasm/overview>. Date checked: 2026-05-27.

5. **regression-js** — Compact MIT-licensed OLS / polynomial / power / exponential regression. We re-implement OLS for cleaner type contracts. URL: <https://github.com/Tom-Alexander/regression-js>. Date checked: 2026-05-27.

6. **jStat** — JavaScript port of R's `stats` distribution functions. Reference for our pdf / cdf / quantile implementations. URL: <https://github.com/jstat/jstat>. Date checked: 2026-05-27.

7. **SciPy / statsmodels (Python sidecar option)** — When a tenant requires PhD-grade statistics (mixed-effects models, survival analysis), we shell out to a sidecar. Versions pinned: SciPy 1.13+, statsmodels 0.14+. URLs: <https://docs.scipy.org/doc/scipy/> and <https://www.statsmodels.org/stable/>. Date checked: 2026-05-27.

Peer-reviewed primary sources for the algorithms themselves:

- Welch, B. L. (1947). *The generalization of "Student's" problem when several different population variances are involved.* Biometrika 34(1/2):28-35. — basis for `welch-t.ts`. <https://doi.org/10.2307/2332510>.
- Pearson, K. (1895). *Notes on regression and inheritance in the case of two parents.* Proceedings of the Royal Society of London 58:240-242. — basis for `correlation/pearson.ts`. <https://www.jstor.org/stable/115794>.
- Spearman, C. (1904). *The proof and measurement of association between two things.* American Journal of Psychology 15(1):72-101. — basis for `correlation/spearman.ts`. <https://doi.org/10.2307/1412159>.
- Kendall, M. G. (1938). *A new measure of rank correlation.* Biometrika 30(1/2):81-93. — basis for `correlation/kendall.ts`. <https://doi.org/10.2307/2332226>.
- Lloyd, S. P. (1982). *Least squares quantization in PCM.* IEEE Transactions on Information Theory 28(2):129-137. — basis for `cluster/kmeans.ts`. <https://doi.org/10.1109/TIT.1982.1056489>.
- Arthur, D. & Vassilvitskii, S. (2007). *k-means++: The advantages of careful seeding.* SODA 2007. — basis for the seeding step in `cluster/kmeans.ts`. <https://dl.acm.org/doi/10.5555/1283383.1283494>.
- Ester, M., Kriegel, H.-P., Sander, J. & Xu, X. (1996). *A density-based algorithm for discovering clusters.* KDD 1996. — basis for `cluster/dbscan.ts`. <https://www.aaai.org/Papers/KDD/1996/KDD96-037.pdf>.
- Pearson, K. (1901). *On lines and planes of closest fit to systems of points in space.* Philosophical Magazine 2(11):559-572. — basis for `dimensionality/pca.ts`. <https://www.tandfonline.com/doi/abs/10.1080/14786440109462720>.
- Mann, H. B. & Whitney, D. R. (1947). *On a test of whether one of two random variables is stochastically larger than the other.* Annals of Mathematical Statistics 18(1):50-60. — basis for `inferential/mann-whitney.ts`. <https://doi.org/10.1214/aoms/1177730491>.
- Kruskal, W. H. & Wallis, W. A. (1952). *Use of ranks in one-criterion variance analysis.* JASA 47(260):583-621. — basis for `inferential/kruskal-wallis.ts`. <https://doi.org/10.2307/2280779>.
- Efron, B. (1979). *Bootstrap methods: another look at the jackknife.* Annals of Statistics 7(1):1-26. — basis for `sample/bootstrap.ts`. <https://doi.org/10.1214/aos/1176344552>.

## 4. Architecture decisions

### 4.1 Pure TypeScript, no native bindings

Every primitive is implemented in TypeScript with `strict: true`. No FFI, no native bindings, no WASM. This keeps the package portable to edge agents, browser previews, and the capability-catalogue invocation runner, where startup cost matters more than peak throughput.

### 4.2 Immutability — no mutation

Per global coding-style rules (`~/.claude/rules/coding-style.md`), every primitive returns new arrays / objects. Inputs are `ReadonlyArray<number>`; outputs are frozen object literals. No `.sort()` on the input — we copy first.

### 4.3 Numerical accuracy floor

Descriptive statistics must agree with published reference values to ≥ 6 decimal places. We use Welford's online algorithm for variance (numerically stable) and Kahan-Babuška summation where catastrophic cancellation is a risk.

### 4.4 No mock tests, live-test only

Per project mandate, no test doubles. Every test is a reference-vector validation: real numbers in, known answers out, computed against canonical published examples.

### 4.5 Capability-catalogue addressable

Every public function is invocable through `@borjie/capability-catalogue`. The catalogue records the input vector, the function name, the version, and the result hash — so Mr. Mwikila's "compute Pearson r on these two columns" turn is replayable indefinitely.

### 4.6 Domain wrappers, not domain leakage

The `src/domain/mining-stats.ts` module is the **only** place mining-specific vocabulary appears. The rest of the package is domain-neutral. The wrappers compose the neutral primitives into the four call shapes Mr. Mwikila uses most:

- `sitePerformanceStats(throughputByDay)` → descriptive summary + bootstrap CI on mean.
- `royaltyRateAnalysis(before, after)` → Welch t-test + Cohen's d + percent-change.
- `safetyIncidentCorrelation(incidents, drivers)` → Pearson + Spearman + chi-square on categorical drivers.
- `buyerCohortAnalysis(purchases)` → k-means cohort assignment + silhouette score.

## 5. DataFrame design

`lite-dataframe.ts` is intentionally minimal — far less than pandas / Danfo.js. The shape:

```ts
interface DataFrame {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  select(cols: ReadonlyArray<string>): DataFrame;
  filter(pred: (row: Readonly<Record<string, unknown>>) => boolean): DataFrame;
  groupBy(col: string): Map<unknown, DataFrame>;
  aggregate<R>(col: string, fn: (xs: ReadonlyArray<number>) => R): R;
}
```

This is enough to power the four domain wrappers and is the *only* DataFrame Mr. Mwikila's voice-agent will see. The day we need joins, windowed aggregates, or arbitrary expressions, we revisit DuckDB-WASM.

## 6. Distributions surface

Every distribution exports `{ pdf, cdf, quantile, sample }` with a deterministic seed-able RNG (Mulberry32). The Gamma CDF uses the regularised lower incomplete gamma function (Lentz's continued-fraction algorithm). The Beta CDF uses the regularised incomplete beta function with Wynn's epsilon acceleration where the series converges slowly.

## 7. Testing strategy

Every module has its own test file in `src/__tests__/`. The fixtures live in `src/__fixtures__/` and include:

- **Anscombe's quartet** — four (x, y) pairs with identical means, variances, and Pearson r, but radically different shapes. Forces us to never trust a single statistic.
- **Iris** — 150 samples × 4 features × 3 species. Standard PCA benchmark; first principal component explains ~73 % of variance.
- **Reduced Boston Housing** — 50 rows × 5 features. OLS regression benchmark.
- **Welch (1947) §3 worked example** — paired t-test reference.

Each test asserts to 6 decimal places (`toBeCloseTo(expected, 6)`) where the reference is exact, and to 4 decimal places where the reference is itself a rounded textbook value.

Test count target: ≥ 30. Distribution across clusters:

| Cluster        | Target tests |
|----------------|--------------|
| descriptive    | 6            |
| inferential    | 5            |
| correlation    | 3            |
| regression     | 3            |
| distributions  | 4            |
| cluster        | 3            |
| dimensionality | 2            |
| dataframe      | 2            |
| sample         | 2            |
| domain         | 4            |
| **Total**      | **≥ 34**     |

## 8. Telemetry

Every public entry-point logs its invocation via `createLogger` from the local `logger.ts` — the same `TelemetryConfig` surface used by the connectors. We record only:

- Function name and version.
- Input vector size (length, columns) — never input *values*.
- Result summary (e.g. "mean = 4.123", never the raw output array).
- Wall-clock duration.

No PII, no full vectors, no row contents — only sizes and summaries.

## 9. Roadmap

- **Phase 1 (this spec)** — descriptive, inferential, correlation, regression, distributions, cluster, dimensionality, dataframe, sample, domain wrappers. Pure TypeScript. 34 tests.
- **Phase 2** — Python sidecar option for mixed-effects, survival, and full-information maximum-likelihood SEMs.
- **Phase 3** — Bayesian primitives (MCMC, variational inference) for the "what's the probability that …" turns.
- **Phase 4** — Streaming / online versions of every descriptive statistic, so dashboards update without a full recompute.

## 10. Out-of-band concerns

- **Reproducibility.** Every randomised primitive (k-means, DBSCAN, bootstrap, sampling) takes an optional `seed: number`. Without a seed, results are deterministic across re-runs on the same input (we lock to a fixed Mulberry32 seed when none is supplied). This is non-negotiable: Mr. Mwikila must be able to re-derive the same number tomorrow.
- **Floating-point determinism.** Reductions order operations deterministically; no `Promise.all` over partial sums.
- **No `Math.random`.** Anywhere. Every randomness source threads through Mulberry32.
- **No mutation of `globalThis`.** Anywhere.

## 11. Acceptance criteria

- ≥ 34 reference-vector tests pass.
- TS strict, no `@ts-nocheck`, no `any`.
- All 11 algorithm sources cited above appear verbatim in the spec (this section).
- Persona "Mr. Mwikila" referenced in domain wrapper docstrings.
- `createLogger` wired through `TelemetryConfig` with `service.name = '@borjie/data-analysis'`.

---

*End of spec.*
