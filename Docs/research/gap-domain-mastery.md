# Gap Dossier — DOMAIN MASTERY (the actual expertise)

**Dimension:** Domain Mastery — does a real, evidence-gated, PhD-depth, self-sufficient
junior/advisor exist that can complete EACH mandate domain end-to-end, so the owner
never needs another platform or outside expert?
**Date:** 2026-06-08
**Author:** Domain-mastery audit subagent (Opus 4.8, 1M)
**Method:** Read both mandate domain maps + Wave-3 capability/orchestration specs, then
grounded every claim in the live codebase of both repos (Borjie + BossNyumba101).
**Repos audited:**
- Borjie — `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Borjie`
- BossNyumba — `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101`

**Score: 2 / 5 vs AGI target (5).**

---

## Executive verdict

The domain depth that *exists* is, in places, genuinely world-class: the wired
mining juniors (`compliance-agent`, `safety-agent`, `cost-engineer`, `fx-treasury-agent`,
`sales-offtake-agent`) are deterministic-engine + LLM-narration, evidence-gated, with
literal HIGH-risk inviolables (GISTM Topic-IV, TZ 6%+1%+16%, TRIFR fatality alert).
That is the right architecture and is the proof the team CAN build PhD-depth juniors.

But domain mastery as a *system property* is **2/5**, for two structural reasons:

1. **Built-but-dark depth.** The three newest, highest-value deep agents —
   `structural-civil-agent.ts` (Eurocode/ACI + GISTM TSF), `machinery-advisory-agent.ts`
   (RCM/ISO 14224/lease-vs-buy), and the standalone `esg-disclosure-agent.ts`
   (ISSB S1/S2 + EITI) — are **not exported from the juniors barrel, not in the
   `JUNIOR_NAMES` router roster, and not in `executor-registry.ts`**. The Master Brain
   *physically cannot dispatch them*. They are dead code from the orchestrator's view.
   (The good news: their depth-engine siblings `qs-engine.ts`, `safety-hse-metrics.ts`,
   `treasury-covenants.ts`, `offtake-settlement.ts`, `esg-disclosure.ts` ARE consumed by
   registered parents — so that depth is reachable. The standalone *agents* are not.)

2. **Whole mandate domains have NO junior at all.** Of the 24 mining-estate domains,
   several first-class pillars have zero brain: **resource/reserve estimation (A2,
   CRIRSCO/JORC classification + CP sign-off)**, **mine planning as an NPV/cutoff/LOM
   optimizer (A3)**, **security & metal accounting (D6, AMIRA P754 / gold-room)**,
   **mine closure & rehabilitation (D4, IAS 37 provisioning)**, **insurance & risk
   transfer (E2)**, a **standalone hedging/trading book (B2)**, **dedicated asset/mineral
   valuation (B6)**, and the entire **family-office / succession / dynasty pillar (E4)** —
   which has a DB schema (`succession-plans.schema.ts`) but **zero junior consumers**.
   Of the 19 real-estate / built-environment domains, **only the shared construction
   spine (structural-civil + QS) exists, and it is the dark code above** — the BossNyumba
   real-estate junior set (deal-sourcing, due-diligence, development, leasing, collections,
   asset-manager, valuation, fund-ops, esg) is **entirely unbuilt in both repos**.

So the AGI bar — *for every mandate domain a deep, evidence-gated, end-to-end-capable
specialist the owner can rely on instead of an outside expert* — is met for roughly
**11 of 24** mining domains (deep+wired), with **3 deep-but-dark**, and **~10 missing or
shallow**; and **~2 of 19** built-environment domains. Hence 2/5.

---

## Coverage matrix — Mining-estate (24 domains, `domain-map-mining-estate.md`)

Legend: **DEEP+WIRED** = real domain engine, evidence-gated, reachable by router.
**DEEP-DARK** = real depth but unreachable (not in barrel/router/registry).
**SHALLOW** = a junior exists but is a thin scorer, not the spec's operating model.
**NONE** = no junior owns this domain.

| # | Domain | State | Evidence (file:line) |
|---|--------|-------|----------------------|
| A1 | Geoscience & Exploration | DEEP+WIRED | `geology-agent.ts`, `drill-hole-logger.ts`, `lab-assay-agent.ts`; `packages/geology-advisor` (499 LOC) |
| A2 | Resource/Reserve estimation & public reporting (CRIRSCO/JORC) | **SHALLOW** | `geology-agent.ts:59` has a `score_band` ending in `jorc_compliant` + a `jorc_caveat` string — it is an *exploration-confidence scorer*, NOT a classifier (no Inferred/Indicated/Measured→Probable/Proved engine, no Modifying Factors, no named CP sign-off gate). Spec demands it (CAPABILITY_SPEC_WAVE3.md:11) |
| A3 | Mine planning & engineering | **SHALLOW** | `mine-planner.ts:2,88` is "section the site polygon + match-factor + 1-page weekly plan" — NO NPV/cutoff-grade/Lerchs-Grossmann/LOM scheduler (grep for npv/cutoff/lerchs/stope = 0 hits). Spec demands NPV optimizer (CAPABILITY_SPEC_WAVE3.md:25) |
| A4 | Drill & blast / extraction ops | SHALLOW | `operations-sic-agent.ts` (Short-Interval-Control loop) covers ops cadence; no blast-design/fragmentation/fleet-dispatch depth |
| A5 | Mineral processing / metallurgy | DEEP+WIRED | `metallurgy-agent.ts` + `metallurgy-knowledge.ts` (21 KB) — flowsheet, recovery, throughput |
| A6 | Value-addition / refining / smelting | NONE | no junior; LBMA Good Delivery / doré / local-beneficiation make-vs-export not modelled |
| A7 | Assaying / sampling / grade control | DEEP+WIRED | `lab-assay-agent.ts` (chain-of-custody + QA/QC), ISO/IEC 17025-shaped |
| B1 | Mineral economics & commodity markets | DEEP+WIRED | `packages/mining-commodity-intelligence` (609 LOC); price inputs to forecast |
| B2 | Trading, hedging & risk management | SHALLOW | hedging lives only inside `fx-treasury-agent.ts` (via `treasury-covenants.ts`); no standalone QP-risk/provisional-pricing/streaming trading-book junior (grep hedge/trading-book junior = 0) |
| B3 | Off-take, marketing & sales | DEEP+WIRED | `sales-offtake-agent.ts` + `offtake-settlement.ts` (TC/RC, payabilities, NET revenue) |
| B4 | Royalty, fiscal & mining taxation | DEEP+WIRED | `compliance-agent.ts:102` (Mining Act 2010, GN refs); TZ 6%+1%+16% as literal policy per spec |
| B5 | Mining law, tenure & licensing | DEEP+WIRED | `licence-agent.ts` (29 KB) — obligation calendar, dormancy, renewal windows |
| B6 | Mineral & mining-asset valuation | NONE | no IMVAL/VALMIN/CIMVal DCF/real-options valuation junior; `cost-engineer.ts` does build-cost only |
| C1 | Treasury & project finance | DEEP+WIRED | `fx-treasury-agent.ts` + `treasury-covenants.ts` (DSCR/LLCR/reserve-tail/DSRA); `packages/fx-treasury-advisor` (618 LOC) |
| C2 | Procurement, supply chain & logistics | DEEP+WIRED | `procurement-agent.ts` + `packages/procurement-coordination`; OECD CAHRA / local content |
| C3 | Machinery, maintenance & reliability | **DEEP-DARK** | `machinery-advisory-agent.ts` (412 LOC: RCM 4-strategy, ISO 14224 MTBF/MTTR, sizing, lease-vs-buy) — imported NOWHERE (`grep` outside its own file = 0). `maintenance-agent.ts`/`asset-fleet-agent.ts` (wired) are thin fuel/hours trackers, not the reliability brain |
| C4 | Construction & civil (mine infra, TSF) | **DEEP-DARK** | `structural-civil-agent.ts` (336 LOC: EN1990/ACI318 limit-state + GISTM TSF inviolable, fail-closed) — imported NOWHERE; not in barrel/router/registry |
| C5 | Real estate, housing & camp estate | NONE | no camp/housing lease-lifecycle/RAP/facilities junior (the spec's real-estate-for-mining-infra slice) |
| D1 | Health, Safety & Environment (HSE) | DEEP+WIRED | `safety-agent.ts` + `safety-hse-metrics.ts` (TRIFR/LTIFR/fatality per Mhrs, ICMM CCM, fatality alert) |
| D2 | Workforce, HR & training | DEEP+WIRED | `hr-agent.ts` + `packages/workforce-orchestrator`; `apps/workforce-mobile` role-gated |
| D3 | ESG & sustainability disclosure | DEEP+WIRED (via parent) + **DEEP-DARK (standalone)** | `compliance-agent.ts:8-11` assembles ISSB/GRI/TNFD/EITI via `esg-disclosure.ts` (reachable). The richer standalone `esg-disclosure-agent.ts` (597 LOC) is dark |
| D4 | Environment, water, energy & mine closure | **SHALLOW/NONE** | closure/rehabilitation, water-balance/ARD, decarbonisation (SBTi) — grep closure/water/decarbon in juniors = 0; only touched as compliance line-items, no IAS 37 provisioning/financial-assurance engine |
| D5 | Community, CSR, human rights & ASM | DEEP+WIRED | `community-agent.ts` (grievance), `village-csr-agent.ts` (CSR), FPIC/ASM on-ramp partial |
| D6 | Security & metal accounting (loss prevention) | NONE | no gold-room/AMIRA-P754 metal-accounting/mass-balance/chain-of-custody-seal junior (grep metal-accounting/gold-room/reconciliation junior = 0) — acute theft/reconciliation risk unmanaged |
| E1 | Accounting, reporting & cost control | DEEP+WIRED (partial) | `cost-engineer.ts` (AISC unit econ) + `forecast-modeler.ts` + ledger; group consolidation/DD&A/GIP shallow |
| E2 | Insurance & risk transfer | NONE | no CAR/EAR/BI/closure-surety/D&O/political-risk junior; `risk-modeler.ts` is a composite-score model, not risk-transfer |
| E3 | Holdings, subsidiaries & ancillary | SHALLOW | `packages/org-graph`/`estate-groups.schema.ts` exist; no junior runs the holdco/beneficial-ownership/EITI-ownership-export workflow |
| E4 | Family office, succession & wealth | **NONE (substrate orphaned)** | `succession-plans.schema.ts` exists but has **zero junior/code consumers** (grep successionPlans outside schema = 0); no mining-CEO family-office/succession/dynasty mode (`mining-ceo-modes.ts` has Build/Strategy/Operations/Document/Finance/Risk/Board/Compliance — no Dynasty) |
| E5 | Pan-African & global governance | SHALLOW | TZ encoded in compliance-agent; KE/UG/NG rule packs not present as juniors/advisors |

**Mining tally:** DEEP+WIRED ~11, DEEP-DARK 3, SHALLOW ~6, NONE ~6 (of 27 rows incl. split D3).

---

## Coverage matrix — Real-estate / built environment (19 domains, `domain-map-real-estate-built-env.md`)

Per CAPABILITY_SPEC_WAVE3 §BOSSNYUMBA, these were to be built by mirroring the proven
mining pattern. Grounding in BossNyumba101 `packages/ai-copilot/src/`: the cognitive infra
exists (autonomy, governance, audit-trail, memory, intelligence-orchestrator) but there is
**no `juniors/` directory and no real-estate domain agent** — only `portfolio-early-warning.ts`
and a `property-grading/portfolio-aggregator.ts`. In Borjie, the only RE-relevant depth is
the shared construction spine (structural-civil + QS) which is dark.

| # | Domain | State | Evidence |
|---|--------|-------|----------|
| 1 | Acquisition & deal-sourcing | NONE | no `deal-sourcing-agent.ts`; no `packages/acquisitions-advisor` (MISSING) |
| 2 | Due diligence / land tenure | NONE | no `due-diligence-agent.ts`; no `packages/land-tenure-advisor` (MISSING); TZ/KE/UG/NG tenure gates unbuilt |
| 3 | Valuation & appraisal (RICS Red Book/IVS) | NONE | no `valuation-agent.ts`; no `packages/valuation-advisor` (MISSING) |
| 4 | Land/geospatial/cadastral | PARTIAL | Borjie `packages/geo-parcels`/`spatial-engine` reusable; no RE survey junior |
| 5 | Quantity surveying & cost mgmt | DEEP-DARK (shared) | `cost-engineer.ts` extended via `qs-engine.ts` (NRM1/2, IPC/variation/retention/final account) — wired in Borjie via cost-engineer; usable by RE but no RE surface |
| 6 | Architecture & design (RIBA 0-7) | NONE | no RIBA stage-gate junior; `packages/stage-advisor` (2617 LOC) is mining study-gates, not RIBA |
| 7 | Structural & civil engineering | DEEP-DARK (shared) | `structural-civil-agent.ts` — dark (above) |
| 8 | MEP / building services | NONE | no CIBSE/ASHRAE/BS7671 junior |
| 9 | Construction & project delivery (FIDIC/NEC/EVM) | SHALLOW | FIDIC claims-clock + EVM/Monte-Carlo named in spec for `procurement/risk/forecast` modelers; not implemented (grep FIDIC/EVM in juniors minimal) |
| 10 | FM / property mgmt / PropTech | NONE | no CMMS/PPM/digital-twin junior; `maintenance-agent.ts` is mining-fuel-hours |
| 11 | Leasing / tenancy / collections | NONE | no `leasing-agent.ts`/`collections-agent.ts` (rent roll/WALT/NER/arrears ladder) |
| 12 | RE finance / mortgage / capital stack | NONE | no capital-stack/DSCR-underwriting junior |
| 13 | REIT / fund operations | NONE | no `fund-ops-agent.ts` (waterfall, CMA/SEC REIT gates) |
| 14 | Portfolio & asset management | NONE | no `asset-manager-agent.ts`; `packages/portfolio-advisor` (MISSING) |
| 15 | ESG / green building (GRESB/CRREM/EDGE) | NONE | no RE `esg-agent.ts` (GRESB quintile, WLCA, CRREM misalignment year) |
| 16 | Brokerage / agency / marketing | SHALLOW | `marketing-brain-mining.ts` is mining-narrative; no RE agency/AML junior |
| 17 | Planning / zoning / permits | NONE | no RTPI/NEMA entitlement junior |
| 18 | Property tax / accounting / insurance | NONE | no IAS 40/IFRS 16/RCA junior |
| 19 | Professional ethics & registration | NONE | no BORAQS/EBK/NCA/CRB registration-verification junior |

**Built-env tally:** DEEP (none clean) · DEEP-DARK 2 (shared QS + structural) · SHALLOW 3 · NONE/PARTIAL 14. Effectively **2/19**.

---

## Why the architecture is RIGHT (so closure is wiring + replication, not invention)

The wired exemplars prove the pattern that meets the AGI bar:
- `structural-civil-agent.ts:255-263` enforces the GISTM Topic-IV inviolable
  **deterministically, fail-closed, before the LLM port** — an Extreme/Very-High TSF
  missing a named EoR/RTFE/ITRB is `blocked` regardless of what the model says.
- `safety-agent.ts:6-12` OVERRIDES any LLM-echoed TRIFR with the computed figure and
  raises an un-buffered owner alert on any fatality/failed critical control.
- `compliance-agent.ts:102-105` requires every citation to carry the specific Act § or
  Gazette number+date — evidence-required by construction.

So the closure lanes below are mostly: (a) **wire the 3 dark agents** (1 barrel export +
1 `JUNIOR_NAMES` entry + 1 `executor-registry` entry + 1 router-prompt line each), and
(b) **replicate this exact deterministic-engine + LLM-narration + Auditor-gate pattern**
for each missing domain.

---

## Gaps (every one has a buildable closureLane)

See the structured list. IDs DM-01…DM-16. Severity reflects mandate-criticality and the
"owner never needs another platform/expert" bar: a missing first-class pillar (E4 dynasty,
D6 metal accounting, A2 reserves) is HIGH/BLOCKER; dark-but-built is HIGH (cheap to fix,
high value lost); the BossNyumba RE set is BLOCKER for that estate's mandate.

---

## Verification notes

- Dark-agent claim verified by: (1) `grep -c` of each file stem in `juniors/index.ts` = 0;
  (2) absence from `JUNIOR_NAMES` (`master-brain.ts:64-94`, 28 names); (3) absence from
  `executor-registry.ts` import+entry block; (4) `grep` of the agent stem across
  `packages/`+`services/` (excluding own file/tests) returning no importer.
- `succession-plans.schema.ts` present in `packages/database/src/schemas/`; consumer grep = 0.
- `mine-planner.ts` / `geology-agent.ts` depth verified by reading output schemas + keyword grep.
- BossNyumba absence verified by listing `packages/ai-copilot/src/` (no `juniors/`) and a
  domain-keyword find returning only `portfolio-early-warning.ts` + `property-grading/`.
- Advisor-package presence/absence verified by `find … -name '*.ts'` LOC counts:
  geology/mine-planner/cost-engineer/fx-treasury/capacity-expansion/stage/buyer-marketplace/
  commodity-intelligence present; valuation/land-tenure/portfolio/acquisitions MISSING.
