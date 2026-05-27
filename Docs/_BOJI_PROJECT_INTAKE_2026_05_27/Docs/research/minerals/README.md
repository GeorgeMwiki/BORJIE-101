# Boji AI — Minerals Intelligence Corpus

> **Purpose:** This folder is the authoritative mineral-by-mineral knowledge that Boji's Geology, Metallurgy, Cost Engineer, Sales/Off-take, Compliance, and Safety/EHS Junior Agents reach for at runtime. Every claim Boji makes about a mineral's chemistry, geology, processing, pricing, or regulation must be traceable to one of these files.
>
> Treat the corpus as **the bootstrap brain Boji ships with on day one**. On first boot of any tenant, the Document Agent ingests this folder into the tenant vector store with provenance tags (`source: boji_corpus_v1`, `file: minerals/XX_...`).

---

## File index

| # | File | Coverage |
|---|---|---|
| 00 | [`00_MINERAL_PROCESSING_OVERVIEW.md`](./00_MINERAL_PROCESSING_OVERVIEW.md) | The cross-mineral "grammar" — universal mining→market pipeline, comminution (Bond Wi), gravity separation, flotation reagent chemistry, magnetic / electrostatic separation, hydromet (leach / SX / IX / cementation / EW), pyromet (roast / smelt / convert / refine), electrometallurgy, standard product specs, transport & hazard class, Boji's 10 universal decision triggers |
| 01 | [`01_precious_metals_and_pgms.md`](./01_precious_metals_and_pgms.md) | **Gold (Au)**, Silver (Ag), Platinum (Pt), Palladium (Pd), Rhodium (Rh), Iridium (Ir), Osmium (Os), Ruthenium (Ru). Tanzania ASGM context, BoT Domestic Gold Programme (4% royalty / 0% inspection / 24-h TZS), LBMA Good Delivery, Mwanza/Geita refineries, Minamata-compliant routing |
| 02 | [`02_base_metals.md`](./02_base_metals.md) | Copper (Cu), Lead (Pb), Zinc (Zn), Nickel (Ni — sulphide & laterite), Tin (Sn), Aluminium (Al — bauxite→alumina→metal), Iron ore (Fe), Manganese (Mn). Kabanga Ni-Cu-Co flagship; Liganga Fe-V-Ti; sequential Cu (CuT, CuOx, CuCN); differential Pb-Zn flotation; Class I vs Class II nickel split |
| 03 | [`03_battery_and_critical_minerals.md`](./03_battery_and_critical_minerals.md) | Lithium (Li — brine + hard-rock + clay), Cobalt (Co — DRC ASM context), Graphite (Tanzania Lindi Jumbo / Mahenge / Bunyu / Epanko — flake-size economics), battery-grade Ni-sulphate, battery-grade Mn-sulphate, Vanadium (V — Liganga), Rare Earths (Ngualla NdPr + the lanthanide cascade), Tungsten (W) |
| 04 | [`04_energy_minerals.md`](./04_energy_minerals.md) | Uranium (U — Mkuju River, Athabasca benchmarks), Thorium (Th — NORM context), Coal (Songwe-Kiwira + Mchuchuma; rank ladder; CSR/CSN; thermal vs coking spread), Helium (He — Rukwa Helium One; Songwe Magadi) |
| 05 | [`05_gemstones_and_diamonds.md`](./05_gemstones_and_diamonds.md) | Diamond (Mwadui Williamson), **Tanzanite (Mererani only)** — Block A/B/C/D + Mererani Wall, Ruby (Songea, Winza, Mahenge, Longido), Sapphire (Tunduru, Umba), Emerald (Manyara), Alexandrite, Garnet (tsavorite Lindi, rhodolite, spessartine), Spinel (Mahenge red), Tourmaline (paraíba), Opal. Trace-element origin fingerprinting, heat-treatment, GIA/SSEF/Gübelin grading |
| 06 | [`06_industrial_minerals.md`](./06_industrial_minerals.md) | Gypsum (Makanya, Kilwa, Itigi), Limestone (Wazo Hill, Tanga, Mbeya — Twiga/Tanga/Mbeya Cement), Salt (Bagamoyo, Uvinza, Maere), Soda ash (Lake Natron — **Ramsar-protected, Boji refuses extraction advice**), Phosphate (Minjingu), Kaolin (Pugu), Mica, Talc, Fluorspar, Magnesite, Dolomite, Silica sand, Bentonite, Pozzolana (Mbeya/Kilimanjaro volcanic), Diatomite, Vermiculite (**asbestos test mandatory**), Perlite, Barite |
| 07 | [`07_specialty_and_refractory_metals.md`](./07_specialty_and_refractory_metals.md) | Tantalum (Ta) + Niobium (Nb) — coltan / pyrochlore, Antimony (Sb), Bismuth (Bi), Tellurium (Te), Gallium (Ga), Germanium (Ge), Indium (In), Selenium (Se), Beryllium (Be), Hafnium (Hf), Scandium (Sc), Yttrium (Y), Chromium (Cr), Molybdenum (Mo), Titanium (Ti), Zirconium (Zr), **Mercury (Hg — lawful compliance only, Minamata-constrained)** |
| 08 | [`08_construction_and_heavy_mineral_sands.md`](./08_construction_and_heavy_mineral_sands.md) | Aggregates, sand (river, M-sand, marine, frac), dimension stone (Tanzania granite blocks), pumice & scoria, cement raw materials, Heavy-Mineral Sands (ilmenite, rutile, leucoxene, zircon, monazite — Fungoni, Tajiri, Madimba on Pwani-Mtwara coast), brick clay, gravel, sand-mining governance (Pangani / Ruvu / Wami moratoria) |

**Total corpus size:** ~ 450,000 words across 9 files; ~ 600 live URL citations.

---

## How Boji's junior agents use this corpus

```
User question
   │
   ▼
Master Brain — classifies intent → routes to Junior Agent
   │
   ▼
Junior Agent calls:  lookup_intelligence_corpus(query, agent_role, top_k=N)
   │
   ▼
Retrieval over corpus
  - vector search (pgvector / Qdrant) on file embeddings
  - structured filter on (mineral, file, section, country, hazard_flag)
  - returns passages + provenance (file + section + URL)
   │
   ▼
Junior Agent grounds its recommendation in returned passages
   │
   ▼
Auditor Agent verifies every claim has provenance
   │
   ▼
Master Brain synthesises → owner-facing answer with footnoted citations
```

### Agent → file mapping (default)

| Junior Agent | Primary files | Secondary files |
|---|---|---|
| **Geology Agent** | 00, 04, 05, per-mineral file | 02, 03, 07, 08 |
| **Metallurgy Agent** | 00, per-mineral file | all |
| **Drill-hole Logger Agent** | 00 §2–3, per-mineral exploration sections | research/04_EPP_COMMUNITY_GEOLOGY_LABS |
| **Lab/Assay Agent** | research/04_EPP, 00 §6 | per-mineral file E-G sections |
| **Cost Engineer Agent** | 00 §11, per-mineral pricing sections (I) | research/03_FX_TREASURY |
| **Sales / Off-take Agent** | per-mineral pricing + Buyer routing (I + H sections) | research/03_FX_TREASURY |
| **FX / Treasury Agent** | research/03_FX_TREASURY | per-mineral pricing (I) |
| **Compliance Agent** | research/01_TZ_MINING_REGULATION + per-mineral § J/K | per-mineral L sources |
| **Safety / EHS Agent** | per-mineral § J + research/04_EPP § 11 | 00 §11.7-9 |
| **EPP Agent** | research/04_EPP, per-mineral § J | research/01_TZ_MINING_REGULATION § 6 |
| **Document Agent** | full corpus | — |
| **Auditor Agent** | full corpus + per-mineral § L sources for evidence | — |

---

## Update protocol

These dossiers are **versioned** — they must be appended-only:

1. **Never edit historical entries.** If a fact changes (e.g., a royalty rate update), append a dated changelog entry at the top of the file and add a "supersedes" pointer in the relevant section. The corpus must remain a defensible audit trail.

2. **New mineral** → new file `NN_<family>.md` + this README index updated + corpus re-ingested into the tenant vector stores via the Document Agent.

3. **New jurisdiction** → new file in the `research/` folder (e.g., `07_GHANA_MINING_REGULATION_2026.md`) — minerals files remain Tanzania-anchored but jurisdiction files multiply.

4. **Regulator updates** (Gazette / SI / GN) → primary entry in `research/01_TZ_MINING_REGULATION_2025_2026.md`; per-mineral files cross-reference but do not duplicate.

5. **Price refresh** — pricing values in this corpus are *baseline anchors*, not live quotes. Boji's runtime FX Agent and Sales Agent fetch live prices from Fastmarkets, Argus, LBMA, LME, Asian Metal, BoT, Mining Commission TZ. The corpus tells the agent **how to interpret** a price; the live feed tells the agent **what** today's price is.

---

## Reading order for engineers building Boji

1. Start with **`00_MINERAL_PROCESSING_OVERVIEW.md`** — gives the mental model.
2. Then **`research/01_TZ_MINING_REGULATION_2025_2026.md`** + **`research/03_FX_TREASURY_UNIT_ECONOMICS.md`** — the regulatory + commercial frame.
3. Then any mineral file relevant to the first target tenant (most likely **01_precious_metals** for gold ASGM, **05_gemstones** for Mererani/Tunduru, **03_battery** for the Lindi graphite belt, **04_energy** for coal / helium / uranium).
4. Use **`research/06_BOSSNYUMBA_PATTERN_MAPPED.md`** for the engineering architecture (the BrainKernel + Junior Factory + Consolidation Worker pattern that Boji clones).

---

## Cross-corpus index by Tanzanian district

| District / Region | Relevant files |
|---|---|
| Geita / Lake Victoria Goldfield | 01 (Au), 04 (Au context), research/01 |
| Mererani (Manyara) | 05 (Tanzanite) |
| Tunduru / Ruvuma | 05 (sapphire), 04 (coal Mchuchuma) |
| Songea / Mahenge / Morogoro | 05 (ruby, spinel), 07 (Be) |
| Winza / Mpwapwa | 05 (ruby, sapphire) |
| Mwanza / Kahama / Tarime | 01 (Au) |
| Lupa / Chunya / Mbeya | 01 (Au), 03 (REE Ngualla), 04 (coal Songwe), 06 (cement Mbeya), 03 (V Liganga) |
| Lindi / Mtwara | 03 (graphite Lindi Jumbo + Mahenge + Bunyu), 03 (REE Ngualla cross-ref), 04 (coal context), 05 (gemstones), 06 (industrial), 08 (HMS Pwani-Mtwara — Fungoni, Tajiri, Madimba) |
| Mwadui / Shinyanga | 05 (diamond) |
| Mpanda / Katavi | 02 (Cu) |
| Kabanga (NW border) | 02 (Ni-Cu-Co), 03 (battery Ni-sulphate route) |
| Ntaka Hill (Lindi) | 02 (Ni-Co), 03 (battery cross-ref) |
| Mkuju River (Selous-adjacent) | 04 (U) |
| Rukwa / Songwe Magadi | 04 (Helium) |
| Wazo Hill (Dar Pwani) | 06 (limestone / Twiga Cement) |
| Tanga | 06 (limestone / Tanga Cement, Maere salt) |
| Makanya / Kilwa / Itigi | 06 (gypsum) |
| Bagamoyo / Uvinza | 06 (salt) |
| Pugu (Dar) | 06 (kaolin) |
| Minjingu (Manyara) | 06 (phosphate) |
| Lake Natron (Manyara) | 06 (soda ash — extraction refused, Ramsar) |
| Pwani / Mtwara coast | 08 (HMS — ilmenite, rutile, zircon, monazite) |

---

## Reading time

| File | Approx pages (12-pt) | Approx reading time |
|---|---|---|
| 00 overview | 20 | 25 min |
| 01 precious | 80 | 90 min |
| 02 base | 40 | 50 min |
| 03 critical | 45 | 60 min |
| 04 energy | 70 | 80 min |
| 05 gemstones | 90 | 100 min |
| 06 industrial | 100 | 110 min |
| 07 specialty | 55 | 65 min |
| 08 construction | 60 | 70 min |
| **Total** | **~ 560** | **~ 11 hours** |

For Boji's agents this is one vector-search call at runtime — but the human-readable version is here for spec-writers, regulators, due-diligence teams, and engineering on-boarding.

— end of minerals corpus README —
