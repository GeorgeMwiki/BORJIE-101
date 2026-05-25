# SOTA Bias Handling Research — 2026-05-25

**Audience:** Engineers extending `@borjie/bias-handling`.
**Sibling package:** `@borjie/fairness-eval` (counterfactual / individual fairness).
**Scope:** Group-fairness metrics, mitigation (pre/in/post-processing),
LLM-specific bias benchmarks, drift monitoring, subgroup discovery,
anti-discrimination law mapping.

`bias-handling` does NOT replace `fairness-eval`. `fairness-eval`
asks *"would this individual's decision flip if their protected
attribute changed?"* — that's **individual / counterfactual**
fairness (Kusner et al. 2017). `bias-handling` asks *"are group
outcomes equitable across populations?"* — that's **group
fairness**. SOTA practice runs both, as one does not imply the
other (Friedler et al. "On the (im)possibility of fairness" 2016).

---

## 1. Group fairness metrics (8 implemented)

Implementations follow the AIF360 + Fairlearn conventions
([IBM AIF360 — Group Fairness Metrics](https://aif360.res.ibm.com/resources),
[Fairlearn 0.10 user guide](https://fairlearn.org/v0.10/quickstart.html)).

| Metric | Formula sketch | Original paper / source |
| --- | --- | --- |
| Demographic Parity (Statistical Parity Difference) | `P(Y_hat=1 \| A=a) − P(Y_hat=1 \| A=b)` | Dwork et al. 2012; AIF360 |
| Disparate Impact | `P(Y_hat=1 \| A=unpriv) / P(Y_hat=1 \| A=priv)` (80% rule) | US EEOC Uniform Guidelines (1978); AIF360 |
| Equalized Odds | TPR + FPR parity across groups | Hardt, Price, Srebro 2016 ("Equality of Opportunity in Supervised Learning") |
| Equal Opportunity | TPR parity for positive class only | Hardt et al. 2016 |
| Predictive Parity | PPV parity (precision) across groups | Chouldechova 2017 |
| False Discovery Rate parity | FDR parity across groups | AIF360 ClassificationMetric |
| False Omission Rate parity | FOR parity across groups | AIF360 |
| Calibration Within Groups | `P(Y=1 \| score=s, A=a) ≈ P(Y=1 \| score=s, A=b)` | Pleiss et al. NeurIPS 2017 ("On Fairness and Calibration") |

These 8 cover the four "fairness families" from Verma & Rubin 2018:
statistical-parity-based, accuracy-error-based, calibration-based,
similarity-based.

### Impossibility result

Pleiss et al. NeurIPS 2017 prove that calibration and equalized
odds **cannot simultaneously be satisfied** except in degenerate
cases. Picking which metric matters is therefore a **stakeholder
decision**, not an engineering one. We expose all 8 metrics and
let the caller pick — we do not collapse into a single score.

---

## 2. Mitigation strategies (3 tiers)

Per AIF360 taxonomy: pre-processing, in-processing,
post-processing ([AIF360 mitigation playbook](https://medium.com/@james.irving.phd/blog-post-series-ai-fairness-360-mitigating-bias-in-machine-learning-models-2268e01584bd)).

### Pre-processing (transform training data)

- **Reweighing** (Kamiran & Calders 2012) — assign instance
  weights so that `P(A, Y)` matches the marginal product
  `P(A) × P(Y)`. We implement a pure-function transform that
  attaches weights to each row.
- **Learned Fair Representations** (Zemel et al. ICML 2013) —
  encode features into a latent space where protected attributes
  cannot be recovered, while preserving downstream utility. We
  ship a config-driven projector and document tradeoffs.

### In-processing (constrained training)

- **Fairness constraint (Lagrangian)** — wraps a model trainer
  with a Lagrange multiplier on a fairness constraint
  (Agarwal et al. ICML 2018 — Fairlearn `ExponentiatedGradient`).
  We expose a `addFairnessConstraint(model, constraint)` adapter.
- **Adversarial debiasing** (Zhang et al. AIES 2018) — train a
  predictor + adversary jointly, where the adversary tries to
  recover the protected attribute from the predictor's output.
  We ship a generic adapter; the inner trainer is caller-supplied.

### Post-processing (transform predictions)

- **Equalized-odds post-processing** (Hardt et al. 2016) — derives
  group-specific thresholds + a randomization rule that achieves
  equalized odds on a calibration set.
- **Reject Option Classification** (Kamiran, Karim, Zhang 2012) —
  in a confidence band around the decision boundary, flip the
  prediction in favor of the unprivileged group. Deterministic
  alternative to randomized post-processing.

---

## 3. LLM bias benchmarks (5 suites)

These probe *language-model* bias as opposed to *classifier* bias
([Promptfoo: top LLM bias benchmarks 2026](https://www.promptfoo.dev/blog/top-llm-safety-bias-benchmarks/),
[Evidently AI: 10 LLM safety / bias benchmarks](https://www.evidentlyai.com/blog/llm-safety-bias-benchmarks)).

| Suite | Categories | Size | Reference |
| --- | --- | --- | --- |
| **BBQ** (Bias Benchmark for QA) | 9 social dimensions (Parrish et al. ACL 2022). Note: spec mentioned "11" — the public release is 9 dimensions, ~58k examples. We ship 9. | ~58 000 | Parrish et al. ACL Findings 2022 — [aclanthology.org/2022.findings-acl.165](https://aclanthology.org/2022.findings-acl.165/) |
| **StereoSet** | Gender, profession, race, religion | ~17 000 | Nadeem, Bethke, Reddy ACL 2021 |
| **CrowS-Pairs** | 9 bias types: race, gender, sexual-orientation, religion, age, nationality, disability, physical-appearance, socio-economic | 1 508 paired sentences | Nangia et al. EMNLP 2020 |
| **HONEST** | Gendered + sexual harm | Templates × pronouns | Nozza et al. NAACL 2021 |
| **RealToxicityPrompts** | Toxicity continuation likelihood | ~100k web prompts | Gehman et al. EMNLP Findings 2020 |

Because we do not ship the full benchmark datasets in this repo
(hundreds of MB; license issues), the runners take a **fixture
subset** and rely on the caller to plug in the canonical
datasets via the published HF datasets URL. The runners
themselves implement the *scoring algorithm* + per-category
breakdown, which is the IP-bearing part.

---

## 4. Drift monitoring

Real-time bias drift is a production-monitoring concern, not a
training-time one. We follow the Evidently AI playbook
([Evidently AI: data drift](https://www.evidentlyai.com/ml-in-production/data-drift)):

- Track per-group **rolling-window** disparity metrics.
- Establish a **baseline window** at deploy time.
- Compare current window vs baseline using a two-sample test
  (we use Kolmogorov-Smirnov by default — Evidently's
  recommendation for continuous metrics).
- Alert when KS p-value < configurable threshold.

This complements (does NOT replace) regular re-evaluation. Drift
fires fast (minutes), full re-eval is slower (hours), but full
re-eval is the source of truth.

---

## 5. Subgroup discovery (Slice Finder / SliceLine)

Aggregate metrics hide **intersectional** bias. SliceLine
(Sagadeeva & Boehm SIGMOD 2021) and Slice Finder (Chung et al.
ICDE 2019) discover subgroups where a model under-performs.

Our implementation is a lightweight Slice Finder variant:

1. Enumerate single-attribute slices.
2. For each, compute performance metric (accuracy, TPR).
3. Compute Δ vs global mean.
4. Compute p-value (binomial test on whether the slice's error
   rate could have come from the global error distribution).
5. Filter by `minSliceSize`, sort by `|Δ|`.

This catches the "women-of-color-renting-bareland" intersectional
case that single-attribute parity metrics miss.

---

## 6. Anti-discrimination law map (5 jurisdictions)

Per-jurisdiction protected attributes with statute citation.
Drives which attributes the `fairness-eval` + `bias-handling`
stack treats as actionable in each market.

### US — Fair Housing Act (1968, as amended)

7 protected: race, color, religion, sex, familial status,
national origin, disability. 42 U.S.C. § 3604.
Source: [DOJ Civil Rights Division — Fair Housing Act](https://www.justice.gov/crt/fair-housing-act-1).

### US — Equal Credit Opportunity Act (1974)

9 prohibited bases: race, color, religion, national origin, sex,
marital status, age, receipt of public assistance, exercise of
rights under the Consumer Credit Protection Act. 15 U.S.C. § 1691.
Source: [Federal Reserve fair-lending docs](https://www.federalreserve.gov/boarddocs/supmanual/cch/fair_lend_fhact.pdf).

### UK — Equality Act 2010

9 protected characteristics (§ 4): age, disability, gender
reassignment, marriage and civil partnership, pregnancy and
maternity, race, religion or belief, sex, sexual orientation.
Source: [Equality Act 2010 §4](https://www.legislation.gov.uk/ukpga/2010/15/section/4),
[EHRC protected characteristics](https://www.equalityhumanrights.com/equality/equality-act-2010/protected-characteristics).

### Kenya — Constitution Article 27 (2010)

13 listed grounds (Article 27(4) — list is non-exhaustive):
race, sex, pregnancy, marital status, health status, ethnic or
social origin, colour, age, disability, religion, conscience,
belief, culture, dress, language, birth.
Source: [Kenya Law Reform Commission — Article 27](https://www.klrc.go.ke/index.php/constitution-of-kenya/110-chapter-four-the-bill-of-rights/112-part-2-rights-and-fundamental-freedoms/193-27-equality-and-freedom-from-discrimination).

### Tanzania — Constitution Article 13 (1977, as amended)

11 protected: nationality, tribe, place of origin, political
opinion, colour, religion, sex, station in life, age, disability,
pregnancy (latter two from Persons with Disabilities Act 2010 +
Employment & Labour Relations Act 2004).
Source: [Tanzania Constitution Art. 13](https://constitutions.unwomen.org/en/countries/africa/tanzania).

`getApplicableProtections({ jurisdiction, context })` returns the
list filtered by context (`housing` / `credit` / `employment` /
`generic`) since e.g. ECOA's "receipt of public assistance" only
applies in credit decisions.

---

## 7. Why these choices

- **AIF360 + Fairlearn over inventing our own:** these are the
  most-cited fairness toolkits with peer-reviewed papers and
  thousands of stars; copying their semantics gives us
  interoperability with downstream auditors.
- **TypeScript port, not Python wrapper:** we run inside the
  Hono / Node service tree. No Python interpreter in production.
  Pure-TS implementations of the math (which is straightforward
  for group fairness metrics — counting positives by group).
- **No ML training in this package:** we provide *adapters* for
  in-processing mitigation. The actual model training stays in
  user code or in `central-intelligence`. We avoid a hard PyTorch
  dependency.
- **Composable, not framework:** every metric and mitigation is a
  pure function. Caller composes. We provide a `createBiasHandling`
  factory for ergonomics, but it's optional.

---

## 8. Source list (12+ cited)

1. [IBM AIF360 — AI Fairness 360 resources](https://aif360.res.ibm.com/resources)
2. [Fairlearn 0.10 user guide (Microsoft)](https://fairlearn.org/v0.10/quickstart.html)
3. [Aequitas bias-audit toolkit (DSSG / University of Chicago)](https://github.com/dssg/aequitas)
4. [Evidently AI — data drift in ML](https://www.evidentlyai.com/ml-in-production/data-drift)
5. [Pleiss et al. NeurIPS 2017 — On Fairness and Calibration](http://papers.neurips.cc/paper/7151-on-fairness-and-calibration.pdf)
6. [Kusner et al. NeurIPS 2017 — Counterfactual Fairness](http://papers.neurips.cc/paper/6995-counterfactual-fairness.pdf)
7. [Hardt, Price, Srebro NeurIPS 2016 — Equality of Opportunity](https://aiwiki.ai/wiki/equalized_odds)
8. [Parrish et al. ACL Findings 2022 — BBQ benchmark](https://aclanthology.org/2022.findings-acl.165/)
9. [Promptfoo — Top LLM bias / safety benchmarks 2026](https://www.promptfoo.dev/blog/top-llm-safety-bias-benchmarks/)
10. [Evidently AI — 10 LLM safety + bias benchmarks](https://www.evidentlyai.com/blog/llm-safety-bias-benchmarks)
11. [Sagadeeva & Boehm SIGMOD 2021 — SliceLine](https://mboehm7.github.io/resources/sigmod2021b_sliceline.pdf)
12. [Equality Act 2010 §4 (UK)](https://www.legislation.gov.uk/ukpga/2010/15/section/4)
13. [Kenya Law Reform — Constitution Article 27](https://www.klrc.go.ke/index.php/constitution-of-kenya/110-chapter-four-the-bill-of-rights/112-part-2-rights-and-fundamental-freedoms/193-27-equality-and-freedom-from-discrimination)
14. [DOJ Civil Rights — Fair Housing Act overview](https://www.justice.gov/crt/fair-housing-act-1)
15. [Federal Reserve fair-lending statutes](https://www.federalreserve.gov/boarddocs/supmanual/cch/fair_lend_fhact.pdf)
16. [Tanzania Constitution Art. 13 (UN Women DB)](https://constitutions.unwomen.org/en/countries/africa/tanzania)

---

## 9. Spec deviations

- **BBQ — 9 not 11 categories.** The spec said "11 categories";
  the public release covers 9. We ship 9 with a `subset` parameter
  so callers can run any combination.
- **`LearnedFairRepresentations`** is implemented as a
  config-driven projector (selection of features the encoder
  zeros / scrambles) rather than a trained encoder. A learned
  encoder requires PyTorch in the runtime; the projector
  approach gives the same API surface and a clear extension
  point for callers who have a Python sidecar.
- **Adversarial debiasing** ships as an adapter / interface;
  the actual adversarial loop lives outside this package because
  it requires a differentiable trainer.
- **LLM benchmarks** ship the scoring + per-category breakdown,
  with a small built-in fixture (~30 examples / suite). The
  caller plugs in the full HF dataset for production runs.
