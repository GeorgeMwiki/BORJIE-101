# Forecast Targets & Domains — what each product must predict, with method + data feeds

**Lane:** `forecast-targets-domains`
**Date:** 2026-06-08
**Scope:** Borjie (AI-native mining-estate OS, Mr. Mwikila brain) and the
sibling BossNyumba (real-estate OS). Both share the forecasting spine:
`packages/forecasting-engine/` (forecasters: `causal`, `discrete-event`,
`stochastic`, `time-series`; plus `world-model`, `scoring`, `feedback`)
and `packages/conformal-calibration-online/` (Adaptive Conformal
Inference / EnbPI — PO-12). This dossier **does not change code**. It
enumerates the prediction targets, the right method per target, the
horizon, the leading indicators, and the **real external data feeds**
(commodity, FX, weather, macro, geo) each forecaster should be fed.

> **Hard rails reminder (CLAUDE.md):** predictions **APPEND** to
> rule-based decisions and never replace them; every AI output cites
> ≥1 `evidence_id`; conformal calibration already exists in-repo and
> wraps every interval; all money renders via `formatCurrency(amount,
> currencyCode)` (multi-currency, TZS at launch, KE/UG/NG expansion);
> EN/SW absolute toggle. Forecasts are decision **inputs**, gated, and
> band-wrapped — not autonomous actions.

---

## 0. The two cross-cutting lanes every target plugs into

This dossier is the "what to forecast" layer. It references two sibling
lanes that define the "how":

- **Foundation-models lane** — zero-shot/few-shot time-series
  foundation models (TSFMs) that need no per-series training:
  **TimesFM 2.5** (Google, decoder-only, ~100B training time-points,
  topped GIFT-Eval zero-shot at release —
  [arXiv/Groundy](https://groundy.com/articles/google-s-timesfm-foundation-model-time/)),
  **Chronos-2** (Amazon, "From Univariate to Universal Forecasting",
  native covariate + multivariate support, surpasses TiRex/TimesFM-2.5
  on WQL and MASE win-rate —
  [arXiv 2510.15821](https://arxiv.org/pdf/2510.15821)),
  **Moirai-2** (Salesforce, decoder-only "less is more", top
  non-leaking GIFT-Eval —
  [arXiv 2511.11698](https://arxiv.org/pdf/2511.11698)). Benchmark of
  record is **GIFT-Eval** (97 tasks / 55 datasets, zero-shot emphasis —
  [Salesforce](https://www.salesforce.com/blog/gift-eval-time-series-benchmark/)).
  The 2026 toolkit survey lists the practical 5
  ([MachineLearningMastery](https://machinelearningmastery.com/the-2026-time-series-toolkit-5-foundation-models-for-autonomous-forecasting/)).
- **Uncertainty lane** — every point forecast becomes a band. Default
  stack: **quantile heads** (p10/p50/p90, matching `ForecastBand` in
  `forecasting-engine/src/types.ts`) → **conformal wrap** for
  distribution-free coverage. For non-stationary series use online
  conformal: **EnbPI** ([Xu & Xie, ICML'21 / TPAMI](https://github.com/hamrel-cxu/EnbPI)),
  **ACI** ([arXiv 2202.07282](https://arxiv.org/pdf/2202.07282)), and
  2026 successors — bias-corrected multi-horizon ACI
  ([arXiv 2604.13253](https://arxiv.org/html/2604.13253)),
  Error-quantified Conformal Inference / ECI
  ([arXiv 2502.00818](https://arxiv.org/pdf/2502.00818)), and the
  change-point-aware online CP ([arXiv 2410.13115](https://arxiv.org/pdf/2410.13115)).
  Benchmark/method survey: [arXiv 2601.18509](https://arxiv.org/html/2601.18509v2).
  For native distributional output use **DeepAR**
  ([arXiv 1704.04110](https://arxiv.org/abs/1704.04110)).

**Method-selection rule of thumb (used in every row below):**

| Situation | Recommended method | In-repo home |
|---|---|---|
| Short history, many related series, want zero-shot | **TSFM** (Chronos-2 if covariates; TimesFM/Moirai-2 univariate) | `forecasters/time-series` |
| Rich exogenous drivers, want explainability | **Gradient-boosted quantile regression** (LightGBM/XGBoost) or hedonic GLM | `forecasters/time-series` + `causal` |
| Causal "what-if" / policy levers | **Structural causal / DAG simulation** | `forecasters/causal` |
| Discrete events (failures, incidents, queueing) | **Survival / hazard models + discrete-event sim / Monte Carlo** | `forecasters/discrete-event` |
| Price paths, treasury, fat tails | **Stochastic (GBM/jump-diffusion, GARCH vol) + Monte Carlo** | `forecasters/stochastic` |
| Any of the above | **Quantile → conformal band** (ALWAYS) | `conformal-calibration-online` |

---

# PART A — MINING-ESTATE (Borjie)

## A1. Mineral / commodity prices — precious + industrial
**Forecast:** spot & forward price paths for gold and other precious
metals (silver, platinum), plus industrial/critical metals the estate
touches (copper, and per-tenant: tin, cobalt, lithium, coltan).
**Why it matters:** drives offtake pricing, royalty accrual, treasury
hedging, and reserve valuation.
**Horizon:** intraday→30d (treasury/hedge), 1–4 quarters (budget),
1–3y (reserve & capex planning).
**Leading indicators:** USD/DXY, real US 10y yields, central-bank gold
buying, ETF flows, mine-supply outlook, China industrial PMI (for
copper), inventory/warehouse stocks (LME), inversion of forward curve.
**Method:** stochastic price-path engine (GBM + jump-diffusion for
gold's gap risk; **GARCH** for realized-vol bands) in
`forecasters/stochastic`, **Monte Carlo** fan-charts, optionally a TSFM
(Chronos-2 with macro covariates) as a comparison forecaster. Note: a
TSFM has even been applied to **realized-volatility** forecasting
([arXiv 2505.11163](https://arxiv.org/pdf/2505.11163)). Never use a
single point — always p10/p50/p90 conformal band.
**Real data feeds:**
- **LBMA** daily gold/silver/platinum auction fixings —
  [lbma.org.uk/prices-and-data](https://www.lbma.org.uk/prices-and-data/precious-metal-prices)
- **LME** base-metals (copper/tin) + warehouse stocks —
  [tradingeconomics.com/commodity/lme](https://tradingeconomics.com/commodity/lme)
- **Metals-API / MetalpriceAPI** JSON REST (60s–10min refresh, LME
  source, history to 2008) —
  [metals-api.com](https://www.metals-api.com/) ·
  [metalpriceapi.com](https://metalpriceapi.com/)
- **World Bank "Pink Sheet"** monthly commodity benchmark (ground-truth
  for backtests/anchoring) —
  [Pink Sheet](https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/world-bank-commodities-price-data-the-pink-sheet)
- House-view priors for sanity bands: J.P. Morgan (avg **$5,055/oz**
  Q4'26 — [jpmorgan.com](https://www.jpmorgan.com/insights/global-research/commodities/gold-prices)),
  S&P Global copper/gold outlook —
  [spglobal.com](https://www.spglobal.com/market-intelligence/en/news-insights/research/2026/04/copper-gold-market-outlook-2026-prices-supply-mining-costs)

## A2. FX — TZS + KE / UG / NG
**Forecast:** USD pairs and cross-rates for TZS (launch), KES, UGX,
NGN; plus realized-vol bands for hedging.
**Why:** offtake settlement, import-cost of equipment/diesel, treasury,
and the USD-cliff remediation logic (domestic non-TZS rejected for
TZ-jurisdiction tenants).
**Horizon:** 1–5d (settlement timing), 1–3 months (treasury), 1y (budget).
**Leading indicators:** policy rate differentials, FX reserves cover,
gold export receipts (a TZ/Ghana/SA reserve driver per
[MCB](https://mcbgroup.com/insights/article/africa-fx-story-2026)),
current-account, oil price (NGN sensitivity), parallel-vs-official
spread.
**Method:** these are managed/near-pegged → use **regime-aware**
modeling: GARCH for vol bands, random-walk + drift baseline, plus a
TSFM with rate-differential covariates. Heavier reliance on the
conformal band because African FX has fat tails / step-devaluations
(treat as **change-points** — use change-point-aware online CP,
[arXiv 2410.13115](https://arxiv.org/pdf/2410.13115)).
**Real data feeds:**
- Central bank references: **Bank of Tanzania**, **Central Bank of
  Kenya**, **Bank of Uganda**, **Central Bank of Nigeria** daily rates
  (official anchor; primary source).
- **Trading Economics** currency forecasts + history (196 countries) —
  [tradingeconomics.com/forecast/currency](https://tradingeconomics.com/forecast/currency)
- **OANDA** converter/rates feed — [oanda.com](https://www.oanda.com/currency-converter/en/)
- African market panels — [african-markets.com/en/currencies](https://www.african-markets.com/en/currencies)
- 2026 regional outlook (TZS/KES "broadly stable", NGN oil-sensitive) —
  [Investing.com](https://www.investing.com/analysis/african-currencies-in-2026-where-stability-is-returning-and-why-it-matters-to-you-200673836)

## A3. Production yield + ore-grade
**Forecast:** recoverable yield (g/t → oz), head grade per block/face,
and recovery % through the plant.
**Why:** production planning, royalty base, offtake commitments.
**Horizon:** shift→week (operational), month→quarter (planning).
**Leading indicators:** drill-hole assays, blast-hole sampling,
throughput/feed rate, reagent dosing, mill power draw, dilution.
**Method:** spatial estimation — **kriging / sequential Gaussian
simulation** for grade (with conditional-simulation uncertainty), plus
**gradient-boosted regression** on plant sensor features for recovery.
Geostats lives naturally in `forecasters/stochastic`/`causal`; recovery
in `time-series`. Carry a full distribution, not a single grade.
**Real data feeds:** tenant drill-hole / assay DB; plant historian
(throughput, reagent, power); benchmark grade-tonnage curves from
**USGS USMIN** deposit database —
[usgs.gov USMIN](https://www.usgs.gov/centers/mendenhall-research-fellowship-program/20-34-machine-learning-enhance-mineral-resource).

## A4. Equipment failure / predictive maintenance (RUL)
**Forecast:** remaining-useful-life (RUL) and failure-probability per
component (bearings, gears, pumps, hydraulics) for haul trucks,
excavators, mills, pumps.
**Why:** unplanned downtime is the #1 production-loss driver; PdM cuts
breakdowns ~70–75%
([SPD/Long-Intl](https://spd.tech/machine-learning/predictive-maintenance/)).
**Horizon:** hours→days (alarm), weeks (parts/maintenance scheduling).
**Leading indicators:** vibration spectra, bearing temperature,
hydraulic pressure, oil-debris/lubrication quality, runtime hours,
load/duty cycle, electrical signature.
**Method:** **deep RUL** — TCN + multi-head attention fusion is current
SOTA for *large-scale mining equipment* (haul trucks, hydraulic
excavators) with uncertainty-weighted multi-task heads
([Nature Sci Reports 2026, s41598-026-43145-z](https://www.nature.com/articles/s41598-026-43145-z));
pair with **streaming anomaly detection** on vibration. Belongs in
`forecasters/discrete-event` (failure as event) + `time-series`
(degradation curve). Survival/hazard framing gives calibrated
failure-by-T probabilities; conformal-wrap the RUL estimate.
Broader trend + edge/cloud split: [Farmonaut](https://farmonaut.com/mining/mining-equipment-predictive-maintenance-7-ai-tech-trends),
[MDPI underground-mining PdM](https://www.mdpi.com/2673-4117/6/10/261),
[AIoT PdM review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12737171/).
**Real data feeds:** OEM telematics (Cat MineStar / Komatsu) vibration
& runtime streams via IoT gateway; CMMS work-order history;
oil-analysis lab results.

## A5. Treasury & cash-flow
**Forecast:** daily/weekly cash position, runway, liquidity-at-risk,
inflows (offtake receipts) vs outflows (payroll, royalty, diesel,
capex).
**Why:** owner cockpit liquidity view; ties to the `cashflow-first`
business archetype already in `forecasting-engine/types.ts`.
**Horizon:** 13-week rolling (treasury standard), 1y annual plan.
**Leading indicators:** offtake schedule + A2 FX + A1 price, payroll
calendar, royalty accrual (A6), open POs, M-Pesa/Stripe settlement lag.
**Method:** **bottom-up driver simulation** (compose A1/A2/A6 bands) +
**Monte Carlo** for liquidity-at-risk percentiles → `discrete-event` /
`stochastic`. All money via `formatCurrency`; the ledger truth stays in
`LedgerService.post()` (forecast never writes the ledger).
**Real data feeds:** internal ledger (`services/payments-ledger`),
payment-provider settlement webhooks; macro rate context from **FRED**
(844k series — [fred.stlouisfed.org](https://fred.stlouisfed.org/)).

## A6. Royalty liability accrual
**Forecast:** accruing royalty payable to the Tanzanian Mining
Commission / TRA (and KE/UG/NG equivalents) and the date/amount due.
**Why:** compliance + cash planning; under-accrual = penalty risk.
**Horizon:** to next statutory payment date; rolling annual.
**Leading indicators:** A3 production × A1 price × statutory royalty
rate; clearance/permit status; FX (A2) for USD-denominated royalty.
**Method:** **deterministic statutory formula** (rule-based, authoritative)
with a **probabilistic overlay** that bands the *uncertain inputs*
(production & price) — this is the canonical "predictions APPEND to
rule-based decisions" pattern. Lives in `causal` (formula) + bands from
A1/A3.
**Real data feeds:** statutory royalty schedule from the mining corpus
(`BORJIE_MINING_CORPUS_PATH` → `intelligence_corpus_chunks`); production
ledger; A1 price feed.

## A7. Demand / offtake
**Forecast:** buyer demand volume, time-to-sell, and clearing price for
listed lots in the marketplace; offtake-contract fulfillment risk.
**Why:** marketplace pricing, inventory turns, settlement planning.
**Horizon:** days→weeks (lot-level), quarter (contract pipeline).
**Leading indicators:** A1 reference price, bid/ask depth & bid history
(`apps/buyer-mobile` bids), buyer KYC pipeline, seasonality, export
permit lead-time.
**Method:** **survival model** for time-to-sell (hazard of a lot
clearing) + **GBM quantile regression** for clearing price on lot
features (grade, weight, location) → `discrete-event` + `time-series`.
**Real data feeds:** internal marketplace bid/listing tables; A1 price
anchor; export-corridor lead-times.

## A8. Workforce / attrition
**Forecast:** probability a worker/manager leaves within horizon;
crew-level staffing gap; absenteeism.
**Why:** continuity of production; recruiting lead-time; the
`retention` weight in `ownerIntent`.
**Horizon:** 30/60/90-day attrition probability; quarterly headcount.
**Leading indicators:** tenure, pay-vs-market, commute/site-remoteness,
overtime, satisfaction signals, season (harvest/competing artisanal pull).
**Method:** **survival analysis** (Cox/discrete-time hazard) is the
right framing (under-used per
[Fast Data Science](https://fastdatascience.com/predicting-employee-turnover/));
in practice 2026 work uses **explainable ensembles** (SHAP feature
selection + gradient boosting, [Nature 2026 s41598-026-36424-2](https://www.nature.com/articles/s41598-026-36424-2),
[MDPI 15/3/185](https://www.mdpi.com/2073-431X/15/3/185)). Use survival
for the *when*, ensemble + SHAP for the *why* (explainability satisfies
evidence-citation rail). Home: `discrete-event`.
**Real data feeds:** internal HRIS / `workforce-mobile` roster, payroll,
attendance; regional wage benchmarks.

## A9. Safety-incident risk
**Forecast:** probability/rate of recordable safety incidents by
site/activity/shift; near-miss escalation risk.
**Why:** life-safety + compliance + production halts. Fail-closed
posture.
**Horizon:** shift/day (hot-spot alerting), monthly trend.
**Leading indicators (the whole point — predict *before* the accident):**
near-miss counts, inspection findings, overtime/fatigue, weather, new
crew %, equipment-fault backlog (A4), activity type.
**Method:** **leading-indicator predictive safety analytics** — model
incident likelihood by location/activity/time from historical incidents
+ near-misses + inspections
([SmartQHSE 2026 guide](https://www.smartqhse.com/safety-blog/predictive-safety-analytics-guide-2026)).
Use a **Poisson/negative-binomial hazard** or GBM classifier with
calibrated probability; conformal-band the rate. Home: `discrete-event`.
Output is advisory + gated (never auto-stops work without human).
**Real data feeds:** internal incident/near-miss log, inspection
records, A4 fault backlog, weather (see below), shift roster.

## A10. Licence / compliance deadline risk
**Forecast:** probability a licence/permit/renewal/royalty filing is
missed or rejected; days-to-deadline risk score.
**Why:** a lapsed licence halts the estate; HIGH-risk policy domain.
**Horizon:** to each statutory deadline; 12-month compliance calendar.
**Leading indicators:** days-to-deadline, document-completeness,
regulator processing-time history, prior rejection reasons, fee/royalty
arrears (A6).
**Method:** **rule-based deadline engine** (authoritative, from corpus)
+ **classifier** for rejection/slippage probability on top. Strictly
APPEND-only over the literal policy rules (HIGH-risk prefixes must hit
literal rules — no reason-resolver generalisation). Home: `causal`.
**Real data feeds:** statutory calendars from mining corpus; internal
filing/document status; regulator SLA history.

## A11. Exploration / geo (prospectivity)
**Forecast:** mineral-prospectivity probability surface (where to drill
next) and expected discovery value.
**Why:** capital allocation for exploration; reserve growth.
**Horizon:** campaign (months→years).
**Leading indicators:** geology, geochemistry, geophysics, remote
sensing, structural proximity, known-deposit footprints.
**Method:** **mineral-prospectivity mapping (MPM)** — deep forest /
random forest / GBM, now **geospatial foundation models**: GFM4MPM
([arXiv 2406.12756](https://arxiv.org/pdf/2406.12756)) and continent-
scale "Masked Mineral Modeling" geospatial infilling
([arXiv 2511.09722](https://arxiv.org/pdf/2511.09722)); interpretable
Deep Forest ([AGU 2024JH000311](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2024JH000311));
decade survey ([MDPI 15/10/1042](https://www.mdpi.com/2075-163X/15/10/1042));
practical toolbox ([RichardScottOZ repo](https://github.com/RichardScottOZ/mineral-exploration-machine-learning)).
Output a probability surface with uncertainty, not a single target.
**Real data feeds:** tenant geophysics/geochem; **USGS** mineral
databases ([usgs.gov](https://www.usgs.gov/centers/mendenhall-research-fellowship-program/20-34-machine-learning-enhance-mineral-resource));
satellite (Sentinel/Landsat) for remote sensing.

---

# PART B — REAL-ESTATE (BossNyumba)

> BossNyumba shares the spine. `conformal-calibration-online`'s own
> docstring names **"rent / vacancy / maintenance forecast
> calibration"** as the integration point — these are first-class.

## B1. Property valuation (AVM)
**Forecast:** market value per property + portfolio repricing.
**Horizon:** on-demand point estimate; daily/quarterly portfolio
repricing.
**Leading indicators:** comparable sales, hedonic features (beds/baths/
area/location), local price index, days-on-market, macro rates.
**Method:** **AVM** — gradient boosting / random forest / NN over
hedonic + repeat-sales features (linear regression is the floor;
GBM/NN captures non-linearity & interactions —
[Radixweb](https://radixweb.com/blog/automated-valuation-model-in-real-estate),
[Dwellsy IQ](https://blog.iq.dwellsy.com/what-is-an-avm-automated-valuation-model-in-real-estate/),
multi-source image fusion pipeline
[PMC12088074](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12088074/)).
AVMs now do **daily/quarterly portfolio repricing** without per-asset
appraisal ([AmeriSave 2026](https://www.amerisave.com/glossary/automated-valuation-model-avm-what-it-means-for-home-buyers-in)).
Output a value **with a confidence interval** (conformal). Home:
`forecasters/causal` (hedonic) + `time-series`.
**Real data feeds:** comparable-sales/listing data; local registry;
FRED rate context.

## B2. Rent / occupancy / vacancy
**Forecast:** achievable rent, occupancy %, vacancy duration per unit.
**Horizon:** lease-cycle (months), annual budget.
**Leading indicators:** local rent index, seasonality, unit features,
concessions, renewal probability, days-vacant history.
**Method:** **GBM quantile regression** for rent; **survival model**
for vacancy duration; TSFM for occupancy time-series. Explicitly the
ACI calibration target named in the package. Home: `time-series` +
`discrete-event`.
**Real data feeds:** internal lease/rent-roll; local rental indices.

## B3. Demand & absorption
**Forecast:** lease-up / absorption rate; time-to-fill new supply.
**Horizon:** project lease-up window (months→quarters).
**Leading indicators:** enquiry/lead volume, local employment, pipeline
supply, price-vs-market.
**Method:** **diffusion / Bass-style absorption** + survival
time-to-lease; Monte Carlo for lease-up curve bands. Home:
`discrete-event` + `causal`.
**Real data feeds:** internal CRM lead funnel; local employment (FRED /
national stats).

## B4. Maintenance / capex
**Forecast:** maintenance work-order volume & cost; component
replacement timing; capex deferral opportunity.
**Horizon:** monthly run-rate; multi-year capital plan.
**Leading indicators:** asset age, work-order history, inspection
findings, occupancy intensity.
**Method:** **predictive maintenance** (same family as A4) for
building systems + **ML budget forecast** for capex; knowing which
asset to renew defers substantial capex
([GI Hub](https://www.gihub.org/infrastructure-technology-use-cases/case-studies/sensors-and-machine-learning-for-predictive-maintenance/)).
Home: `discrete-event` + `time-series`.
**Real data feeds:** internal CMMS / work-order log; building-systems
telemetry.

## B5. Construction cost & schedule risk
**Forecast:** final project cost & completion date with probability of
overrun/delay.
**Horizon:** project duration.
**Leading indicators:** input-price indices (cement/steel/labour),
design maturity, change-order rate, contractor performance, macro
volatility, weather.
**Method:** **Monte Carlo QSRA** (cost & schedule) anchored by
**Reference Class Forecasting** — MCS cuts cost-estimate error to ~8.2%
vs 22.4% traditional, schedule 12.6% vs 28.3%
([JETIR](https://www.jetir.org/papers/JETIR2508577.pdf),
[iQRM 2026 QSRA guide](https://iqrm.net/blog/schedule-risk-analysis-complete-guide));
2026 work pairs **Bi-GRU input-price forecasting** with MCS for
probabilistic contingency
([Buildings 16/11/2124](https://doi.org/10.3390/buildings16112124),
macro-aware GRU/LSTM cost model [PMC12510611](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12510611/)).
Home: `discrete-event` (Monte Carlo) + `stochastic`.
**Real data feeds:** input-price indices; internal schedule/cost-control
data; weather (below).

## B6. Market-cycle turning points
**Forecast:** probability the local market is approaching a
peak/trough; regime label (expansion/contraction).
**Horizon:** 6–18 months.
**Leading indicators:** price-to-rent, days-on-market trend, transaction
volume, rate environment, building-permit pipeline.
**Method:** **regime-switching / change-point detection** (Markov-
switching, BOCPD) + macro-indicator classifier; conformal-band the
turning-point probability. Home: `causal` + `time-series`.
**Real data feeds:** local transaction indices; **FRED**/**World
Bank**/**IMF WEO** macro ([imf.org WEO](https://www.imf.org/external/datamapper/datasets/WEO)).

---

## Shared external data feeds (both products)

| Feed | Use | Source |
|---|---|---|
| Commodity prices | A1, A3, A6, A7 | [LBMA](https://www.lbma.org.uk/prices-and-data/precious-metal-prices), [LME/TradingEconomics](https://tradingeconomics.com/commodity/lme), [Metals-API](https://www.metals-api.com/), [MetalpriceAPI](https://metalpriceapi.com/), [World Bank Pink Sheet](https://thedocs.worldbank.org/en/doc/18675f1d1639c7a34d463f59263ba0a2-0050012025/world-bank-commodities-price-data-the-pink-sheet) |
| FX | A2, A5, A6 | Central banks (BoT/CBK/BoU/CBN), [Trading Economics](https://tradingeconomics.com/forecast/currency), [OANDA](https://www.oanda.com/currency-converter/en/), [african-markets](https://www.african-markets.com/en/currencies) |
| Macro | A5, B1, B3, B6 | [FRED](https://fred.stlouisfed.org/), [World Bank Open Data](https://data.worldbank.org/), [IMF WEO](https://www.imf.org/external/datamapper/datasets/WEO), [DBnomics](https://db.nomics.world/) |
| Weather / climate | A9 (safety), B5 (construction) | [NOAA Climate Data](https://www.noaa.gov/), NASA POWER (solar/met), national met services |
| Geo / satellite | A3, A11 | [USGS](https://www.usgs.gov/centers/mendenhall-research-fellowship-program/20-34-machine-learning-enhance-mineral-resource), Sentinel/Landsat |
| Equipment telemetry | A4, B4 | OEM telematics (Cat MineStar / Komatsu), IoT gateway, CMMS |

---

## How this binds to the rails (do/don't)

- **Every** row outputs a `ForecastBand` (p10/p50/p90), conformal-
  wrapped via `conformal-calibration-online`. No bare point forecasts.
- Forecasts are **decision inputs that APPEND** to authoritative
  rule-based engines (royalty A6, licence A10, statutory deadlines) —
  they never overwrite the rule output.
- Each forecast cites its driver evidence (`evidence_id` from LMBM /
  corpus / data-feed snapshot) so the Auditor Agent passes it.
- Money targets (A1/A2/A5/A6/A7, B1/B2/B5) render via
  `formatCurrency(amount, currencyCode)`; never hard-code a currency.
- Safety (A9) and licence (A10) are fail-closed + gated: advisory,
  human-in-loop, never an autonomous halt/stop.
- Backtests anchor on neutral ground truth (World Bank Pink Sheet for
  prices; central-bank fixings for FX; USGS for geo) to avoid
  self-referential drift.

## Open items for the build lanes (not done here)
1. Map each target to a concrete forecaster file under
   `packages/forecasting-engine/src/forecasters/*` and register its
   default TSFM/quantile/conformal config.
2. Stand up a `data-feeds` adapter layer (commodity/FX/macro/weather)
   with caching + provenance stamping for `evidence_id`.
3. Pick the GIFT-Eval-validated TSFM per target (Chronos-2 where
   covariates exist; TimesFM-2.5 / Moirai-2 univariate) and benchmark
   against in-repo stochastic/causal baselines via `scoring`.
