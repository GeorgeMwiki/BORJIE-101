# Boji AI — Documentation corpus

This folder is **Boji's bootstrap brain**.

It is not just for humans. Every file here is also a runtime intelligence source: at first-boot, the Document Agent ingests the entire `primary_sources/` and `research/` directories into the tenant vector store with provenance tags. Every Junior Agent's tool surface includes a `lookup_intelligence_corpus(query, agent_role)` call that does retrieval over this corpus. Every recommendation the Master Brain produces must cite a passage from here (or from a regulation that has since been ingested through the Compliance Agent's update pipeline) — otherwise the Auditor Agent rejects it.

Treat additions to this folder the way an engineering team treats migrations: append, do not overwrite. Date and source every change.

---

## Layout

```
Docs/
├── README.md                                            ← this file
├── BOJI_AI_SPEC.md                                      ← the master specification (v0.2+)
├── SME MINING INSIGHTS.pdf                              ← IIED 16641 — Mutagwaba et al. 2018
├── primary_sources/                                     ← founder's own words, verbatim
│   ├── USER_BRIEF_01_product_framing.md
│   ├── USER_BRIEF_02_workflows.md
│   └── USER_BRIEF_03_session_directives.md
├── build/                                              ← engineering bridge (build-plan, schema, agent prompts, screens)
│   ├── README.md
│   ├── MVP1_BUILD_PLAN.md                              ← 12-week ticket plan with acceptance criteria
│   ├── DATA_MODEL.md                                   ← Postgres + PostGIS + pgvector schema + RLS
│   ├── AGENT_PROMPT_LIBRARY.md                         ← production prompts for all 28 named juniors
│   └── UI_SCREEN_CATALOGUE.md                          ← 89 screens across 4 surfaces
└── research/                                            ← citation-backed deep-research dossiers
    ├── 01_TZ_MINING_REGULATION_2025_2026.md
    ├── 02_MINE_TO_MARKET_SIC_FMS.md
    ├── 03_FX_TREASURY_UNIT_ECONOMICS.md
    ├── 04_EPP_COMMUNITY_GEOLOGY_LABS.md
    ├── 05_AI_MINING_PLATFORM_LANDSCAPE.md
    ├── 06_BOSSNYUMBA_PATTERN_MAPPED.md
    └── minerals/                                        ← per-mineral dossiers (full-mining-expert corpus)
        ├── README.md                                    ← minerals corpus index
        ├── 00_MINERAL_PROCESSING_OVERVIEW.md            ← cross-mineral processing grammar
        ├── 01_precious_metals_and_pgms.md               ← Au, Ag, Pt, Pd, Rh, Ir, Os, Ru
        ├── 02_base_metals.md                            ← Cu, Pb, Zn, Ni, Sn, Al, Fe, Mn
        ├── 03_battery_and_critical_minerals.md          ← Li, Co, graphite, V, REE, W (+battery-Ni/Mn)
        ├── 04_energy_minerals.md                        ← U, Th, coal, He
        ├── 05_gemstones_and_diamonds.md                 ← diamond, tanzanite, ruby, sapphire, emerald, alexandrite, garnet, spinel, tourmaline, opal
        ├── 06_industrial_minerals.md                    ← 18 industrial minerals (gypsum → barite)
        ├── 07_specialty_and_refractory_metals.md        ← Ta, Nb, Sb, Bi, Te, Ga, Ge, In, Se, Be, Hf, Sc, Y, Cr, Mo, Ti, Zr, Hg
        └── 08_construction_and_heavy_mineral_sands.md   ← aggregates, sand, dimension stone, pumice, HMS, brick clay
```

---

## What each file is for

### `BOJI_AI_SPEC.md`
The single source of truth for what Boji is, how it is built, and in what order. v0.2 expands on v0.1 with citation-backed content from the six dossiers. New revisions append a changelog entry; never rewrite history.

### `SME MINING INSIGHTS.pdf`
The 100-page IIED 16641 research report (Mutagwaba, Tindyebwa, Makanta, Kaballega, Maeda — 2018). The single most-quoted external source in the spec. Every priority issue the field study surfaces (pp. 67–85) maps directly to a Boji feature.

### `primary_sources/USER_BRIEF_01_product_framing.md`
The founder's 18-section product framing, captured verbatim from the first session message. Includes the Living Mining Business Map, the five strategic intelligence levels, the seven onboarding stages, the twelve modules, the six playbooks, the multi-agent architecture, and the six-MVP roadmap. The **central concept ledger** for the product.

### `primary_sources/USER_BRIEF_02_workflows.md`
The founder's pre-licence, post-licence, road-negotiation, determination, planning, excavation, QC, on-loading and marketplace workflows — captured verbatim. The **UX-and-flow ledger**.

### `primary_sources/USER_BRIEF_03_session_directives.md`
The four explicit meta-directives the founder issued in this session — project framing, spec output expectations, app-surface architecture (2 web + 2 mobile, no customer), and the "preserve every byte of local intelligence" instruction. The **meta-instruction ledger**.

### `research/01_TZ_MINING_REGULATION_2025_2026.md`
Licence types and lifecycle, Mining Commission and cadastre, GePG payment rails, royalty schedule, mineral-trading rules, BoT Domestic Gold Programme, FX regulations 2025, EPP/EIA framework, Land Acts, CSR 2023 + March-2026 High Court ruling, Local Content 2018→GN-563/2025, enforcement themes, cross-border benchmarks. **Compliance Agent + Licence Agent baseline.**

### `research/02_MINE_TO_MARKET_SIC_FMS.md`
McKinsey mine-to-market thesis, ABB OMS / Deswik / GroundHog SIC, Cat MineStar / Wenco / Modular DISPATCH, Maptek / Seequent / Datamine planning stack, RL truck-dispatch research, shift-report template, hauling/loading economics (50–60% opex, 70% engine LCC, match factor 0.85–1.0), demurrage, predictive maintenance economics (USD 20k/hr downtime), the 2025-26 AI mining cycle (Codelco, BHP, Rio Project Sage, Freeport-Bagdad fully autonomous Oct 2025). **Mine Planner + SIC + Asset + Maintenance Agent baseline.**

### `research/03_FX_TREASURY_UNIT_ECONOMICS.md`
GN 198/2025 TZS mandate + 27-Mar-2026 cliff, BoT gold-window 24-hour settlement, LBMA gold doré 2–8% discount, NSR formula with TZ deductions, break-even-grade sensitivity, unit-economics framework, working-capital math, off-take/streaming/royalty/trader-advance economics, stockpile-as-USD-hedge rule, CBR 5.75% + 91% mining-credit-growth, CRDB-MC MoU Feb 2026, full TZ mining-tax stack including 0.1% HIV levy and ring-fencing s.114. **FX/Treasury + Cost Engineer + Sales/Off-take Agent baseline.**

### `research/04_EPP_COMMUNITY_GEOLOGY_LABS.md`
NEMC EPP cycle and rejection patterns, dual-bond regime, EIA-track procedure, Land Act/VLA 1999 + Compensation Reg L.N. 78/2001 components (disturbance/transport/accommodation/loss-of-profit formulas), village-meeting protocol, CSR 14d/7d/30d timing + ICMM PE9/PE10, road-negotiation playbook, artisanal-to-JORC determination ladder, multi-shaft vein triangulation (V = L × W × T_true), lab supply chain (SGS / BV / ALS / Intertek / GST / AMGC) with prices, QA/QC 5-10% insertion standard, QField/Sentinel-2/DJI field stack, mineral-specific district notes, Explosives Act lawful-compliance scope. **EPP + Village CSR + Road + Geology + Drill-hole + Lab + Safety Agent baseline.**

### `research/05_AI_MINING_PLATFORM_LANDSCAPE.md`
Big-mining AI deals 2024–2026, incumbent engineering ERPs and their SME gap, AI-native exploration startups, ASM compliance tools, multi-agent orchestration frameworks (LangGraph, Anthropic Agent SDK, OpenAI Agents SDK, AutoGen, CrewAI, Magentic-One), vector / KG / OCR / geospatial / mobile-sync / biometric / Swahili-LLM stack recommendations, AI-native operating systems in other industries (BossNyumba, Cropin, Pula, Lori, Wasoko). **Tech-stack + competitive-positioning baseline.**

### `research/06_BOSSNYUMBA_PATTERN_MAPPED.md`
File-path-level map of the BossNyumba codebase pattern Boji clones — the 13-step BrainKernel pipeline, Junior Factory lifecycle, Task Agent contract, 9-stage Consolidation Worker, Weekly Prompt Compiler (GEPA), Temporal Entity Graph bi-temporal schema, Document Intelligence service, multi-tenant boundary enforcement, Counter-Model Hoist (Phase-C-1, commit 18c3f908). **Engineering blueprint for the first weeks of Boji's repo.**

### `research/minerals/` (9 files, ~ 450,000 words, ~ 600 live URL citations)
The **per-mineral expert corpus** that makes Boji full-mining-expert on every commercially mined mineral on Earth — Tanzania-anchored throughout. Each file follows the same 12-section schema (A: Identity → B: Geology → C: TZ relevance → D: Exploration → E: Mining → F: Beneficiation → G: Hydromet/Pyromet refining → H: Movement/hazard → I: Pricing → J: EHS → K: Decision triggers → L: Sources). The cross-cutting `00_MINERAL_PROCESSING_OVERVIEW.md` gives the *grammar* (Bond Wi, flotation reagents, gravity separation, hydromet leach + SX + IX + EW, pyromet smelting/converting/refining, electrometallurgy, product specs, transport/hazard); the eight per-family files give the *vocabulary*. **The Geology, Metallurgy, Cost Engineer, Sales/Off-take, Compliance, and Safety/EHS Junior Agents read from this corpus on every relevant turn.** See `research/minerals/README.md` for the in-corpus index, agent → file mapping, district-by-district reading guide, and update protocol.

---

## How updates are made

1. **Founder briefs** — only add new files; never edit existing ones. If a directive changes, write a new `USER_BRIEF_NN_*.md` and link it from this README.
2. **Research dossiers** — append new entries at the bottom of the relevant file with a dated header, e.g. `## 2026-08-12 update — new GN-XXX of 2026`. Do not edit historical entries.
3. **Main spec** — every change is a new minor version with a changelog entry at the top.
4. **Versioning ingestion** — when a new file or section is added to `Docs/`, the Compliance Agent ingestion job re-embeds it and the weekly prompt-compile loop re-validates the golden set before promoting any change.

---

## Why this folder exists

The founder's explicit instruction on 2026-05-17:

> "I GAVE YOU SO MUCH LOCAL INFO DON'T WASTE ANY OF IT IN BUILDING THIS DETAILED SPEC FOR THIS PROJECT, SAVE ALL ANALYSIS, RESEARCH, DOCS LINKS TO GAIN INTELLIGENCE ETC IN THE BOJI PROJECT WE WILL NEED IT FOR INTELLIGENCE LOGIC"

This README, the `primary_sources/` directory and the `research/` directory are the architectural answer to that instruction. Every URL, every legal citation, every cost figure, every framework, and every founder sentence the project has produced lives here, and is now part of Boji's runtime intelligence.
