# Wave-3 Capability Spec — world-class autonomous MDs

Source: deep-research-SOTA workflow (cited dossiers in this dir). Drives the Wave-3 domain build. Autonomy model + shared foundations apply to BOTH estates.

## BORJIE

**Mandate:** Borjie's AI MD (Mr. Mwikila) autonomously runs a full mining ESTATE — every mineral right, ounce, dollar, worker, asset, subsidiary, and dynasty obligation — plus the real-estate and construction needed to build mine infrastructure/camps/plants, governed end-to-end by evidence-cited, ledger-anchored, jurisdiction-bound, human-gated cognition.

### Tenement & Asset-Register Spine (the geological estate as system-of-record)
- Hold a spatial system-of-record for every mineral right on a digital cadastre; track each licence's NEXT obligation (annual fee, work-program report, relinquishment, renewal window) as a scheduled deadline because lapse = forfeiture.
- Maintain resources/reserves as a graded-confidence inventory (Exploration Results -> Inferred/Indicated/Measured -> Probable/Proved) under CRIRSCO/JORC/NI 43-101/SAMREC with named Competent/Qualified Person sign-off and Modifying Factors applied to convert Resource->Reserve.
- Operate ONE consolidated asset register spanning tenements, reserves, plant, fleet, holdings — reconciling to both the ledger and the cadastre; this is the substrate every other junior reads/writes.
- Log drill-holes/assays and surface spatial layers (parcels, pits, infrastructure) with cm-level GNSS/RTK + total-station control for setting-out, as-builts and volumes.
- Enforce CRIRSCO Transparency/Materiality/Competence via the evidence-required rule; geology output cites >=1 evidence_id and is rejected by the Auditor if Competent-Person attribution is missing.

  - target: packages/ai-copilot/src/juniors/licence-agent.ts (tenement lifecycle + obligation deadlines)
  - target: packages/ai-copilot/src/juniors/geology-agent.ts + drill-hole-logger.ts + lab-assay-agent.ts (graded reserve inventory + assays + CP sign-off)
  - target: packages/geology-advisor
  - target: packages/geo-intelligence + geo-parcels + geo-platform + spatial-engine (cadastre, GNSS/RTK, setting-out, volumes)
  - target: packages/database (schema: tenements, resources_reserves graded tiers, consolidated asset_register reconciling ledger+cadastre)
  - target: apps/owner-web/src/app/(routes)/licence + licences + sites + portfolio-map + estate + geology + regulatory-calendar
  - target: packages/ai-copilot/src/juniors/auditor-agent.ts (CP/evidence gate)

### Conversion Engine — Mine Planning, Metallurgy & Maintenance (turning rock into payable units)
- Run mine planning/scheduling as an NPV optimizer across strategic/LOM and short-term horizons with cutoff-grade optimization (high-then-declining grade strategy), pit/stope/blend/stockpile scheduling under precedence constraints.
- Design and run the processing flowsheet — comminution (liberation vs overgrind), gravity/flotation/leaching (CIL/CIP/heap)/magnetic separation — tracking head grade, metallurgical recovery, and throughput vs nameplate as live sensors.
- Manage maintenance to ISO 55000/55001 with RCM/RCA + condition monitoring (ISO 13374) for predictive maintenance; track availability/utilization/MTBF feeding sustaining-capex.
- Map mine study gates (scoping/PFS/FS/detailed engineering, AACE Class 5->1) onto stage gates and never start downstream work on an upstream-grade design.
- Emit each conversion metric (head grade, recovery, throughput, availability, strip ratio) as a typed sensor feeding the KPI spine and AISC computation.

  - target: packages/ai-copilot/src/juniors/mine-planner.ts (NPV/cutoff/scheduling) + packages/mine-planner-advisor
  - target: packages/ai-copilot/src/juniors/metallurgy-agent.ts (flowsheet, recovery, throughput sensors)
  - target: packages/ai-copilot/src/juniors/maintenance-agent.ts + asset-fleet-agent.ts + packages/fleet-management (ISO 55000, MTBF, condition monitoring)
  - target: packages/capacity-expansion-advisor + stage-advisor (study-gate progression)
  - target: packages/mining-commodity-intelligence + forecasting-engine (price inputs to NPV)
  - target: apps/owner-web/src/app/(routes)/site-cockpit + sites + fleet

### Commercial Book — Off-take, Royalty, Fiscal & Treasury (the money machine)
- Structure off-take agreements (quality specs, payabilities, TC/RC, deleterious-element penalties), compute NET (not gross) revenue (~85-96.5% of LME after TC/RC), and run a streaming/royalty financing + LME/LBMA hedging book.
- Continuously accrue/pay the state share by archetype (ad valorem/specific/profit/windfall/hybrid); for Tanzania hard-encode-as-policy 6% royalty + 1% clearing fee + >=16% free-carried interest + in-country processing mandate as LITERAL HIGH-risk rules (no reason-resolver generalisation), with multi-currency via formatCurrency (never hard-code TZS/USD).
- Maintain lender coverage covenants (DSCR >= ~1.5x, LLCR 1.7-2.0x, PLCR >2.0x), reserve-tail >= 30%, fund a DSRA, optimize debt/equity, and pass Equator Principles / IFC Performance Standards E&S gates.
- Route EVERY money event — royalty/clearing/inspection postings, off-take settlement, hedge margin, debt service — through LedgerService.post() double-entry only, with SoD: proposer (fx-treasury) != approver (four-eye) != recorder (ledger).
- Reconcile all material payments-to-government for EITI and surface DSCR/reserve-tail/AISC covenant breaches proactively.

  - target: packages/ai-copilot/src/juniors/sales-offtake-agent.ts + personas/sub-personas/offtake-persona.ts (off-take, TC/RC, NET revenue)
  - target: packages/ai-copilot/src/juniors/fx-treasury-agent.ts + packages/fx-treasury-advisor + personas/sub-personas/finance-persona.ts (hedging, covenants, DSCR/reserve-tail)
  - target: services/payments-ledger (LedgerService.post royalty/clearing/inspection + government-payment reconciliation; arrears/, services/, repositories/)
  - target: packages/regulatory-tz-mining + jurisdiction-profile-tz + compliance-pack (6%+1%+16% as literal policy)
  - target: packages/central-intelligence/src/kernel/four-eye-approval.ts + policy-gate.ts + inviolable.ts (money-path SoD + HIGH-risk literal rules)
  - target: apps/owner-web/src/app/(routes)/treasury + finance + counterparties + sales + marketplace

### Licence-to-Operate — HSE, ESG, Tailings, Climate & Transparency (inviolable guardrails)
- Watch TRIFR/LTIFR/fatalities per million hours worked and run Critical Control Management + bowtie with field verification and named ownership; HSE is a hard constraint, not a KPI.
- Maintain a per-asset ICMM Performance Expectations register (10 Principles, Dec-2024) on the mandatory 3-yr self-assessment + 3rd-party VSP validation cycle; track IRMA level (50/75/100) and mirror the 8 TSM protocols (Level C-AAA).
- Operate full GISTM tailings conformance per facility: consequence classification (Low-Extreme) drives design floods/earthquakes; enforce named Accountable Executive + Engineer of Record + RTFE + ITRB for Extreme/Very-High dams; publish Principle-15 facility disclosure; run observational-method monitoring (piezometer/inclinometer/InSAR) + dam-breach analysis.
- Assemble disclosure: ISSB IFRS S1/S2 (4 pillars, Scope 1/2/3 all 15 categories, scenario analysis, transition plan), GRI 14 Mining 2024 (impact materiality, eff. Jan-2026), SASB EM-MM (financial materiality), TNFD LEAP (14 disclosures), EITI 2023 (beneficial ownership + contracts + payments-to-government).
- Pursue SBTi-aligned decarbonisation (net-zero Scope 1+2 by 2050; Scope 3 >=67% near / >=90% long), context-based ICMM water stewardship, FPIC-as-objective (UNDRIP, ICMM Aug-2024), OECD 5-step CAHRA due diligence (Annex-II red lines), integrated mine closure from day one (IAS 37 provisioning + financial assurance bond), and Minamata mercury-free ASM.
- Encode HIGH-risk inviolables literally: no Extreme TSF without ITRB+EoR+Accountable Executive; no World-Heritage mining; FPIC-as-objective; CAHRA Annex-II disengagement; closure financial assurance always present.

  - target: packages/ai-copilot/src/juniors/safety-agent.ts (TRIFR + critical-control verification) + community-agent.ts + village-csr-agent.ts (FPIC/CSR)
  - target: packages/ai-copilot/src/juniors/compliance-agent.ts + personas/sub-personas/compliance-persona.ts (ICMM/IRMA/GISTM/ISSB/GRI/TNFD/EITI register + disclosure assembly)
  - target: packages/central-intelligence/src/kernel/inviolable.ts + policy-gate.ts (literal HIGH-risk guardrails)
  - target: packages/ai-copilot/audit-trail + packages/audit-hash-chain + observability (append-only provenance for EITI/IRMA/GISTM/OECD step-5 reporting)
  - target: packages/database (schema: compliance_obligations, esg_metrics Scope1/2/3+water+biodiversity, tailings_facilities consequence-class+roles, closure_plans+financial_assurance, due_diligence_lots)
  - target: packages/forecasting + causal-inference (CRREM-style stranding/climate scenario)
  - target: apps/owner-web/src/app/(routes)/safety + compliance + community + chain-of-custody + regulatory-calendar

### Enterprise Operations — Workforce, Procurement, Local Content & Holdings
- Run workforce/HR role-gated (owner/manager/employee) with shift planning, payroll and competency, surfaced in the mobile app; tie workforce hours to the TRIFR denominator.
- Run procurement to category-management discipline (vendor pre-qual, competitive tender, 3-way match) with OECD CAHRA due diligence and local-content quotas enforced as policy (TZ 51%/25% JV thresholds, >=16% indigenous equity, PMLs reserved for Tanzanians).
- Provide an ASM formalization on-ramp: licensed artisanal miners trained on environmental/mining practice, operating mercury-free under Minamata, integrated into the formal supply chain.
- Maintain the holdings/subsidiaries graph + beneficial-ownership chain and export the EITI ownership disclosure; consolidate group results.
- Track local-content fulfilment, vendor risk and group-consolidation KPIs as first-class register entries.

  - target: packages/ai-copilot/src/juniors/hr-agent.ts + packages/workforce-orchestrator + mining-shift-planner + employee-perf-followup
  - target: apps/workforce-mobile (role-gated owner/manager/employee)
  - target: packages/ai-copilot/src/juniors/procurement-agent.ts + packages/procurement-coordination + inventory-management (category mgmt, 3-way match, CAHRA)
  - target: packages/ai-copilot/src/juniors/marketplace-stakeholder-agent.ts + community-agent.ts (ASM on-ramp)
  - target: packages/org-graph + org-scope + graph-database (holdings + beneficial-ownership chain)
  - target: apps/owner-web/src/app/(routes)/workforce + workforce-tabs + payroll + people + inventory + group

### Dynasty — Family Office, Succession & Group Wealth
- Maintain family mission/constitution/council and run an 18-36 month succession program with next-gen development.
- Model wealth-transfer instruments (trust/GRAT/dynasty-trust/FLP) and generational transfer planning.
- Expose dedicated CEO/strategic modes for the dynasty lens (succession, family-constitution, holdings strategy).
- Reconcile family-office holdings into the consolidated asset register and group ledger.
- Carry the dynasty layer with the same evidence + audit + locale discipline as operating functions.

  - target: packages/ai-copilot/src/personas/mining-ceo-modes.ts + mining-ceo-persona.ts (add family-office/succession modes alongside Build/Strategy/Operations/Finance/Risk/Board)
  - target: packages/ai-copilot/src/personas/owner-advisor.ts + sub-personas/consultant-persona.ts + advisor-persona.ts
  - target: packages/strategic-layer + strategic-reports (succession program tracking)
  - target: packages/org-graph (family council/holdings graph)
  - target: packages/database (schema: family_constitution, succession_program, wealth_transfer_instruments)
  - target: apps/owner-web/src/app/(routes)/group + personal-kb

### KPI Spine & Board/Investor Reporting (AISC-centered executive truth)
- Compute AISC as the master profitability metric (cash cost + sustaining capex + corporate G&A + reclamation + sustaining exploration per oz/unit; AIC adds growth capex) alongside head grade, recovery, throughput, strip ratio, NPV/IRR, R:P, TRIFR, Scope 1/2/3, DSCR/reserve-tail.
- Drive quarterly OKRs (3-5 measurable KRs, ~70% stretch, committed/aspirational/learning) cascaded from the consolidated register.
- Produce board packs (quarterly, detailed) distinct from investor updates (monthly, concise): ~15-20 curated KPIs across strategy/performance/governance, variance-vs-budget (>10% flagged), forecast-accuracy tracking.
- Grade forecasts with Scaled Pinball Loss/CRPS/MASE/WMAPE (quantile calibration), not point accuracy; use time-series foundation models for probabilistic forecasts.
- Surface everything in the owner cockpit (AISC/recovery/TRIFR/DSCR/NPV widgets) and CEO modes, bilingual EN/SW under the absolute-toggle rule.

  - target: packages/ai-copilot/src/juniors/forecast-modeler.ts + report-writer.ts + risk-modeler.ts
  - target: packages/executive-brief-engine + report-engine + strategic-reports + central-intelligence/src/kernel/briefing.ts
  - target: packages/outcomes + services/outcomes-metering + packages/analytics (OKR/KPI scoring)
  - target: packages/forecasting + forecasting-engine + conformal-calibration-online + calibration-monitor (Scaled Pinball/CRPS)
  - target: apps/owner-web/src/app/(routes)/reports + cockpit + master-brain + mwikila; packages/ai-copilot/src/personas/mining-ceo-modes.ts (BOARD_INVESTOR_MODE)

### Mine-Infrastructure Construction & Real-Estate (camps, plants, civils for the estate)
- Enforce RIBA Plan of Work 2020 Stages 0-7 for camps/plants/processing buildings; cost-plan to RICS NRM1, measure BOQ to NRM2, build unit rates from first principles ((L+P+M)*(1+waste)+OH&P) with preliminaries priced separately.
- Select procurement route x pricing mechanism and administer the right contract (FIDIC Red/Yellow/Silver, NEC4 A-F, JBC/NCA local forms); run the FIDIC claims clock (28-day Notice, 42-day particulars, 84-day DAAB) and the post-contract money machine (IPC valuations, pay-less notices, variations, retention, defects liability, final account) — all money events through LedgerService.post().
- Apply limit-state structural/civil design to Eurocodes (EN 1990-1999) + ACI 318 + KS/TZS for plant/civils; treat tailings dams as GISTM-governed structures (consequence class, EoR/RTFE/ITRB, observational method) shared with the Licence-to-Operate pillar.
- Run project controls: CPM critical path, EVM (CPI=EV/AC, SPI=EV/PV, EAC), Monte Carlo QSRA producing P50/P80/P90 with contingency from P-value spread (not padding); secure NEMA/NEMC EIA before breaking ground and verify CRB/ERB/AQRB / NCA-class registration of every firm.
- Carry staff/mine-worker housing as real-estate: lease lifecycle (rent roll, WALT, NER), arrears ladder, facilities CMMS/PPM, RICS Red Book / IVS 2025 valuation (5 methods incl. DRC for specialised plant/tailings/workshops), and EDGE-default green certification with social-value (UKGBC) for worker housing — manage all information in an ISO 19650 Common Data Environment feeding the estate brain.

  - target: EXTEND packages/ai-copilot/src/juniors/cost-engineer.ts to a full QS junior (NRM1/2, IPC/variations/retention/final account) + packages/cost-engineer-advisor
  - target: NEW packages/ai-copilot/src/juniors/structural-civil-agent.ts (Eurocode/ACI limit-state + TSF surveillance/GISTM) — highest-value gap
  - target: packages/ai-copilot/src/juniors/procurement-agent.ts (contract-form selector + FIDIC claims clock) + risk-modeler.ts + forecast-modeler.ts + mine-planner.ts (add EVM engine + Monte Carlo QSRA module)
  - target: packages/ai-copilot/src/juniors/maintenance-agent.ts (facilities CMMS/PPM) + personas/sub-personas/maintenance-persona.ts
  - target: packages/ai-copilot/src/juniors/compliance-agent.ts + licence-agent.ts (NEMA/NEMC EIA + CRB/NCA/BORAQS registration checks)
  - target: services/payments-ledger (IPC/variation/retention/final-account postings); packages/document-analysis + intelligence corpus (ISO 19650 CDE)
  - target: apps/owner-web/src/app/(routes)/estate + site-cockpit; NEW Built-Environment/Construction MD advisor persona alongside personas/mining-ceo-modes.ts

## BOSSNYUMBA

**Mandate:** BossNyumba's AI MD autonomously runs a full real-estate ESTATE — acquisition, development, leasing, collections, facilities, portfolio/fund operations, valuation and ESG — with construction as one embedded discipline, governed by the same evidence-cited, ledger-anchored, jurisdiction-bound, human-gated cognition proven in Borjie (which it reuses package-for-package).

### Acquisition & Agentic Underwriting (the scored deal funnel)
- Run a scored, stage-gated deal pipeline with origination-channel attribution and agentic underwriting that auto-builds the DCF proforma and a structured Investment Committee memo.
- Enforce mandatory DSCR/downside stress-testing before any IC decision; never advance a deal past IC on an un-stressed proforma.
- Model the residual land-value/GDV feasibility for development plays and benchmark every deal against a target return.
- Maintain a CRM-grade deal/relationship layer integrated with the proforma engine (Argus-equivalent).
- Cite >=1 evidence_id (comps, market data, DD findings) on every underwriting recommendation; the Auditor rejects empty-evidence IC memos.

  - target: NEW junior deal-sourcing-agent.ts (mirror packages/ai-copilot/src/juniors/sales-offtake-agent.ts) in packages/ai-copilot/src/juniors/
  - target: NEW packages/acquisitions-advisor (mirror packages/capacity-expansion-advisor / cost-engineer-advisor)
  - target: packages/ai-copilot/src/juniors/forecast-modeler.ts + risk-modeler.ts (DCF + DSCR stress)
  - target: packages/market-intelligence + market-intelligence corpus (comps/market evidence)
  - target: packages/ai-copilot/src/juniors/auditor-agent.ts (IC-memo evidence gate); reuse persona-runtime master-brain orchestration

### Due Diligence, Land Tenure & Transaction Gates (jurisdiction-bound legality)
- Drive a data-room-backed DD workflow on a 30-90-day clock across financial/physical/legal/operational categories with ALTA/NSPS survey, title commitment, zoning verification letter, and Phase I ESA (ASTM E1527-21) as gating artifacts; auto-escalate to Phase II on any Recognized Environmental Condition.
- Encode per-jurisdiction East-Africa land tenure as DD/title-validity gates: TZ Right of Occupancy + TIC derivative-right route for non-citizens; KE leasehold + CMA D-/I-REIT compliance; UG mailo/freehold/leasehold/customary + RTA Cap.230; NG Certificate of Occupancy + s.22 Governor's consent + SEC REIT 75/25/10 rule.
- Treat HIGH-risk transaction gates (Governor's consent, TIC route, non-citizen restriction) as literal policy rules, not generalisable reasoning.
- Maintain a document/data-room reconciliation trail with hash-chained provenance for every DD artifact.
- Verify professional registration and statutory routing (registered valuer/surveyor) before relying on any third-party report.

  - target: NEW junior due-diligence-agent.ts (mirror compliance-agent.ts gated by auditor-agent.ts) in packages/ai-copilot/src/juniors/
  - target: NEW packages/land-tenure-advisor with per-jurisdiction TZ/KE/UG/NG rule packs (mirror packages/compliance-pack / regulatory-tz-mining / jurisdiction-profiles)
  - target: packages/central-intelligence/src/kernel/policy-gate.ts + inviolable.ts (literal HIGH-risk tenure gates)
  - target: packages/document-analysis + document-reconciliation + audit-hash-chain (data-room + provenance)
  - target: packages/jurisdiction-profiles + jurisdiction-profile-tz pattern (extend to KE/UG/NG land law)

### Development & Construction (RIBA-gated delivery)
- Run development on RIBA Plan of Work 2020 Stages 0-7 with stage-gate outcomes/tasks/information-exchanges and sustainability embedded from Stage 0 to in-use evaluation at Stage 7; never start Stage 4/5 on a Stage 2 design.
- Cost-plan to RICS NRM1, measure BOQ to NRM2, build first-principles unit rates; select procurement route x pricing and administer FIDIC/NEC4/JBC/NCA contracts with the 28/42/84-day claims clock and full IPC/variation/retention/final-account machine — all money events via LedgerService.post().
- Apply limit-state structural design (Eurocodes EN 1990-1999 + ACI 318 + KS/TZS), ULS/SLS, geotechnics.
- Run project controls: CPM + EVM (CPI/SPI/EAC) + Monte Carlo QSRA (P50/P80/P90, contingency from spread); allocate HSE on the CDM 2015 duty-holder model (Client/PD/PC) with hierarchy of control, RAMS, permits, ISO 45001.
- Secure NEMA/NEMC EIA before ground-break; verify NCA-class/BORAQS/CRB/ERB/AQRB registration of every firm; manage all information in an ISO 19650 Common Data Environment.

  - target: NEW junior development-agent.ts (mirror mine-planner.ts) in packages/ai-copilot/src/juniors/; packages/stage-advisor (RIBA gates)
  - target: EXTEND cost-engineer.ts to QS junior (NRM1/2, IPC/variations/retention) + packages/cost-engineer-advisor
  - target: NEW structural-civil-agent.ts (Eurocode/ACI limit-state) shared with Borjie
  - target: procurement-agent.ts (contract selector + FIDIC clock) + risk-modeler.ts + forecast-modeler.ts (EVM + Monte Carlo QSRA); safety-agent.ts (CDM)
  - target: compliance-agent.ts + licence-agent.ts (EIA + registration); packages/document-analysis + intelligence corpus (ISO 19650 CDE); services/payments-ledger (construction money events)

### Leasing, Tenancy & Collections (the recurring-revenue engine)
- Operate the lease lifecycle with a rent roll + lease abstracts, critical-date alerting (breaks/expiries/reviews/options), and WALT + Net Effective Rent (face vs effective) at asset and portfolio level.
- Run a renewal/retention engine quantifying retention-vs-replacement cost and optimize leasing velocity (VTS-equivalent).
- Run a deterministic arrears ladder (reminder->demand->escalation->legal) with dispute logging, reconcile collections against the rent roll, and surface collection-rate/aging/bad-debt KPIs.
- Route ALL money movement (rent receipts, deposits, arrears recovery) through the auditable LedgerService.post() path with SoD.
- Track ancillary income (parking, signage, telecoms/rooftop, storage, EV charging, flex space) as first-class NOI line items with utilization/yield KPIs.

  - target: NEW junior leasing-agent.ts (extend packages/ai-copilot/src/personas/tenant-assistant.ts) in packages/ai-copilot/src/juniors/
  - target: NEW junior collections-agent.ts (mirror fx-treasury-agent.ts; MUST route via LedgerService.post())
  - target: services/payments-ledger (arrears/ ladder already present — reuse for rent + ancillary)
  - target: packages/ai-copilot/src/juniors/report-writer.ts (rent roll, WALT/NER, aging KPIs)
  - target: apps/owner-web cockpit lease + arrears surfaces (mirror Borjie route pattern); marketing-brain package (listing/leasing velocity)

### Facilities, PropTech & Asset Management (NOI per building)
- Operate a CMMS-style work-order/PPM engine with SLA tracking; ingest IoT/BMS telemetry for predictive maintenance and real-time energy monitoring; maintain a digital-twin asset register per building.
- Separate asset management (NOI/value-add business plans per asset) from portfolio management (construction by geography/class/mandate aligned to risk/return targets).
- Run recurring hold/sell DCF analysis benchmarked against a target return.
- Maintain a per-building consolidated asset register reconciling to the ledger (the real-estate analogue of Borjie's estate register).
- Surface availability/SLA/energy-intensity and NOI-per-asset KPIs to the cockpit.

  - target: EXTEND packages/ai-copilot/src/juniors/maintenance-agent.ts + asset-fleet-agent.ts (CMMS/PPM, IoT/BMS, digital twin) + personas/sub-personas/maintenance-persona.ts
  - target: NEW junior asset-manager-agent.ts (mirror forecast-modeler.ts) for NOI business plans + hold/sell DCF
  - target: NEW packages/portfolio-advisor (mirror existing advisor packages) for portfolio construction
  - target: packages/fleet-management + anomaly-detection + analytics (telemetry, predictive maintenance)
  - target: packages/database (schema: buildings asset_register, work_orders, ppm_schedules) reconciling to ledger

### Fund Operations, Capital Stack & Valuation (institutional money discipline)
- Model the full capital stack (senior/mezz/pref/common) and run a distribution-waterfall engine (return of capital -> preferred return 6-10% -> catch-up -> IRR-tiered promote), supporting American and European structures with 1-2% mgmt-fee accrual and LP/GP distribution statements.
- Comply with REIT regimes (KE CMA D-/I-REIT; NG SEC 75/25/10 asset rule) as policy gates on fund structure.
- Produce RICS Red Book Global 2025 / IVS 2025-compliant valuations: scope (VPS1/IVS101) -> basis of value (VPS2/IVS102: Market/Investment/Fair/Equitable etc.) -> approaches (income/comparison/cost/residual/DCF/DRC) -> data & inputs (IVS104) -> auditable models (VPS5/IVS105) -> compliant report (VPS6/IVS106); reconcile DCF vs cap-rate (Value=NOI/cap rate; 50bps exit-cap move = 5-10% value swing); carry ESG risk into value.
- Produce VPGA 2 secured-lending valuations (Market Value or MLV) with conflicts/independence record before any borrow-against-asset flow; route formal valuations through East-Africa statutory regimes (TZ Valuation & Valuers Registration Act 2016 VRB+Chief Valuer; KE Valuers Act Cap 532 VRB+ISK) — AI analyses, human registered valuer signs.
- Generate LP/GP distribution statements and fund-level returns with full ledger provenance; money path only via LedgerService.post().

  - target: NEW junior fund-ops-agent.ts (waterfall/capital stack) + valuation-agent.ts (RICS/IVS) in packages/ai-copilot/src/juniors/ (mirror fx-treasury-agent.ts + forecast-modeler.ts)
  - target: services/payments-ledger (waterfall distributions, mgmt-fee accrual, LP/GP statements via LedgerService.post())
  - target: packages/central-intelligence/src/kernel (Valuation advisor in think-pipeline; predictions APPEND to rule-based)
  - target: packages/land-tenure-advisor / jurisdiction-profiles (REIT 75/25/10 + CMA gates; statutory valuer routing)
  - target: packages/ai-copilot/src/personas/sub-personas/finance-persona.ts + four-eye-approval.ts (secured-lending gate; human-valuer-signs handoff)

### ESG, Carbon & Green Certification (value-and-lettability)
- Self-assess the portfolio against the GRESB Real Estate Assessment (Management/Performance/Development/Residential), predict the quintile 5-star rating, and identify marginal points.
- Classify funds under SFDR (Art 6/8/9) and produce EU-Taxonomy alignment evidence (substantial contribution + DNSH + minimum safeguards); produce IFRS S2 four-pillar climate disclosure with physical+transition scenario analysis and Scope 1/2/3.
- Compute whole-life carbon per RICS WLCA 2nd ed. (embodied+operational+user), overlay each asset on its CRREM 1.5C pathway, flag the Misalignment Year, and sequence retrofit capex to avoid stranding; treat EPC/MEES rungs as value-and-lettability inputs.
- Choose green certification per asset/market: EDGE (IFC 20/20/20) as the East-Africa default; LEED v5 / BREEAM for trophy & investor-mandated assets.
- Measure social value of staff/tenant housing (UKGBC framework: security of tenure, affordability, habitability, accessibility) to defend social licence.

  - target: NEW junior esg-agent.ts (mirror auditor-agent.ts/report-writer.ts) in packages/ai-copilot/src/juniors/ for GRESB/SFDR/IFRS-S2 disclosure assembly
  - target: Decarbonisation advisor in packages/central-intelligence/src/kernel think-pipeline (WLCA/CRREM/EPC; predictions APPEND, never replace)
  - target: packages/forecasting + causal-inference (CRREM stranding scenarios)
  - target: packages/database (schema: esg_metrics, carbon_pathways, certifications) reading asset-register
  - target: capital-projects/development persona (EDGE-default decisioning); social-licence/community advisor (UKGBC social value)

### KPI Spine, CEO Modes & Board/Investor Reporting
- Drive quarterly OKRs (3-5 KRs, ~70% stretch) cascaded from the per-building register; track portfolio NOI, occupancy, WALT, collection rate, hold/sell signals, GRESB score, fund-level IRR/promote.
- Produce board packs (quarterly) vs investor updates (monthly): ~15-20 curated KPIs across strategy/performance/governance, variance-vs-budget (>10% flagged), forecast-accuracy tracking.
- Expose strategic CEO modes (Acquirer/Developer/AssetManager/FundOperator/Disposer) analogous to Borjie's mining-ceo-modes.
- Grade forecasts with Scaled Pinball Loss/CRPS (quantile calibration), not point accuracy.
- Surface everything bilingual EN/SW under the absolute-toggle rule, multi-currency via formatCurrency (TZS launch; KES/UGX/NGN expansion).

  - target: NEW real-estate owner-advisor/CEO-modes set (mirror packages/ai-copilot/src/personas/mining-ceo-modes.ts + owner-advisor.ts) exposing Acquirer/Developer/AssetManager/FundOperator/Disposer
  - target: packages/executive-brief-engine + report-engine + strategic-reports + central-intelligence/src/kernel/briefing.ts
  - target: packages/outcomes + services/outcomes-metering + analytics (OKR/KPI scoring)
  - target: packages/forecasting + conformal-calibration-online + calibration-monitor (Scaled Pinball/CRPS)
  - target: apps/owner-web cockpit (mirror Borjie route pattern); packages/i18n + language-pack-en/sw + translation (EN/SW absolutism)

## Shared foundations (both estates)
- AUTONOMOUS-MD COGNITIVE CORE (both estates run on it): the master-brain orchestrator (packages/ai-copilot/src/juniors/master-brain.ts + persona-runtime) decomposes/delegates to specialist worker juniors over an explicit state machine (packages/agent-orchestrator + module-orchestrator + workflow-engine) with retries/timeouts/HITL pauses; deliberate cognition (planner-executor via juniors/executor.ts + executor-registry.ts, Reflexion in central-intelligence/src/kernel/reflexion, LATS + debate/critics/cot-reservoir) replaces single-shot reflex for high-stakes calls.
- EVIDENCE-REQUIRED VERIFIABLE DECISIONING: every consequential decision carries >=1 evidence_id + reasoning trace written to the hash-chained append-only audit (packages/audit-hash-chain + ai-copilot/audit-trail + central-intelligence/src/kernel/decision-trace.ts); the Auditor Agent (juniors/auditor-agent.ts) rejects empty/unsupported evidence chains. Same rule for a mining CP sign-off and a real-estate IC memo.
- TRUSTWORTHY UNCERTAINTY: replace verbalized confidence with conformal prediction sets / conformal abstention / selective prediction (packages/conformal-calibration-online + calibration-monitor + process-reward-model) to DRIVE escalate-to-human; refuse high-dispersion (semantic-entropy) answers.
- GRAPHRAG-GROUNDED DURABLE MEMORY: entity knowledge graph + community summaries + global/local search (packages/graph-rag-router + knowledge-graph + graph-database + org-graph + info-synthesis) over four-layer memory — working/episodic(hash-chained audit)/semantic(intelligence_corpus_chunks)/procedural(skill-library) — with consolidation, contradiction-resolution and forgetting (packages/cognitive-memory + memory-v2 + persistent-memory + tacit-knowledge).
- CAUSAL + PROBABILISTIC ANALYTICS: SCM/do-calculus/uplift/Double-ML for 'should I act' decisions (packages/causal-inference + belief-engine + reasoning-substrate) and time-series-foundation-model probabilistic forecasts graded by Scaled Pinball Loss/CRPS/MASE/WMAPE (packages/forecasting + forecasting-engine + anomaly-detection); Monte Carlo + Bayesian scenario planning shared by mining NPV and real-estate DCF.
- HARDENED TOOL FABRIC ON MCP: least-privilege scopes, poka-yoke tool arguments, kill-switches enforced OUTSIDE the agent's reasoning path with credential revocation on trip (packages/mcp + mcp-server + agent-platform + agent-security-guard + tenant-isolation-guard + mutation-authority; services/mcp-server-borjie|tra|process-intel).
- SOX/COSO INTERNAL CONTROLS + SEGREGATION OF DUTIES: proposer (fx-treasury/collections) != approver (four-eye-approval.ts) != recorder (services/payments-ledger LedgerService.post() double-entry). Money path is ALWAYS high-risk; every money event in either estate routes through the ledger only — never a direct write.
- CONSTRUCTION DISCIPLINE (cross-cutting, identical canon both estates): RIBA Plan of Work 0-7 stage gates, RICS NRM1/NRM2 cost-planning + first-principles unit rates, FIDIC/NEC4/JBC/NCA contract selection + 28/42/84-day claims clock + IPC/variation/retention/final-account machine, Eurocode/ACI limit-state design, GISTM for tailings (mining) / structural integrity (both), CPM+EVM+Monte-Carlo QSRA project controls, CDM 2015 HSE duty-holders, NEMA/NEMC EIA + professional-body registration, ISO 19650 CDE. Carriers: shared QS junior (extended cost-engineer.ts), shared structural-civil-agent.ts, procurement-agent.ts, risk/forecast-modeler EVM+Monte-Carlo, safety-agent.ts, compliance/licence-agent.ts.
- ESG/DISCLOSURE BACKBONE: ISSB IFRS S1/S2 four-pillar climate disclosure + Scope 1/2/3 + scenario analysis is common to both (GRI 14 Mining vs GRESB/SFDR/EU-Taxonomy on the real-estate side); WLCA/CRREM carbon math, EDGE-default green certification for East-Africa, and FPIC/UKGBC social-licence all reuse the same disclosure-assembly junior pattern + central-intelligence Decarbonisation advisor (predictions APPEND to rule-based, never replace).
- JURISDICTION + LOCALE + CURRENCY INVARIANTS: per-jurisdiction rule packs (TZ launch; KE/UG/NG expansion) as literal HIGH-risk policy in central-intelligence/policy-gate.ts + inviolable.ts (no reason-resolver generalisation on sovereign/kill_switch/four_eye/policy_rollout prefixes); strict EN/SW single-locale absolutism (packages/i18n + language-pack-en/sw + translation, zero mixing ever); multi-currency via formatCurrency only (never hard-code TZS/USD/KES/UGX/NGN).
- GOVERNANCE BINDING (NIST AI RMF GOVERN/MAP/MEASURE/MANAGE + EU AI Act Art.14 + OECD): per-action autonomy keyed to risk class, statutory human-oversight surface (understand limits, counter automation bias, override/reverse, stop/kill button), regulatory-change sensors watching standards updates, and a continuous-learning ADL loop (trace observability -> eval-in-CI -> policy update) via services/junior-evolution-worker + brain-evolution-worker + sleep-pass-orchestrator + apollo-gauntlet-runner + evals/.

## Autonomy model
DECISION RIGHTS (per-action, risk-classed): autonomy is selected per action by risk tier (packages/central-intelligence/src/kernel/risk-tier.ts + autonomy-governance + an approval matrix/RACI), NOT globally. LOW-risk bounded actions (refresh a forecast, draft an internal report, log a sensor, abstain) run AUTONOMOUS. MEDIUM-risk run HOTL (human-on-the-loop: the MD acts and a human can monitor/intervene/reverse). HIGH-risk run HITL (human-in-the-loop: before-execute approval) and the highest tier requires FOUR-EYES two-person verification (four-eye-approval.ts). A hard owner-work boundary is never crossed autonomously: legal-accountability acts (signing contracts, hiring, a registered-valuer signature, a Competent-Person sign-off), catastrophic-irreversible acts (large payments, prod DB migrations, licence relinquishment), and statutory acts route to the human owner — the MD analyses and recommends; the human commits. CONTROL LOOPS: (1) Sense — typed sensors + GraphRAG corpus + regulatory-change sensors feed the brain; (2) Deliberate — planner-executor + Reflexion + LATS + evidence-retrieving multi-agent debate, with conformal abstention escalating low-confidence/high-dispersion calls to a human instead of guessing; (3) Verify — the Auditor Agent rejects empty-evidence chains, the policy-gate enforces literal HIGH-risk inviolables (TZ 6%+1%+16%, no-Extreme-TSF-without-ITRB, FPIC, Governor's-consent, REIT 75/25/10), and SoD ensures proposer != approver != ledger recorder; (4) Act — only through hardened MCP tools with least-privilege scopes and kill-switches enforced outside the reasoning path; every money event posts via LedgerService.post() double-entry; (5) Record — hash-chained append-only audit with >=1 evidence_id + reasoning trace; (6) Learn — the ADL loop turns traces into eval cases in CI then policy updates (junior/brain-evolution workers, sleep-pass-orchestrator, apollo-gauntlet, evals/), with drift/calibration monitors. HITL GATES (concrete): money above a tier threshold; royalty/government payment; off-take/lease/IC commitment; secured-lending valuation reliance (human registered valuer signs); GISTM Extreme-TSF actions; FPIC/community-consent decisions; CAHRA Annex-II disengagement; licence relinquishment/renewal; any action a literal HIGH-risk policy prefix matches; any conformal-abstention escalation. KPIs/OKRs: quarterly Objectives + 3-5 measurable Key Results at ~70% stretch (committed/aspirational/learning), cascaded from the consolidated asset/building register; the master metric is AISC (Borjie) / NOI+fund-IRR (BossNyumba), with HSE/TRIFR and ESG/GRESB as hard guardrails not tradeable KRs; forecasts graded by Scaled Pinball Loss/CRPS, not point accuracy (packages/outcomes + services/outcomes-metering + analytics + conformal-calibration-online). BOARD/INVESTOR REPORTING: distinct cadences — board pack quarterly+detailed, investor update monthly+concise — each ~15-20 curated KPIs across strategy/performance/governance, variance-vs-budget with >10% auto-flagged, forecast-accuracy tracked, produced by executive-brief-engine + report-engine + strategic-reports + briefing.ts and surfaced through the BOARD_INVESTOR CEO mode in the owner cockpit, bilingual EN/SW, multi-currency via formatCurrency. The MD is a standing governed institution, not a chatbot: it composes these organs (mining-ceo-persona + mining-ceo-modes / the new real-estate CEO-modes set) into ONE governed executive loop whose every consequential act is bounded, evidenced, recorded, reversible, and — at the highest tiers — human-committed.

## Verdict
Best-in-world is achieved not by inventing new organs — Borjie already has a package named for essentially every SOTA capability (graph-rag-router, causal-inference, forecasting, conformal-calibration-online, four-eye-approval, audit-hash-chain, payments-ledger, autonomy-governance, mcp) — but by WIRING SOTA DEPTH into those shells and COMPOSING them into one governed executive loop per MD. Three things separate world-class from a demo: (1) DEPTH OF DOMAIN TRUTH — the MD must hold the real operating model (CRIRSCO graded reserves + AISC for mining; RICS Red Book + waterfall + CRREM for real-estate; RIBA+FIDIC+NRM+Eurocode+GISTM for the shared construction spine), with every number traceable to an evidence_id and every jurisdiction rule encoded as literal HIGH-risk policy, not generalised reasoning. (2) TRUSTWORTHY AUTONOMY — bounded per-action autonomy (HITL/HOTL/four-eyes/kill-switch, EU AI Act Art.14 + NIST + OECD floored), conformal abstention that escalates instead of confabulating, SoD that keeps proposer/approver/ledger-recorder distinct, and a hard owner-work boundary the MD never crosses. (3) RUN-THE-BUSINESS DISCIPLINE — AISC/NOI-centered OKR cascades, board-vs-investor reporting cadences, forecasts graded by Scaled Pinball Loss not accuracy, and a continuous-learning ADL loop turning every trace into an eval then a policy update. CONCRETE WAVE-3 PRIORITIES: build the two highest-value missing juniors (a full QS junior by extending cost-engineer.ts, and a structural-civil/TSF GISTM agent) shared by both estates; stand up the BossNyumba real-estate junior/advisor/CEO-mode set by mirroring the proven mining pattern (deal-sourcing, due-diligence, development, leasing, collections, asset-manager, valuation, fund-ops, esg agents + acquisitions/portfolio/land-tenure advisors); add the family-office/succession modes to Borjie; deepen the consolidated asset register so it reconciles to ledger+cadastre and feeds the KPI spine; and harden the policy-gate with the full set of literal jurisdiction inviolables. Do this and each MD becomes a standing, auditable, jurisdiction-bound institution that can run its estate autonomously to a standard no human team sustains 24/7 — which is the bar for best-in-world."}