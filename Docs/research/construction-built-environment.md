# State-of-the-Art Construction & Built-Environment Expertise

**Research dossier — what a world-class autonomous MD must know to lead construction & built-environment delivery across BOTH estates (mine infrastructure/plants/camps/tailings dams AND buildings).**

- **Audience:** Borjie central-intelligence kernel, the `ai-copilot` juniors (cost-engineer, procurement, safety, mine-planner, risk-modeler, maintenance, compliance, report-writer), owner/admin personas, and the strategic-reports advisors.
- **Author:** Research subagent (deep web research, every claim cited to a real URL actually fetched).
- **Date:** 2026-06-08
- **Depth target:** PhD / 20-year-consultant. Combines the heads of a **Chartered Surveyor + Structural Engineer + Architect + Quantity Surveyor + Project Manager** into one MD-grade brief.
- **Scope note:** Construction is the connective tissue across the Borjie estate: a mine is a *construction programme* (declines, plants, TSFs, camps, haul roads, water/power) as much as a building portfolio is. This dossier covers the shared discipline so a single brain can reason across both.

---

## 0. The mental model — construction as a stage-gated, risk-priced, contractually-governed value chain

A world-class MD holds five integrated lenses simultaneously and never lets one dominate:

| Lens | Owns | Core question | Failure mode if missing |
|------|------|---------------|-------------------------|
| **Architect / Lead designer** | Brief, concept, spatial coordination, design intent | "Is it the right thing, well-arranged, buildable, compliant?" | Beautiful-but-unbuildable, scope creep, late planning refusal |
| **Structural / Civil engineer** | Loads, codes, factors of safety, geotechnics, durability | "Will it stand up, for how long, against what?" | Collapse, settlement, tailings dam breach |
| **Quantity surveyor (QS) / cost manager** | BOQ, cost plan, rate build-up, valuations, variations, final account | "What does it cost, who pays, is the spend earned?" | Budget blowout, payment disputes, unmanaged change |
| **Project manager / controls** | Schedule, EVM, risk, procurement strategy, integration | "Is it on time, on budget, and converging?" | Drift, surprise at completion, claims |
| **Surveyor (land/engineering)** | Boundaries, levels, setting-out, as-builts | "Is it in the right place, at the right level?" | Built on wrong line, encroachment, re-work |

Above all of these sits **HSE** (no value justifies a fatality) and **contract law** (FIDIC/NEC/JBC/NCA define who carries each risk). The MD's job is **integration** — the stage gates below force these lenses to converge at defined moments.

---

## 1. Design stage gates — RIBA Plan of Work 2020 (the canonical spine)

The **RIBA Plan of Work 2020** is the definitive UK/Commonwealth model and the de-facto reference for East-African consultants. It organises briefing → design → construction → operation into **8 stages (0–7)**, each with a **gateway** that must be signed off before money flows to the next stage. ([RIBA](https://www.riba.org/work/insights-and-resources/riba-plan-of-work/); [Designing Buildings — RIBA Plan of Work 2020](https://www.designingbuildings.co.uk/wiki/RIBA_Plan_of_Work_2020); [DS-A — the 8 RIBA stages](https://ds-a.co.uk/the-8-riba-stages-of-work/))

| Stage | Name | What happens | Gateway / output | Mine-estate analogue |
|-------|------|--------------|------------------|----------------------|
| **0** | Strategic Definition | Test the *need*; business case; feasibility; option appraisal | Confirm project viability; client requirements | Scoping study / decision to expand a pit, build a plant |
| **1** | Preparation & Briefing | Develop the project brief, budget, programme, site appraisals, project execution plan | Brief signed off; team appointed | Order-of-magnitude (Class 5) estimate; PEP |
| **2** | Concept Design | Architectural concept + strategic engineering; outline cost plan; project strategies | Concept frozen & signed off (NOT to be reopened) | Pre-feasibility study (PFS) |
| **3** | Spatial Coordination | Coordinate the design in 3D; engineering analysis; cost exercises; usually planning application | Design coordinated; planning submitted | Feasibility study (FS / DFS) — bankable |
| **4** | Technical Design | All technical info: specifications, structural design, MEP, building-regs compliance, fabrication info | Construction-ready information complete | Detailed engineering (FEED → EPC handover) |
| **5** | Manufacturing & Construction | Build it; site inspections; resolve site queries (RFIs); no design change | Practical / substantial completion | Construction & commissioning |
| **6** | Handover | Snag, commission, hand over; close the building contract | Building handed over; aftercare initiated | Plant ramp-up / takeover |
| **7** | Use | Operate; post-occupancy evaluation; feedback to next project | POE report; lessons learned | Operations + closure planning |

**2020 update — why it matters for an AI-native estate OS:** the revision baked in **digitisation (BIM/ISO 19650), modern methods of construction (MMC/offsite), sustainability strategies, ethics, and aftercase/POE** as first-class concerns, and clarified the Stage 2 vs Stage 3 boundary (Stage 2 = get the concept right and *close the brief*; Stage 3 = coordinate and *get the cost plan right* — do **not** reopen the concept). ([RIBAJ — 2020 update analysed](https://www.ribaj.com/intelligence/updates-to-the-riba-plan-of-work-2019-dale-sinclair-gary-clark))

> **MD discipline:** never let a project skip a gateway. The single most common cause of overrun is starting Stage 4/5 work on a Stage 2 design. The mine-industry mirror (AACE estimate classes / study gates) enforces the same discipline.

---

## 2. Cost — quantity surveying, BOQ, rate build-up & cost planning (RICS NRM)

### 2.1 The measurement backbone — RICS New Rules of Measurement (NRM)

The **RICS New Rules of Measurement** are the global standard suite for cost management, giving a consistent "cradle-to-grave" framework. Reissued Oct 2021/2022 as **practice information** (formerly guidance notes). ([RICS — NRM](https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/construction-standards/nrm))

- **NRM1 — Order of Cost Estimating & Cost Planning (capital works):** the *planning* tool. Elemental cost plans, plus rules for quantifying **preliminaries, overheads & profit (OH&P), design/project-team fees, risk allowances, inflation, and other development costs**. Used through RIBA Stages 0–4 to give the client confidence the budget is sound. ([RICS NRM1 PDF](https://www.rics.org/content/dam/ricsglobal/documents/standards/nrm_1_order_of_cost_estimating_and_cost_planning_2nd_edition_rics.pdf); [MyQS — NRM1 guide 2026](https://www.myqs.ai/blog/nrm1-explained-guide-uk-construction-2026))
- **NRM2 — Detailed Measurement for Building Works:** the *procurement* tool. The rulebook for **Bills of Quantities (BOQ)**. Replaced **SMM7** (operative 2013). Three parts: (1) General — context within RIBA/OGC; (2) Rules for detailed measurement — BOQ function, work breakdown; (3) **Tabulated rules** (the core) across a **41-section** work classification (Preliminaries … Mechanical & Electrical). ([Designing Buildings — NRM2](https://www.designingbuildings.co.uk/wiki/NRM2); [RateQS — NRM2 explained](https://rateqs.com/insights/nrm2-explained/))
- **NRM3 — Order of Cost Estimating & Cost Planning for Maintenance:** links capital cost to **whole-life-cycle costing (WLCC)**; aligned with **ISO 19650** BIM transition. ([RICS — NRM](https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/construction-standards/nrm))

> **Workflow:** Start with an **NRM1 elemental cost plan** (planning tool through RIBA 0–4) → transition to an **NRM2 BOQ** at tender (procurement tool). The elemental structure is broadly consistent so the cost plan carries through into the BOQ. ([RateQS — quantification/NRM2](https://rateqs.com/insights/apc-quantification-nrm2/))

### 2.2 Rate build-up — the unit-rate anatomy every QS must know

A measured BOQ item's **unit rate** is built from first principles:

```
Unit rate = (Labour + Plant + Materials) × (1 + waste%) + Overheads + Profit
```

- **Labour:** all-in hourly rate (basic + statutory on-costs + non-productive time) × output constant (hrs per unit).
- **Materials:** delivered cost + **waste allowance** + handling.
- **Plant:** owned/hired rate × usage per unit.
- **Preliminaries:** time-related (site staff, accommodation, cranes, security) + fixed (mobilisation/demob) — priced separately in NRM2, NOT smeared into rates.
- **OH&P:** head-office overhead recovery + margin (project- and market-dependent).

NRM2 sets out exactly how measured work is **broken down, described and quantified** so pricing and tender comparison are meaningful — the description governs what is and isn't included, which is the root of most pricing disputes. ([Designing Buildings — NRM2](https://www.designingbuildings.co.uk/wiki/NRM2)) Key APC competencies: *how to build a unit rate and which assumptions most affect its reliability* (outputs, waste, market). ([RateQS — quantification/NRM2](https://rateqs.com/insights/apc-quantification-nrm2/))

### 2.3 BOQ types

- **Firm BOQ:** quantities measured from complete drawings — used for lump-sum tenders.
- **Approximate / provisional BOQ:** quantities measured from incomplete design — re-measured during the works (measurement contract).
- **Provisional sums & PC sums:** allowances for work not yet designed / for nominated suppliers.

---

## 3. Procurement & tendering strategy

### 3.1 Procurement routes (who designs, who carries risk)

([Designing Buildings — traditional procurement](https://www.designingbuildings.co.uk/wiki/Traditional_procurement_method); [NetSuite — 5 types of construction procurement](https://www.netsuite.com/portal/resource/articles/erp/types-of-construction-procurement.shtml); [Kisiel — procurement methods](https://kisiel.co.uk/insights/procurement-methods-in-construction/))

| Route | Design by | Single point of responsibility? | Risk profile | Best for |
|-------|-----------|----------------------------------|--------------|----------|
| **Traditional (Design-Bid-Build)** | Employer's consultants | No (split design/build) | Employer keeps design risk; price certainty before start | Quality-led, fully designed buildings |
| **Design & Build (D&B)** | Contractor | **Yes** | Contractor carries design + build risk; single point | Speed, cost certainty, less client design control |
| **Management Contracting** | Employer's consultants | Management contractor manages works contractors | Employer carries more risk; early start | Large/complex, fast-track, evolving design |
| **Construction Management** | Employer's consultants | Employer holds trade packages directly | Employer carries most risk + coordination | Sophisticated clients wanting control |

### 3.2 Pricing mechanisms (how the contract sum is fixed)

([NetSuite — construction procurement](https://www.netsuite.com/portal/resource/articles/erp/types-of-construction-procurement.shtml); [Designing Buildings — traditional procurement](https://www.designingbuildings.co.uk/wiki/Traditional_procurement_method))

- **Lump sum:** single agreed price for all works; stage payments as work proceeds. **Price certainty, contractor carries quantity risk.** Standard for traditional/D&B with firm BOQ.
- **Measured / re-measurement:** **no fixed contract sum**; the BOQ acts as a **schedule of rates** and final cost = actual quantities × tendered rates. Used where design is incomplete; FIDIC Red Book is the classic measured form.
- **Cost-plus / cost-reimbursable:** employer pays **actual cost + fee/incentive**. Lowest price certainty, used for urgent/undefined scope or where quality outranks budget.
- **Target cost (pain/gain):** hybrid — a target price with a **pain/gain share** so both parties have skin in the game (see NEC4 Options C/D below). Best for complex risk-sharing.

### 3.3 The tender process

Pre-qualification (PQQ) → invitation to tender (ITT) with drawings + BOQ/spec + conditions → tender period → tender opening → arithmetic & technical check → tender report & recommendation → award → contract execution. Two-stage tendering (early contractor involvement on a fee, then negotiated price) is increasingly used to de-risk complex work. A formal **procurement strategy** should be set at RIBA Stage 1. ([RICS — developing a construction procurement strategy](https://www.rics.org/content/dam/ricsglobal/documents/standards/Developing-a-construction-procurement-strategy.pdf))

---

## 4. Contracts — FIDIC, NEC4, JCT (the legal risk-allocation engines)

### 4.1 FIDIC 2017 suite ("rainbow") — the global standard for international & infrastructure work

In December 2017 FIDIC published the **2nd editions** of its three main forms — the first major update in ~20 years — adding much more prescriptive claims, notice and dispute machinery. ([FIDIC — New 2017 Contracts](https://fidic.org/themes/new-fidic-contracts-2017-2nd-editions-red-yellow-and-silver-books); [Fenwick Elliott / SCL — the new 2017 FIDIC books](https://www.fenwickelliott.com/sites/default/files/scl_-_the_new_2017_fidic_red_yellow_and_silver_books_with_scl_logo-1.pdf))

| Book | Design by | Payment | Risk balance | Administered by | Best for |
|------|-----------|---------|--------------|-----------------|----------|
| **Red** | Employer | **Measured** (BOQ rates) or lump sum | **Balanced**; Employer carries unforeseeable physical conditions; Contractor may claim EOT + cost | **The Engineer** | Building & civil works designed by employer |
| **Yellow** | **Contractor (design-build)** | Lump-sum instalments per schedule; "Tests After Completion" clause | Employer carries unforeseen ground risk; Contractor claims available | **The Engineer** | Plant, E&M, design-build (water/wastewater plants, pumping stations, process units) |
| **Silver** | **Contractor (EPC/turnkey)** | **Lump sum, no adjustment** | **Contractor carries most risk**, incl. accuracy of Employer's Requirements; Employer keeps war/force-majeure; limited control | **Employer's Representative** (not an Engineer) | EPC/turnkey process, power, private infrastructure — financeable, fixed-price/date |

([ICCP — FIDIC Red/Yellow/Silver overview](https://www.instituteccp.com/fidic-red-yellow-and-silver-books-a-brief-overview/); [Clyde & Co — FIDIC 2017 quick reference](https://www.clydeco.com/en/insights/2017/12/fidic-2017-quick-reference-guide))

Other FIDIC forms an MD should recognise: **Green Book** (short form, simple/low-value), **Gold Book** (DBO — design-build-operate), **Emerald Book** (underground/tunnelling), **Pink Book** (MDB-harmonised for World Bank-funded projects). ([ICCP](https://www.instituteccp.com/fidic-red-yellow-and-silver-books-a-brief-overview/))

#### FIDIC 2017 claims & dispute machinery (Clauses 3, 20, 21) — the part that wins or loses money

- **The Engineer (Sub-Clause 3.7):** acts neutrally to **consult → agree → determine** matters and claims. The Engineer's determination is **binding unless** challenged. ([Gowling WLG — dispute resolution under FIDIC](https://gowlingwlg.com/en/insights-resources/articles/2024/a-guide-to-dispute-resolution-under-fidic))
- **Claims (Clause 20):** a party claiming **additional payment and/or EOT** must give **Notice within 28 days** of the event (or it is **time-barred**), then **full particulars within 42 days**. This dual-deadline regime — same for Employer and Contractor in 2017 — is the single most contested mechanism on FIDIC jobs. ([Aceris Law — FIDIC dispute mechanism](https://www.acerislaw.com/fidic-dispute-resolution-mechanism/); [FIDIC — Clause 20 dispute resolution](https://fidic.org/sites/default/files/24%20CLAUSE%2020,%20DISPUTE%20RESOLUTION.pdf))
- **Notice of Dissatisfaction (NOD):** dissatisfied with the Engineer's determination → serve NOD **within 28 days** or the determination becomes **final and binding**. ([Gowling WLG](https://gowlingwlg.com/en/insights-resources/articles/2024/a-guide-to-dispute-resolution-under-fidic))
- **DAAB (Clause 21):** the 2017 forms renamed the DAB the **Dispute Avoidance/Adjudication Board** — emphasising *avoidance*, typically a **standing board** for the project life. The DAAB issues a **reasoned decision within 84 days**; binding but **not final** — a party may serve a NOD within 28 days, after which → **amicable settlement → ICC arbitration**. ([Aceris Law](https://www.acerislaw.com/fidic-dispute-resolution-mechanism/); [Fenwick Elliott — 2017 dispute mechanism](https://www.fenwickelliott.com/research-insight/annual-review/2018/new-dispute-resolution-mechanism); [HKA — DAABs dos and don'ts](https://www.hka.com/article/daabs-dos-and-donts/))

### 4.2 NEC4 — the collaborative alternative (East Africa & infrastructure increasingly use it)

The **NEC4 Engineering & Construction Contract (ECC)** is a collaborative, plain-English suite with **six main payment Options A–F** spanning the full risk spectrum. Parties must act in a **"spirit of mutual trust and co-operation"**, give **early warnings**, and manage change through a **fast compensation-event process** against a continually-updated programme. ([NEC — ECC](https://www.neccontract.com/products/contracts/nec4/engineering-and-construction-contract/ecc))

| Option | Mechanism | Risk |
|--------|-----------|------|
| **A** | Priced contract with **activity schedule** | Most risk on **contractor** (lump sum) |
| **B** | Priced contract with **bill of quantities** | Most risk on contractor (re-measured) |
| **C** | **Target contract** with activity schedule | **Shared** (pain/gain) |
| **D** | Target contract with bill of quantities | Shared (pain/gain) |
| **E** | **Cost reimbursable** | Most risk on **client** |
| **F** | **Management contract** | Most risk on client |

([NEC — ECC options](https://www.neccontract.com/products/contracts/nec4/engineering-and-construction-contract/ecc); [GMH Planning — Option C & D focus](https://gmhplanning.co.uk/nec-downloads/nec4-ecc-option-c-and-option-d/))

### 4.3 Local equivalents (East Africa)
- **JBC (Joint Building Council) Agreement** — the standard building contract used in Kenya/Tanzania, derived from the JCT family.
- **NCA standard contracts** — the Kenyan **National Construction Authority** issues/endorses standard forms (see §7).
- World-Bank-funded works in the region default to **FIDIC Pink Book (MDB harmonised)**.

---

## 5. Post-contract QS administration — IPCs, variations, retention, defects, final account

The QS / contract administrator runs the *money machine* during construction:

- **Interim Payment Certificates (IPC):** for any contract > 45 days, parties are entitled to **interim/stage payments**. The QS prepares a **gross valuation** of work *properly* executed + materials on/off site, then deducts **prior payments and retention** → **net amount due**. The certifier issues within statutory timeframes (e.g. ~5 days of the due date). The QS **must visit site** to verify work claimed actually exists and is arithmetically correct. ([Designing Buildings — interim certificates](https://www.designingbuildings.co.uk/wiki/Interim_certificates_in_construction_contracts); [TU Dublin — preparing interim payment valuations](https://arrow.tudublin.ie/cgi/viewcontent.cgi?article=1078&context=beschreoth))
- **Payment notice & "pay-less notice":** if the payer intends to pay less than certified, it must serve a formal **pay-less notice** with the calculation basis before the final date for payment — the core anti-abuse mechanism of construction payment law. ([Designing Buildings — interim certificates](https://www.designingbuildings.co.uk/wiki/Interim_certificates_in_construction_contracts))
- **Variations (VOs):** changes are valued at each interim valuation — using BOQ rates where work is similar, pro-rata rates where partly similar, or fair rates / dayworks where new. Variations, defective work and delays are all reconciled at each valuation. ([TU Dublin](https://arrow.tudublin.ie/cgi/viewcontent.cgi?article=1078&context=beschreoth))
- **Retention:** a % held from each payment as security. **Half released at Practical Completion**, the **balance released on the Certificate of Making Good Defects** (end of the defects period). Best practice holds retention in a separate trust account. ([Designing Buildings — interim certificates](https://www.designingbuildings.co.uk/wiki/Interim_certificates_in_construction_contracts))
- **Defects Liability / Rectification Period:** typically **12 months** post-completion during which the contractor must rectify defects arising from poor workmanship/materials at its own cost. ([TU Dublin](https://arrow.tudublin.ie/cgi/viewcontent.cgi?article=1078&context=beschreoth))
- **Final account & final certificate:** full reconciliation of measured work, variations, claims, fluctuations → final contract sum; the **final certificate** releases the residual retention and (subject to the contract) is conclusive evidence of completion.

> **Borjie money-path tie-in:** every certified IPC, variation, retention release and final-account settlement is a money event that must flow through `LedgerService.post()` (double-entry, immutable) — never a direct ledger write. The QS junior produces the valuation; the ledger records it.

---

## 6. Structural & civil engineering basics — codes, limit states, geotechnics

### 6.1 The Eurocode system (the global limit-state reference; basis of most modern national codes)

The **Eurocodes (EN 1990–EN 1999)** are a harmonised, mutually-dependent set that **must be used together**, replacing national codes for the design of buildings and civil works. ([EC — Eurocodes](https://single-market-economy.ec.europa.eu/sectors/construction/eurocodes_en); [SteelConstruction.info — design codes & standards](https://steelconstruction.info/Design_codes_and_standards))

| Eurocode | Covers | MD must know |
|----------|--------|--------------|
| **EN 1990** | **Basis of structural design** — the *head* code | Limit-state philosophy; reliability; load combinations; partial factors |
| **EN 1991** | **Actions on structures** (loads) | Dead/imposed/wind/snow/thermal/fire/seismic actions |
| **EN 1992** | **Concrete** (RC & prestressed) | ULS/SLS, cover/durability, detailing, fire |
| **EN 1993** | **Steel** | Member design, stability, connections, fatigue |
| **EN 1994/95/96/99** | Composite / **timber** / **masonry** / **aluminium** | Material-specific limit-state rules |
| **EN 1997** | **Geotechnical design** | Foundations, retaining walls, slopes, ground risk |
| **EN 1998** | **Seismic (earthquake) design** | Capacity design, ductility (relevant to the EA Rift) |

**Limit-state design (the core idea):** structures are checked against (1) **Ultimate Limit State (ULS)** — strength/stability, preventing collapse (bending, shear, torsion) using factored loads and material partial factors; and (2) **Serviceability Limit State (SLS)** — deflection, crack width, vibration, comfort. A pre-design phase fixes cover, member sizes and concrete strength for **durability and fire**. EN 1990 supplies the safety/reliability framework, EN 1991 the loads, EN 1992 the concrete rules. ([Wikipedia — Eurocode 2](https://en.wikipedia.org/wiki/Eurocode_2:_Design_of_concrete_structures); [Wikipedia — Eurocode: Basis of structural design](https://en.wikipedia.org/wiki/Eurocode:_Basis_of_structural_design); [JRC — basis of structural design handbook](https://eurocodes.jrc.ec.europa.eu/sites/default/files/2021-12/handbook1.pdf))

> **2023 note:** **EN 1990:2023** broadened the head code to *"Basis of Structural and Geotechnical Design"*, integrating geotechnical reliability more tightly. ([iTeh — EN 1990:2023](https://standards.iteh.ai/catalog/standards/cen/6aad58da-1470-467f-9f37-4657dcf5d4af/en-1990-2023))

### 6.2 Other major code families the MD must recognise
- **ACI 318** (American Concrete Institute) — the US concrete code, the global counterpart to EN 1992; common on internationally-funded/mining EPC work.
- **BS / KS / TZS national standards** — Kenya (KEBS) and Tanzania (TBS) adopt British/Euro-derived structural standards; KS/TZS codes govern local approvals.
- **ASCE / AISC** (US loads & steel), **AS** (Australian, common in mining via Australian EPCMs).

### 6.3 Geotechnics & the mine-estate dimension
Ground risk dominates mining civil works: slope stability for pit walls and waste dumps, bearing capacity for plant foundations, settlement of haul roads, dewatering, and — most critically — **tailings storage facilities** (next section). EN 1997 / the **observational method** (design-as-you-monitor) is the governing approach for high-uncertainty ground.

---

## 7. Tailings dams & mine infrastructure — the highest-consequence construction in the estate

A tailings storage facility (TSF) is a **dam that can kill thousands** if it fails (Brumadinho, Brazil, 2019 — 270+ deaths — triggered the global standard below). This is the most important single piece of construction knowledge for the mining estate.

### 7.1 The Global Industry Standard on Tailings Management (GISTM)

Published **August 2020** by the **Global Tailings Review** (co-convened by **ICMM + UNEP + PRI**) in direct response to Brumadinho. Goal: **"zero harm to people and the environment"** and **"zero tolerance for human fatalities."** Structure: **6 Topic Areas → 15 Principles → 77 auditable Requirements.** ([Global Tailings Review — GISTM](https://globaltailingsreview.org/global-industry-standard/); [ICMM — GISTM news](https://www.icmm.com/en-gb/news/2020/new-global-industry-standard-on-tailings-management))

| Topic Area | Theme | Construction-relevant content |
|------------|-------|-------------------------------|
| **I** | Project-affected people | Human-rights due diligence; community engagement across lifecycle |
| **II** | Knowledge base | Site characterisation; multidisciplinary social/environmental/geotech knowledge |
| **III** | **Design, construction, operation & monitoring** | **Robust designs; consideration of alternative tailings tech; all credible failure modes; the Observational Method; performance-based monitoring** |
| **IV** | Management & governance | **Accountable Executive, Engineer of Record (EoR), Responsible Tailings Facility Engineer (RTFE)**, Tailings Management System, Independent Tailings Review Board |
| **V** | Emergency preparedness | Dam-breach scenarios; community capacity; long-term recovery |
| **VI** | Public disclosure | Standardised, public, accessible disclosure of facility data |

([Global Tailings Review](https://globaltailingsreview.org/global-industry-standard/); [WSP — embracing the GISTM](https://www.wsp.com/en-us/insights/embracing-the-global-industry-standard-on-tailings-management); [Barr — mine-tailings standards](https://www.barr.com/insights/navigating-the-expanding-landscape-of-mine-tailings-standards/))

**Conformance timeline:** ICMM members committed all **"Extreme"/"Very high"** consequence facilities to conformance within **3 years**, all others within **5 years**. ([ICMM — GISTM news](https://www.icmm.com/en-gb/news/2020/new-global-industry-standard-on-tailings-management))

### 7.2 The engineering essentials a world-class MD enforces
- **Consequence classification** drives everything — requirements scale with the *consequence of failure* (population/economic/environmental at risk downstream). Higher class → higher design floods/earthquakes, higher factor of safety, more monitoring. ([Barr](https://www.barr.com/insights/navigating-the-expanding-landscape-of-mine-tailings-standards/))
- **Engineer of Record (EoR):** a single accountable engineer for design integrity and as-built conformance; the **RTFE** owns day-to-day facility engineering; an **Independent Tailings Review Board (ITRB)** provides external challenge. ([Global Tailings Review](https://globaltailingsreview.org/global-industry-standard/))
- **Construction method matters:** **upstream** (cheapest, *most failure-prone* — banned in some jurisdictions post-Brumadinho), **downstream** (safest, most material), **centreline** (compromise). The MD must know the method and its liquefaction risk.
- **Observational method + instrumentation:** piezometers, inclinometers, survey monuments, InSAR/satellite deformation monitoring; design assumptions verified continuously against monitored behaviour. ([Global Tailings Review](https://globaltailingsreview.org/global-industry-standard/))
- **Companion standards:** **CDA (Canadian Dam Association) Dam Safety Guidelines** — five core principles, flexibility + professional judgement, adopted into several regulatory regimes; plus ANCOLD (Australia). ([Barr](https://www.barr.com/insights/navigating-the-expanding-landscape-of-mine-tailings-standards/))

### 7.3 Other mine-estate construction the MD must cost, schedule and govern
Process plants (crushing/milling/CIL/flotation), camps & accommodation, haul roads & site roads, water supply/dewatering, power (grid/diesel/solar), workshops, fuel farms, magazines, water/effluent treatment, and **mine closure & rehabilitation works** (a contractual + regulatory liability that must be provisioned from day one).

---

## 8. Project controls — schedule, cost & risk integration (EVM, CPM, Monte Carlo)

### 8.1 Earned Value Management (EVM) — the integrated cost+schedule truth

EVM unifies **scope, time and cost** into one performance picture by comparing **planned vs earned vs actual**. ([PMI — integrating scheduling & EVM](https://www.pmi.org/learning/library/integrating-scheduling-evm-metrics-8516); [Deltek — CPI guide](https://www.deltek.com/en/project-and-portfolio-management/earned-value-management/cost-performance-index))

| Metric | Formula | Reads |
|--------|---------|-------|
| **PV** (Planned Value / BCWS) | budgeted cost of work scheduled | the baseline |
| **EV** (Earned Value / BCWP) | budgeted cost of work *performed* | what you've actually earned |
| **AC** (Actual Cost / ACWP) | actual cost of work performed | what you've spent |
| **CPI** = EV / AC | **cost efficiency**; **>1 = under budget** | every $ spent buys >$1 of value |
| **SPI** = EV / PV | **schedule efficiency**; **>1 = ahead** | progress vs plan |
| **CV** = EV − AC, **SV** = EV − PV | cost/schedule variance | $ over/under, $ ahead/behind |
| **EAC / ETC / VAC / TCPI** | forecasts | estimate at completion, to complete, variance, to-complete performance index |

CPI and SPI must be read **together**: a project can be under budget (CPI > 1) yet still at risk of late delivery (SPI < 1). EVM enables **proactive course-correction** and reduces overrun risk. ([Celoxis — EVM metrics](https://www.celoxis.com/article/earned-value-management-projects); [4PMTI — CPI vs SPI](https://www.4pmti.com/learn/cost-performance-index-cpi-vs-schedule-performance-index-spi/)) Research confirms EVM (and the Earned-Schedule extension) improves forecasting accuracy on real construction project datasets. ([PMC — comparative analysis of EVM in construction](https://pmc.ncbi.nlm.nih.gov/articles/PMC12222939/))

### 8.2 Schedule & quantitative risk analysis

- **Critical Path Method (CPM):** logic network → longest chain of dependent activities = the **critical path**; float/slack on non-critical paths; drives the baseline programme.
- **Quantitative Schedule Risk Analysis (QSRA) via Monte Carlo:** replace fixed durations with **three-point estimates (optimistic/most-likely/pessimistic)**; run thousands of iterations → a **probability distribution of completion dates**. Report **P50 / P80 / P90** confidence dates. ([IQRM — schedule risk analysis guide](https://iqrm.net/blog/schedule-risk-analysis-complete-guide); [IQRM — Monte Carlo in project risk](https://iqrm.net/blog/monte-carlo-simulation-project-risk-management))
- **Contingency from P-values, not padding:** the **gap between P50 and P80/P90 is your justified buffer** — derive schedule (and cost) contingency from the distribution, never arbitrary mark-ups. **Criticality index** and **tornado charts** show which activities/risks drive the spread, focusing mitigation. ([IQRM — schedule risk analysis guide](https://iqrm.net/blog/schedule-risk-analysis-complete-guide))
- **Cost risk** mirrors this: Monte Carlo over BOQ/cost-plan line items + discrete risk register → a **P50/P80 cost** for board-grade contingency.

### 8.3 Estimate maturity (mining lens)
Mine/EPC estimates carry an **AACE class** (Class 5 scoping ±50% → Class 1 ±10%) mapped to study gates (scoping → PFS → FS/DFS → detailed engineering) — the cost-side mirror of RIBA stages 0→4. The MD must never quote a Class-5 number as a commitment.

---

## 9. Health, Safety & Environment (HSE) on site

### 9.1 CDM-style duty allocation (the UK CDM 2015 model — the global best-practice template)

The UK **Construction (Design & Management) Regulations 2015**, enforced by the **HSE**, allocate H&S duties across the project and are the most-copied framework worldwide. ([HSE — CDM 2015](https://www.hse.gov.uk/construction/cdm/2015/index.htm); [HSE — summary of duties](https://www.hse.gov.uk/construction/cdm/2015/summary.htm))

| Duty-holder | Responsibility |
|-------------|----------------|
| **Client** | Make suitable arrangements; allocate time/resource; ensure others perform |
| **Principal Designer** | **Plan, manage, monitor & coordinate H&S in the *pre-construction* phase**; design out foreseeable risk; produce pre-construction info | ([HSE — principal designers](https://www.hse.gov.uk/construction/cdm/2015/principal-designers.htm)) |
| **Principal Contractor** | **Plan, manage, monitor & coordinate H&S in the *construction* phase**; produce the construction-phase plan; ensure competence/training | ([Procore — CDM 2015 explained](https://www.procore.com/en-gb/library/cdm-2015-explained)) |
| **Designers / Contractors** | Eliminate/reduce risk in their own work; not endanger others; follow site rules |

**Trigger:** projects with **more than one contractor** must appoint a **Principal Designer and Principal Contractor in writing**. ([HSE — summary of duties](https://www.hse.gov.uk/construction/cdm/2015/summary.htm)) The governing principle is **"design out risk first"** — the hierarchy of control (Eliminate → Substitute → Engineering controls → Administrative controls → PPE) applied from the drawing board, not just on site.

### 9.2 Site HSE essentials (building + mine)
Risk assessment & method statements (RAMS); permit-to-work systems (hot work, confined space, working at height, lifting); the "fatal four/six" (falls, struck-by, caught-in, electrocution + for mining: ground failure, vehicle/haulage); competence & toolbox talks; incident reporting & investigation; mine-specific regimes (explosives, ventilation, ground control, TSF surveillance). International reference floor: **ILO** construction-safety conventions and **ISO 45001** (OH&S management systems).

### 9.3 Environmental compliance — East Africa EIA regime
No development permit may issue without an **EIA licence** for scheduled projects:
- **Kenya:** **NEMA** issues EIA licences under the **Environmental Management & Coordination Act (EMCA) No. 8 of 1999**; **no licensing authority may permit a scheduled project (housing estates, industrial plants, mining, roads, energy, water infrastructure, etc.) without a NEMA EIA licence.** ([NEMA — EIA service](https://nema.go.ke/services/environment-impact-assessment-eia/))
- **Tanzania:** **NEMC** administers EIA under the **Environmental Management Act (EMA) 2004**; sector-specific EIA guidelines exist for **building construction**. ([NEMC — EIA training manual](https://www.nemc.or.tz/uploads/publications/sw-1576238321-EIA%20Training%20Manual%20Version%204.pdf); [CSE/NEMC — EIA guidelines for building construction](https://www.cseindia.org/cse-and-nemc-release-environmental-impact-assessment-eia-guidelines-for-tanzania-s-building-construction-sector-11907))

---

## 10. Land & engineering surveying

- **GNSS/GPS (RTK):** triangulates ≥4 satellites; with RTK corrections achieves **centimetre-level real-time accuracy** — used for control networks, topographic capture, boundary definition and **setting-out** in open areas. ([Castle Surveys — GNSS in topo surveying](https://castlesurveys.co.uk/understanding-gnss-in-topographic-surveying-accuracy-at-scale/); [Wumara — GNSS & total stations](https://www.wumaragroup.com.au/how-engineering-surveyors-use-gnss-and-total-stations-to-improve-build-accuracy/))
- **Total stations (robotic):** measure angles + distances via laser/prism; superior where satellites are blocked (under structures, pits, dense areas) and integrate with **machine control** for precision 3D earthworks. ([Global GPS Systems — total station vs GNSS](https://globalgpssystems.com/total-station/total-station-surveying-vs-gnss-surveying-understanding-the-differences/); [Metricop — total station vs GNSS](https://metricop.com/blogs/land-surveying/total-station-surveying-vs-gnss-surveying-which-is-better))
- **Integrated practice:** GNSS sets the site **control network**; total stations do the detailed setting-out and as-builts off those controls — both used together is standard. ([Global GPS Systems](https://globalgpssystems.com/total-station/total-station-surveying-vs-gnss-surveying-understanding-the-differences/))
- **Survey types:** cadastral (boundaries/title), topographic (terrain for grading/drainage), engineering/setting-out (translating design to ground), deformation monitoring (dams, slopes, structures), and **as-built** verification. Topographic data underpins grading, drainage and foundation design. ([ZenaDrone — topographic survey](https://www.zenadrone.com/topographic-survey-types-process-benefits/); [USDA — GPS standards for cadastral surveys](https://www.fs.usda.gov/database/gps/documents/GPS4CAD_Stds.pdf))
- **Modern stack:** add drone/UAV photogrammetry & LiDAR for volumes/stockpiles, GIS, and BIM-linked survey.

---

## 11. Digital delivery — BIM & ISO 19650 (the AI-native estate's data backbone)

**ISO 19650** is the international standard series for managing information across the asset lifecycle using BIM — the natural integration layer for an AI-native estate OS. ([BSI — ISO 19650](https://www.bsigroup.com/en-US/products-and-services/standards/iso-19650-building-information-modeling-bim/); [Wikipedia — ISO 19650](https://en.wikipedia.org/wiki/ISO_19650))

| Part | Scope |
|------|-------|
| **19650-1** | Concepts & principles |
| **19650-2** | Information management — **delivery (capital) phase** |
| **19650-3** | Information management — **operational (asset) phase** |
| **19650-4** | Information exchange processes & criteria |
| **19650-5** | **Security**-minded information management |

The pivot is the **Common Data Environment (CDE)** — a single source of truth where all stakeholders work from the most up-to-date, accurate data, reducing errors and disputes and enabling globally-agreed good practice. ([StreamBIM — ISO 19650 information management](https://streambim.com/bim-information-management-iso-19650/); [Thinkproject — ISO 19650 BIM](https://www.thinkproject.com/insights/blog/iso-19650-bim/)) For Borjie this maps directly onto the intelligence corpus + CDE-style document management already in the estate OS.

---

## 12. East-Africa professional & regulatory bodies (the licence-to-operate layer)

A world-class MD operating in Tanzania (launch) + Kenya/Uganda (expansion) must know **who registers whom** — work executed by an unregistered firm/person is unlawful and uninsurable.

### Tanzania (launch jurisdiction)
- **CRB — Contractors Registration Board** (Contractors Registration Act No. 17 of 1997, as amended): registers **building, civil, mechanical, electrical and specialist** contractors. Foreign contractors restricted to **Class One**; permanent vs temporary (incl. JV) registration. A firm **cannot be registered with all three boards simultaneously.** ([CRB Tanzania](https://www.crb.go.tz/); [CRB criteria booklet](https://www.crb.go.tz/download/allforms/CRBCRITERIABOOKLET.pdf); [Lexology — registration requirements TZ construction](https://www.lexology.com/library/detail.aspx?g=413d6288-7e1c-4133-9523-fd4c3490b5e2))
- **ERB — Engineers Registration Board:** registers engineers & engineering firms. ([ERB Tanzania](https://www.erb.go.tz/))
- **AQRB — Architects & Quantity Surveyors Registration Board:** registers architects & QSs. ([Mondaq — construction industry in Tanzania](https://www.mondaq.com/construction-planning/587506/construction-industry-in-tanzania))
- **NEMC — National Environmental Management Council:** EIA under EMA 2004 (see §9.3).

### Kenya (primary expansion market)
- **NCA — National Construction Authority** (NCA Act No. 41 of 2011): regulates the sector — **registers contractors in 8 classes (NCA 1 highest/unlimited → NCA 8 smallest)** across works categories (building; civil — water & roads; mechanical & electrical — specialist), **accredits skilled workers, and enforces standards**. **Foreign contractors register only at NCA 1; NCA 2–8 reserved for local contractors.** ([NCA — local contractors](https://www.nca.go.ke/local-contractors); [Construction Kenya — NCA categories](https://www.constructionkenya.com/2623/nca-kenya-registration-requirements/); [CAHF — NCA Act No. 41 of 2011](https://cahf.gitbook.io/kenya-legal-policy-and-institutional-review/annex-d-laws-governing-construction-and-maintenance/3.-national-construction-authority-act-no.-41-of-2011))
- **BORAQS — Board of Registration of Architects & Quantity Surveyors** (est. 1934, Cap 525): registers architects & QSs; sets the code of conduct. Parallel learned societies: **AAK (Architectural Association of Kenya, 1967)** and **IQSK (Institute of Quantity Surveyors of Kenya)**. ([BORAQS](https://boraqs.or.ke/); [BORAQS — code of conduct PDF](https://boraqs.or.ke/wp-content/uploads/2024/07/CODE-OF-CONDUCT-FOR-ARCHITECTS-AND-QUANTITY-SURVEYORS-OF-KENYA-02.07.24.pdf))
- **EBK — Engineers Board of Kenya** (Engineers Act 2011): registers engineers/engineering consultancies. *(Body identified from the BORAQS/built-environment ecosystem; specific EBK page UNVERIFIED in this pass.)*
- **NEMA — National Environment Management Authority:** EIA under EMCA 1999 (see §9.3).

> The **RICS** (Royal Institution of Chartered Surveyors) is the global gold-standard chartered body for QS/cost/building surveying and the source of the NRM measurement suite — chartered (MRICS/FRICS) status is the international benchmark above local registration.

---

## 13. What "world-class" means — the MD bar, distilled

A world-class autonomous construction MD:
1. **Gate-keeps ruthlessly** — never lets design, cost or procurement run ahead of the stage gate (RIBA 0–7 / AACE study classes).
2. **Prices from first principles** — builds unit rates and elemental cost plans (NRM1/NRM2), never accepts an unexplained lump.
3. **Chooses the contract to the risk** — matches FIDIC Red/Yellow/Silver or NEC4 A–F to who *should* carry each risk, and runs the **notice/claims clock (28/42-day FIDIC deadlines)** so entitlement is never time-barred.
4. **Runs the money machine** — IPC valuations, variations, retention, defects, final account, all reconciled and ledgered.
5. **Reads CPI/SPI together and contingencies from P-values** — forecasts EAC early; corrects course before drift compounds.
6. **Treats HSE as non-negotiable** — designs out risk (CDM hierarchy), and on the mine side holds TSF safety (GISTM, EoR/RTFE, consequence class) as the highest-consequence duty in the estate.
7. **Is licence-to-operate literate** — every firm/person registered (CRB/ERB/AQRB · NCA/BORAQS/EBK), every scheduled project EIA-licensed (NEMC/NEMA) before ground is broken.
8. **Is digitally native** — runs an ISO 19650 CDE as the single source of truth, feeding the AI estate brain.

---

## 14. Codebase mapping — which Borjie components should carry these capabilities

The construction discipline cross-cuts existing juniors; the key **gap is the absence of dedicated QS / structural / surveyor juniors**. Mapping (juniors live in `packages/ai-copilot/src/juniors/`):

| Capability cluster | Carrier (existing) | Recommended additions |
|--------------------|--------------------|------------------------|
| BOQ, rate build-up, cost planning (NRM1/2), IPC/variations/retention/final account | **`cost-engineer.ts`** (extend to full **QS junior**) | New `quantity-surveyor-agent.ts` if cost-engineer stays narrow to mining unit-cost |
| Procurement routes, tendering, contract selection | **`procurement-agent.ts`** | Add contract-form selector (FIDIC/NEC/JBC/NCA) logic |
| Schedule (CPM), EVM (CPI/SPI/EAC), schedule/cost Monte Carlo, contingency | **`risk-modeler.ts`** + **`forecast-modeler.ts`** + **`mine-planner.ts`** | EVM engine + Monte Carlo QSRA module |
| Structural/civil codes, limit-state checks, geotech, **tailings/GISTM/EoR** | **`mine-planner.ts`** (civil/TSF), **`maintenance-agent.ts`** (asset integrity) | New `structural-civil-agent.ts` (TSF surveillance + GISTM conformance) |
| HSE on site (CDM duties, RAMS, permits) | **`safety-agent.ts`** | CDM duty-holder + permit-to-work model |
| EIA/environmental & professional-body registration compliance | **`compliance-agent.ts`** + **`licence-agent.ts`** | NEMA/NEMC EIA + CRB/NCA/BORAQS registration checks |
| Surveying (control, setting-out, as-builts, volumes) | **`drill-hole-logger.ts`** / `geology-agent.ts` (spatial) | Survey/setting-out capability for civil works |
| Cost reporting, IPC/valuation artefacts, board-grade controls dashboards | **`report-writer.ts`** + `packages/strategic-reports/` advisors | Construction controls report templates (EVM S-curve, cost plan, cashflow) |
| Money events (IPC, variation, retention, final account) | **`services/payments-ledger/` `LedgerService.post()`** (HARD RULE — double-entry, never direct write) | — |
| BIM/CDE document backbone | intelligence corpus + `document-analysis` / CDE-style doc mgmt | ISO 19650 CDE alignment |
| Personas / advisors (owner cockpit, admin console) | `packages/ai-copilot/src/personas/`, `strategic-reports` personas | A "Built-Environment / Construction MD" advisor persona surfacing §13 bar |

**Highest-value gap to close:** a dedicated **QS junior** (cost planning + IPC/variation/final-account lifecycle through the ledger) and a **structural-civil/TSF junior** (GISTM conformance, EoR/RTFE accountability, consequence classification, observational-method monitoring) — these are the two construction capabilities most material to estate risk and money that no current junior fully owns.

---

## 15. Key standards & frameworks index (the canon)

- **RIBA Plan of Work 2020** — design stage gates (0–7).
- **RICS NRM1 / NRM2 / NRM3** — cost estimating, BOQ measurement, maintenance/WLCC.
- **FIDIC 2017 suite** — Red / Yellow / Silver (+ Green, Gold, Emerald, Pink); Clauses 3/20/21 (Engineer, claims 28/42-day, DAAB 84-day).
- **NEC4 ECC** — collaborative; Options A–F.
- **JBC / NCA standard forms** — East-Africa local contracts.
- **Eurocodes EN 1990–1999** (limit-state) + **ACI 318** (US concrete) + KS/TZS national codes.
- **GISTM (2020)** + **CDA / ANCOLD** dam-safety guidelines — tailings.
- **EVM (PMI), CPM, Monte Carlo QSRA** — project controls.
- **CDM 2015 (HSE), ISO 45001, ILO** — health & safety.
- **EMCA 1999 (NEMA, Kenya) / EMA 2004 (NEMC, Tanzania)** — EIA.
- **ISO 19650-1..5** — BIM / information management / CDE.
- **Registration:** CRB · ERB · AQRB (Tanzania); NCA · BORAQS · EBK · AAK · IQSK (Kenya); RICS (global chartered).

---

## Sources (all fetched/searched in this research pass)

1. https://www.riba.org/work/insights-and-resources/riba-plan-of-work/
2. https://www.designingbuildings.co.uk/wiki/RIBA_Plan_of_Work_2020
3. https://ds-a.co.uk/the-8-riba-stages-of-work/
4. https://www.ribaj.com/intelligence/updates-to-the-riba-plan-of-work-2019-dale-sinclair-gary-clark
5. https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/construction-standards/nrm
6. https://www.rics.org/content/dam/ricsglobal/documents/standards/nrm_1_order_of_cost_estimating_and_cost_planning_2nd_edition_rics.pdf
7. https://www.myqs.ai/blog/nrm1-explained-guide-uk-construction-2026
8. https://www.designingbuildings.co.uk/wiki/NRM2
9. https://rateqs.com/insights/nrm2-explained/
10. https://rateqs.com/insights/apc-quantification-nrm2/
11. https://www.designingbuildings.co.uk/wiki/Traditional_procurement_method
12. https://www.netsuite.com/portal/resource/articles/erp/types-of-construction-procurement.shtml
13. https://kisiel.co.uk/insights/procurement-methods-in-construction/
14. https://www.rics.org/content/dam/ricsglobal/documents/standards/Developing-a-construction-procurement-strategy.pdf
15. https://www.instituteccp.com/fidic-red-yellow-and-silver-books-a-brief-overview/
16. https://fidic.org/themes/new-fidic-contracts-2017-2nd-editions-red-yellow-and-silver-books
17. https://www.fenwickelliott.com/sites/default/files/scl_-_the_new_2017_fidic_red_yellow_and_silver_books_with_scl_logo-1.pdf
18. https://www.clydeco.com/en/insights/2017/12/fidic-2017-quick-reference-guide
19. https://gowlingwlg.com/en/insights-resources/articles/2024/a-guide-to-dispute-resolution-under-fidic
20. https://www.acerislaw.com/fidic-dispute-resolution-mechanism/
21. https://www.fenwickelliott.com/research-insight/annual-review/2018/new-dispute-resolution-mechanism
22. https://www.hka.com/article/daabs-dos-and-donts/
23. https://fidic.org/sites/default/files/24%20CLAUSE%2020,%20DISPUTE%20RESOLUTION.pdf
24. https://www.neccontract.com/products/contracts/nec4/engineering-and-construction-contract/ecc
25. https://gmhplanning.co.uk/nec-downloads/nec4-ecc-option-c-and-option-d/
26. https://www.designingbuildings.co.uk/wiki/Interim_certificates_in_construction_contracts
27. https://arrow.tudublin.ie/cgi/viewcontent.cgi?article=1078&context=beschreoth
28. https://single-market-economy.ec.europa.eu/sectors/construction/eurocodes_en
29. https://steelconstruction.info/Design_codes_and_standards
30. https://en.wikipedia.org/wiki/Eurocode_2:_Design_of_concrete_structures
31. https://en.wikipedia.org/wiki/Eurocode:_Basis_of_structural_design
32. https://eurocodes.jrc.ec.europa.eu/sites/default/files/2021-12/handbook1.pdf
33. https://standards.iteh.ai/catalog/standards/cen/6aad58da-1470-467f-9f37-4657dcf5d4af/en-1990-2023
34. https://globaltailingsreview.org/global-industry-standard/
35. https://www.icmm.com/en-gb/news/2020/new-global-industry-standard-on-tailings-management
36. https://www.wsp.com/en-us/insights/embracing-the-global-industry-standard-on-tailings-management
37. https://www.barr.com/insights/navigating-the-expanding-landscape-of-mine-tailings-standards/
38. https://www.pmi.org/learning/library/integrating-scheduling-evm-metrics-8516
39. https://www.deltek.com/en/project-and-portfolio-management/earned-value-management/cost-performance-index
40. https://www.celoxis.com/article/earned-value-management-projects
41. https://www.4pmti.com/learn/cost-performance-index-cpi-vs-schedule-performance-index-spi/
42. https://pmc.ncbi.nlm.nih.gov/articles/PMC12222939/
43. https://iqrm.net/blog/schedule-risk-analysis-complete-guide
44. https://iqrm.net/blog/monte-carlo-simulation-project-risk-management
45. https://www.hse.gov.uk/construction/cdm/2015/index.htm
46. https://www.hse.gov.uk/construction/cdm/2015/summary.htm
47. https://www.hse.gov.uk/construction/cdm/2015/principal-designers.htm
48. https://www.procore.com/en-gb/library/cdm-2015-explained
49. https://nema.go.ke/services/environment-impact-assessment-eia/
50. https://www.nemc.or.tz/uploads/publications/sw-1576238321-EIA%20Training%20Manual%20Version%204.pdf
51. https://www.cseindia.org/cse-and-nemc-release-environmental-impact-assessment-eia-guidelines-for-tanzania-s-building-construction-sector-11907
52. https://castlesurveys.co.uk/understanding-gnss-in-topographic-surveying-accuracy-at-scale/
53. https://www.wumaragroup.com.au/how-engineering-surveyors-use-gnss-and-total-stations-to-improve-build-accuracy/
54. https://globalgpssystems.com/total-station/total-station-surveying-vs-gnss-surveying-understanding-the-differences/
55. https://metricop.com/blogs/land-surveying/total-station-surveying-vs-gnss-surveying-which-is-better
56. https://www.zenadrone.com/topographic-survey-types-process-benefits/
57. https://www.fs.usda.gov/database/gps/documents/GPS4CAD_Stds.pdf
58. https://www.bsigroup.com/en-US/products-and-services/standards/iso-19650-building-information-modeling-bim/
59. https://en.wikipedia.org/wiki/ISO_19650
60. https://streambim.com/bim-information-management-iso-19650/
61. https://www.thinkproject.com/insights/blog/iso-19650-bim/
62. https://www.crb.go.tz/
63. https://www.crb.go.tz/download/allforms/CRBCRITERIABOOKLET.pdf
64. https://www.erb.go.tz/
65. https://www.mondaq.com/construction-planning/587506/construction-industry-in-tanzania
66. https://www.lexology.com/library/detail.aspx?g=413d6288-7e1c-4133-9523-fd4c3490b5e2
67. https://www.nca.go.ke/local-contractors
68. https://www.constructionkenya.com/2623/nca-kenya-registration-requirements/
69. https://cahf.gitbook.io/kenya-legal-policy-and-institutional-review/annex-d-laws-governing-construction-and-maintenance/3.-national-construction-authority-act-no.-41-of-2011
70. https://boraqs.or.ke/
71. https://boraqs.or.ke/wp-content/uploads/2024/07/CODE-OF-CONDUCT-FOR-ARCHITECTS-AND-QUANTITY-SURVEYORS-OF-KENYA-02.07.24.pdf
