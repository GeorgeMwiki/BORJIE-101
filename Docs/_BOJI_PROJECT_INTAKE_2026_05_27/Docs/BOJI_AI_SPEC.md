# Boji AI — Mining Company Brain

**An AI-native strategic operating system for building, running, and scaling mining businesses.**

Tanzania-first. Built for the world. Designed for solo PML holders → multi-site, multi-mineral portfolios → growing fleets of excavators, dumpers, crushers, trucks, processing yards, and trading desks.

---

> **Single-sentence product:**  Boji AI is a central mining intelligence — a Master Brain that reads every document, talks to the owner, asks the right questions, spawns specialist Junior Agents that go to workers, supervisors, geologists, document officers, drivers, buyers, regulators — and synthesises one living, strategic, accountable view of the entire mining business: from licence application → vein discovery → mechanisation decision → ore on the weighbridge → cash on the bank statement.

> **One-line analogy:**  What BossNyumba is to property, Boji is to mining.

---

## 0 · Document control

| Field | Value |
|---|---|
| Title | Boji AI — Mining Company Brain — Master Specification |
| Version | **v0.2 (research-enriched draft)** |
| Authored | 2026-05-17 |
| Status | Draft for internal review |
| Owner | George Mwikila |
| Repo target | `github.com/GeorgeMwiki/BOJI-AI` *(to be created)* |
| Spec lineage | BossNyumba central-command pattern (13-step BrainKernel + Junior Factory + Consolidation Worker + Weekly Prompt Compiler), ported to mining domain |
| Primary research base | IIED 16641 — Mutagwaba et al. (2018) *Artisanal and small-scale mining in Tanzania — Evidence to inform an 'action dialogue'* (full 100-page read) |
| Secondary research base | Six parallel deep-research agents — see **Appendix E** for full citations across: (1) Tanzanian mining regulation 2025/2026 (Mining Act, GN 198/2025 FX rules, GN 260/2025 PML Technical Support, GN 563/2025 Local Content reserved-list, BoT Domestic Gold Purchase Programme, CSR 2023 + March 2026 High Court ruling, dormancy/auto-revocation pipeline); (2) Mine-to-Market + Short-Interval-Control state-of-art (McKinsey, ABB OMS, Deswik IOM, GroundHog SIC, MICROMINE Pitram, Hexagon MineOperate, Cat MineStar, Modular DISPATCH, Wenco, RPM XECUTE); (3) FX/Treasury/Unit-Economics for sub-USD-10m miners (BoT FX 27-Mar-2026 cliff, LBMA gold doré premium economics, NSR + break-even-grade math, off-take vs streaming, stockpile-as-USD-hedge logic, ring-fenced loss relief s.114, CBR 5.75% + 91% mining credit growth, CRDB-Mining-Commission MoU Feb 2026); (4) EPP / community / geology / lab supply chain (NEMC EPP cycle, Land + Village Land Acts 1999, Compensation Regulations 2001, CSR 14d/7d/30d timing, vein-triangulation formula, JORC/NI43-101/SAMREC, SGS/Bureau Veritas/ALS/Intertek/GST/AMGC labs, QA/QC 5-10% insertion, QField/Sentinel-2/DJI); (5) AI mining platform landscape (Codelco × Microsoft Mar 2025, BHP / Rio Project Sage / Vale / Anglo / Newmont / Freeport-Bagdad-fully-autonomous-Oct-2025 / Glencore, KoBold $537m Jan 2025, Earth AI / GoldSpot / IntelliSense.io / Petra Data Science / MineSense / Strayos, Levin Sources Delve / Minexx / ITSCI, Anthropic Claude Agent SDK / OpenAI Agents SDK / LangGraph supervisor / Microsoft Magentic-One, Smile ID NIDA, Aya Expanse 32B + Llama 3.2 + Whisper Swahili stack); (6) BossNyumba codebase pattern verification (BrainKernel 13-step pipeline, JuniorAIFactory lifecycle, TaskAgent contract, 9-stage Consolidation Worker, Temporal Entity Graph, Counter-Model Hoist Phase-C-1) |

### v0.3 changelog (2026-05-17 — later same day)
* **CORRECTED surface architecture.** Boji has exactly **four surfaces — two web + two mobile — and NO customer/tenant app**. Spec §15 now contains the authoritative surface map. The customer-facing analogue from BossNyumba is intentionally dropped: Boji's universe is `Owner | Admin | Worker | Boji-Internal`, full stop.
* **NEW: §16 Always-Learning Brain.** A dedicated, deep section on how Boji evolves — short-term in-conversation learning, nightly Consolidation Worker, weekly Prompt Compiler, monthly Domain-Knowledge Refresh, quarterly Frontier-Capability Review — plus the Forecasting Engine (per-asset, per-site, per-portfolio, per-FX, per-price) and the Drift / Calibration regime that keeps the brain honest. Boji is **never hard-coded; it is always updating itself**.
* **NEW: §17 Owner-Insights catalogue + §18 Worker-app design** explicitly distinguished from BossNyumba's persona model.
* **NEW: Docs corpus protocol.** `Docs/primary_sources/` and `Docs/research/` are now first-class runtime artefacts — every founder brief and every research dossier is ingested at first-boot and every Master recommendation must cite from this corpus.

### v0.2 changelog
* **NEW:** Six parallel deep-research agents completed; spec is now backed by 200+ live URL citations consolidated in Appendix E.
* **CRITICAL forcing function added:** **27 March 2026 USD-contract cliff** — all USD-denominated domestic Tanzanian contracts become void unless renegotiated into TZS (Foreign Currency Usage Regulations 2025 / GN 198 of 2025, eff. 28 March 2025). This single date drives the MVP 1 priority order: a Contract-Currency Auditor must ship before any other treasury feature, because the entire SME mining base in Tanzania is at risk on that date.
* **CRITICAL automation event added:** Tanzania's Mining Commission has publicly announced **automated dormancy revocation** following the 15 April 2025 round (40 PLs cancelled, 188,000+ ha returned). Boji's "Dormancy Risk Score" is therefore both a retention feature and a survival feature.
* **CRITICAL gold-window economics added:** BoT Domestic Gold Purchase Programme (eff. 1 July 2024) — **4% royalty, 0% inspection, 0% VAT** vs the 6%+1% base — with a **20% mandatory domestic set-aside** as a precondition for export-permit issuance and **24-hour TZS settlement**. This is the single biggest unit-economics lever for every ASGM holder in Tanzania.

### v0.3 changelog (founder directives — 2026-05-17 session)
* **App-surface architecture corrected** to exactly **four surfaces** (no customer app): Owner/Admin mobile, Worker mobile, Owner/Admin web, Boji internal-platform web. See new §14a.
* **Always-Learning Brain** principle promoted to its own first-class section §16a — Boji is never hard-coded; every interaction makes it better.
* **Minerals intelligence corpus** added at `Docs/research/minerals/` — 9 files, ~ 450,000 words, ~ 600 live URL citations covering every commercially mined mineral (Au, Ag, PGMs, Cu, Pb, Zn, Ni, Sn, Al, Fe, Mn, Li, Co, graphite, V, REE, W, U, Th, coal, He, all gemstones, all industrial minerals, Ta-Nb / Sb / Bi / Te / Ga / Ge / In / Se / Be / Hf / Sc / Y / Cr / Mo / Ti / Zr / Hg, aggregates, HMS). Boji is now full-mining-expert on every mineral by design, not by ad-hoc lookup.
* **Primary-source preservation** at `Docs/primary_sources/` — the founder's three verbatim briefs are now canonical documents that ship with Boji and ground every agent.
* **Spec lineage tightened:** Boji clones the BossNyumba `BrainKernel` (13-step pipeline) + `JuniorAIFactory` lifecycle + `ConsolidationWorker` (9-stage nightly + weekly GEPA prompt compiler) + `TemporalEntityGraph` (bi-temporal). Code-level fidelity intended — see Appendix I.

---

## 1 · Why this exists

### 1.1 The owner-side problem (re-framed from BossNyumba lessons)

Mining business owners — from a single PML holder in Chunya to a multi-site investor running gold, gemstone, salt, and gypsum operations across Geita / Tanga / Manyara / Kilimanjaro — face the **same five compounding problems every day**:

1. **They are document-blocked.**  More than 90% of PML owners do not have an EPP filed within four months of licence award even though the Mining (Environmental Protection for Small-Scale Mining) Regulations 2010 demand it (IIED 16641, p. 73). Renewal windows are missed. Authority letters go un-signed. Village minutes are kept in notebooks that get lost. Tax clearance expires the day before a buyer pays.

2. **They are geology-uncertain.**  52% of small-scale miners say lack of geological information is their *most critical* constraint; another 27% say *critical* (IIED 16641, p. 70). Miners abandon licensed land because they cannot afford trenching, sampling, or assay. They mechanise too early (paying for an excavator before the vein is confirmed) or too late (sticking with hand tools when the vein is already proven).

3. **They are cash-fragile and FX-exposed.**  Mineral prices are USD-denominated globally (LBMA twice-daily gold fix, LME copper cash official, tanzanite Geneva auctions). But under the **Foreign Currency Usage Regulations 2025 (GN 198 of 2025, gazetted 28 March 2025)** — operationalising the Finance Act 2024 amendment to the BoT Act — **every domestic transaction inside Tanzania must be priced, invoiced, and paid in TZS, and every legacy USD-denominated contract becomes void on 27 March 2026** unless re-papered. Penalties scale to **TZS 4m or 14 years imprisonment**. A 4% TZS depreciation between sale and payment is a 4% margin loss; a 4% appreciation while ore is stockpiled is a 4% windfall lost. SME miners have no treasury function, no hedging instruments at sub-USD-10m scale, and often no idea that stockpile timing is a currency decision. The BoT Domestic Gold Purchase Programme (eff. 1 July 2024, ~5,022 kg / USD 554m purchased by mid-2025) settles in **TZS within 24 hours** at **4% royalty / 0% inspection / 0% VAT** — materially better than the 30–45-day off-taker route — but only if the holder also meets the 20% mandatory domestic set-aside as a condition of export.

4. **They are people-coordination-blind.**  PML holders sub-lease to pit-holders, who hire informal teams; supervisors track attendance on paper; an idle excavator costs more than 12 workers combined; reassignment between sites is rare because there is no portfolio view (IIED 16641, p. 68 — "Licensed miners using informal operators").

5. **They have no strategic chief-of-staff.**  No mining consultant comes free. Nobody in Geita or Mererani charges TZS 20,000/month to tell a PML owner "Site A deserves the excavator this week; pause Site B until renewal evidence is uploaded; reassign 6 workers from Site C to sorting at Site A; if Buyer X pays Friday your runway extends from 11 days to 18." That is the gap.

### 1.2 The technology shift that makes Boji possible *now*

* **Multi-agent LLMs with tool use** can act as cheap specialists: a "Document Agent" that reads PMLs, extracts coordinates, files reminders; a "Mine Planner Agent" that converts a Sentinel-2 site image into a sectioned plan; a "Cost Engineer Agent" that builds break-even-grade per site from supervisor pings.
* **Smartphone penetration in TZ mining belts** is now ≥ 80% even at pit level. Voice and photo capture in Swahili work in low-bandwidth conditions.
* **Cheap satellite imagery** (Sentinel-2 free, Planet at SME prices) gives every PML a baseline geospatial layer.
* **Mobile biometric authorisation** (Android BiometricPrompt, iOS LocalAuthentication, Smile Identity, NIDA) makes auto-generated, fingerprint-signed letters legally credible under TZ Electronic Transactions Act 2015 — exactly what the user snippet's "Village government representatives use their fingerprint on smartphones to authorise…" flow needs.
* **Frontier knowledge graphs + vector retrieval** can finally hold an entire mining business — owner, companies, licences, sites, employees, assets, documents, costs, production, sales, risks, decisions — as one queryable model.

The big global mining houses are doing all of this at LSM scale (Codelco × Microsoft 2025, BCG AI-Powered Mining 2026, Rio Tinto, BHP, Vale, Newmont). Nobody is doing it for the **2 million Tanzanian ASM/SSM operators and the much bigger SME population across Africa, Latin America, and Asia.** That is Boji's open market.

### 1.3 What Boji is *not*

* Not a mining ERP. ERPs record. Boji *advises and executes*.
* Not an exploration / geological-modelling tool like Leapfrog / Vulcan / Datamine. Boji *consumes* that data and reasons about it.
* Not a fleet management system like Caterpillar MineStar. Boji *integrates* low-cost GPS / supervisor pings into a strategic loop.
* Not a traceability ledger like ITSCI / Minexx. Boji *uses* traceability data for audit but its product is operator decision-making.
* Not a compliance-only tool like Levin Sources' Delve. Boji *binds compliance to strategy* — the renewal deadline isn't a checkbox, it's a cash-flow trigger.

---

## 2 · The IIED-grounded user reality

This section restates field truth from IIED 16641 (Mutagwaba et al., 2018), because every Boji feature must answer one of the priority issues the IIED dialogue surfaced.

### 2.1 Who the user is

| User segment | Description | IIED reference |
|---|---|---|
| Owner / PML holder | Registered mineral-rights owner; legally responsible for hiring, paying, safety, environment | p. 27 Box 1 |
| Pit holder | Informally leased mining area from PML owner; bears most risk; organises labour | p. 27 Box 1 |
| Pit financier | Provides cash for tools, food, fuel, wages; often owns processing equipment | p. 27 Box 1 |
| Mine workers | Underground / surface; usually paid via production-share or daily | p. 67 |
| Service providers | Brokers, processors, transporters, drivers, cooks, mechanics | p. 27 Box 1 |
| Buyers (local brokers → big brokers → dealers → exporters) | Tiered gold and gem trade — Geita / Katoro / Mwanza / DSM | p. 26 Figure 3 |
| Women miners | 27% of TZ ASM workforce; often in processing, food, transport, ancillary roles; under-represented in pit ownership | p. 43, p. 74 |
| Cooperatives / SACCOS | Mining SACCOS (Hekima Mwanza, Rwamgasa Umoja, Geita Women's) — improving capital access via group structure | p. 53, p. 80 |

### 2.2 What they all need but cannot afford

* PML application + renewal pack assembly
* EPP filing in Swahili with photo evidence
* Village government CSR-minute + landowner-loyalty letters (with fingerprint authorisations)
* Road negotiation with crossed landowners
* Geological determination — local-method recording → bore-hole logging → lab assay → bankable report
* Site planning, sectioning, geofencing
* Daily shift reports → SIC deviation analysis
* Excavation–haulage–QC–on-loading coordination
* Buyer routing, weighbridge documentation, payment letters
* FX-aware sell-or-stockpile decisions
* Burn-rate, cost-per-metre, cost-per-gram tracking
* Equipment rent-vs-buy, maintenance scheduling
* Investor-bankable reports
* Compliance audit pack

### 2.3 What IIED's priority-issues list maps to in Boji

| IIED finding (IIED 16641 §6) | Boji response |
|---|---|
| Licensed miners using informal operators (p. 68) | First-class pit-holder / financier / labour cooperative as legal entities in domain model; production-share contract templates with fingerprint authorisations; transparent royalty/share flow |
| Lack of awareness and enforcement of the law (p. 69) | "Compliance copilot" that explains every rule in Swahili the moment a decision is being made (e.g., warn when mining within 60 m of a water source) |
| Weak institutions, lack of coordination (p. 69) | Single owner-facing layer that reconciles MM, NEMC, TRA, GST, district, village data so the owner sees one truth even when government is fragmented |
| Lack of local-government involvement (p. 69) | Village & district modules with their own logins, fingerprint authorisations, and dashboards — they participate in the platform, not around it |
| High cost of acquiring PMLs (p. 70) | Cost forecaster shows total true cost (application + processing + annual rent + EPP consultant + village CSR + meals + transport) so owner is not surprised |
| Limited areas / overlapping licences (p. 70, p. 75) | Cadastre-aware geofencing; pre-application overlap check against the public Tume ya Madini cadastre |
| Lack of geological information (p. 70) | Bore-hole logger + lab-assay workflow + multi-shaft volume estimator + geological-confidence score that drives every spend decision |
| Lack of technological tools (p. 70) | Mobile-first capture: photos, GPS, voice, fingerprints; the smartphone *is* the SCADA, the FMS, the shift log |
| Insufficient mining experts for extension services (p. 71) | "Marketplace of experts" — certified geologists, NEMC-registered EIA experts, surveyors, blasting competents, accountants, mining lawyers; AI auto-matches to need |
| Environmental problems — dust, water, abandoned pits (p. 71) | EPP-as-living-document; rehabilitation reserve auto-accrual against production; pit-refill task auto-created at end of phase |
| Destruction of roads by heavy trucks (p. 72) | Road-impact agreement template; auto-share of village road-maintenance levy proportional to truck-km |
| Mercury / cyanide use (p. 72) | Minamata-aware advisor: explains retort, banded washing, mercury-free alternatives (Mintek Igoli), tracks reduction over time |
| Poor mine-closure planning (p. 73) | Mine-closure plan compiled in parallel with EPP from day one; rehab-bond simulation |
| Lack of PPE / lax enforcement (p. 73) | PPE inventory; toolbox-talk daily prompt; incident log; OSHA-aligned critical-control register (ICMM CCM-style) |
| Cultural barriers for women (p. 74) | Women-led cooperative onboarding; women-only training tracks; gender-disaggregated dashboards |
| Limited access to credit (p. 75) | Investor-bankable site reports auto-generated from production + geology + costs; loan-application packs; TIB / NMB / NBC / SACCOS integrations |
| Poor market access (p. 76) | Live mineral price feed; multi-buyer routing; auction-style sale support; mineral-trading-centre integration |
| Tax burden (p. 76) | Tax engine — royalty, inspection, clearance, local-government bye-law fees auto-computed; advance reservation against sale |
| No guide price (p. 77) | AI guide-price recommender from comparable recent sales + LBMA + Geneva auction + local broker spread |
| Voiceless ASM / weak associations (p. 77) | External-stakeholder window — locals see external partners, externals see local performance, ratings on both sides |

### 2.4 The recurring meta-finding

> The IIED report concludes (p. 87–88) that the single most valuable intervention is **a one-stop information centre that holds licensing, technological, financial, health, market, and price information accessible to ASM operators.** That sentence, written by Tanzanian researchers in 2018, is Boji AI's mandate in 2026 — but now with a Master Brain on top of it.

---

## 3 · The product primitive: the Living Mining Business Map

Boji is built around one persistent artefact per tenant: the **Living Mining Business Map (LMBM)** — a knowledge graph + vector store + time-series ledger that the Master Brain reads, writes, and reasons over.

### 3.1 LMBM layers

```
┌───────────────────────────────────────────────────────────────────────────┐
│                       LIVING MINING BUSINESS MAP                          │
├───────────────────────────────────────────────────────────────────────────┤
│  Strategy layer    ▸ next actions, capital allocation, expansion paths    │
│  Risk layer        ▸ licence / cash / geology / safety / community / FX   │
│  Production layer  ▸ metres advanced, BCM moved, ROM tonnes, grade, recovery │
│  Sales layer       ▸ ore parcels, stockpiles, buyers, payments, NSR        │
│  Treasury layer    ▸ cash, AR, AP, FX exposure, runway, off-take pre-fin   │
│  Cost layer        ▸ wages, fuel, food, rent, rehab accrual, royalty       │
│  Inventory layer   ▸ fuel, food, water, PPE, parts, sample bags, explosives* │
│  Asset layer       ▸ excavators, compressors, generators, pumps, trucks    │
│  People layer      ▸ owner, managers, supervisors, miners, contractors     │
│  Document layer    ▸ PML PDFs, EPP, receipts, contracts, minutes, photos   │
│  Geology layer     ▸ bore-holes, samples, assays, vein model, confidence   │
│  Site layer        ▸ start area, camp, stockpile, dump, QC, road, sections │
│  Licence layer     ▸ PL/PML/ML/SML/dealer/broker — terms, deadlines, fees  │
│  Company layer     ▸ companies, directors, shareholders, bank, tax, KYC    │
│  Owner layer       ▸ goals, risk appetite, capital, minerals, horizon      │
└───────────────────────────────────────────────────────────────────────────┘
                  * explosives only as lawful compliance metadata
```

Each layer has typed entities, relationships across layers, full time-series history, and provenance (who said it, when, with what evidence). Every claim in the map is **fact / claim / assumption / forecast / external-rule / recommendation** — the AI never blurs these.

### 3.2 The graph in queries

The point of the LMBM is that any owner-level question is a graph traversal:

* *"Which costs are connected to PL-001?"* → cost edges grouped by licence
* *"Which sites depend on John?"* → people→assignment→site path
* *"Which documents are blocking production at Site B?"* → site→blocker→document
* *"Which assets are idle but costing money?"* → asset.utilization < threshold AND asset.daily_cost > 0
* *"Which buyer payments are tied to which stockpile?"* → stockpile→parcel→sale→payment

The Master Brain composes these traversals automatically.

---

## 4 · The multi-agent architecture (BossNyumba-pattern, mining-tuned)

### 4.0 BossNyumba pattern, verified

The BossNyumba codebase (mapped by a parallel agent — see Appendix E.6) implements this pattern as a **13-step deterministic BrainKernel pipeline** invoked once per user turn:

1. Identity & scope (tenant / user / persona)
2. Killswitch gate (env-driven HALT / DEGRADED)
3. Memory recall (semantic graph + episodic store)
4. Cohort signals (tenant-wide aggregated context)
5. Self-awareness (drift, confidence)
6. Theory of mind (user state, intent)
7. Tool spec resolution (per-persona tool surface)
8. Agent loop (think → tool calls → reflect → stop)
9. Decision trace (200-trace cap per tenant)
10. Confidence gate (low → invoke Opus advisor mid-turn)
11. Governance & review (autonomy policy, four-eye approval for sensitive actions)
12. Provenance write (semantic memory + confidence)
13. Response synthesis

Plus three permanent background processes:
* **Junior Factory** (`packages/ai-copilot/src/junior-ai-factory/service.ts`) — `provision → adjustScope → recordAction → suspend → revoke` lifecycle, with `policySubset ⊆ tenant AutonomyPolicy` validation and daily-action caps.
* **Consolidation Worker** (`services/consolidation-worker/`) — nightly 9-stage pipeline: ingest → cluster → reflect (Haiku constitutional critique) → promote → decay → consolidate → re-embed → publish → **weekly prompt-compile** (Sundays, 5-iteration GEPA loop with Claude mutator + Haiku evaluator, Pareto-gated promotion).
* **Counter-Model Hoist (Phase C-1)** — optional Haiku challenger plugged at kernel composition, fires on sensitive/low-confidence actions; the production wiring landed in BossNyumba commit `18c3f908`.

**Persistent state lives in a bi-temporal Temporal Entity Graph** (`temporal_entities`, `temporal_relationships`, `temporal_communities`) with valid-from/valid-to + recorded-at + invalidated-at columns — every fact is auditable through history. Multi-tenant boundary is enforced at every layer via `req.scope.tenantId` + Postgres RLS + per-tenant KMS keys.

**Boji adopts this kernel verbatim**, with mining-specific juniors replacing property-specific juniors. Naming convention preserved: `BrainKernel`, `JuniorAIRecord`, `TaskAgent`, `AutonomyPolicy`, `kernel_cot_reservoir`, `temporal_entities`. Code-level fidelity matters because it lets the BossNyumba team's hard-won learnings about token budgeting, decision-trace size, and weekly-prompt-compile cadence transfer directly.

### 4.1 Pattern overview

```
                          OWNER (chat, voice, dashboard)
                                     │
                                     ▼
              ┌───────────────── MASTER BRAIN ─────────────────┐
              │  Mining CEO mode • Strategy mode •  Build mode │
              │  Operations mode • Finance mode • Risk mode    │
              │  Document mode • Board/Investor mode           │
              └────────┬───────────────────────────┬───────────┘
                       │ spawns junior agents      │ synthesises results
                       ▼                           ▲
       ┌─────────────────────────────────────────────────────────┐
       │              JUNIOR EXPERT AGENT POOL                   │
       │                                                         │
       │   Document       Licence/PL     Mine Planner            │
       │   EPP            Village CSR    Road Negotiation        │
       │   Geology        Lab/Assay      Drill-hole Logger       │
       │   Operations     Shift / SIC    HR / Workforce          │
       │   Procurement    Asset/Fleet    Maintenance             │
       │   Cost Engineer  FX/Treasury    Sales / Off-take        │
       │   Safety / EHS   Community      Auditor / Evidence      │
       │   Report Writer  Compliance     External-Stakeholder    │
       └────────┬────────────────────────────────────────────────┘
                │ each junior calls into the worker-side UI / data
                ▼
   ┌────────────────────────────────────────────────────────────┐
   │  WORKER / SUPERVISOR / GEOLOGIST / DRIVER / OFFICER LAYER  │
   │  smartphone forms • voice notes • photos • fingerprints    │
   │  • GPS pings • weighbridge images • daily reports          │
   └────────────────────────────────────────────────────────────┘
                ▲
                │ all data flows back into the LMBM, audited
                ▼
        ┌─────────────────────────────────────────┐
        │      LIVING MINING BUSINESS MAP         │
        │  Postgres + PostGIS + pgvector + S3     │
        │  + time-series (Timescale) + audit log  │
        └─────────────────────────────────────────┘
```

### 4.2 Master Brain

**Single, conversational, owner-facing.** Backed by Claude (frontier reasoning) for strategy; can fall back to Haiku-class for cheap loops. Holds a persistent system prompt that includes the LMBM summary, the owner profile, the current operating mode, and a short list of unresolved decisions.

Modes:

| Mode | Purpose | Default temperature | Tool access |
|---|---|---|---|
| Build | Onboarding, structuring company / sites / people | low | Company / Licence / People / Document tools |
| Strategy | Portfolio ranking, capital allocation, mechanisation | low | all read tools + simulator + forecaster |
| Operations | Daily plan / SIC / blockers | low | Shift / SIC / HR / Asset / Inventory tools |
| Document | Filing, refiling, renewals, packs | very low | Document / Licence / Compliance tools |
| Finance | Burn-rate, cash, FX, runway | very low | Cost / Treasury / Sales tools |
| Risk | Licence / safety / community / FX scan | low | every audit tool |
| Board / Investor | Clean external narrative | low (and longer context) | Report Writer + read tools |

### 4.3 Junior expert agents

Each is a typed contract: `JuniorAgent { id, mandate, inputs, tools, evidence_required, output_schema, confidence_required }`. Juniors:

* are **stateless per task** (state lives in LMBM)
* run **as tool-calls from the Master**, not as parallel chatbots
* must **declare evidence and confidence** before returning
* can **schedule themselves** (e.g. Document Agent schedules a renewal reminder)
* can **call other juniors** (e.g. Geology Agent calls Lab/Assay Agent)
* can **call the worker layer** by creating tasks with required-evidence fields

Catalogue:

| Agent | Mandate | Key tools | Talks to (worker side) |
|---|---|---|---|
| **Document Agent** | OCR, classify, extract, file, generate refiling pack, chat-with-doc | Mistral OCR, pgvector, template engine, fingerprint API | Document Officer |
| **Licence / PL Agent** | Track PL/PML/ML/SML/dealer/broker lifecycle; calendar; cadastre overlap check; renewal pack | Cadastre API (manual fallback), payment-ref tracker | Owner, Document Officer |
| **EPP Agent** | Compose EPP from photos + answers; route to NEMC officer; track approval | EPP template engine, NEMC officer marketplace, fingerprint API | Site Manager, NEMC officer |
| **Village CSR Agent** | Schedule village meeting; capture minutes; record CSR commitments + landowner loyalty; emit fingerprint-signed letter | Meeting scheduler, fingerprint API, letter template | Village chair, owner, landowner |
| **Road Negotiation Agent** | Identify crossed landowners; per-acre/per-tree compensation register; produce district approval letters | GIS clip tool, compensation calculator, letter template | Owner, landowners, district |
| **Geology Agent** | Build geological-confidence score from local + professional methods; advise on next investigation step | Confidence model, mineral-specific playbooks | Local prospector, geologist |
| **Drill-hole Logger Agent** | Structured capture of pit/shaft/RC/diamond holes; multi-hole vein triangulation; volume estimate | Volume calculator, JORC-lite template | Supervisor, geologist |
| **Lab / Assay Agent** | Sample-tag chain-of-custody, lab order, QA/QC duplicate/standard/blank protocol, result ingestion | Lab marketplace, QA/QC checker | Geologist, lab partner |
| **Mine Planner Agent** | Sectionise site (start area, camp, stockpile, dump, QC, road); expansion simulation; FMS-lite plan | Sentinel-2 fetch, sectioniser, simulator | Site Manager |
| **Operations / SIC Agent** | Build shift plan; hourly supervisor pings; end-of-shift reconciliation; deviation explanation | SIC engine, deviation codes | Supervisor |
| **HR Agent** | Roles, assignments, attendance, advances, productivity by phase, idle-time detection | Attendance log, payroll, advance ledger | Supervisor, HR officer |
| **Procurement Agent** | Inventory, reorder, supplier timing, delay risk vs site need date | Supplier marketplace, reorder engine | Stores keeper |
| **Asset / Fleet Agent** | Excavator/compressor/generator/pump/truck registry; rent vs buy; match factor; utilisation | Fleet ledger, rent-vs-buy model | Operator |
| **Maintenance Agent** | Hour-based service schedule; vibration / oil flags; downtime codes | Maintenance engine | Mechanic, operator |
| **Cost Engineer Agent** | Per-site, per-phase, per-tonne unit economics; break-even grade; idle-cost detection | Unit-economics engine | Finance officer |
| **FX / Treasury Agent** | Cash runway, AR/AP, FX exposure, sell-or-stockpile recommendation | LBMA + BoT rate feed, runway model | Owner |
| **Sales / Off-take Agent** | Buyer routing, weighbridge image, batch sale letter, payment trace, NSR calc | Buyer marketplace, NSR engine | Owner, buyer, officer |
| **Safety / EHS Agent** | Critical-control register (ICMM CCM), toolbox talks, incident log, PPE, water/dust/noise | Safety engine | Supervisor, OSHA officer |
| **Community Agent** | Village complaints, CSR delivery, grievance log, land-use plan alignment | Grievance ledger | Village chair, community liaison |
| **Auditor / Evidence Agent** | For every recommendation, verifies the evidence chain; flags assumptions vs facts | Provenance graph walker | (internal) |
| **Compliance Agent** | Cross-checks every action against TZ Mining Act, EMA, Land Act, BoT FX rules | Rule engine, citation library | (internal) |
| **External-Stakeholder Window Agent** | Surfaces local performance to externals, partner opportunities both ways, ratings | Marketplace engine | All sides |
| **Report Writer Agent** | Daily Owner Brief, Weekly Strategy Memo, Monthly Mining Report, Investor / Bank pack | Long-context templater | Owner, banks, investors |

### 4.4 Worked example of orchestration

> **Owner:** *"Niletee excavator Site B kesho?"* (Should I bring an excavator to Site B tomorrow?)

Master Brain receives, classifies intent as `MECHANISATION_DECISION`, fans out:

1. **Licence Agent** → Is Site B's PL active? Are obligations current? `OK: PML-2024-0381, active, renewal in 7 months`.
2. **Geology Agent** → What's the confidence score at Site B? `MEDIUM (0.62): 3 hand-shafts, 1 channel sample, no assay yet`.
3. **Operations Agent** → What phase is Site B in? `EXPANSION_OF_VEIN_SEARCH`.
4. **Cost Engineer Agent** → Manual vs excavator economics for this phase? `Manual = TZS 380k/day for 14 workers; excavator rental = TZS 1.2m/day all-in; break-even = 5.8 days; faster reach to confirmation by ~3 days.`
5. **Asset Agent** → Is an excavator available? `Yes — owned CAT 320 currently idle at Site A.`
6. **HR Agent** → Workers available at Site B? `12 workers assigned, 4 idle.`
7. **Safety Agent** → Access / slope / ground risk? `Slope OK; recent rain in district; access road needs 1 day repair.`
8. **EPP Agent** → Any environmental permission needed? `Current EPP covers excavation in zone 1; zone 2 (where excavator would go) needs amendment.`
9. **Sales Agent** → Outstanding orders driving urgency? `Buyer X confirmed 4 kg by 25th; current stockpile only 1.6 kg.`
10. **FX Agent** → Cash impact? `If excavator approved 4 days: TZS 4.8m, runway drops 11→7 days unless Buyer X pays by Friday.`

Master Brain synthesises:

> **"Maybe — but with conditions. Send excavator only after two things: (1) NEMC zone-2 EPP amendment uploaded (Document Agent has drafted it, you just need to authorise); (2) road repair completed (1 day, 3 workers, TZS 220k). Rent for 4 days only with daily evidence — vein continuity photo + supervisor sign-off. If no continuity by day 3, stop, manual continues. This will reach confirmation ~3 days earlier and lets you ship 4 kg to Buyer X. Cash runway drops to 7 days but recovers to 19 days once Buyer X pays Friday. Confidence: 71%. Missing evidence: assay result on sample SB-04-22, supervisor confirmation that zone-2 ground is excavator-safe."*

Every junior call, every traversal, every recommendation is **stored in the audit log** so the owner can later ask *"why did you tell me to send the excavator?"* and Boji can show the full chain.

---

## 5 · Domain model (entities & relationships)

> Postgres-first; PostGIS for geometry; pgvector for embeddings; Timescale for time-series; S3 for binary; Neo4j *optional* in v2 if traversal cost outgrows recursive CTEs.

### 5.1 Top-level entities

```sql
-- Tenant boundary
tenant              (id, name, country, created_at, plan)

-- Owner layer
owner_profile       (tenant_id, user_id, goals, risk_appetite, capital_band, horizon, minerals[])

-- Company layer
company             (id, tenant_id, name, registration_no, tin, vrn, country, registered_address)
director            (id, company_id, name, role, kyc_doc_ids[])
shareholder         (id, company_id, name, percent, type)
bank_account        (id, company_id, bank, account_no, currency, purpose)
authority           (id, company_id, type, holder, signature_doc_id, fingerprint_template_id, valid_until)

-- Licence layer
licence             (id, company_id, type ENUM('PL','PML','ML','SML','DEALER','BROKER','PROCESSING','SMELTING'),
                     mineral, holder_id, grant_date, expiry_date, area_km2,
                     coordinates GEOMETRY, status, fees jsonb, obligations jsonb)
licence_event       (id, licence_id, kind, due_date, status, evidence_ids[])

-- Site layer
site                (id, licence_id, name, location GEOGRAPHY, mineral, phase, manager_id, status)
site_section        (id, site_id, kind ENUM('start','camp','stockpile','dump','qc','road','section_n'),
                     geometry GEOMETRY)

-- Geology layer
drill_hole          (id, site_id, kind ENUM('pit','shaft','rc','diamond','auger','trench','channel'),
                     location POINT, depth_m, layers jsonb, vein_intersect jsonb, photos[])
sample              (id, drill_hole_id, lab_id, sent_at, received_at, results jsonb, qa_qc jsonb)
vein_model          (id, site_id, length_m, width_m, dip_deg, strike_deg, plunge_deg,
                     volume_m3, confidence_pct, evidence_ids[])

-- People layer
employee            (id, company_id, name, role, site_id, wage_rate, type ENUM('PML','contractor','pit','daily'),
                     fingerprint_template_id, status)
attendance          (id, employee_id, site_id, date, hours, evidence_id)
advance             (id, employee_id, amount, currency, given_at, settled_at)

-- Asset layer
asset               (id, company_id, kind ENUM('excavator','compressor','generator','pump','crusher','truck','vehicle','tool','ppe'),
                     model, owned BOOL, site_id, operator_id, hours_used, status)
maintenance_event   (id, asset_id, kind, hours_at, cost, parts[], next_due_hours)
fuel_log            (id, asset_id, date, litres, cost_tzs, cost_usd, evidence_id)

-- Inventory layer
inventory_item      (id, site_id, kind, unit, current_qty, reorder_point, supplier_id)
stock_move          (id, item_id, qty, kind ENUM('in','out','transfer','waste'), evidence_id, ts)

-- Document layer
document            (id, tenant_id, kind, status, file_url, ocr_text, embedding VECTOR, related_to[], extracted jsonb)
fingerprint_event   (id, user_id, document_id, biometric_hash, signed_at, geo POINT)

-- Cost layer
cost                (id, site_id, category, amount, currency, ts, evidence_id, fx_at_ts NUMERIC)
forecast_cost       (id, site_id, category, forecast_for, low NUMERIC, mid NUMERIC, high NUMERIC, basis)

-- Production layer
shift_report        (id, site_id, supervisor_id, date, workers_present, machine_hours, metres_advanced,
                     bcm_overburden, rom_tonnes, fuel_litres, photos[], incidents jsonb, tomorrow_plan)
production_record   (id, site_id, kind ENUM('rom','concentrate','dore','gem','crushed','run-of-mine'),
                     mass_kg, grade jsonb, recovery_pct, ts)

-- Sales layer
ore_parcel          (id, site_id, mass_kg, grade jsonb, location, status, photos[])
sale                (id, parcel_id, buyer_id, weighbridge_doc_id, plate, driver_doc_id,
                     gross_price USD, gross_price_tzs NUMERIC, deductions jsonb, net NUMERIC,
                     payment_status, payment_evidence_id, ts)
buyer               (id, name, type, country, kyc_doc_ids[], rating)

-- Treasury layer
fx_rate             (ts, pair, rate, source)         -- BoT, LBMA, local
cash_account_balance(account_id, ts, balance)
ar_ageing           (sale_id, ts, days_outstanding)

-- Strategic layer
decision_log        (id, ts, prompt, mode, juniors_called[], confidence, recommendation, evidence_ids[], owner_action)
task                (id, owner_user_id, title, due, priority, site_id, kind, evidence_required[], status)
risk                (id, kind, severity, site_id, description, owner_id, status, mitigations[])
```

### 5.2 Multi-tenant rules

* Every row carries `tenant_id`. RLS in Postgres.
* `tenant.kind = ('owner','village','district','external_partner','admin')` — non-owner tenants see only what the owner-tenant exposes to them.
* Village / district personas use fingerprint+phone to authenticate; they sign letters and view limited site data.
* Federal regulators (Mining Commission, NEMC, OSHA, TRA) can be granted **read-only audit packets**, expiring, watermarked.

---

## 6 · End-to-end journeys

These are the **seven mega-flows** that map 1-to-1 to the user-supplied requirements snippet (pre-licence → post-licence → road negotiation → determination → planning → excavation/QC/on-loading → marketplaces). They are also the MVP product backlog.

### 6.1 Journey A — Pre-licence acquisition

#### A.1 Arrive at site & take coordinates
- Mobile capture: GPS lat/long, polygon shaping with two-finger drag, altitude, accuracy, weather, photos
- Auto-overlap check against the public Tume ya Madini cadastre (PDF parse + manual periodic refresh; future: API when offered)
- If overlap → Master Brain warns and proposes nearby alternative blocks

#### A.2 Apply for mineral right
- Form auto-populated with: owner KYC (TIN, passport, business licence), letter to regional head (auto-generated), area polygon, mineral, capital plan
- Submit produces a "control number" placeholder; user pays via TIGO Pesa / M-Pesa / Selcom / GePG / bank — receipt scanned, Document Agent verifies
- Auto-generated **letter of introduction to District as investor** following Mining Commission templates, with stamp + holder fingerprint + signature, downloadable in PDF / DOCX / image, shareable via WhatsApp / email / printable QR

#### A.3 Village government meeting
- Schedule meeting with village chair via in-app calendar; SMS reminder
- Itemised minutes (Swahili default, English on request):
  - Land loyalty (where landowner is non-government / non-village land — landowner attends)
  - Agreed village tax (TZS/year, payable schedule)
  - Agreed CSR (water borehole, classroom, dispensary, road grading, etc.)
- **Fingerprint authorisation** — village chair, executive officer, landowner, owner all press fingerprint on owner's smartphone; biometric hash + GPS + timestamp recorded
- Auto-generated **village agreement letter** with stamps, signatures, fingerprints; PDF + DOCX
- Item gets a check-mark in the workflow tree; next step unlocks

> *The fingerprint flow only works if the local government official's biometric template was previously enrolled by the appropriate authority. Boji ships an "enrolment kit" for village/district administrators — first-run capture at their office, attested by the regional commissioner / district commissioner.*

#### A.4 District EPP approval
- Two options the user picks:
  - Schedule a district-approved NEMC environmental officer (in-app booking)
  - Schedule a private NEMC-registered EIA expert (marketplace; rating, distance, cost, availability)
- EPP wizard:
  - Site baseline photos (every section, every nearby water source, every settlement within 500 m)
  - Q&A: human settlement / burial sites / cultural heritage / water / vegetation / animals / soil (Mining (Environmental Protection for Small-Scale Mining) Regulations 2010 §3)
  - Reclamation plan: who, what, when, how (rehab bond simulator)
  - Mercury/cyanide commitments (Minamata-aligned)
  - Officer fingerprint as second recommendation
- Output in multiple formats; auto-shareable
- **EPP-and-geo-tagging-first reminder** surfaced before any clearing/excavation — IIED 16641 p. 73 finding directly addressed

#### A.5 Approval-to-proceed gate
- Once village minutes + EPP + district approval logged, Boji emits a single **"Go-ahead pack"** that the owner can hand to a Resident Mine Officer / inspector
- Master Brain explicitly flags any missing piece and refuses to mark "go-ahead" until each is uploaded

### 6.2 Journey B — Road negotiations

- Master Brain looks at site polygon + nearest motorable road; computes likely access path
- Auto-fetch crossed parcels (village land-use map if available; else owner walks the route with phone, GPS-pinning each crossed parcel)
- For each parcel:
  - landowner KYC, fingerprint
  - compensation calc per acre / per tree / per crop using current Land (Assessment of the Value of Land for Compensation) Regulations rates
  - generate **agreement letter**, all parties fingerprint-sign
- Schedule 3-day excavator road-clearing job with auto-reservation against the asset pool
- Track payments to each owner; receipts auto-filed

### 6.3 Journey C — Determination / research phase

#### C.1 Local approach
- Tool log: pick, shovel, jembe, mallet, chisel, sluice
- Payment log per worker per day
- Vein-observation entries (`kuona mishipa`): photo, depth at intersect, host rock, indicator minerals
- "Local advisory" tag for elder miners; "Geologist advisory" tag for hired professional

#### C.2 Professional approach
- **Drill-hole Logger Agent** captures each pit/shaft/trench:
  - location, kind, depth, layers (topsoil → laterite → weathered → fresh → vein zone)
  - vein width, dip, strike, plunge if visible
  - photo at each layer transition
  - sample bag tag (chain-of-custody)
- Multi-hole **vein triangulation**:
  - Boji draws candidate vein surfaces from intersection points
  - Estimated length × width × depth → volume m³
  - Estimated tonnes (× density per host-rock template)
  - Estimated grade × recovery → recoverable Au g or carat
  - Output: a **bankable research report** template (JORC-lite for SME, with explicit "this is not JORC-compliant unless validated by a Qualified Person" disclaimer)
- **Lab/Assay Agent** orders fire-assay / AAS / ICP-MS from SGS, Bureau Veritas, ALS, Intertek, or GST/AMGC lab — QA/QC pack auto-attached (standard + blank + duplicate per 20 samples)

#### C.3 Bankable report
- Auto-compiled sections: company, licence, geology, samples & assays, volume estimate, costs, sale logic, risks, use of funds, repayment, real-time-visibility commitment
- For each bank (TIB, NMB, NBC, equipment lessor) the report adapts to their template
- **Bank oversight section** — promises live dashboard access, compliance audit packet, sale escrow, repayment auto-deduction

### 6.4 Journey D — Site planning

- Geo-tag → polygon → break into sections (start area / camp / storage / overload-dump / ore stockpile / QC place / road)
- Layered overlays:
  - terrain (DEM from Copernicus)
  - topography contour
  - local history (oral knowledge captured; village CSR records)
  - directions and access
  - ecology / conservation overlay (NEMC protected areas, forest reserves)
- **Forecasts / simulations** (Mine Planner Agent):
  - excavator and dumper movement — no collisions, no idle waits
  - amounts of overburden vs ore per day/week/month/year
  - schedule simulation against rainfall / regulator inspection cadence
  - on-loading window calculator (the *real* task: aligning excavation × QC × dumper × officer × buyer-vehicle to minimise fuel & demurrage)
  - notify officials directly on the platform; record confirmations
- Forecasts of **truck arrival at destination cities** + likely demurrage cost if late

### 6.5 Journey E — Excavation, QC, supervised on-loading

#### E.1 Excavation
- Driver app: counter button each time the excavator scoops; daily total
- Idle-time auto-detection from GPS / counter inactivity
- Move recommendations from Mine Planner ("excavator should not move more than 40 m from current section — fuel cost > productivity gain")
- Fuel log per shift; engine-hour log

#### E.2 Quality control
- Hire QC support via marketplace (workers, certified inspectors)
- Per-vehicle / per-batch QC log:
  - weight (district weighbridge ticket image)
  - plate
  - driver KYC
  - origin section
  - destination
  - mineral kind, grade estimate, photos
- Batch processing for multiple vehicles in a queue

#### E.3 Supervised on-loading
- Officer takes photo of weighbridge readout (or video, or live-watch)
- Auto-OCR of weighbridge ticket
- **Fast payment** (mobile-money / bank) — owner sees confirmation in real-time
- Auto-**letter for driver** as evidence (individual or batch); fingerprint-signed by officer
- Document organisation: village-tax receipts, royalty receipts, inspection receipts, clearance receipts — every receipt is OCR-classified and chained to the parcel

### 6.6 Journey F — Sales, FX, treasury

- Buyer marketplace: licensed brokers (Geita / Mwanza / Arusha / DSM), Mineral Trading Centres, BoT (gold mandatory sale), Geneva tanzanite auction, Tucson/Hong Kong/Bangkok gemstone shows
- For each sale candidate, FX/Treasury Agent computes:
  - Gross USD price
  - TZS at *today's* BoT mid + buyer spread
  - Refining / inspection / royalty / transport deductions → **NSR** (Net Smelter Return)
  - Cash-conversion cycle: when does the cash actually land?
  - If TZS is weakening: stockpile vs sell-now simulator
- If owner picks sell, an **export & traceability pack** auto-generated:
  - source PML
  - chain-of-custody from drill-hole → parcel → weighbridge → buyer
  - royalty receipt
  - BoT export clearance placeholder
  - buyer KYC

### 6.7 Journey G — Marketplaces & external-stakeholder window

- Marketplace categories:
  - Workers (mining labour, supervisors, drivers, QC inspectors)
  - Equipment (excavators, compressors, generators, pumps, crushers, trucks — rent / buy / lease-to-own)
  - Quality-control tools (sluices, sample-prep, gold-balance, retort, screen)
  - Labs (assay, gem grading, certification)
  - Experts (geologist, EIA, blasting competent, accountant, lawyer, surveyor)
  - Buyers (local broker, big broker, dealer, export, Mineral Trading Centre)
- Ratings on both sides
- AI-powered Swahili ↔ English ↔ French ↔ Mandarin translation for cross-border deals
- **External-stakeholder window**:
  - Externals view local PML performance + compliance in real-time (only what owners opt to share)
  - Locals view potential external partners
  - Groups & cooperatives can co-list to take larger orders
  - Ratings for individuals, companies, groups

---

## 7 · Strategic decision engines

Twelve engines the Cost / Strategy / Mine Planner / FX agents call into.

| Engine | Question it answers | Inputs | Output |
|---|---|---|---|
| 1. Start / Pause / Continue / Kill | Should we operate this site this week? | confidence, cash, regulatory status, market price, weather, blockers | one of 4 + reasons |
| 2. Manual vs Machine | Should we rent/buy a machine for this phase? | phase, vein confidence, headcount cost vs machine cost, days-to-confirmation gain | rec + break-even days |
| 3. Rent vs Buy equipment | If machine, rent or buy? | utilisation forecast, cost-of-capital, market rate | rec + payback months |
| 4. Hire vs Contractor | Permanent crew or contractor team? | cash runway, skill needed, duration | rec + risk note |
| 5. Explore more vs Extract | Push another sample round or start producing? | volume confidence, time-to-cash, sample cost | rec + EV calc |
| 6. Process vs Sell raw | Beneficiate or sell ROM? | recovery, processing cost, buyer premium | rec + NSR delta |
| 7. Renew vs Abandon licence | Is this PL worth its annual rent + obligations? | sunk cost, geology score, strategic option value | rec |
| 8. Site A vs Site B funding | Where does the next TZS X go? | per-site ROI, risk, runway impact | ranked list |
| 9. Workers vs Supervision | Hire more miners or one supervisor? | productivity loss, idle cost | rec |
| 10. Stockpile vs Sell-now | Hold ore for FX/price uplift? | TZS/USD vol, storage cost, theft risk, price trend | sell / stockpile / partial |
| 11. Internal vs JV/farm-out | Develop ourselves or partner? | capital gap, technical gap, timeline | rec + suggested partners |
| 12. Quick cash vs Reserve build | Optimise this quarter or 5-yr NPV? | owner profile, capital, debt position | rec |

Each engine returns a typed `Recommendation { confidence, evidence_ids, assumptions, alternatives, reversibility, decision_owner }` — exactly the structure that lets the Master Brain reason transparently.

---

## 8 · Fleet & equipment intelligence — scaling from 1 excavator to 100

This section directly answers the user's emphasis: *"I'm doing a mining business, I'm gonna deal with a fleet of all different kinds at some point."*

### 8.1 Scale tiers

| Tier | Description | Boji intensity |
|---|---|---|
| Solo PML | 1 site, hand tools, maybe 1 compressor | smartphone forms; weekly AI brief |
| Small mechanised | 1–2 sites, 1 excavator (rented), 1 generator, 1 compressor, 1 truck | daily SIC; rent-vs-buy nudges |
| Multi-site SME | 3–5 sites, 2–4 excavators, dedicated processing yard, fleet of trucks | full Mine Planner; fleet match-factor optimisation |
| Growing group | 5+ sites, multiple companies, processing + trading + equipment-rental subsidiaries | portfolio dashboard; group treasury; investor reports |
| ASM-aggregator | Hub serving 50–500 ASM operators (e.g. processing centre, cooperative platform) | the Boji platform itself becomes the hub's OS |

### 8.2 Fleet primitives

- **Match factor** = (truck capacity × cycle time) / (loader capacity × bucket time) — Asset Agent computes per shift; recommends adding / removing a truck
- **Queue minimisation** — Mine Planner emits the dispatch order
- **Cost-per-operating-hour** per asset class, per make/model
- **Predictive maintenance** — at SME tier, hour-meter-based service schedule; at growing-group tier, vibration + oil-analysis ingestion
- **Operator scoring** — fuel burn / hour, payload / cycle, downtime codes
- **Fleet substitution** — when one excavator goes down, Boji proposes the cheapest mitigation (rent backup, shift another site's machine, accept idle)

### 8.3 The strategic question Boji answers that no FMS does

> *"Across all my fleet, all my sites, all my minerals, what is the single highest-ROI action this week?"*

Boji can answer that because the LMBM ties asset → site → phase → confidence → cash → buyer → FX in one model. No incumbent fleet system does this.

---

## 9 · Mineral-specific playbooks

Each playbook is a typed `Playbook { phases[], decision_thresholds, document_pack, marketplace_routes, compliance_rules }`.

### 9.1 Gold (reef / vein / alluvial / eluvial)
- Phases: licence → village → EPP → access → trench → shaft → vein-search → confirmation → expansion → extraction → processing → sale
- Mercury rule: retort + banded washing area (NEP 1997 / Minamata)
- Sale path: PML → local broker → big broker → dealer → BoT (mandatory gold sale to BoT) or Mineral Trading Centre
- AI guardrails: cyanide leaching only if licensed cyanidation plant; otherwise refuse to advise

### 9.2 Tanzanite (Mererani only)
- Pocket-based, highly variable; Geneva auction price reference; tanzanite-specific dealer ecosystem (TAMIDA)
- AI flags: tanzanite ASM more organised than gold ASM (IIED p. 28) → templates assume production-sharing with PML owner

### 9.3 Other gemstones (ruby, sapphire, emerald, alexandrite, garnet)
- Per-mineral districts: Longido / Mahenge / Matombo / Mpanda / Tunduru / Mbinga / Mpwapwa / Lindi
- Hand-tool friendly; lower mechanisation; cutting/polishing value-add advised
- Sale path: TAMIDA dealer or direct Tucson / Hong Kong / Bangkok

### 9.4 Diamond
- Kimberlite (Mwadui) vs alluvial (Shinyanga)
- Special diamond-handling regulations (Kimberley Process)

### 9.5 Industrial minerals (gypsum, limestone, salt, kaolin)
- Gypsum (Makanya), salt (Maere / coast), limestone/aggregates (Amboni)
- Lower margin, higher volume; road impact dominant; village-government revenue an explicit feature
- AI advises against early mechanisation unless volume justifies

### 9.6 Strategic minerals (coal, rare earths, graphite, nickel/copper)
- Generally LSM territory; Boji's role is helping SMEs negotiate JV / tribute / off-take with LSM neighbours
- ASM-LSM peaceful-coexistence module (IIED §5.5)

---

## 10 · The FX, treasury, and unit-economics core

> *Why this is its own section: every other module loses money if FX is wrong. The user explicitly called this out — exchange-rate misses cost months of margin.*

### 10.1 Daily FX feed
- BoT mid-rate (TZS/USD, TZS/EUR, TZS/CNY)
- LBMA gold AM/PM fix
- LME / Fastmarkets for base & strategic metals
- Indicative gemstone reference (Geneva auction averages)
- All cached locally with timestamp; offline-capable

### 10.2 The TZS-only rule, encoded — and the 27 March 2026 cliff

The single most consequential 2025 regulatory shift for any Tanzanian mining business.

- **Legal basis:** Finance Act 2024 inserted s.26(2) of the BoT Act criminalising non-TZS domestic transactions. **GN 198 of 2025 (Foreign Currency Usage Regulations 2025)** gazetted **28 March 2025** operationalises it.
- **Core rule:** All pricing, quoting, invoicing, and payment for goods/services in Tanzania must be in TZS. A seller cannot refuse TZS. Refusing TZS or even *facilitating* foreign-currency payment is an offence.
- **Permitted USD use cases (narrow):** government-to-IO payments, diplomatic missions, foreign-currency loans from local FIs, duty-free shops, export transactions with offshore counterparties.
- **Penalties:** Up to **TZS 4 million fine OR up to 14 years' imprisonment** (or both). Previous regime was TZS 1m/day.
- **The 27 March 2026 cliff:** Every legacy USD-denominated domestic contract — mining services, drilling, camp, security, expat consulting, equipment hire — must be **re-papered into TZS within 12 months** of the effective date, i.e. **by 27 March 2026**, or be unenforceable. The Minister of Finance may grant case-by-case extensions.
- **Boji's response:**
  - **Contract-Currency Auditor** scans the tenant's contract corpus, flags every USD clause, and generates a TZS-equivalent variation addendum (signed via the fingerprint flow) before the cliff.
  - The invoice engine refuses to mint a domestic USD invoice; if user insists, Boji captures the override, the legal-citation acknowledgement, and the actor identity (audit-grade refusal).
  - Cross-border export documents (FOB / CIF to a non-resident counterparty) continue to be USD-denominated; Boji tags every invoice as domestic or cross-border at the contract layer.
  - For the owner this is a **strategic constraint**, not just compliance: Boji surfaces every operational decision (e.g. "stockpile vs sell to local broker") with the TZS-conversion timing as a primary variable, not an afterthought.

### 10.2.1 Penalty registration and BoT facility-notification
- Foreign-credit facility registration was previously fined TZS 1m/day; under the amendment regime the fine ceiling rises to TZS 4m + imprisonment.
- Boji's Compliance Agent pre-files BoT facility-registration notices for any incoming USD loan or equipment-lease, attaches the supporting documents from the LMBM, and tracks the regulator response window.

### 10.3 Sell-now vs Stockpile simulator
- Inputs: today's USD price; TZS/USD rate; 30-day FX volatility; gold trend (90-day MA); storage cost; theft risk score; cash runway; outstanding orders
- Output: probability-weighted recommendation, including **partial sale** (sell 60% now, hold 40% for X days)

### 10.4 Net Smelter Return calculator — TZ-specific
Canonical formula: `NSR = (Grade × Price × Recovery) − (TC + RC × Grade) − Transport − Royalty − Inspection − Insurance − Levies`.

Tanzania-specific stack (gold doré illustrative):
- Gross USD value at LBMA fix, less **2–8% African artisanal doré discount** to Good Delivery
- − refining (Rand Refinery / Metalor / Argor-Heraeus / Valcambi / PAMP — typically USD 0.50–1.50/oz)
- − transport + insurance (Geita → Mwanza → DSM → refinery)
- − **royalty: 6% raw / 4% if sold to in-country refinery / 4% under BoT Domestic Gold Programme**
- − **inspection fee: 1% (waived under BoT Gold Programme)**
- − **0.1% HIV Response Levy (new from Finance Act 2025, FY 2025/26)**
- − **0.3% Local Government Service Levy** (district/municipal where the mine sits)
- − **2% WHT, plus VAT 18% — but BoT route is zero-rated** (input-VAT recoverable)
- = NSR TZS

Indicative effective burden on unrefined gold export ≈ **9.4%** (6% royalty + 2% WHT + 1% inspection + 0.3% LG service levy + 0.1% HIV levy); under BoT route ≈ **4.4%** with 24-hour settlement.

Per-mineral royalty schedule encoded (config-driven, gazette-updateable):
| Mineral | Royalty |
|---|---|
| Uranium | 5% |
| Diamonds, rough gemstones, rough tanzanite | 5% |
| Cut/processed gemstones (incl. cut tanzanite) | 1% |
| Gold, copper, silver, PGM (raw export) | 6% |
| Same, sold to in-country refinery | 4% |
| Same, sold under BoT Domestic Gold Programme | 4% (+ 0% inspection + 0% VAT) |
| Other metallic minerals (Ni, Co, Fe, REE, graphite as metallic) | 6% |
| Coal — domestic / export | 1% / 3% |
| Industrial minerals (limestone, gypsum, salt, soda ash, phosphate, sand, dimension stone) | 3% |
| Renewably-produced salt with environmental levy paid | exempt |

### 10.5 Unit-economics dashboard
- TZS / metre advanced
- TZS / BCM overburden
- TZS / tonne ROM
- TZS / tonne milled
- TZS / recoverable gram or carat
- TZS / operating hour by machine class
- TZS / worker-day, phase-adjusted

### 10.6 Working-capital management
- Fuel float (days)
- Payroll runway (weeks)
- Supplier credit terms
- Receivable ageing
- Off-take advance vs free-float

---

## 11 · Documents, fingerprints, and the credibility layer

### 11.1 Why this matters

The IIED report repeatedly shows that the actual blocker to ASM formalisation is **documents** — applications, EPPs, village minutes, tax clearance, receipts (pp. 68–77). The user's snippet specifies fingerprint-authorised auto-letters as a core feature. Boji must therefore make documents a **first-class, legally credible** layer.

### 11.2 Document lifecycle

```
upload  ──►  OCR (Mistral OCR or Document AI)
        ──►  Document Agent classifies (PML / EPP / receipt / minutes / etc.)
        ──►  extracts fields (dates, names, numbers, coords, fees)
        ──►  validates against ruleset (e.g. PML expiry vs grant date sanity)
        ──►  embeds (pgvector)
        ──►  links into LMBM
        ──►  schedules follow-ups (renewal reminder, missing-attachment task)
        ──►  available to chat ("What's missing in this PML pack?")
```

### 11.3 Auto-generated letters

Every standard letter is a typed template:

* Letter of introduction to district (PML investor)
* Letter to village government requesting meeting
* Minutes of village meeting (with CSR + village tax + landowner loyalty)
* Landowner compensation letter
* Road-clearing approval letter
* EPP cover letter and full EPP
* Driver / vehicle release letter after on-loading
* Buyer sale confirmation
* Bank-loan application cover
* Investor / off-taker pitch cover

Each rendered in **PDF + DOCX + PNG** with:
- Mining-authority-style header
- Stamps (uploaded once, reused)
- Visible fingerprint impression
- Visible signature
- QR code linking to the LMBM document record (cryptographically signed)

### 11.4 Fingerprint authorisation

* Pre-enrolment: village chair, executive officer, district officer, NEMC officer, landowner, owner — enrolled by an authorised operator with witness; biometric template stored as **irreversible hash** (server cannot re-construct fingerprint)
* In-app authorisation: device captures fingerprint → matches against stored hash → emits `fingerprint_event` with biometric hash, signed timestamp, GPS, and the document hash being signed
* Legal basis: Electronic Transactions Act 2015 + Evidence Act amendments; Boji surfaces the legal citation inline at the moment of signing
* Verification: the QR code on every letter lets any external party verify it against Boji's signed-event registry

> **Hard constraint:** Boji does not impersonate a government stamp. The fingerprint represents a *person* who is authorised by their role. Boji renders a stylised header that **does not imply** a government endorsement when there is none.

---

## 12 · Mobile-first, offline-first, Swahili-first

### 12.1 Devices and connectivity

- Primary client: Android (≥ Android 8) via Expo / React Native; iOS parity
- Owner client: web (Next.js)
- Worker client: mobile-first PWA with strong offline (WatermelonDB + Powersync / Replicache)
- Voice input: Whisper (cloud) + Whisper.cpp (on-device fallback) — Swahili first-class
- Photo compression: WebP, max-edge 2048, server-side thumbnailing
- Sync: CRDT-friendly schema; conflict resolution by Master Brain when ambiguous

### 12.2 Languages

- Swahili (default in TZ)
- English
- French (DRC / Burundi / Rwanda expansion)
- Portuguese (Mozambique)
- Mandarin (off-taker comms)

### 12.3 Field UX rules

- Every form must work in 2 minutes with one thumb
- No form has more than 6 fields per screen
- Every screen has a "ask Boji" voice button
- Every report has a "share to WhatsApp" action
- Battery- and data-aware: photos uploaded only on Wi-Fi by default

---

## 13 · Reports

| Report | Cadence | Audience | Auto-trigger |
|---|---|---|---|
| Daily Owner Brief | daily 06:00 | Owner | always |
| Weekly Strategy Memo | Sunday 18:00 | Owner | always |
| Monthly Mining Business Report | 1st of month | Owner + Board | always |
| Site Daily | end of shift | Owner + Site Manager | per shift |
| Investor / Bank Pack | on-demand | Banks / TIB / NMB / NBC / off-takers | on request |
| Board Pack | quarterly | Board | scheduled |
| Audit Pack | on-demand | Regulator (read-only) | on request |
| Community Update | monthly | Village / district | scheduled |

Every report shows **provenance** — every number links back to its evidence in the LMBM.

---

## 14a · App-surface architecture — exactly four surfaces

**Per founder Directive 03 (2026-05-17 session, captured verbatim in `primary_sources/USER_BRIEF_03_session_directives.md`):** Boji is **not** BossNyumba's persona shape. There is no customer / tenant / external-consumer app. The product has four — and only four — surfaces:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        OWNER / ADMIN PERSONA                            │
│                                                                         │
│  ┌──────────────────────────┐         ┌────────────────────────────┐   │
│  │ OWNER MOBILE APP         │         │ OWNER WEB APP              │   │
│  │ (iOS + Android, Expo RN) │         │ (Next.js 15)               │   │
│  │                          │         │                            │   │
│  │ • daily brief            │  same   │ • strategic cockpit        │   │
│  │ • decision approvals     │  data   │ • document chat            │   │
│  │ • voice-first ask Boji   │ ◄─────► │ • board / investor packs   │   │
│  │ • field photo + GPS      │  same   │ • portfolio map (PostGIS)  │   │
│  │ • biometric sign-off     │  agents │ • multi-company group view │   │
│  │ • push alerts            │         │ • report exports           │   │
│  └──────────────────────────┘         └────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                  WORKER / SUPERVISOR PERSONA                            │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ WORKER MOBILE APP (Expo RN; PWA fallback for cheap Android)  │      │
│  │                                                              │      │
│  │ • shift report (workers, hours, fuel, photos, blockers)      │      │
│  │ • hourly SIC supervisor pings (configurable cadence)         │      │
│  │ • excavator-count button                                     │      │
│  │ • drill-hole logger (lithology + vein-intersect + photo)     │      │
│  │ • weighbridge photo / OCR                                    │      │
│  │ • inventory issue / return (fuel, PPE, parts)                │      │
│  │ • safety toolbox-talk acknowledgement                        │      │
│  │ • voice notes (Swahili → on-device Whisper)                  │      │
│  │ • offline queue + sync (PowerSync / CRDT)                    │      │
│  │ • fingerprint sign-off                                       │      │
│  └──────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                BOJI INTERNAL-PLATFORM (BOJI TEAM ONLY)                  │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │ BOJI INTERNAL WEB APP (Next.js 15)                           │      │
│  │                                                              │      │
│  │ • tenant directory (sign-up, billing, plan tier)             │      │
│  │ • intelligence-corpus management                             │      │
│  │   (versioned ingest of research/* and minerals/*)            │      │
│  │ • model / prompt registry (weekly GEPA outputs)              │      │
│  │ • per-tenant audit-log viewer                                │      │
│  │ • support-ticket & escalation tooling                        │      │
│  │ • feature-flag + roll-out controls                           │      │
│  │ • regulatory-change pipeline (Gazette / NEMC / BoT ingest)   │      │
│  │ • marketplace moderation (workers / equipment / labs / experts) │   │
│  │ • health-check dashboards (SLO, model spend, error rates)    │      │
│  │ • A/B test harness for prompt / agent improvements           │      │
│  │ • compliance review queue (manual-approval gates)            │      │
│  └──────────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────────┘
```

### Surface design principles

| Surface | Persona | Latency target | Connectivity assumption | Auth |
|---|---|---|---|---|
| Owner mobile | owner, admin, finance officer, doc officer | < 1.5 s warm; voice < 3 s end-to-end | intermittent 4G / Wi-Fi | NIDA + biometric |
| Owner web | same | < 800 ms p50 | always-on | NIDA + WebAuthn |
| Worker mobile | site manager, supervisor, driver, geologist, stores keeper, QC officer | < 1.0 s warm; offline-first | rural 2G/3G frequent; offline expected | fingerprint + device-bound key |
| Boji internal | Boji ops / engineering / compliance | < 500 ms p50 | always-on | SSO + MFA + audit |

### What we deliberately do NOT ship

- **No customer / tenant-of-the-owner app.** The owner's customers (buyers, brokers, regulators) are *contacted* by Boji (auto-letter, fingerprint-attested PDF, WhatsApp/SMS share) but do not have their own Boji surface.
- **No public marketplace UI for non-Boji users in v1.** External-stakeholder browsing happens through shared report links + the Owner web app's external-partner module.
- **No customer-loyalty / CRM extension.** That's a BossNyumba/property pattern; mining doesn't need it.
- **No tenant-self-serve "build-your-own-agent" UI in v1.** All agent provisioning happens through Boji internal controls; tenants get curated juniors.

### Implementation note

All four surfaces share the **same backend, the same domain model, the same agent pool, the same audit log**. The differences are *role-scoped views + tool surfaces*, not separate services.

- `apps/owner-mobile/` — Expo RN; share TypeScript types with `apps/owner-web/`.
- `apps/owner-web/` — Next.js 15.
- `apps/worker-mobile/` — Expo RN; PWA fallback at `worker.boji.ai`.
- `apps/boji-internal/` — Next.js 15; behind SSO + IP allow-list.

Backend services (`services/api-gateway/`, `services/consolidation-worker/`, `services/document-intelligence/`, `services/notifications/`, `services/payments/`) are surface-agnostic.

---

## 14 · Tech stack

| Layer | Choice | Why |
|---|---|---|
| Web — Owner / Admin (Owner Portal) | Next.js 15 + React 19 + Tailwind v4 + shadcn/ui + Radix | strategic cockpit; matches BossNyumba pattern; OKLCH theming |
| Web — Boji Internal Platform | same stack as owner portal, separate app under `apps/internal-platform-portal` | Boji team operates the multi-tenant platform; no overlap with owner data UI |
| Mobile — Owner / Admin (Owner App) | Expo 53 + React Native + NativeWind | owner flexibility in the field; mirrors owner-portal feature-for-feature with mobile-native primitives |
| Mobile — Worker (Worker App) | Expo 53 + React Native + NativeWind | supervisor / driver / officer / stores-keeper / geologist field-data-capture surface; voice-first, photo-first, fingerprint-signed |
| Offline / sync | Powersync or Replicache + WatermelonDB | proven CRDT-style sync over Postgres |
| Backend | Node 22 + Fastify or NestJS; Hono on edge for light routes | aligns with BossNyumba |
| LLM orchestration | Claude (Anthropic SDK) with prompt caching; LangGraph for multi-agent state | frontier reasoning + auditable graphs |
| Master Brain model | Claude Opus 4 / 4.7 with 1M context (planning, board mode) | high reasoning, long context for big tenants |
| Junior agent models | Claude Sonnet 4.x for most; Haiku 4.x for cheap loops | cost/perf balance |
| Embeddings | Cohere embed v3 multilingual or OpenAI text-embedding-3-large | Swahili-capable |
| Vector store | pgvector (HNSW) | one Postgres |
| Graph queries | Postgres recursive CTE + JSONB; Neo4j optional later | start simple |
| Time-series | Timescale | natural fit for shift / cost / fx / production |
| Geospatial | PostGIS + Mapbox / MapTiler + Tippecanoe vector tiles | mining is geo-first |
| OCR | Mistral OCR + Llama Parse fallback; Document AI for complex forms | high accuracy on Swahili forms |
| Object storage | S3 / Cloudflare R2 | photos, docs, weighbridge images |
| Search (text) | Postgres FTS + pgvector hybrid | one DB |
| Auth | Clerk or Auth.js + WebAuthn / BiometricPrompt / LocalAuthentication | fingerprint required |
| Notifications | Knock or Novu; WhatsApp Business; SMS via TZ aggregator | meet users where they are |
| Payments | Selcom + Stripe + GePG bridge + DPO | TZS + USD + mobile money |
| Maps imagery | Sentinel-2 (Copernicus, free) + Planet (paid layer) | site mapping |
| Audio | Whisper (cloud) + Whisper.cpp (on-device) | Swahili STT |
| Translation | NLLB / GPT translate for Swahili ↔ EN ↔ FR ↔ ZH | marketplace cross-border |
| Observability | OpenTelemetry + Grafana + Sentry | SLO discipline |
| Infra | Cloudflare (edge) + AWS (Postgres / S3 / Bedrock fallback) + Terraform | repeatable |
| Compliance / audit log | append-only Postgres + S3 WORM bucket + KMS-signed events | non-repudiation |

---

## 19 · Security, privacy, regulatory posture

* All PII (KYC, fingerprint templates) encrypted at rest (AES-256-GCM) and in transit (TLS 1.3); fingerprint templates stored only as irreversible hashes
* Tenant isolation via Postgres RLS + per-tenant KMS key
* Mining-specific data sensitivity: licence applications can be commercially sensitive — encrypted, owner-only visibility by default
* Government / regulator audit packs use **expiring signed URLs** with watermarking
* Compliance Agent maintains a citation library of every TZ law/regulation referenced; every recommendation that depends on a law cites it
* No explosive operational instructions ever — only lawful compliance metadata (Magazine Licence status, blast-approval letters, exclusion-zone confirmations)
* No mercury operational instructions that increase exposure; only retort + banded-washing + Minamata-aligned guidance
* SOC2 Type II target within 18 months; ISO 27001 thereafter

---

## 15 · Surface architecture — four apps, no customer

> **This section is authoritative. Where any earlier section implied a customer-facing app, this section overrides it.**

Boji has exactly **four surfaces**. They share one tenant database, one knowledge graph, one Master Brain, and one Junior-Agent pool. They differ only in (a) who logs in, (b) what tool-surface that role exposes, and (c) what insight-density vs data-capture-density the UI is optimised for.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      OWNER / ADMIN persona                             │
│  ┌──────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │  Owner Mobile App            │  │  Owner Portal (Web)             │ │
│  │  React Native (Expo)         │  │  Next.js 15                     │ │
│  │  Insight + decision-capture  │  │  Strategic cockpit              │ │
│  │  in the field                │  │  Document chat, board reports   │ │
│  └──────────────────────────────┘  └─────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────┤
│                          WORKER persona                                │
│  ┌──────────────────────────────┐                                      │
│  │  Worker Mobile App           │                                      │
│  │  React Native (Expo)         │                                      │
│  │  Voice-first, photo-first,   │                                      │
│  │  fingerprint-signed          │                                      │
│  │  Field data capture          │                                      │
│  └──────────────────────────────┘                                      │
├────────────────────────────────────────────────────────────────────────┤
│                  BOJI-INTERNAL persona (us)                            │
│  ┌──────────────────────────────┐                                      │
│  │  Internal Platform Portal    │                                      │
│  │  Next.js 15                  │                                      │
│  │  Multi-tenant ops, billing,  │                                      │
│  │  prompt-compile QA, telemetry│                                      │
│  └──────────────────────────────┘                                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 15.1 Owner / Admin persona — two surfaces

The Owner / Admin sees the same data and decisions on both surfaces. The difference is *form*:

| Surface | Optimised for | Examples of UX patterns it owns |
|---|---|---|
| **Owner Portal (web)** | strategic thinking, deep insight, multi-document chat, multi-site comparison, investor reports, board packs | wide tables, full geospatial map, drag-to-reshape area polygons, document side-by-side compare, scenario simulator, weekly memo composer, marketplace browsing |
| **Owner App (mobile)** | quick checks in transit, voice commands, accepting/declining recommendations, signing letters with fingerprint, taking owner-side site photos, push-notification triage | one-screen "today's brief", swipe-to-approve task, voice-to-decision, push notifications with fingerprint confirm, single-tap "stockpile vs sell" simulator, mobile-resolution dashboards |

**Single mental model.** The Owner App is *not* a junior subset of the portal — it is a different *form* of the same model. Anything the owner does in the field on the mobile app is reflected in the web portal within seconds.

### 15.2 Worker persona — one surface

The Worker app is the field-data-capture surface. Workers are: supervisors, excavator operators, drivers, on-loading officers, QC inspectors, stores-keepers, geologists, document officers, finance officers, security, drill operators.

Junior agents *meet workers here*. The Operations Agent posts a daily plan; the supervisor reports back hourly with voice + photo + counter button; the Drill-hole Logger Agent posts a fresh hole form; the QC Inspector posts batch weighbridge images; the Document Officer is prompted to upload a missing receipt.

The Worker app **never shows owner-level strategic insight**. It shows: "your tasks today", "your shift, in real time", "your team", "your equipment", "your handover note". Above all it is voice-first and photo-first because most workers will not type long-form Swahili on a phone in a dusty pit.

### 15.3 Boji-Internal persona — one surface

The Boji team needs its own surface to run the multi-tenant platform — onboarding new owners, monitoring agent health, reviewing prompt-compile candidates before promotion, billing, support, and curating the global intelligence corpus (regulation updates, new mineral playbooks, FX-feed providers).

This surface is **never visible to owners or workers**. It is gated behind a separate identity provider and uses a separate domain (`internal.boji.ai`). All access is audit-logged.

Capabilities:
* Tenant directory, plan/billing, contracts, KYC
* Live telemetry across tenants (no row-level data — aggregates only by default)
* Prompt-compile QA: review last week's GEPA candidates, see Pareto deltas, approve / reject promotion
* Junior-agent registry: enable/disable agents per tenant, hot-fix policy subsets
* Regulation corpus editor: when GN-XXX of 2026 is gazetted, the Boji team adds it here and the Compliance Agent re-ingests
* Marketplace moderation: dispute resolution, rating audits
* On-call dashboards: kernel latency, junior failure rate, OCR accuracy, biometric-sign error rate

### 15.4 Repo layout

```
apps/
├── owner-portal/                       # web — strategic cockpit
├── owner-app/                          # mobile — owner in the field
├── worker-app/                         # mobile — supervisor / driver / officer / geologist
└── internal-platform-portal/           # web — Boji team only

packages/
├── central-intelligence/               # BrainKernel (13-step pipeline) — verbatim from BossNyumba
├── ai-copilot/junior-ai-factory/       # provision / adjust / suspend / revoke
├── ai-copilot/task-agents/             # cron / event / manual triggered agents
├── domain-models/                      # mining-specific types (licence, site, drill_hole, ...)
├── database/                           # Drizzle + schemas (temporal-entity-graph included)
├── api-sdk/                            # type-safe client for all four apps
├── design-system/                      # shadcn + Tailwind tokens — Tanzania OKLCH palette
├── chat-ui/                            # owner-portal + owner-app chat surface
└── shared-mobile/                      # offline sync, biometrics, voice, push

services/
├── api-gateway/                        # composition root, routes, middleware
├── consolidation-worker/               # nightly 9-stage + weekly prompt-compile
├── document-intelligence/              # OCR, fraud detection, evidence-pack
├── notifications/                      # WhatsApp + SMS + push + email
├── payments/                           # Selcom / Stripe / GePG bridge / DPO
├── reports/                            # daily brief / weekly memo / board pack
├── geo-intelligence/                   # Sentinel-2 fetch, drone ingest, cadastre overlap
└── treasury-feed/                      # LBMA + BoT + LME + Fastmarkets + Argus + Bonas

infra/
├── terraform/                          # Cloudflare + AWS + KMS + S3-WORM
└── alerts/
```

### 15.5 Authentication and identity

* Owner / Admin: **Smile ID + NIDA** for KYC + face liveness; passkey for portal, BiometricPrompt / LocalAuthentication for mobile.
* Worker: phone-number-first SMS OTP; optional NIDA enrolment by the owner during onboarding; biometric template stored as irreversible hash; fingerprint signing requires both possession (the device) and biometric (the finger).
* Boji-internal: SSO via Google / Microsoft 365 + hardware security key (YubiKey) for admin actions.
* Village / district / NEMC officer / lab partner / buyer / external partner: **pre-enrolled fingerprint templates** held in the tenant scope they participate in; no separate app — they sign via the owner's or worker's device.

---

## 16 · The always-learning brain — never hard-coded

> "It's not like we are hard-coded on, well, it's like we're always learning. We're always updating ourselves. We're always getting better. Like, we are a brain." — founder, Directive 03

This is the section that operationalises that promise. Boji has five learning loops running at five cadences. Each loop has a specific mechanism, a specific input, a specific evaluator, and a specific promotion gate. Together they make the platform a genuinely-evolving brain rather than a static SaaS app.

### 16.1 Loop 1 — In-conversation learning (real-time, per turn)

**Mechanism:** the BrainKernel's 13-step pipeline (verbatim from BossNyumba — see `research/06_BOSSNYUMBA_PATTERN_MAPPED.md`).

Every owner / worker / village-officer turn:
1. Pulls the latest LMBM snapshot for the tenant.
2. Recalls relevant prior facts from the temporal entity graph + vector store.
3. Updates the brain's belief about the owner's intent, risk appetite, and current operating context.
4. Writes new facts (with confidence + provenance) back to memory.
5. Logs the full decision trace.

**Promotion gate:** none — these writes are tentative, low-confidence. They become durable only if loop 2 promotes them.

**Latency budget:** end-to-end 2-6 seconds for Master synthesis with 3-5 Junior calls.

### 16.2 Loop 2 — Nightly Consolidation Worker (24-hour cadence)

**Mechanism:** the 9-stage `services/consolidation-worker/` pipeline.

Each night, for each tenant:
1. **Ingest** the day's raw thoughts from `kernel_cot_reservoir`.
2. **Cluster** by entity (licence, site, employee, asset, etc.).
3. **Reflect** with a Haiku constitutional evaluator — does this fact conform to the platform's principles (evidence-required, no-fabrication, citation-of-regulation)?
4. **Promote** high-confidence facts to durable memory.
5. **Decay** old low-confidence facts.
6. **Consolidate** contradictions — when two facts disagree, the bi-temporal validity window is updated and the older fact is soft-invalidated, not deleted.
7. **Re-embed** the promoted facts so future RAG retrieves them.
8. **Publish** consolidation events so dependent services (forecasting, reports) refresh.
9. **(Sundays only)** kick off Loop 3.

**Promotion gate:** Haiku evaluator score + confidence threshold + no contradiction with a "load-bearing" fact (one cited by ≥ N prior decisions).

**Effect for the owner:** the Daily Owner Brief on Monday is generated against a memory that has *learned* from the previous week.

### 16.3 Loop 3 — Weekly Prompt Compiler (7-day cadence)

**Mechanism:** the GEPA loop in `services/consolidation-worker/src/prompt-compile/`.

Each Sunday:
1. **Mutator** (Claude Opus 4.x) proposes 5 candidate system-prompt revisions for each capability (Master Brain modes, top-5 Juniors).
2. **Evaluator** (Claude Haiku 4.x) scores each candidate against a *golden set* of historical decisions where the right answer is known.
3. Candidate that strictly improves on the baseline (and doesn't regress the golden set) is promoted.
4. Boji-internal team reviews the diff in the Internal Platform Portal before the promotion lands in production.

**Promotion gate:** Pareto-dominant on golden set + Boji-internal team approval.

**Effect for the owner:** quality compounds week-over-week. Boji at week 26 is *meaningfully better* than Boji at week 1, even on identical inputs.

### 16.4 Loop 4 — Monthly Domain-Knowledge Refresh (30-day cadence)

**Mechanism:** a scheduled job runs Junior agents (Compliance Agent, Licence Agent, FX Agent) in *learning mode*:

* Compliance Agent crawls `tumemadini.go.tz`, NEMC, BoT, TRA, gazette diffs for new GNs.
* Licence Agent diffs the public cadastre against tenant licences.
* FX Agent refreshes the LBMA / BoT / LME / Fastmarkets feed providers, updates premium-discount calibration on African doré, refreshes the cross-border benchmark table.
* Geology Agent monitors arXiv + Mining Journal for new vein-estimation / POMDP / drilling-cost papers.
* The brief these juniors produce lands in the **Internal Platform Portal** for the Boji team to curate and merge into `Docs/research/`.
* Once merged, the corpus re-ingests, the Compliance Agent re-validates every active recommendation that depended on the touched regulations.

**Promotion gate:** Boji-internal curation step is mandatory. Regulation changes are too high-stakes to auto-promote.

**Effect for the owner:** when GN-XXX of 2026 lands, Boji is updated within days, not quarters. The 27-March-2026 USD-contract cliff is a one-time forcing function; the monthly refresh keeps Boji ahead of the *next* such cliff.

### 16.5 Loop 5 — Quarterly Frontier-Capability Review (90-day cadence)

**Mechanism:** the Boji-internal team conducts a 90-day review of:

* New frontier LLMs and their cost-vs-capability curve (Opus / Sonnet / Haiku tiers + competitors).
* New OCR / vector / KG / mobile-sync / Swahili-LLM technology.
* New mining-AI techniques in the literature (RL truck dispatch, POMDP mine planning, hyperspectral ore sorting, etc.).
* Boji's own performance metrics over the quarter — agent failure rates, kernel-latency p95, GEPA promotion frequency, owner-conversion rate.

**Promotion gate:** capability changes go through a deliberate migration plan in the Internal Portal — never auto-applied.

**Effect for the owner:** Boji *as a product category* keeps moving with the frontier, not behind it.

### 16.6 Drift & calibration regime

A learning system that doesn't calibrate becomes a confidently-wrong system. Boji runs three calibration jobs:

| Calibration | Frequency | Test | If fail |
|---|---|---|---|
| **Forecast-vs-actual** | weekly | for every forecast (cost runway, production tonnes, FX timing, vein confidence) compare to actuals once they land; compute Brier score per capability | retrain the forecaster; pin the affected capability to "low confidence" until back-tests recover |
| **Citation-validity** | nightly | for every recommendation made today, can the cited regulation / passage still be retrieved and does it still say what we said it said? | flag the recommendation as stale; ask the owner to re-confirm |
| **Provenance-completeness** | continuous | for every Master response, was every numeric or legal claim sourced? | Auditor Agent blocks the response; Master must retry with citations |

### 16.7 Forecasting engine

This is the user-facing payoff of the always-learning brain. Boji forecasts at five granularities, each plugged into a different junior:

| Forecast | Junior | Method | Refreshes |
|---|---|---|---|
| **Per-asset hours-to-failure** | Maintenance Agent | hour-meter + duty cycle + service history + (optional) vibration / oil-debris | nightly |
| **Per-site daily production** | Operations / SIC Agent | last-7-day moving baseline + planned shifts + weather + machine availability + match-factor | every shift report |
| **Per-site cost runway** | Cost Engineer Agent | burn-rate + scheduled spend + receivable timing + FX | hourly |
| **Portfolio cash position** | FX/Treasury Agent | per-site runway aggregation + buyer payment-probability + BoT vs export route | daily |
| **FX / gold / mineral price** | FX/Treasury Agent | LBMA + BoT + LME + Fastmarkets + Argus + Bonas feed; medium-term (30-day) directional prior derived from gold-cycle correlation with TZS strength | every 15 min during market hours |
| **Vein confidence** | Geology Agent | bore-hole triangulation + assay returns + supervisor evidence; Bayesian update each new sample | each new bore-hole / assay |
| **Demand timing** | Sales Agent | buyer order book + auction calendar + Geneva / Tucson / Hong Kong / Bangkok cadence + historical season | weekly |
| **Compliance deadlines** | Licence Agent + Compliance Agent | every licence event + EPP cycle + CSR plan window + 27-March-2026 cliff + dormancy-revocation tracking | daily |

Forecasts are *not* point estimates — they are typed `Forecast { p10, p50, p90, basis, evidence_ids, confidence, model_version, last_calibrated }` so the owner can act on the band, not the centre line.

### 16.8 Why this is genuinely different from a "feature update"

A traditional SaaS company ships features. Boji ships **learning capacity**. The Master Brain at week 1 follows static prompts. The Master Brain at week 52 follows prompts that have been improved by **52 GEPA cycles**, against **365 nights of consolidation**, against **12 monthly regulation refreshes**, against **4 quarterly frontier reviews** — and against the tenant's own history. That is the brain promise.

---

## 17 · The owner-insights catalogue (mobile + web)

Specific, named insights the Owner App and Owner Portal must produce. This is the catalogue agents target; the dashboard is whatever shows the top N items today.

### 17.1 The Daily Owner Brief (default home screen)
1. **Today's critical decisions** — top 3, each with a one-line recommendation and a "tell me more" expand.
2. **What changed since yesterday** — facts that flipped (vein confidence up, cash down, document filed, machine broke).
3. **What's at risk** — licence / cash / safety / FX / community items rising in severity.
4. **Who's waiting on you** — fingerprint-signature requests, four-eye approvals.
5. **Today's compliance touch-points** — payments due, reports due, meetings due.

### 17.2 Strategic insight cards
* **Site ranking** — every site scored on geology / cash / licence / readiness / risk.
* **Mechanisation decision** — manual vs machine economics, phase-adjusted.
* **Sell vs stockpile** — FX-aware, cost-of-carry-aware, with sell-partial option.
* **Where the next TZS X should go** — capital allocation across the portfolio.
* **Phase change recommendation** — when a site should move from search → confirmation → expansion → extraction.
* **Worker reassignment** — idle workers Boji can move to where they're needed.
* **Asset re-routing** — excavator that should leave Site A for Site B and why.
* **Buyer routing** — who pays the best net price net of FX timing and fees.
* **Cash-runway band** — p10/p50/p90 over 7/30/90 days.
* **Profit forecast** — site, mineral, portfolio.

### 17.3 Predictive insights
* "Fuel runs out in X days; reorder by Y."
* "Compressor maintenance due in Z engine-hours; book mechanic now."
* "Vein continuity is degrading at Site B — recommend pause."
* "Buyer X has paid 4 of 5 recent invoices late by a mean of 9 days — discount their probability."
* "Renewal pack assembly time for PML-001 historically takes 26 days; start at T-30."
* "If you mechanise Site A this week, runway drops to 7 days unless Buyer X pays Friday."

### 17.4 Investor / lender insights
* **Bankable report draft** — generated from production + geology + costs; bank-template-aware (TIB, NMB, NBC, CRDB).
* **Repayment simulator** — interest rate × principal × cash forecast.
* **Live-visibility commitment pack** — what dashboards Boji will expose to the lender if the loan lands.
* **Audit packet** — watermarked, expiring URL for a regulator or off-taker.

---

## 18 · The worker-app design — separate, simple, voice-first

The Worker App is intentionally narrow. Its single job is to be the **easiest way to capture truth from the field**.

### 18.1 Daily worker home

* "Your shift today" — site, start time, supervisor, equipment.
* "Your tasks today" — 3-7 items from the Operations Agent.
* Big mic button for voice notes.
* Big camera button for photos.
* Big fingerprint button for signing.
* No graphs. No multi-page menus. No FX. No portfolio. No strategy.

### 18.2 Per-role flows

| Role | Primary flow |
|---|---|
| Supervisor | hourly check-in: workers present, hours run, tonnes moved, fuel used, blockers, photo + voice note |
| Excavator operator | counter-tap per scoop; idle-detection auto-flag; fuel-level confirm; pre-start checklist |
| On-loading officer | weighbridge image + plate number + driver KYC + batch sale letter generation + fingerprint |
| QC inspector | per-vehicle / per-batch sample log + photo |
| Stores keeper | stock-in / stock-out scans; reorder confirmation |
| Geologist | bore-hole logger form per hole; sample bag-tag scan; multi-hole triangulation surfaces (read-only summary) |
| Document officer | scan a document → OCR → classify → file; missing-field follow-up checklist |
| Driver | route check-in / check-out; geofence events auto-captured |
| Security | incident log; perimeter walk check-in |

### 18.3 Offline-first

* Worker app caches the day's plan locally on shift start.
* All field captures (photo, voice, form, fingerprint event) queue locally; sync on reconnect.
* Sync is conflict-free for most fields (last-writer-wins for sensors), CRDT-merged for collaborative drafts (e.g. an EPP draft co-edited by a NEMC officer and the owner).

### 18.4 Voice-first

* Push-to-talk Whisper transcription (Swahili default).
* "Hey Boji" wake-word optional.
* Boji speaks back in Swahili (Coqui XTTS-v2) for accessibility.

### 18.5 Worker app does not see owner data

* Wage rates, FX, P&L, marketplace pricing, investor reports — none of this is in the Worker app.
* The worker sees their own attendance and their own assigned tasks.

---

## 20 · GTM and pricing

### 20.1 Pricing tiers (TZ launch)

| Tier | Monthly TZS | Includes | Target |
|---|---|---|---|
| **Mwanzo** (Free) | 0 | 1 PML, 1 site, document chat, basic owner brief, marketplace listings | onboarding & freemium |
| **Mkulima** (Working) | 50,000 | 3 PMLs, 3 sites, EPP wizard, village minutes, shift reports, owner brief, weekly memo | solo PML holders |
| **Mfanyabiashara** (Business) | 250,000 | 10 PMLs, 10 sites, full fleet + treasury + sales modules, investor reports | small mechanised |
| **Kampuni** (Company) | 1,200,000 | unlimited PMLs/sites, multi-company, processing/trading subs, group treasury | multi-site SMEs |
| **Group** (Custom) | from 5,000,000 | white-label hub for cooperatives & ASM aggregators | aggregators |

USD/EUR pricing maintained for non-TZ tenants. Add-ons: extra lab credits, extra OCR pages, premium FX feed (sub-second LBMA), bank-pack generation credits.

### 20.2 Distribution

1. **Direct field sales in Geita / Mwanza / Mererani / Tanga** — partner with FEMATA, GEREMA, TAREMA, MAREMA, TAMIDA, TAWOMA (all named in IIED 16641 §4.2) as channel co-marketers
2. **Cooperative-as-customer** — sell to mining SACCOS who onboard their members at zero cost; revenue from data + finance partners
3. **NGO / development partnerships** — IIED, HakiMadini, Pact's Delve, Solidaridad, Fairtrade Gold Africa for ASM formalisation projects
4. **Government partnerships** — Mining Commission, NEMC, STAMICO, GST extension-service co-deployment
5. **Bank partnerships** — TIB, NMB, NBC sell Boji as the "mining-ready" loan-application platform; commercial-bank co-revenue
6. **Equipment-financier partnerships** — Caterpillar Financial, Sinotruk, JCB / Komatsu dealers integrate Boji as the equipment-finance underwriting tool

### 20.3 Expansion path

- TZ → DRC (Katanga copper-cobalt artisanal, Kivu gold/tin/coltan): translate licence types, French UI, FCFA/CDF/USD
- TZ → Ghana (Minerals Commission, small-scale 25-acre concessions)
- TZ → Kenya (Mining Act 2016, Migori gold belt)
- TZ → Zambia (gemstones, copper)
- LATAM track: Peru (REINFO), Colombia (small-scale gold)

---

## 21 · MVP roadmap (6 milestones)

### Milestone 1 — Document & PL Brain (8–12 weeks)
- Owner onboarding wizard (BossNyumba-style central command)
- Upload PML / EPP / receipts; OCR + classification + extraction
- PL lifecycle calendar (grant, renewal, payments)
- Document chat
- Daily Owner Brief
- Auto-generated district-introduction & village-meeting letters
- Fingerprint enrolment for owner + village chair (pilot district)

### Milestone 2 — Site Threads & Daily SIC (8 weeks)
- Site geo-tagging & sectioning
- Daily shift report (workers, hours, fuel, photos, blockers)
- AI deviation explanation
- Tomorrow-plan suggestion
- Task system

### Milestone 3 — Cost, FX, Strategy (8 weeks)
- Burn-rate, runway, NSR, sell-vs-stockpile
- Decision engines 1–4 (start/pause/kill, manual-vs-machine, rent-vs-buy, hire-vs-contractor)
- Portfolio site ranking
- Weekly Strategy Memo

### Milestone 4 — Fleet, HR, Inventory (10 weeks)
- Asset registry + match factor
- Employee assignment & idle-time detection
- Procurement + reorder
- Maintenance scheduling

### Milestone 5 — Production, Sales, Marketplaces (12 weeks)
- Ore-parcel tracking, weighbridge image → batch sale letter
- Buyer routing + payment trace
- Marketplace v1: workers, equipment, labs, experts, buyers
- External-stakeholder window

### Milestone 6 — Advanced Mining Intelligence (16 weeks)
- Sentinel-2 site overlays + drone-imagery ingestion
- Geological-confidence model from drill-hole logger
- Scenario simulation (multi-site, multi-FX)
- Investor / bank pack generator
- Multi-company group dashboards
- Cooperative-hub white-label

> **Total: ~62 weeks** to v1.0 "Mining Company Brain" with a usable product at every milestone. Single-engineer worst case 18 months; pair / small team comfortably 9–12.

---

## 22 · Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Regulator data not available (Mining Commission cadastre, NEMC list) | high | medium | manual periodic ingestion; rate-limited scrape; pursue MoU with Mining Commission |
| BoT FX rules change | medium | medium | Compliance Agent updates citation library; rule-engine isolates impact |
| Fingerprint legal-status challenge | low | high | only render as "person authorisation", never imply government stamp; cite Electronic Transactions Act inline |
| Low literacy in user base | medium | medium | voice-first; Swahili-first; image-rich UI |
| Power / connectivity in field | high | low | offline-first PWA + edge sync; ≤ 4 G fallback |
| AI hallucination on legal advice | medium | high | every legal claim must cite a regulation; Auditor Agent kills uncited claims |
| Owner over-relies on AI for safety / environment | medium | high | every safety/EHS output requires human-supervised sign-off; ICMM CCM critical-controls cross-reference |
| Marketplace fraud / mis-rating | medium | medium | KYC required for listings; rating decay; dispute-resolution flow |
| Competing big-platform entry (Microsoft, BHP-backed) | low | high | own the SME tier with Swahili + fingerprint + cooperative integrations |
| Mercury-related liability | medium | high | refuse to give operational mercury advice that increases exposure; only abatement |

---

## 23 · Differentiation summary

| Vs | Difference |
|---|---|
| Caterpillar MineStar, Wenco, Modular Mining | Strategy + documents + FX + community; not just fleet telemetry |
| Deswik, MICROMINE, Hexagon | Owner-facing, AI-first, SME-priced; not engineer-only modelling |
| Sage X3 Mining, IFS, Dynamics 365 Mining | Mining-native domain model with EPP, village minutes, fingerprint letters, Swahili |
| Levin Sources Delve, ITSCI, Minexx | Operating system + advisory, not only traceability |
| KoBold Metals, Earth AI, GoldSpot | SME execution platform, not LSM-only exploration AI |
| Generic ERPs | Domain depth — PL/PML lifecycle, NEMC EPP, BoT FX, ICMM CCM are first-class concepts |
| Government online portals | Owner-side intelligence layer that *talks to* portals and synthesises across them |

---

## 24 · Open questions for v0.2 of this spec

1. Do we ship a v1 with **no government-portal integration** (manual control numbers + manual uploads), or do we negotiate an MoU with the Mining Commission early?
   *User has confirmed: no government integration in MVP. Boji explains the manual steps with the same rigor as if it were auto-filing.*
2. Single-tenant Postgres + RLS, or per-tenant Postgres schema, or per-tenant database?
3. Build our own Swahili LLM fine-tune (Inkuba / Aya / Jacaranda) or stay multilingual-only on frontier models?
4. Offer escrow as a Boji service (regulated), or stay as integration partner with banks?
5. Cooperative-hub: revenue-share or seat-license?
6. Drone integration in M5 or M6?
7. Do we list **gold-only** in MVP or include gemstones from day one? (recommend gold-only initially, given highest IIED-documented urgency, then add tanzanite/gemstone playbook in M3)
8. Brand & domain — `boji.ai` vs `bojiai.com` vs `boji.co.tz`?

---

## 25 · Glossary

| Term | Meaning |
|---|---|
| ASM | Artisanal and Small-Scale Mining |
| BoT | Bank of Tanzania |
| EIA | Environmental Impact Assessment |
| EPP | Environmental Protection Plan (PML holders, Mining (Environmental Protection for Small-Scale Mining) Regulations 2010) |
| FEMATA | Federation of Miners Associations of Tanzania |
| FMS | Fleet Management System |
| GST | Geological Survey of Tanzania |
| JORC | Joint Ore Reserves Committee (Australian resource-reporting code) |
| LBMA | London Bullion Market Association |
| LMBM | Living Mining Business Map (Boji's core artefact) |
| LSM | Large-Scale Mining |
| ML | Mining Licence |
| MM | Ministry of Minerals (formerly MEM) |
| NEMC | National Environment Management Council |
| NSR | Net Smelter Return |
| OSHA | Occupational Safety and Health Authority (TZ) |
| PL | Prospecting Licence |
| PML | Primary Mining Licence (small-scale, < USD 100k capital, < 10 ha) |
| ROM | Run-of-Mine |
| SIC | Short Interval Control |
| SML | Special Mining Licence |
| SSM | Small-Scale Mining |
| STAMICO | State Mining Corporation |
| TAMIDA | Tanzania Mineral Dealers Association |
| TAWOMA | Tanzania Women Miners Association |
| TIB | Tanzania Investment Bank |
| Tume ya Madini | Mining Commission |

---

## 26 · References

Primary:

- Mutagwaba, W., Tindyebwa, J., Makanta, V., Kaballega, D., Maeda, G. (2018) *Artisanal and small-scale mining in Tanzania — Evidence to inform an 'action dialogue'.* IIED Research Report 16641. https://www.iied.org/16641iied — read in full, cited inline throughout §2 above.

Tanzanian law and regulation (to be enriched by the live research agents):

- The Mining Act, 2010 (Cap 123) (as amended 2017, 2018, 2024)
- The Mining (Mineral Rights) Regulations, 2018
- The Mining (Minerals and Mineral Concentrates Trading) Regulations, 2018
- The Mining (Local Content) Regulations, 2018
- The Mining (Mineral Beneficiation) Regulations, 2018
- The Mining (Audit and Inspection of Records) Regulations, 2018
- The Mining (Environmental Protection for Small-Scale Mining) Regulations, 2010
- The Natural Wealth and Resources (Permanent Sovereignty) Act, 2017
- The Natural Wealth and Resources Contracts (Review and Re-negotiation of Unconscionable Terms) Act, 2017
- The Environmental Management Act, 2004 + EIA Regulations 2018
- The Land Act, 1999; the Village Land Act, 1999; the Land Use Planning Act, 2007
- The Occupational Health and Safety Act, 2003
- The Electronic Transactions Act, 2015
- BoT Foreign Exchange Regulations, 2024
- Minamata Convention on Mercury (TZ signatory)

Strategy / technology (to be enriched by live agents):

- McKinsey & Co — *The mine-to-market value chain: a hidden gem.*
- BCG — *The AI-Powered Mining and Metals Company* (2026)
- Deloitte — *Digital transformation in mining* (2026)
- Microsoft Cloud blog — *Embracing AI and adaptive cloud to drive digital transformation in mining* (2025)
- Reuters — Codelco / Microsoft AI agreement, 2025-03-05
- ABB — *Digitalization of Short Interval Control and Production Scheduling in mining*
- Deswik — Operations software (IOM / SIC connectors)
- GroundHog — *Short Interval Control for Mining*
- Global Mining Guidelines Group — SIC case studies
- ICMM — *Health and safety critical control management: good practice guide*
- IFC — *Environmental, Health, and Safety Guidelines for Mining*
- Spatial Dimension — Tanzania online mining cadastre portal
- arXiv 2605.13702 — Adaptive mine planning under geological uncertainty (POMDP)

> All of the above are starting points. The Boji team must maintain a living research register; every regulatory citation must be auto-versioned in the Compliance Agent's citation library.

---

# Appendix A · The seven mega-flows in pseudo-state-machine form

Provided here so the engineering team can implement them as Boji workflows directly.

### A.1 Pre-licence
```
state = NEW_SITE_CANDIDATE
  ▸ capture coordinates ─► CHECK_OVERLAP
CHECK_OVERLAP
  ▸ no overlap ─► PRE_APPLICATION
  ▸ overlap    ─► SUGGEST_ALTERNATIVE
PRE_APPLICATION
  ▸ collect KYC, gen district-intro letter, payment, control number ─► PML_PENDING
PML_PENDING
  ▸ PML issued ─► VILLAGE_MEETING_PENDING
VILLAGE_MEETING_PENDING
  ▸ minutes + fingerprint sign-offs ─► EPP_PENDING
EPP_PENDING
  ▸ EPP filed + NEMC sign-off ─► READY_TO_OPERATE
```

### A.2 Road negotiation
```
ROAD_NEEDED → enumerate crossed parcels → per parcel { agreement letter + fingerprint sign } → schedule clearing job → execute → road open
```

### A.3 Determination
```
LOCAL_PROSPECTING → SAMPLES_TAKEN → LAB_ORDERED → ASSAY_BACK → CONFIDENCE_RECOMPUTED → DECISION (continue / pause / kill)
```

### A.4 Planning
```
GO_AHEAD → SECTIONISE → SIMULATE → SCHEDULE → BOOK_EQUIPMENT → BOOK_OFFICERS → READY
```

### A.5 Excavation / QC / on-loading
```
SHIFT_START → SUPERVISOR_PING (hourly) → SHIFT_END_REPORT → AI_DEVIATION_ANALYSIS → TOMORROW_PLAN
ONLOAD_REQUEST → OFFICER_BOOKED → WEIGHBRIDGE_IMAGE → SALE_LETTER → PAYMENT → CLOSE_BATCH
```

### A.6 Sales / FX
```
PARCEL_READY → BUYER_BIDS → SIM_SELL_NOW_VS_STOCKPILE → DECISION → EXECUTE_SALE → PAYMENT → NSR_BOOKED
```

### A.7 Marketplace & external window
```
LIST | DISCOVER | RATE | MESSAGE (Swahili ↔ EN ↔ ZH) | TRANSACT
```

---

# Appendix B · Compliance hot-paths (TZ-specific defaults)

These are the rules the Compliance Agent enforces by default; every value will be parameterised in the citation library so that legal updates do not require code changes.

* Mining within 60 m of water source → block + cite EMA 2004 / NAWAPO 2002 (IIED 16641 p. 69)
* PML capital threshold ≤ USD 100,000 → flag if reported capex above; cite Mining Act 2010 §4
* Renewal window for PML: T-90 to T-30 days before expiry → schedule pack assembly automatically
* EPP for PML required within 4 months of grant → auto-task + countdown
* Mine closure plan accrual → recommended (not yet legally required for PML in 2010 Act, but IIED §7.2 recommends and 2024 amendments may change)
* Royalty + inspection: gold 6% + 1% inspection (Mining (Mineral Rights) Regulations 2018; to be verified by live regulation agent)
* Gold mandatory sale to BoT/Mineral Trading Centre route → enforced in Sales Agent
* Mercury use → discourage; advise retort + banded washing; Minamata-aligned (binding on TZ since 16 Aug 2017)
* Local-content procurement: prefer Tanzanian-owned suppliers (Mining (Local Content) Regulations 2018)
* Foreign exchange: domestic TZ transactions in TZS (BoT FX Regs 2024)

---

# Appendix C · Boji's Master Brain system-prompt skeleton

```
You are Boji — a Master Mining Brain serving {owner.name}'s {company.count} mining {company|companies}.

Living Mining Business Map summary:
{lmbm.summary()}     // graph-derived; cached; refreshed on every event

Owner profile:
- minerals: {owner.minerals}
- risk appetite: {owner.risk_appetite}
- capital band: {owner.capital_band}
- horizon: {owner.horizon}

Current mode: {mode}  // Build | Strategy | Operations | Document | Finance | Risk | Board

Decisions pending owner approval: {decision_log.pending(top=5)}
Critical risks: {risk.critical()}
Cash runway: {treasury.runway_days} days
Highest-confidence site: {portfolio.top_site()}
Lowest-confidence site: {portfolio.bottom_site()}

When the owner speaks:
1. Classify intent.
2. If a decision engine applies, call relevant juniors in parallel.
3. Synthesise their results; cite each junior's evidence_ids.
4. Return a Recommendation { rec, confidence, evidence_ids, assumptions, alternatives, decision_owner }.
5. Never fabricate. If evidence is missing, ask one specific question OR create a task to collect it.
6. Speak in the owner's preferred language (default Swahili).
7. If a recommendation depends on a TZ regulation, cite the act + section.
8. If a recommendation depends on FX, cite the FX timestamp.
9. Refuse to give unsafe operational instructions (explosives, mercury exposure-increasing, illegal export routes).

You can spawn these juniors via the tool API: [list].
You can write to LMBM via [list].
You can create tasks via [list].
You can schedule reminders via [list].
You can render letters via [list].

Audit: every action you take is logged to decision_log with a chain of evidence.
```

---

# Appendix D · Why "Mining Company Brain" matters in one paragraph

The IIED report's most repeated finding is that ASM/SSM operators in Tanzania are not lazy and not unwilling — they are **information-, document-, geology-, and capital-blind, simultaneously**. Every existing intervention (decentralised licensing, NEMC EPP guidelines, MM ASM portal, government grants, training, centres of excellence, dispute resolution) addresses one piece of that blindness. None creates a continuously updating, owner-side mental model that ties licence → village → EPP → vein → cost → cash → buyer → FX into one decision-making organism. **Boji AI is that organism.**

---

# Appendix E · Research Dossier (v0.2)

> Consolidated, citation-backed findings from six parallel deep-research agents run on 17 May 2026. Each sub-section captures one agent's brief verbatim-of-substance (compressed to the highest-leverage claims) with the live URLs preserved. Every assertion in the main body of this spec that is not directly traceable to IIED 16641 ties back to one of these six dossiers. Treat this appendix as the **Compliance Agent's citation library at launch** — versioned, dated, and inspectable.

## E.1 — Tanzanian mining regulation 2025/2026 (deep)

### Licence types — current eligibility, area, term, renewal, key obligations
* **PL — Prospecting Licence:** anyone (foreign-OK); ≤ 2,000 km²; initial **4 years** + 3 + 2 (max 9); **50% area relinquishment at each renewal**; cancellation on 90-day non-commencement, non-payment of rent, breach of EPP, dormancy at 18 months. Source: [Tume ya Madini — Application Procedures](https://www.tumemadini.go.tz/pages/applicationprocedure/), [Rive & Co — PL Procedures](https://www.rive.co.tz/application-for-prospecting-licence-pl-procedures-in-tanzania/).
* **PML — Primary Mining Licence:** **Tanzanian citizens only** (individual or 100% TZ-owned co); ≤ **10 ha**; **capital ≤ USD 5m**; **7 years**, renewable; mandatory EPP, mine-closure/rehab liability, royalty + 1% inspection. Source: [Tume ya Madini](https://www.tumemadini.go.tz/pages/applicationprocedure/), [GERPAT Solutions](https://gerpatsolutions.co.tz/mining-licences-acquired-in-tanzania-the-comprehensive-guide/).
* **ML — Mining Licence:** companies, capital > USD 100k and ≤ USD 100m; 10 years renewable; EIA-approved by NEMC; feasibility study, CSR plan with LGA, 16% state free-carried interest, local-content plan.
* **SML — Special Mining Licence:** capital > USD 100m; issued on Cabinet approval; term = life-of-ore; Framework Agreement with Government; 16% non-dilutable free-carried + up to 50% via tax-for-equity; full EIA + closure bond + 20% mandatory domestic gold trade if a gold producer. Source: [Bowmans — State Participation Regulations 2022](https://bowmanslaw.com/insights/tanzania-mining-state-participation-regulations-2022-published/), [Clyde & Co — Free-Carried Interest TZ](https://www.clydeco.com/en/insights/2024/02/the-concept-of-free-carried-interest-tanzania).
* **Processing / Smelting / Refining licences** required for in-country value addition; 2024 directive: **no ML/SML without local value-addition plan**. BoT-designated refineries: Geita Gold Refinery, Mwanza Precious Metals Refinery, Eyes of Africa.
* **Dealer / Broker / MTC channel:** all gold, tin, diamond, tanzanite, coloured gemstones must trade through Mineral Trading Centres and Buying Stations; broker may not take physical possession or export.
* **FY 2024/25 throughput:** 8,501 licences issued; 14 revoked; 95 warned; 118 PL default notices; 41 ML default notices. Source: [TanzaniaInvest — 2024/25 Licence Statistics](https://www.tanzaniainvest.com/mining/mining-licences-2024-2025-issued-revoked-warnings).

### Mining Commission, cadastre, GePG
* Mining Commission (Tume ya Madini) — establishes Mineral Licensing and Information Systems department; runs the **online cadastre** at `portal.tumemadini.go.tz/portal/` (and legacy `portal.madini.go.tz/map/`). Source: [Tume ya Madini](https://www.tumemadini.go.tz/about-us/functions/), [Spatial Dimension](https://www.spatialdimension.com/articles/tanzania-online-mining-cadastre-portal-launched).
* **GePG (Government Electronic Payment Gateway)** — every royalty, rent, inspection and clearance fee paid against a **Control Number**; channels include M-Pesa, Tigo Pesa, Airtel, HaloPesa, and bank counters. Source: [GePG Tanzania](https://epay.gepg.go.tz/), [ClickPesa explainer](https://clickpesa.com/understanding-gepg-in-tanzania-what-it-is-how-it-works-and-why-it-matters/).
* Sister institutions: **GST** (Geological Survey of Tanzania; 2nd-edition Industrial Minerals Book Nov 2024), **STAMICO** (state mining corporation; geological data programme to derisk lending), **NEMC** (EIA / EPP), **TRA** (collects royalty via GePG), **TEITI** (transparency reporting). **TMAA was absorbed into the Mining Commission in 2017**.
* **Sector revenue FY 2023/24:** TZS 753.82 bn collected (85.45% of TZS 882.1b target); royalties = TZS 582.9bn; inspection fees = TZS 106.2bn; **FY 2024/25 target ~TZS 1 trillion**.

### Royalties (statutory schedule, gross-value basis)
| Mineral | Royalty | Source |
|---|---|---|
| Gold raw export | **6%** | [Tume ya Madini — Royalties & Inspection Fees](https://www.tumemadini.go.tz/pages/mineral-royalties-and-inspection-fees-rates/) |
| Gold to in-country refinery | **4%** | same |
| Gold under BoT Domestic Gold Programme | **4% + 0% inspection + 0% VAT** | [FB Attorneys — BoT Gold Programme](https://fbattorneys.co.tz/bot-issues-notice-on-gold-purchase-program-in-tanzania/) |
| Diamonds, uncut gemstones, rough tanzanite | 5% | [Lexology](https://www.lexology.com/library/detail.aspx?g=398c68a3-74b3-441f-8888-169a3ffee73a) |
| Cut/processed gemstones (incl. cut tanzanite) | 1% | same |
| Uranium | 5% | same |
| Other metallic minerals (Ni, Co, Fe, REE, graphite as metallic) | 6% | same |
| Coal — domestic / export | 1% / 3% | same |
| Industrial (limestone, gypsum, salt, soda ash, phosphate, sand, dimension stone) | 3% | same |
| Renewably-produced salt + env-levy paid | exempt | same |
| **+ Clearance/Inspection fee** | **1% gross** on every consignment | [TanzaniaInvest — 1% Clearing Fee](https://www.tanzaniainvest.com/mining/1-percenyt-clearing-fee-mineral-export) |
| **+ HIV Response Levy (new FY 25/26)** | **0.1% gross** | [EY Finance Act 2025](https://www.ey.com/en_gl/technical/tax-alerts/tanzanian-finance-act-2025-analysis), [KPMG Budget Brief](https://assets.kpmg.com/content/dam/kpmg/ke/pdf/tax/2025/Tanzania_2025_2026_Budget_Brief.pdf) |
| **+ Local-Government Service Levy** | up to 0.3% turnover | Lexology |

Effective burden on unrefined gold export ≈ **9.4%**; under BoT route ≈ **4.4%** with **24-hour TZS settlement**.

### Mineral trading & export
* Mandatory MTC channel; export documents include Export Permit, Certificate of Origin (tanzanite), **Tanzania Kimberley Process Certificate** (diamonds), **ICGLR Certificate** (Sn/Ta/W), GMO valuation receipt; surrender of permit to Customs/Postmaster at exit. Source: [Tume ya Madini — Export Procedures](https://www.tumemadini.go.tz/pages/procedures-for-exportation-of-minerals/).
* **20% mandatory domestic set-aside for gold** under amended *Mining (Minerals and Mineral Concentrates Trading) Regulations* (eff. 1 July 2024) — **failure means no export permit**. Source: [FB Attorneys](https://fbattorneys.co.tz/bot-issues-notice-on-gold-purchase-program-in-tanzania/), [Bloomberg](https://www.bloomberg.com/news/articles/2025-06-12/tanzania-wants-large-miners-to-refine-trade-20-of-gold-locally).
* BoT Domestic Gold Purchase Programme: ~**5,022 kg / USD 554m purchased by mid-2025** (beyond the USD 350m initial target). Source: [TanzaniaInvest](https://www.tanzaniainvest.com/mining/central-bank-gold-purchase-miners), [Chanzo, 17-Jun-2025](https://thechanzo.com/2025/06/17/bank-of-tanzania-boosts-gold-reserves-with-new-agreements-to-strengthen-gold-purchase-programme/).

### Foreign-exchange regime
* **Finance Act 2024** inserted s.26(2) BoT Act criminalising non-TZS domestic transactions. **GN 198 of 2025 (Foreign Currency Usage Regulations 2025)** gazetted **28 March 2025** operationalises it. **27 March 2026** is the legacy-contract repaper deadline. Penalty up to **TZS 4m or 14 years' imprisonment**. Sources: [Clyde & Co](https://www.clydeco.com/en/insights/2025/03/new-regulations-on-foreign-currency-use-tanzania), [Bowmans](https://bowmanslaw.com/insights/tanzania-amendment-to-the-foreign-exchange-regulations/), [Dentons](https://www.dentons.com/en/insights/alerts/2025/april/25/tanzania-enacts-sweeping-restrictions-on-foreign-currency-transactions), [ALN Tanzania (8 Apr 2025)](https://aln.africa/wp-content/uploads/2025/04/Impact-of-2025-Foreign-Currency-Usage-Regulations-in-Tanzania-Tanzania-Legal-Insight-ALN-Tanzania-8.4.25.pdf), [PwC TZ](https://www.pwc.co.tz/press-room/regulations-on-foreign-currency.html), [Auditax](https://auditaxinternational.co.tz/tanzania-issues-foreign-currency-usage-regulations-2025-gn-no-198-of-2025/), [Mondaq](https://www.mondaq.com/contracts-and-commercial-law/1772854/tanzania-foreign-currency-regulations-2025-what-businesses-must-know-about-the-tzs-mandate).

### EPP / EIA
* **PML → EPP** (Mining (Environmental Protection for Small-Scale Mining) Regulations 2010 §3) within 4 months of grant. **>90% of PMLs default on this** (IIED 16641 §6.3). Sign-off chain: NEMC-registered EIA expert → DEMO → NEMC Zonal Office.
* **GN 260 of 2025 (Mining (Technical Support for PML Holders) Regulations 2025)** formalises a **Facilitator role**: 90 days for mining plan, 120 days for EIA-equivalent plan; **30% gross-profit floor** in any facilitation deal. Sources: [Velma Law](https://velmalaw.co.tz/news/technical-support-for-small-scale-miners-regulations-2025/), [Bowmans](https://bowmanslaw.com/insights/tanzania-mining-technical-support-for-primary-mining-licence-holders-regulations-published/).
* **ML / SML → full EIA** under EMA 2004 + EIA & Audit Regulations 2005 (updated 2018, 2024). Dual-bond regime: Rehabilitation Bond (Mining Act) + Decommissioning Bond (NEMC EPB Regulations 2024). Mine Closure Guidelines 2019.

### Land, surface rights, CSR
* **Land Act 1999 + Village Land Act 1999** — three categories: General, Reserved, Village. Village governs communal/individual (CCRO)/reserved. Mining Act takes precedence on subsurface; holder pays compensation for surface improvements under **Land (Assessment of the Value of Land for Compensation) Regulations 2001 (L.N. 78/2001)** as amended 2017. Components: market value (Registered Valuer) + unexhausted improvements (crops, trees, structures by schedule) + **disturbance allowance** (12-month bank fixed-deposit rate × land value) + **transport allowance** (12 t × 20 km × freight rate) + **accommodation allowance** (36 × monthly rent) + **loss-of-profit allowance** (36 × monthly net profit).
* **CSR Plan — Mining Act s.105 + Mining (CSR) Regulations 2023 (GN 409/2023)** as further amended **January 2026** (Clyde & Co update). Process: CSR Committee 14 days → District/Town/Municipal/City Council 7 days → Ministers (LGAs + Finance) 30 days. **March 2026 High Court invalidated** the rigid 40% village + 60% district split — CSR allocation is now negotiable. Sources: [Bowmans — Mining CSR 2023](https://bowmanslaw.com/insights/tanzania-the-mining-corporate-social-responsibility-regulations-2023/), [Clyde & Co — CSR Amendments Jan 2026](https://www.clydeco.com/en/insights/2026/01/legal-update-tanzania-amendments-to-the-mining-cor), [African Mining Market — High Court ruling](https://africanminingmarket.com/tanzania-high-court-invalidates-corporate-social-responsibility-allocation-framework-under-mining-regulations/25116/).

### Local content
* **Mining (Local Content) Regulations 2018**, amended through **GN 563 of 2025 (12 Sept 2025 effective)**. ITC = ≥ 20% Tanzanian-citizen equity, **80% senior management Tanzanian, 100% non-managerial Tanzanian**. **Reserved-list (Reg 13A)** — some goods/services for **100% Tanzanian-owned ITCs only** (no JV cures non-indigenous participation). Mandatory **JV minimum 20%** ITC equity for non-indigenous suppliers; **Commission pre-approval** of JV agreements; sole-sourced contracts > **USD 10,000** notified to Commission; **5% ITC equity in the mining company itself**; local-content plan deemed approved after **50 working days** silence. Sources: [Clyde & Co GN 563/2025](https://www.clydeco.com/en/insights/2025/09/amendment-to-the-mining-local-content-regulations), [Dentons](https://www.dentons.com/en/insights/alerts/2025/november/27/mandatory-reservation-of-goods-and-services-in-the-mining-sector-for-indigenous-tanzanian-companies), [ALN](https://aln.africa/insight/mining-local-content-amendment-regulations-2025-key-changes-and-implications/), [Mondaq](https://www.mondaq.com/mining/1762932/tanzania-mining-local-content-regulations-2025-what-foreign-investors-must-know-about-the-new-jv-rules).

### Enforcement themes 2024–2026
* **Dormancy crackdown:** Notices of Breach 14 April 2025 → 13 May 2025 deadline; 95 large/medium-scale licences warned; 7 dormant licences = TZS 15 T potential investment.
* **40 PLs cancelled** covering **188,000+ ha** (15 Apr 2025); Minister Mavunde announced **automation of next revocation round** — biggest 2026 cadastre development. Source: [Uchumi360](https://uchumi360.com/mining/policy-regulation/tanzania-revoked-40-mining-licences-covering-188000-hectares-on-april-15-the-day-after-the-minister-said-the-next-round-will-be-automated-that-second-announcement-is-the-more-consequential-story).
* **73 additional licences revoked** Nov 2025 to reallocate to youth mining programmes. Sources: [The Citizen](https://www.thecitizen.co.tz/tanzania/news/national/tanzania-revokes-73-mining-licences-in-renewed-crackdown-on-dormant-operators-5276816), [BizLens](https://thebizlens.co.tz/2025/11/25/tanzania-cancels-73-inactive-mineral-licences-to-boost-youth-mining-programmes/).
* **227 ML/SML applications revoked** May 2024 + "**no ML/SML without local value-addition plan**" directive.
* **Minamata NAP 2020–2025** mercury phase-out; 13.2–24.4 t/year mercury still estimated in TZ ASGM. Source: [Minamata Convention — TZ NAP](https://minamataconvention.org/sites/default/files/documents/national_action_plan/TANZANIA-NAP-EN-2020.pdf).

### Cross-border
* **Ghana — GoldBod Act 1140/2025** (eff. 1 May 2025) — sole authority for ASM gold licensing, aggregation, assay, export; targeting 127 t ASM gold/year, ~USD 20 bn FX. Sources: [Clinton Consultancy](https://clintonconsultancy.com/2025/04/16/clintonconsultancy-com-goldbod-regulatory-update-2025/), [Lawyard](https://www.lawyard.org/blog-articles/ghana-gold-board-act-2025-a-bold-step-to-transform-the-nations-gold-sector/), [MINING.COM](https://www.mining.com/web/ghana-targets-127t-of-artisanal-gold-annually-under-sweeping-reforms/).
* **DRC** — ASGM formalisation push via SAEMAPE; ~74% cobalt exports to China; trader pre-finance dominant; 87,000 t cobalt quota 2026–27. Sources: [Bloomberg](https://www.bloomberg.com/features/2025-congo-china-cobalt/), [Fastmarkets](https://www.fastmarkets.com/insights/drc-cobalt-export-quotas-2025/).
* **Kenya** — Mining Act 2016 + ASM Regs 2017 — Cooperative-based ASM Permits; online cadastre (TZ-pattern).
* **Zambia** — 680 ASM rights in 2024 (vs 304 in 2023); Local Content Regulations 2025 draft. Source: [Veridicor](https://veridicor.com/2025/09/09/artisanal-and-small-scale-mining-in-zambia-sector-analysis/).
* **South Africa** — Mineral Resources Development Bill 2025 (replaces MPRDA 2002, introduces explicit ASM permit regime).

## E.2 — FX, treasury, unit economics for SME mineral producers

* **TZS/USD 2026:** End-2024 ~TZS 2,445/USD; May 2026 spot ~TZS 2,595–2,605/USD; 52-week range 2,415–2,708; **BoT Central Bank Rate 5.75% Q1 2026**; **GDP growth 5.9% in 2025**; **mining credit grew 91.1% YoY to Dec 2025**. Sources: [FocusEconomics](https://www.focus-economics.com/country-indicator/tanzania/exchange-rate/), [Investing.com USD/TZS](https://www.investing.com/currencies/usd-tzs-historical-data), [TradingEconomics](https://tradingeconomics.com/tanzania/currency), [TanzaniaInvest — Q1 2026](https://www.tanzaniainvest.com/economy/central-bank-rate-q1-2026), [The Citizen — Mining credit 90%+](https://www.thecitizen.co.tz/tanzania/business/why-credit-growth-to-tanzania-s-mining-sector-has-topped-90-percent-5381970), [TanzaniaInvest — Banking 2025 Review](https://www.tanzaniainvest.com/finance/banking/banking-sector-2025-performance-review-unaudited-aml).
* **CRDB × Mining Commission MoU (23 Feb 2026)** — flexible-collateral lending against mining licences, gold reserves, contracts. CRDB has disbursed **TZS 186 bn (136 large + 50 small)**. Source: [TanzaniaInvest](https://www.tanzaniainvest.com/mining/small-scale-miners-financing-crdb-mining-commission-agreement).
* **No hedging instruments at SME scale** — treasury must be operational, not financial; natural hedges via USD-linked stockpiles, BoT-window timing, supplier-payment timing.
* **LBMA gold:** twice-daily fix in USD/oz of 995 gold; African artisanal doré **2–8% discount** to Good Delivery; major refineries Rand Refinery, Metalor, Argor-Heraeus, Valcambi, PAMP; refining fees ~USD 0.50–1.50/oz; lot tolerances ±0.05% Au. Source: [LBMA Gold Price](https://www.lbma.org.uk/prices-and-data/lbma-gold-price), [LBMA OTC Guide §4](https://www.lbma.org.uk/publications/the-otc-guide/the-price).
* **Gemstones:** flows through Tucson (Feb), Hong Kong (Mar/Sep), Bangkok (Sep), Geneva (May/Nov auctions); **Bonas Group** Geneva tender for top tanzanite grades; D-block AAA vs B can be 50× per-carat. Sources: [Rapaport](https://rapaport.com/magazine-article/a-sparkling-outlook-for-the-2025-gem-market/), [Bonas Group](https://www.bonasgroup.com/en/tender-and-auction-sales/gemstones), [Bangkok Gems Market](https://www.bangkokgemsmarket.com/blogs/fun-read/gem-show-guide-2025), [ICA Tucson 2026](https://www.gemstone.org/ica-exhibitors---tucson-2026).
* **Industrial minerals:** copper on LME cash official (TC/RC at record lows 2025); REE on **Fastmarkets** + **Argus**; cobalt prices doubled in 2025, cobalt-hydroxide quadrupled (DRC quota). Sources: [Fastmarkets LME Week 2025](https://www.fastmarkets.com/insights/copper-concentrates-benchmark-lme-week-2025/), [Fastmarkets Rare Earths](https://www.fastmarkets.com/metals-and-mining/rare-earths-prices-and-news/), [Fastmarkets — Cobalt 2026 preview](https://www.fastmarkets.com/insights/dried-up-feedstock-pipeline-cobalt-prices-soaring-2025-deficit/).
* **NSR formula:** `NSR = Grade × Price × Recovery − (TC + RC × Grade) − Transport − Royalty − Insurance`. Sources: [Queens MineDesign Wiki](https://minewiki.engineering.queensu.ca/mediawiki/index.php/Net_smelter_return), [911 Metallurgist NSR PDF](https://www.911metallurgist.com/wp-content/uploads/2016/03/NSR-Net-Smelter-Return.pdf), [AllMinings](https://allminings.com/net-smelter-return/).
* **Unit-economics framework:** cost / m advanced (USD 800–3,500/m underground); cost / BCM overburden (USD 1.50–5.00 SME open-pit); cost / t ROM; cost / t milled (USD 25–60/t SME gold CIL); cost / recoverable gram (≈ USD 12/g at 3 g/t @ 85% recovery @ USD 30/t mill cost); **break-even grade** swings ~15% per 0.5 g/t variation.
* **Working capital:** fuel float dominant (200-hp excavator ~7,500 l/month ≈ TZS 22.5 m ≈ USD 8.7k per excavator-month); supplier credit very short (fuel COD or 7 days; consumables 30 days); gemstone buyer terms 30–90 days — implicit funding cost 1.2–4.5% per invoice.
* **Off-take structures:** streaming agreements (long-term, sub-market unit price for a % of production), royalty finance (~6–7% of gross production for upfront), forward sale, equipment leasing (Cat Financial / Komatsu Financial), JV pre-finance, **trader advances** (15–30% implicit cost, ubiquitous in TZ gemstones and DRC cobalt). Sources: [Lexology — Streaming Agreements](https://www.lexology.com/library/detail.aspx?g=3119a668-e775-4638-b633-52aa10122691), [Lexology — Mine Finance in Africa](https://www.lexology.com/library/detail.aspx?g=cc1db36b-49ac-490a-9170-9d68aea275e6), [HSF Kramer](https://www.hsfkramer.com/insights/2024-01/beneath-the-surface-resourcing-our-future-royalties-and-streams-what-you-need-to-know), [Gowling WLG](https://gowlingwlg.com/en/insights-resources/articles/2021/alternative-mine-financing).
* **Stockpile-as-currency-hedge rule:** sell when (expected USD-gold appreciation + TZS depreciation, next 30 d) < monthly cost of carry (storage + insurance + WACC × value). For most SMEs break-even is at ~1.5–2.0% expected monthly move.
* **Cost-of-capital baseline:** commercial bank 15–19%, microfinance 22–30%, equipment leasing 14–18%, mobile-money float ~4–8%/month, informal "uchaguzi" 3–10%/month.
* **Tax:** CIT 30%; royalty (per schedule); 1% inspection (waived under BoT); **0.1% HIV Response Levy new FY25/26**; **VAT 18%, zero-rated under BoT gold programme**; VAT withholding from 1 July 2025 (3% goods / 6% services); ring-fencing per mineral right (Mining Act, applied 40+ years). Sources: [PwC Tanzania CIT](https://taxsummaries.pwc.com/tanzania/corporate/taxes-on-corporate-income), [TRA Taxes at a Glance 2025/2026](https://www.tra.go.tz/images/uploads/pages/TAXES_AND_DUTIES_AT_A_GLANCE_2025_2026.pdf), [EY — Finance Act 2025](https://www.ey.com/en_gl/technical/tax-alerts/tanzanian-finance-act-2025-analysis), [KPMG — TZ Budget 2025/26](https://assets.kpmg.com/content/dam/kpmg/ke/pdf/tax/2025/Tanzania_2025_2026_Budget_Brief.pdf), [Afriwise](https://www.afriwise.com/blog/tanzania-tax-update-finance-act-2025-highlights), [OECD Ring-Fencing Toolkit Jul 2025](https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/07/ring-fencing-mining-income_5404dcb9/176481fc-en.pdf).

## E.3 — Mine-to-Market, Short-Interval-Control, FMS, Mine Planning

* **Mine-to-Market (M2M):** 11 integrated levers can lift **EBITDA 10–15%** (planning integration, throughput, recovery, blend conformance, logistics, contract conformance, working capital, ...) — McKinsey 2020 framework, reused in 2024 "OptimusAI" practice. Source: [McKinsey M2M](https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mine-to-market-value-chain-a-hidden-gem), [Mining Digital recap](https://miningdigital.com/digital-mining/mckinsey-embrace-value-chain-and-boost-ebitda-10-15), [Deloitte TtT 2025](https://www.deloitte.com/cbc/en/about/press-room/tracking-the-trends-report-2025.html).
* **SIC cadence:** pre-shift plan → hourly or 2-hourly check-ins → mid-shift bottleneck review → end-of-shift reconciliation → handover. GroundHog reports **30%+ productivity uplift** from disciplined SIC. Standard 15–25 deviation codes (mechanical, electrical, operational, weather, blast, fuel, road, blast-clearance, change-of-operator). 80% of stoppages historically resolvable within one shift. Sources: [GroundHog SIC](https://groundhogapps.com/groundhog-short-interval-control/), [GroundHog Open Pit](https://groundhogapps.com/sic-for-open-pit/), [ABB OMS SIC](https://new.abb.com/mining/digital-applications/operations-management-system-oms-for-mining/digitalization-of-short-interval-control-(sic)-and-production-scheduling-in-mining), [Deswik ORB](https://www.deswik.com/en-au/casestudies/world-s-first-highly-automated-short-interval-control-system-for-hard-rock-underground-mines), [Deswik IOM](https://www.deswik.com/news/an-integrated-and-scheduling-driven-approach-to-short-interval-control-in-mining/), [MICROMINE Pitram](https://www.micromine.com/pitram/), [Hexagon MineOperate](https://hexagon.com/products/product-groups/hxgn-mineoperate), [Nature Sci Reports 2025](https://www.nature.com/articles/s41598-025-88505-3).
* **FMS:** tier-1 stack (Cat MineStar, Modular DISPATCH, Wenco, Hexagon, Komatsu KOMTRAX, MICROMINE Pitram) costs USD 1m+ + ~USD 880k/yr licences; mid-tier Haultrax ~USD 300k capex + USD 150k/yr; SME-affordable telematics MiX / Cartrack from USD 30/unit beacons + smartphone-first. Sources: [Cat MineStar](https://www.cat.com/en_US/by-industry/mining/minestar-solutions.html), [Wenco](https://www.wencomine.com/), [Haultrax](https://haultrax.com/everything-you-need-to-know-fleet-management-systems/), [Cartrack mining](https://www.cartrack.co.za/blog/fleet-management-for-the-mining-industry), [MiX](https://www.mixtelematics.com/us/industries/mining/).
* **Mine planning leaders:** Deswik, MICROMINE (Origin Copilot 2024), Hexagon MinePlan, Maptek Vulcan (DomainMCF AI), Surpac (multilingual, emerging-market default), **Leapfrog 2025.1/2/3** + Seequent Evo cloud + Imago core-imagery ML, RPMGlobal XECUTE.
* **AI/RL planning:** RL truck dispatching now beats heuristic DISPATCH; **47% cash-flow uplift** in actor-critic truck-shovel allocation; POMDP multi-agent DDPG for ore blending. Sources: [MDPI 2025 multi-agent RL](https://www.mdpi.com/2075-1702/13/5/350), [Deep RL truck dispatching, ScienceDirect 2024](https://www.sciencedirect.com/science/article/abs/pii/S0305054824002879), [arXiv 1706.08264 OPMOSP](https://arxiv.org/abs/1706.08264), [Lamghari & Dimitrakopoulos](https://www.sciencedirect.com/science/article/pii/S0305054818302958).
* **Hauling/loading economics:**
  * **Haulage = 50–60% of total mine opex** ([GRT](https://globalroadtechnology.com/the-true-cost-of-poor-haul-road-maintenance/), [Mining Doc](https://www.miningdoc.tech/2025/05/22/effect-of-the-surge-loader-on-truck-productivity/)).
  * **Fuel = 30% of mine energy and up to 70% of engine LCC** ([Cummins](https://www.cummins.com/news/2021/03/11/improving-financial-performance-and-reducing-maintenance-costs)).
  * Tyres 40.00R57 = USD 30–50k each × 6 per truck; life 7–12 months; +1% rolling resistance → −10% speed; bad roads cut tyre life 30–50%.
  * **Match factor** = (truck arrivals) / (shovel service rate); published optimum **0.85–1.0**; **"excavator never idle"** mathematically defensible — shovel-idle is the most expensive minute on site. Sources: [Pathan 2025 Wiley](https://onlinelibrary.wiley.com/doi/full/10.1155/atr/7939037), [Transpara 10 KPIs](https://www.transpara.com/10-real-time-kpis-every-mine-hauling-operations-leader-should-keep-on-their-radar/).
* **Predictive maintenance:** single haul-truck downtime ≈ **USD 20,000/hr** ([Mining Digital PdM](https://miningdigital.com/digital-transformation/predictive-maintenance-reshaping-mining-operations)); Anglo American + IBM Maximo cut unplanned downtime up to **75%**; SME prescription: hour-based service schedule + periodic oil analysis (USD 30–60/sample) + vibration pucks + operator pre-start checklists.
* **AI mining 2025–2026 cycle:**
  * **Codelco × Microsoft** (Mar 2026) — 18-month MoU across all Chilean copper estate. Sources: [Mining.com](https://www.mining.com/codelco-microsoft-team-up-on-ai-analytics-initiatives/), [Energy News Mar 2026](https://energynews.oedigital.com/mining/2026/03/05/codelco-and-microsoft-sign-ai-agreement-for-mining-operations), [SME ME](https://me.smenet.org/codelco-microsoft-sign-ai-deal-for-mining-operations/).
  * **BHP AI Hub Singapore** (May 2025) + Escondida + Azure ML **USD 18.9m operational uplift** on copper recovery. Sources: [BHP Feb 2025](https://www.bhp.com/news/bhp-insights/2025/02/the-role-of-digital-twins-and-ai-in-enhancing-decision-making-in-the-mining-industry), [Microsoft Industry Blog Dec 2025](https://www.microsoft.com/en-us/industry/blog/energy-and-resources/mining/2025/12/08/transforming-mining-how-frontier-firms-lead-with-ai-and-agentic-innovation/).
  * **Freeport-McMoRan Bagdad** went **fully autonomous Oct 2025** — 33 trucks, projected 18% haulage efficiency + 22% accident reduction. Sources: [FCX Oct 2025](https://www.fcx.com/freeport-features/100125), [Sustainability Magazine](https://sustainabilitymag.com/news/freeport-mcmoran-ai-driven-autonomous-haulage).
  * **KoBold Metals** Series C **USD 537m at USD 2.96bn valuation** (Jan 2025); Mingomba copper discovery in Zambia. Source: [Reuters 15 Jan 2025](https://www.reuters.com/business/...).
  * **PML 2025 Technical Support Regulations (GN 260)** + 30% gross-profit floor for facilitators creates a structural opening for Boji to be the facilitator-platform.

## E.4 — EPP, community, geology, lab supply chain

* **EPP cycle 6–12 weeks; professional fees TZS 1.5–6 m**. Common rejection reasons (FADev, NEMC zonal reviews): missing baseline, inadequate rehab cost, no mercury protocol, protected-area overlap, no community consultation, no signed DEMO sheet, coordinate mismatch.
* **EIA tiered process for ML/SML:** registration → scoping → baseline (hydro, ecology, social, archaeology, air, noise) → draft EIS → public hearing → NEMC technical review → Minister (VPO) issues certificate → EMP conditions → bonds → annual audit → decommissioning → closure plan (Mine Closure Guidelines 2019).
* **Dual-bond regime** — Rehabilitation Bond (Mining Act, Reg 207) + Environmental Performance Bond (NEMC EPB Regulations 2024); bond release requires NEMC inspection within 90 days of decommissioning notice. Sources: [Mwebesa Law](https://mwebesalaw.co.tz/a-legal-quagmire-of-competing-bonds-prioritize-environmental-security-or-regulatory-efficiency/), [Clyde & Co 2024](https://www.clydeco.com/en/insights/2024/07/environment-management-regulations).
* **Compensation under L.N. 78/2001** (as amended 2017): market value + improvements + 12-mo bank deposit rate disturbance + transport (12 t × 20 km) + 36-month accommodation + 36-month loss-of-profit.
* **Village government meeting** — quorum per village constitution (commonly half plus one); thumb-print authorisation by illiterate signatories witnessed by VEO; common conflicts: family graves, standing crops, water-source fears, school proximity, sacred groves, footpaths.
* **CSR Plan timing — 14d Committee + 7d Council + 30d Ministers** under GN 409/2023. March 2026 High Court invalidated rigid 40/60 split.
* **Determination methods (Swahili artisanal vocabulary):** *kuona mishipa* (vein observation), *kuchimba mtaro* (hand-trenching), *kuchimba shimo* (hand-shaft), *kuchenjua* (panning), *kuchekecha* (sluicing), *kupiga ramli* (oral intelligence). Sources: [IPIS NW Tanzania](https://ipisresearch.be/wp-content/uploads/2019/01/1901-ASM-Tanzania_web%C2%AE.pdf), [IIED 16641](https://www.iied.org/sites/default/files/pdfs/migrate/16641IIED.pdf).
* **Drill rates:** RC ~USD 60–110/m; diamond core HQ/NQ ~USD 130–220/m in TZ.
* **Vein triangulation:** with ≥ 3 vein intersections, fit a planar vein; **V (m³) = L × W × T_true**, where **T_true = T_apparent × sin(angle between hole and vein plane)**; tonnes = V × SG (~2.7 t/m³ quartz reef); contained metal = tonnes × grade. Sources: [RockMass core logging guide](https://rockmass.net/files/core_logging_guide.pdf), [Marjoribanks core log sheets](http://rogermarjoribanks.info/diamond-drill-core-log-sheets/), [CIM Best Practice](https://mrmr.cim.org/media/1080/cim-mineral-exploration-best-practice-guidelines-november-23-2018.pdf).
* **Reporting codes:** JORC 2012 (Australia), NI 43-101 (Canada), SAMREC (SA) — all require a **Competent / Qualified Person** with ≥ 5 yrs deposit-style experience. Sources: [JORC 2012](https://www.jorc.org/docs/JORC_code_2012.pdf), [AusIMM CP review](https://www.ausimm.com/globalassets/downloads/jorc-competent-person---a-baseline-review-in-a-global-context-june-2022-final.pdf), [IMC reporting codes](https://imctucson.com/mineral-resource-and-reserve-reporting-codes/).
* **Labs:** SGS (Mwanza, fire-assay 15/30/50 g, 2025 expansion), Bureau Veritas (Mwanza/Geita prep), ALS (Mwanza prep), Intertek (Geita/Mwanza); **GST Dodoma** SADCAS ISO/IEC 17025:2017-accredited; **AMGC Dar es Salaam**; new **TZS 14.3 bn Kizota Dodoma lab** under construction (largest in E/C Africa). Sources: [SGS Tanzania](https://www.sgs.com/en-tz/services/fire-assay-analysis), [SGS Mwanza 2025 expansion](https://www.sgs.com/en-tz/news/2025/08/advancing-tanzania-mining-sector-sgs-enhances-testing-capabilities), [Intertek precious metals](https://www.intertek.com/minerals/precious-metals-analysis/), [GST charges](https://www.gst.go.tz/charges-for-labolatory-services/), [TanzaniaInvest Kizota](https://www.tanzaniainvest.com/mining/construction-mineral-testing-laboratory-kizota-dodoma).
* **Assay costs (indicative 2025):** Au-FA-AAS USD 12–18; ICP multi-element USD 20–35; ICP-MS USD 35–60; screen-fire USD 70–120; GST published rates ~30–50% below commercial.
* **QA/QC standard:** **5–10% inserts** — 1 in 20 a CRM (matrix-matched, low/medium/high), 1 in 20 a coarse blank, 1 in 20 a field duplicate; charts: CRMs within ±2 SD, blanks < 5× detection, duplicates within ±10% on log-log. Sources: [Lyell QA/QC review](https://www.lyellcollection.org/doi/full/10.1144/geochem2023-046), [Mineral Mountain QA/QC](https://mineralmountainresources.com/corporate-qaqc/).
* **Field GIS:** Garmin GPSMAP, Avenza Maps, **QField** (open-source frontline), ArcGIS Field Maps, Emlid Reach RTK, Mapbox, **Sentinel-2** free 10 m via Copernicus (NDVI, alteration, drainage), Planet/Maxar sub-metre, DJI Mavic 3 / Mini 4 Pro for 1–5 cm orthos via WebODM / Agisoft.
* **Mineral districts:**
  * **Gold** — Geita / Bulyanhulu (Lake Victoria Goldfield reef-quartz), Lupa/Mara (alluvial), eluvial soils.
  * **Tanzanite — Mererani only**, graphitic gneiss, Block A/B/C/D, Mererani wall.
  * **Ruby/sapphire/spinel** — Winza (2008, amphibolite ruby), Songea, Tunduru (sapphire alluvial), Umba (sapphire/garnet), Mahenge (spinel/ruby), Longido (ruby).
  * **Tsavorite/rhodolite garnet** — Lindi (Lutela), Umba, Komolo.
  * **Emerald / alexandrite** — Manyara, pegmatite/schist.
  * **Diamond** — **Mwadui kimberlite** (Williamson; 146 ha, world's largest economic kimberlite) + alluvial trains.
  * **Industrial** — Gypsum (Kilwa, Itigi); limestone (Tanga, Mbeya, Wazo Hill); salt (Bagamoyo solar; Uvinza rock); pozzolana (Kilimanjaro / Mbeya volcanic); kaolin (Pugu).
  * **Strategic** — Graphite (Lindi — Lindi Jumbo, Walkabout Resources); REE (**Ngualla** Peak Resources NdPr); coal (**Songwe-Kiwira** Mbeya 35.5+45.5+20.5 Mt; **Mchuchuma** Ruvuma 428 Mt); heavy-mineral placers Pwani coast.
* **Explosives / safety (lawful compliance only):** Explosives Act Cap.45 — Blasting Certificate (5-yr, examined by Inspector); Magazine Licence (1:1,000 scale map of 1-mile radius); daily issue/return reconciled; Boji hosts certificates, expiries, magazine inventory logs, exclusion-zone polygons, incident records — **never** operational blast instructions.

## E.5 — AI mining platform competitive landscape & tech stack

* **Big-mining AI deals 2024–2026:** Codelco × Microsoft (Mar 2026), BHP × Microsoft + Accenture (Oct 2024 extension; AI Hub Singapore May 2025), Rio Project Sage × AWS + Anthropic Claude (late 2024) + Databricks + Komatsu FrontRunner AHS, Vale × Cognite + VALE-GPT, Anglo IROC + Microsoft/Cognite, Newmont × Caterpillar autonomy + Petra Data Science, Freeport-McMoRan Bagdad fully autonomous Oct 2025 + "Concentrating Intelligence" 5% recovery uplift, Glencore × IntelliSense.io. Sources: Reuters, FT, Mining Weekly, Mining.com 2024–2026 coverage.
* **Exploration AI:** **KoBold Metals** USD 537m Series C @ USD 2.96b (Jan 2025); **Earth AI** USD 20m Series B (Jan 2025); **GoldSpot Discoveries** (TSXV: SPOT); **VRIFY**.
* **Mid-tier incumbents:** Deswik, MICROMINE, Hexagon MinePlan/MineOperate/Pitram, Maptek (DomainMCF), RPM Global (XECUTE/AMT/XERAS), K2fly (Decipher), Seequent (Leapfrog/Imago — 2025.1/2/3 with cloud Evo + ML AutoCrop), Datamine, Bentley Mining. **All engineer-tool-first; none owner-facing AI advisory; none SME-priced; none Swahili/fingerprint/offline.**
* **AI-native verticals:** IntelliSense.io (real-time grinding/flotation/leaching), Petra Data Science (predictive geometallurgy), MineSense (XRF + AI sorting at the shovel), Strayos (drone-photogrammetry + blast AI), Plotlogic (hyperspectral; acquired by Lummus 2024), Sentian / Sentient (autonomous RL plant control), OreFox (gen-AI exploration assistant).
* **ASM-focused tools:** Levin Sources, Pact's Delve, Better Sourcing Programme (3T), BGR/ITSCI (Sn-Ta-W Great Lakes), Minexx (mobile-first ASM 3T+gold), MineHub, ConsenSys/Everledger, CRAFT Code. **All compliance/traceability overlays; none an operating system.**
* **SME ERPs that DON'T fit:** Sage X3 Mining (USD 30–150k implementation), BST10, Pronto Xi Mining, Microsoft Dynamics 365 F&O Mining (USD 50k+ implementation), IFS Cloud, Workday, Infor M3. Entry costs at least 10× a typical PML's turnover; no TZ Mining Act overlay; no Swahili; no offline; no AI advisory.
* **Multi-agent stack:** LangChain / **LangGraph 0.2+** supervisor (Sep 2024) — checkpointing + HIL primitives; **Anthropic Claude Agent SDK** (Q1 2025 GA) — native sub-agent spawning, computer-use, MCP servers; **OpenAI Responses API + Agents SDK** (Mar 2025) — successor to Assistants with hand-offs, guardrails, tracing; Vercel AI SDK 4.x; Pydantic-AI; AutoGen 0.4; CrewAI; **Microsoft Magentic-One** (Nov 2024).
* **Vector DBs:** pgvector (Postgres-native default), Qdrant (Rust-fast hybrid), Weaviate, Pinecone, Vespa.
* **Knowledge graphs:** **Neo4j** default; **Apache AGE** for graph-on-Postgres single-DB; ArangoDB; Memgraph in-memory.
* **OCR (2025 state):** **Mistral OCR** (Mar 2025) — very strong on technical PDFs; Google Document AI (best multilingual + handwriting); AWS Textract (forms + tables); LlamaParse; Unstructured.io. Boji baseline = Mistral + Document AI ensemble.
* **Geospatial:** PostGIS source-of-truth; Mapbox / MapTiler tiles; MapLibre / OpenLayers / deck.gl web; **Tippecanoe** for offline vector tiles; **Cesium + 3D Tiles** for block models.
* **Mobile-first:** Expo SDK 52+ / RN 0.76 New Architecture; Capacitor 6; **PowerSync** (Postgres CDC → client SQLite, the 2025 standout); WatermelonDB; Replicache; Y.js / Automerge CRDTs.
* **Biometrics:** Android BiometricPrompt + iOS LocalAuthentication / Secure Enclave; **Smile ID** for **NIDA** + face liveness (also DRC, KE, UG, NG, ZA) — default for African KYC. TZ legal cover: **Electronic Transactions Act 2015 Cap.442 ss.22-23** + Evidence Act Cap.6.
* **Swahili LLM stack (Boji recommended):** **Aya Expanse 32B** (Cohere multilingual) for cloud Swahili reasoning + **Llama 3.2 3B** fine-tuned on Swahili mining terms for on-device fallback + **Whisper-large-v3 / Distil-Whisper** for ASR + **Coqui XTTS-v2** for Swahili TTS. Other ecosystem: Jacaranda UlizaLlama, Lelapa InkubaLM-0.4B, Masakhane SERENGETI, AfroXLMR.
* **Comparable AI-native operating systems in other industries:** **BossNyumba** (property), Cropin (agtech), Pula (parametric insurance), FarmDrive (alt-data credit), Apollo Agriculture (input financing), Lori Systems / Kobo360 (logistics), TradeDepot / Wasoko (B2B distribution). Transferable pattern: smartphone-first under-served operator + AI advisory + voice/local-language + offline + transaction-take + lender-grade single-source-of-truth.

## E.6 — BossNyumba codebase pattern (verbatim mapped)

* **Directory layout** — `apps/` (admin-platform-portal, estate-manager-app, owner-portal, customer-app), `packages/` (central-intelligence, ai-copilot/junior-ai-factory, ai-copilot/task-agents, agent-platform, database, domain-models, api-sdk), `services/` (api-gateway, consolidation-worker, document-intelligence, notifications, payments, reports), `infra/` (terraform, alerts).
* **Master Brain:** `packages/central-intelligence/src/kernel/kernel.ts` + `compose.ts` + `agent-loop.ts` — the 13-step BrainKernel pipeline detailed in section 4.0 above. Composition root: `services/api-gateway/src/composition/brain-kernel-wiring.ts`.
* **Junior Factory:** `packages/ai-copilot/src/junior-ai-factory/{types,service}.ts` — `provision/adjustScope/recordAction/suspend/revoke`; `policySubset ⊆ tenant AutonomyPolicy` validated; daily-action cap; in-memory test repo + Postgres adapter wired at api-gateway.
* **HTTP routes** for junior provisioning: `POST /api/v1/junior-ai/provision`, `GET /api/v1/junior-ai/mine`, `GET /api/v1/junior-ai/:id`, `PATCH /api/v1/junior-ai/:id/scope`, `POST /api/v1/junior-ai/:id/suspend`, `POST /api/v1/junior-ai/:id/revoke` — all gated by `requireRole(TEAM_LEAD)`.
* **Task Agents:** `packages/ai-copilot/src/task-agents/{types,executor,registry}.ts` — cron / event / manual triggers; guardrails per autonomy domain + action; LLM-invoking agents wrapped with budget guard; results audited + emit `TaskAgentRan`.
* **Consolidation Worker:** `services/consolidation-worker/src/{index,consolidation}.ts` + `stages/01-ingest` through `09-weekly-prompt-compile`.
* **Weekly Prompt Compiler:** `services/consolidation-worker/src/prompt-compile/{weekly-compiler,claude-mutator,haiku-evaluator}.ts` — 5-iteration GEPA loop, Pareto gate, runs only on Sundays.
* **Counter-Model Hoist (Phase C-1):** plugged at kernel composition; commit `18c3f908` made it production-wired.
* **Persistent state:** `packages/database/src/schemas/temporal-entity-graph.schema.ts` (bi-temporal: `valid_from`/`valid_to`/`recorded_at`/`invalidated_at`) + `ai-semantic-memory.schema.ts` (flat KV fallback).
* **Document intake:** `services/document-intelligence/src/` — `OCRExtractionService`, `DocumentCollectionService`, `FraudDetectionService`, `ValidationConsistencyService`, `EvidencePackBuilderService`.
* **Multi-tenant boundary:** `req.scope.tenantId` everywhere; Postgres RLS; per-tenant `AutonomyPolicy` loaded via `autonomyPolicyLoader(tenantId)`.

**Boji clones this pattern intact** — same kernel, same factory, same nine-stage consolidation, same weekly GEPA prompt-compile, same counter-model hoist, same temporal entity graph — only the junior catalogue, the tool surface, and the playbooks change. This is the single biggest engineering accelerator we have.

---

# Appendix F · The 27-March-2026 cliff — operational playbook

Because this is the single biggest forcing function in the spec, an end-to-end playbook is captured here so the engineering team knows exactly what to ship in MVP 1.

1. **Discover** — scan tenant's contract corpus (uploaded PDFs, emails, supplier portals). Document Agent classifies each as `domestic | cross_border | hybrid`.
2. **Classify currency** — extract currency clauses, payment terms, governing law. Flag every `domestic` contract priced in USD.
3. **Propose** — for each flagged contract, draft a **TZS Conversion Addendum** (template-driven) that:
   * fixes a TZS-equivalent price at a specified conversion date (typically BoT mid on the day of signing the addendum)
   * adds a TZS-only payment clause
   * adds an optional FX-adjustment formula (if both parties agree) tied to a published BoT rate
4. **Route for fingerprint signature** — both parties (or their authorised reps) sign via the standard fingerprint flow; QR + audit log + LMBM linkage.
5. **Track the cliff** — single dashboard showing every contract's status (`renegotiated | in_progress | not_started | exempt | minister-extension-requested`), with day-count to 27 March 2026.
6. **Notify** — automated email/WhatsApp/SMS to counterparties at T-90/T-60/T-30/T-14/T-7/T-1 days.
7. **Audit pack** — for a BoT inspector, generate a watermarked, expiring URL containing all renegotiated addenda + the original contracts + the signing audit trail.

---

# Appendix G · Junior agent backlog (v0.2 enriched)

Adding two agents identified by E.1 and E.5 that were missing from §4.3:

| Agent | Mandate | Trigger |
|---|---|---|
| **Cadastre Sync Agent** | Daily diff of the public Tume ya Madini cadastre against tenant licences; flag new neighbouring grants, area shrinkages, dormancy notices, automated revocation announcements | cron daily 03:00 + cadastre-event webhook |
| **Local-Content Compliance Agent** | Walk every supplier in procurement; check beneficial-ownership against ITC definition (≥ 20% Tz equity, 80% senior management, 100% non-managerial); check reserved-list Reg 13A; verify JV equity ≥ 20%; notify on sole-source > USD 10k; run 50-working-day deemed-approval timer on local-content plan | on procurement-event + cron daily |
| **Dormancy Risk Score Agent** | Score each licence daily on: last payment age, last report age, work-programme variance, area utilisation, EPP filed, renewal-pack readiness; output a colour-coded risk; pre-prepare a Notice-of-Breach response packet if score crosses red | cron daily + Notice-of-Breach webhook |
| **BoT Gold Window Agent** | Compute net-net economics of BoT 4%/0%/0% vs export route; auto-route consignments; track 20% mandatory set-aside ratio; block export-permit request if set-aside < 20% | every sale candidate |
| **Contract-Currency Auditor Agent** | The 27 March 2026 cliff playbook (Appendix F) | on contract upload + cron daily |

---

# Appendix H · Open research items to be done before v1

* Confirm exact BoT facility-registration form and webhook availability.
* Confirm whether Mining Commission cadastre offers an API (Spatial Dimension launch indicates yes; needs MoU).
* Smile ID NIDA pricing at scale + offline fallback path.
* Whisper-cpp Swahili WER benchmark on field-recorded audio in noisy conditions.
* Aya Expanse 32B cost-per-token at our expected QPS.
* Negotiate API access for SGS / Bureau Veritas / ALS / Intertek lab portals for assay-result push.
* Negotiate with TIB / NMB / NBC / CRDB on the bank-pack format that auto-unlocks SME mining loans.
* Verify the latest royalty schedule against the most recent Gazette (config-driven so this is a refresh, not a code change).
* Verify the post-March-2026 CSR allocation expectations after the High Court ruling stabilises.

---

# Appendix I · Implementation guidance for the engineering team

* **Mono-repo bootstrap:** start from a fork of BossNyumba's `packages/central-intelligence`, `packages/ai-copilot`, `services/consolidation-worker`, and `services/api-gateway/src/composition`. Rename `apps/estate-manager-app` → `apps/site-manager-app`; `apps/owner-portal` stays. Drop property-specific juniors; replace with the Boji catalogue (§4.3 + Appendix G).
* **Schemas:** copy `temporal-entity-graph.schema.ts` as-is; add mining-specific entity types (`licence`, `site`, `drill_hole`, `vein_model`, `ore_parcel`, etc.) to the type enum.
* **Knowledge graph queries:** Postgres + Apache AGE single-DB option preferred initially; promote to Neo4j Aura only if graph traversal latency becomes a bottleneck.
* **Embeddings:** Cohere embed v3 multilingual (Swahili support better than OpenAI text-embedding-3-large).
* **Audit log:** append-only Postgres + S3 WORM bucket + KMS-signed events per BossNyumba's pattern.
* **Multi-tenant:** Postgres RLS + per-tenant KMS key + per-tenant pgvector partial indexes (or Qdrant collection per tenant if migrating off pgvector at scale).
* **Killswitch / killbox:** environmental `HALT` and `DEGRADED` modes per BossNyumba — every junior must respect them.

---

# Appendix J · Suggested first commits

To ship MVP 1 in 8–12 weeks:

1. `feat(repo): initial boji monorepo from bossnyumba fork`
2. `feat(domain): add Tanzania mining domain types (licence, site, drill_hole, vein_model, ore_parcel)`
3. `feat(juniors): replace property junior catalogue with mining junior catalogue (Document, Licence, EPP, Village CSR, Geology, Cost, FX/Treasury)`
4. `feat(licence): cadastre sync + GePG control-number tracker + renewal calendar`
5. `feat(documents): mistral OCR + classify PML/EPP/receipt/minutes`
6. `feat(epp): EPP wizard with NEMC officer marketplace + fingerprint sign flow`
7. `feat(village): CSR plan minutes generator + fingerprint multi-party signature`
8. `feat(fx): GN 198/2025 contract auditor + BoT rate feed + TZS-only invoice guardrail`
9. `feat(treasury): NSR calculator + BoT gold-window economics + 20% set-aside tracker`
10. `feat(reports): Daily Owner Brief + Weekly Strategy Memo`

---

# Appendix K · Marketing & narrative

The one-line pitches we should test:

* "Akili ya kampuni ya madini." ("The mind of a mining company.")
* "Your mining business — clearly, in your pocket, in Swahili."
* "From PML to BoT gold-window in 24 hours, fully documented."
* "An AI mining director for every PML holder."
* "BossNyumba ilifanya majengo. Boji inafanya madini." ("BossNyumba did buildings. Boji does mining.")

---

— end of master spec v0.2 —
