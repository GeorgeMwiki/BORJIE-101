# Boji AI — Base Metals Dossier

> **Scope:** Cu, Pb, Zn, Ni (sulphide & laterite), Sn, Al, Fe, Mn — eight metals that together account for ~95% of the non-precious metals traded on the London Metal Exchange (LME). For each: ore identity, geology, Tanzania context, exploration, mining, beneficiation, hydromet / pyromet refining, product specs, transport, pricing, EHS, and decision triggers Boji must encode. Cross-references to the cross-mineral overview file `00_MINERAL_PROCESSING_OVERVIEW.md`.

---

## 1 · Copper (Cu)

### A · Identity

- Atomic number 29, mass 63.55, density 8.96 g/cm³, melting point 1085 °C, FCC crystal.
- Crustal abundance ≈ 60 ppm.
- Principal ore minerals:
  - **Chalcopyrite CuFeS₂** — ~ 34.6% Cu, dominant primary sulphide world-wide.
  - **Bornite Cu₅FeS₄** — 63% Cu, high-grade enrichment.
  - **Chalcocite Cu₂S** — 79.8% Cu, supergene enrichment blanket.
  - **Covellite CuS** — 66.5% Cu.
  - **Native copper Cu** — high-purity, rare bulk source.
  - Oxides / carbonates (supergene cap): **malachite Cu₂CO₃(OH)₂**, **azurite Cu₃(CO₃)₂(OH)₂**, **chrysocolla (Cu,Al)₂H₂Si₂O₅(OH)₄·nH₂O**, **cuprite Cu₂O**, **tenorite CuO**.

### B · Geology & deposit types

| Deposit type | Typical grade | Examples |
|---|---|---|
| Porphyry Cu (Cu-Mo, Cu-Au) | 0.3-0.8% Cu | Chuquicamata, El Teniente, Escondida, Bingham, Grasberg, Oyu Tolgoi, Cerro Verde |
| Sediment-hosted Cu (Kupferschiefer / Copperbelt) | 2-5% Cu | Polish Kupferschiefer, Zambian/DRC Copperbelt (Tenke, Mutanda, Kamoa) |
| VMS (volcanogenic massive sulphide) | 1-4% Cu + Zn/Pb/Au/Ag | Bathurst (Canada), Iberian Pyrite Belt, Neves-Corvo |
| Skarn | 0.5-2% Cu | Antamina, Bingham margins |
| IOCG (iron-oxide-copper-gold) | 0.5-1.5% Cu + Au + U | Olympic Dam, Carrapateena, Salobo |
| Native copper (Lake Superior) | 1-3% Cu | Keweenaw (legacy) |

### C · Tanzania / East Africa relevance

- The **Central African Copperbelt** sits just to the north-west across the DRC border; TZ proper has only modest Cu — **Mpanda district** (Katavi region), **Kabanga Cu-Ni-Co** (NW, near Burundi border), **Kapalagulu** in Lake Tanganyika belt.
- Several small ASM Cu-oxide showings; informal heap-leach is occasionally attempted but rarely viable.
- Cross-border: any Tanzanian SME with assets near the DRC border should track Glencore (Mutanda), Ivanhoe (Kamoa-Kakula), CMOC (Tenke Fungurume) as off-take comparators.

### D · Exploration & determination

- **Geophysics:** IP/resistivity for disseminated sulphides; mag for skarn; gravity for massive sulphide; CSAMT for deeper porphyry.
- **Geochem pathfinders:** Mo, Re, Au, Te, Bi, Se for porphyry; Co for sediment-hosted; Hg + Sb halos for epithermal Cu-Au.
- **Drilling:** RC for greenfield (USD 60-110/m TZ), HQ/NQ core for resource definition (USD 130-220/m).
- **Assay:** ICP-OES / ICP-MS multi-element; Cu by AAS as cross-check; sequential Cu (acid-soluble = oxide; cyanide-soluble = secondary sulphide; residual = primary sulphide) — this **CuT, CuOx, CuCN** breakdown drives the SX-EW-vs-flotation decision.

### E · Mining methods

- **Open-pit** dominant for porphyry (Escondida is the world's largest); bench heights 12-18 m, strip ratios 1-3 for low-grade ore.
- **Block-cave** for large low-grade orebodies (El Teniente, Northparkes, Grasberg DOZ).
- **Sublevel stoping** for narrow vein and small skarn.
- **Heap leach** for oxide-cap supergene; permeable lift heights 4-12 m, irrigation 5-12 L/m²·h, residence 60-180 days.

### F · Comminution & beneficiation

- **Sulphide route — flotation:**
  - Crush + grind to p80 75-150 µm (porphyry); finer (40-50 µm) for fine-grained / refractory.
  - Bond Wi typical 12-16 kWh/t.
  - Reagents: **SIPX or PAX collector 30-80 g/t**, MIBC frother 20-40 g/t, lime to pH 10-12 (depresses pyrite), CuSO₄ if sphalerite present.
  - Cleaner stages: 2-3 cleaning circuits → final concentrate **25-30% Cu** (porphyry typical).
  - Recovery typical 85-92%; tailings 0.04-0.10% Cu.
  - Selective flotation in Cu-Mo ores: Mo float at end after pyrite depression; molybdenite is naturally hydrophobic — collector is diesel/kerosene.
- **Oxide route — heap leach / SX-EW:**
  - Acid (H₂SO₄) heap leach over agglomerated ore on HDPE pad; PLS (pregnant leach solution) gravity-collected into pond.
  - **SX (solvent extraction)** with LIX 84-I / LIX 984N / Acorga M5640 in kerosene diluent; loaded organic stripped with spent electrolyte (200 g/L H₂SO₄).
  - **EW (electrowinning)** to LME Grade A copper cathode at 250-330 A/m², 2.0-2.2 V; current efficiency 88-92%; cathode 99.99% Cu.

### G · Pyrometallurgy & refining (sulphide route)

1. **Drying** of concentrate (~6-9% moisture) to ~ 0.1%.
2. **Flash smelting** (Outokumpu/Outotec) with O₂-enriched air: chalcopyrite + O₂ → Cu-Fe-S matte (~ 65% Cu) + iron-silicate slag + SO₂.
3. **Converting** in Peirce-Smith or Mitsubishi converter: matte → blister Cu (~ 98.5%) + slag + SO₂.
4. **Fire refining** in anode furnace: blister → anode (99.5%) with poling to drive off residual S/O.
5. **Casting** anodes 300-400 kg.
6. **Electrorefining**: copper anode dissolves in CuSO₄/H₂SO₄ electrolyte; cathode (starter sheet or stainless blank, ISA / Kidd process) collects 99.99% Cu.
7. **Anode slime** drops to cell bottom — collected for Au, Ag, Pt, Pd, Se, Te, Bi recovery (significant by-product value).
8. **Off-gas SO₂** → acid plant → sulphuric acid by-product (1.5-2.5 t H₂SO₄ per t Cu).

### H · Transport, packaging, hazard

- **Cu cathode** (LME Grade A): bundled and strapped, ~ 25 t per FCL container, ~ 1900 t per Panamax hold; not DG.
- **Cu concentrate**: bulk vessel; some concentrates classify as **UN 1376 / 1408 / 3190** (self-heating Class 4.2) at high pyrite/high moisture; TML (Transportable Moisture Limit) testing per IMSBC code is mandatory.
- **Anode slime** (Au/Ag/PGM): treat as precious — armed/insured.
- **SX organic** (kerosene + extractant): UN 1268 Class 3 flammable.

### I · Pricing & markets

- **LME** Cu cash + 3-month forward (London Met Exchange); SHFE in Shanghai for Asia premium.
- **Treatment & Refining Charges (TC/RC)**: smelters charge concentrate sellers a USD/t TC + USD/lb RC; benchmark Chinese annual negotiation (CSPT). Record-low TC of ~ USD 10/t was set 2025 because of concentrate scarcity.
- **Payable terms (typical Cu concentrate offtake)**: 96-97% of contained Cu payable; deductions: 1.0-1.2 u Cu (the un-paid first unit), Cu MMR (minimum metal return), penalties for As, Sb, Bi, Hg, F, Cl, U above contractual limits.
- Premium drivers: cathode brand on LME registered-brand list; Asian premium currently ~ USD 80-130/t over LME on Yangshan basis.

### J · EHS

- **Acid Mine Drainage (AMD)** from sulphide tailings — pyrite + O₂ + H₂O → H₂SO₄ + Fe³⁺. Long-tail liability.
- **Tailings Storage Facility (TSF)** stability (Brumadinho, Samarco lessons); GISTM 2020 compliance.
- **SO₂ from smelters** → acid-plant capture mandatory in OECD jurisdictions.
- **Arsenic** in some concentrates (enargite Cu₃AsS₄) → smelter penalty + worker exposure.
- **Cyanidation tailings** if Cu present consumes CN⁻ as Cu(CN)₃²⁻ — important for Cu-Au flowsheets.

### K · Decision triggers for Boji

- Sequential Cu assay (CuT, CuOx, CuCN) **before** flowsheet design — gates flotation vs heap-leach decision.
- "If oxide cap depth × strip > X, heap-leach SX-EW economic at small scale; below X, sulphide-only and concentrate sale."
- Penalty-element screening (As, Sb, Hg, Bi, F, Cl, U) — Boji must catch these before quoting concentrate revenue.
- Always model **by-product Au, Ag, Mo, Co**; un-modelled by-products under-price the asset by 5-30%.
- For DRC-border owners, model **freight to Dar es Salaam port** as a key cost; rail vs road; consider Beira and Walvis Bay alternates.

### L · Sources

- [LME Copper](https://www.lme.com/en/Metals/Non-ferrous/LME-Copper)
- [USGS Copper Statistics & Information](https://www.usgs.gov/centers/national-minerals-information-center/copper-statistics-and-information)
- [International Copper Study Group (ICSG)](https://icsg.org/)
- [Mining.com — TC/RC benchmarks](https://www.mining.com/copper-treatment-charges-record-low/)
- [Outotec / Metso flash smelting](https://www.mogroup.com/portfolio/flash-smelting/)
- [SX-EW chemistry — Cytec / Solvay LIX reagents](https://www.solvay.com/en/markets-products/featured-products/lix-extractants)
- [Tanzanian Mining Commission — Mpanda Cu prospects](https://www.tumemadini.go.tz/)
- [Kabanga Nickel project (Lifezone Metals)](https://lifezonemetals.com/)
- [GISTM 2020 tailings standard](https://globaltailingsreview.org/global-industry-standard/)

---

## 2 · Lead (Pb)

### A · Identity
- Atomic number 82, mass 207.2, density 11.34 g/cm³, melting point 327 °C.
- Crustal abundance ≈ 14 ppm.
- **Galena PbS** — primary; 86.6% Pb; cubic cleavage; classic massive sulphide.
- **Anglesite PbSO₄**, **cerussite PbCO₃** — supergene oxidation products.
- Almost always co-occurs with Zn (sphalerite) and minor Ag.

### B · Geology & deposit types

| Type | Grade | Examples |
|---|---|---|
| **MVT (Mississippi Valley-type)** | 5-10% Pb+Zn | Pine Point, Viburnum Trend, Ozark |
| **SEDEX (sedimentary exhalative)** | 5-15% Pb+Zn | Mt Isa, McArthur River, Red Dog, Sullivan |
| **Irish-type carbonate replacement** | 8-12% combined | Navan, Lisheen |
| **Broken Hill-type (BHT)** | 8-20% combined | Broken Hill, Aggeneys |
| VMS Pb-Zn-Cu | variable | Iberian belt, Kidd Creek |

### C · Tanzania relevance
- Limited but present: **Mkalama, Manyoni, Mpanda** small Pb-Zn-Ag occurrences.
- Most production scenarios are by-product / dual-product with silver dominating revenue.

### D-F · Exploration / mining / beneficiation
- IP for sulphides; gravity for massive sulphides.
- Open-pit or underground sublevel stoping.
- **Differential flotation Pb-Zn** is the textbook flowsheet:
  1. Grind to p80 50-75 µm.
  2. **Pb rougher** at pH 8-10 with KAX/Aerofloat collector + MIBC frother; depress Zn with NaCN + ZnSO₄.
  3. **Pb cleaners** 2-3 stages → Pb con (50-65% Pb).
  4. **Zn activation** with CuSO₄ → Zn rougher with KAX/PAX, lime to pH 10-11.
  5. **Zn cleaners** → Zn con (50-58% Zn).
  6. Tailings to TSF; pyrite often floated separately for acid plant or returned to dam.
- Recoveries: 80-92% Pb to Pb con, 85-92% Zn to Zn con, with high "selectivity index" (penalty for Pb in Zn con and vice versa).

### G · Pyrometallurgy & refining
- Pb con → **sinter machine** (Dwight-Lloyd) to oxidise PbS to PbO + SO₂.
- **Imperial Smelting Furnace** (Pb + Zn together) — vintage but still ~10% of world Pb-Zn.
- Modern: **Kivcet** (Outotec), **QSL** (Lurgi) flash bath smelters → Pb bullion (95-98% Pb).
- **Drossing** removes Cu, As, Sb.
- **Softening** at 700°C with air or PbO → Bi/Sb/As/Sn skim.
- **Parkes process** — add Zn to bullion → Zn-Ag-Au crust separates (silver harvest); then **Harris process** for further refining.
- **Electrorefining (Betts process)** in PbSiF₆/H₂SiF₆ electrolyte → 99.97-99.99% Pb cathode.

### I · Pricing
- **LME Pb** cash + 3M; ranges historically USD 1500-2500/t.
- Concentrate payable: 95% of contained Pb; deductions for impurities.
- Ag credit can dominate revenue — 60-80% of net smelter return on high-Ag galena.

### J · EHS
- **Lead exposure**: hands/dust ingestion → BLL (blood lead level) monitoring; workers and surrounding communities.
- Pb dust deposition around old smelters has long-term health consequences (legacy lawsuits, Doe Run Peru).
- Acid mine drainage from sulphide tailings.

### K · Decision triggers
- Differential-float test work mandatory **before any flowsheet sign-off** — Pb-Zn separation is technically difficult and reagent-dosing-sensitive.
- Silver credit dominates economics; force Ag assay reporting.
- Smelter penalty for Cu, As, Sb, Bi, Hg in Pb con — gate sale value.

### L · Sources
- [USGS Lead Statistics](https://www.usgs.gov/centers/national-minerals-information-center/lead-statistics-and-information)
- [International Lead and Zinc Study Group](https://www.ilzsg.org/)
- [LME Lead](https://www.lme.com/en/Metals/Non-ferrous/LME-Lead)

---

## 3 · Zinc (Zn)

### A · Identity
- Atomic number 30, mass 65.38, density 7.13 g/cm³, melting point 419.5 °C.
- **Sphalerite (Zn,Fe)S** — primary; 50-67% Zn depending on Fe substitution.
- **Smithsonite ZnCO₃**, **hemimorphite Zn₄Si₂O₇(OH)₂·H₂O**, **hydrozincite Zn₅(CO₃)₂(OH)₆** — supergene.
- Sphalerite hosts indium, gallium, germanium, cadmium as trace by-products (significant for In, Ge economics).

### B · Geology — same SEDEX/MVT/BHT/VMS as Pb (co-occurs).

### C · Tanzania — same modest Pb-Zn occurrences (Mkalama / Manyoni).

### F · Beneficiation — see § Pb above (differential flotation).

### G · Hydrometallurgical refining (dominant route)
- Concentrate **roast**: ZnS + 3/2 O₂ → ZnO + SO₂ (fluidised-bed roaster, 950 °C).
- Calcine **leach** in H₂SO₄ (neutral + hot acid leach) → ZnSO₄ solution; Fe precipitated as **goethite, jarosite or hematite** (three competing routes; goethite vs jarosite is a permanent storage-vs-volume trade-off).
- **Purification** by Zn-dust cementation: removes Cu, Cd, Co, Ni, In; cement is harvested for by-products.
- **Electrowinning** at 400-500 A/m² → SHG (Special High Grade) cathode **99.995% Zn**.
- Alternative pyrometallurgical route: Imperial Smelting Process — both Zn and Pb together; declining.

### H · Transport / hazard
- Zn concentrate: bulk vessel; classified Class 9 marine pollutant in some jurisdictions; carries Cd as a worker-exposure flag.
- Zn metal SHG: not DG.

### I · Pricing
- LME Zn; SHFE; ranges historically USD 2000-3500/t.
- Payable: 85% of contained Zn (the 15% deduction is the highest among LME base metals — reflects the cost of the roast-leach-EW process).
- **Critical by-products**: Cd, In, Ge, Ga (China export-restriction risk).

### J · EHS
- Cd exposure (sphalerite contains 0.1-0.5% Cd which reports to refinery process).
- Jarosite / goethite tailings — long-term storage.
- AMD.

### K · Decision triggers
- 85% payable on Zn — Boji must explicitly model this; the headline "55% Zn concentrate" earns roughly 0.85 × 55% × LME, less TC/RC.
- By-product Cd/In/Ge accounting: only a few refiners pay credits; check the offtake terms.

### L · Sources
- [International Lead and Zinc Study Group](https://www.ilzsg.org/)
- [Outotec Zinc Refining](https://www.mogroup.com/portfolio/zinc-direct-leaching/)
- [USGS Zinc Statistics](https://www.usgs.gov/centers/national-minerals-information-center/zinc-statistics-and-information)

---

## 4 · Nickel (Ni) — sulphide vs laterite

### A · Identity
- Atomic number 28, mass 58.69, density 8.91 g/cm³, melting point 1455 °C.
- Two fundamentally different ore families:
  - **Sulphide:** pentlandite **(Fe,Ni)₉S₈** — primary; usually intergrown with chalcopyrite and pyrrhotite in mafic-ultramafic intrusions.
  - **Laterite:** weathered ultramafic — saprolite (silicate Ni in serpentine/garnierite) and limonite (Ni-bearing Fe oxide/goethite).

### B · Geology

| Family | Examples | Grade |
|---|---|---|
| Sulphide | Sudbury (Ontario), Kambalda (WA), Voisey's Bay (NF), Norilsk (Russia), Mt Keith, Jinchuan | 0.6-3% Ni + Cu + Co + PGM |
| Laterite | Indonesia, New Caledonia, Cuba (Moa), Philippines, Madagascar | 1-2% Ni; HPAL or NPI route |

### C · Tanzania — KABANGA: the flagship

- **Kabanga Nickel project** (NW TZ near Burundi border) — high-grade Ni-Cu-Co massive sulphide ranked among the world's top undeveloped Ni-sulphide resources.
- Current operator **Lifezone Metals** (formerly Kabanga Nickel Ltd) with Tanzania government participation; novel **Hydromet refining** route proposed — direct sulphate-leach instead of conventional matte smelter.
- Other TZ Ni-Cu-Co prospects: **Kapalagulu** layered intrusion (NW), **Ntaka Hill** Ni-Co (Lindi/Mtwara, smaller).

### D · Exploration

- **Geophysics:** EM (electromagnetic) is decisive for massive sulphide — electrical conductivity contrast is 4-5 orders of magnitude.
- Pathfinders: Cu, Co, PGE for sulphide; Mg, Cr for laterite.
- Drilling: HQ/NQ core; downhole EM (DHEM); spectral / XRF logging of weathered profile for laterites.

### E · Mining

- Sulphide: underground (Voisey's, Sudbury, Norilsk) or open-pit (Mt Keith); narrow-vein selective in some cases.
- Laterite: strip mining at very low strip ratios; saprolite-zone is high-Mg silicate; limonite-zone is Fe-rich.

### F · Beneficiation & processing

- **Sulphide flotation:** grind p80 50-75 µm; PAX/SIPX collectors; depress Cu with NaCN/SO₂/H₂O₂ for selective Cu/Ni split; Ni concentrate **8-18% Ni** + Cu + Co + PGM.
- **Smelting (sulphide):** flash furnace → Cu-Ni matte → converter → blister matte (high-grade matte ~ 50% Ni) → Sherritt-style hydromet refining (NH₃ leach) → Class I Ni cathode.
- **Laterite (HPAL — High Pressure Acid Leach):** 250 °C, 50 bar, sulphuric acid — selective Ni/Co dissolution; gangue (Mg, Al, Si) stays solid; followed by **MHP** (Mixed Hydroxide Precipitate) or **MSP** (Mixed Sulphide Precipitate) → Cyanex 272 SX to split Co/Ni → NiSO₄ battery-grade product.
- **Laterite (Caron):** reduce + ammoniacal leach (lower capex but lower recovery).
- **Laterite (NPI — Nickel Pig Iron):** Indonesian / Chinese RKEF process, very cheap, but produces ferro-nickel for stainless steel, NOT Class I metal for batteries.

### G · Refining — Class I vs Class II distinction (critical)

- **Class I (LME-deliverable, ≥ 99.8% Ni)** — required for battery sulphate manufacture; sources: Norilsk briquettes, Vale carbonyl pellets, Mond carbonyl, Sherritt rounds, BHP Nickel West briquettes.
- **Class II (ferro-nickel, NPI)** — stainless steel feed only; cannot make NiSO₄ economically.
- This split is the **single most important fact** in the nickel market 2020-2026: EV battery demand wants Class I; Indonesian NPI flooded the Class II side; LME prices reflect a blended market that confuses owners. Boji must model the destination market.

### H · Transport
- Ni metal: not DG; LME brand cathode / briquette / round; FCL container.
- Ni concentrate: bulk vessel; pyrophoric if high-pyrrhotite — TML/IMSBC concerns.
- Ni laterite ore (HPAL feed): bulk vessel; some recent incidents of liquefaction on Philippines-China lateritic shipments.

### I · Pricing
- LME Ni cash + 3M; ranges USD 14,000-30,000/t in 2024-2026 cycle.
- Battery-grade NiSO₄ traded separately (Asian Metal, Fastmarkets) at premium to LME × Ni content.
- Co credit on Ni-sulphide concentrate (1-15% Co payable).

### J · EHS
- **Cancer-linked dust** in nickel refining (lung cancer historical Inco / Sudbury), strictly controlled now.
- HPAL tailings (high acidity, neutralisation needed).
- Mafic-ultramafic asbestos contamination risk in some laterite operations.

### K · Decision triggers
- **Kabanga-class Ni-Cu-Co sulphide prospect**: advise immediate JV with established Ni player (BHP, Vale, Glencore, Sumitomo, Korean POSCO); ASM cannot economically extract; refining requires complex SX cascade.
- **Laterite Ni in TZ**: not currently a feature, but if a prospect emerges, route to HPAL operator (Sumitomo, Nornickel, IXM); ASM-impossible.
- Always compute by-product Co + PGM in sulphide; can flip economics.
- Force model the **Class I vs Class II destination market** — different prices, different buyers, different specs.

### L · Sources
- [LME Nickel](https://www.lme.com/en/Metals/Non-ferrous/LME-Nickel)
- [USGS Nickel Statistics](https://www.usgs.gov/centers/national-minerals-information-center/nickel-statistics-and-information)
- [Lifezone Metals — Kabanga project](https://lifezonemetals.com/projects/kabanga-nickel-project/)
- [Nickel Institute](https://nickelinstitute.org/)
- [Benchmark Mineral Intelligence — battery-grade nickel](https://www.benchmarkminerals.com/)
- [Sumitomo HPAL — Coral Bay technical](https://www.smm.co.jp/E/)

---

## 5 · Tin (Sn)

### A · Identity
- Atomic number 50, mass 118.71, density 7.31 g/cm³, melting point 232 °C.
- **Cassiterite SnO₂** — 78.8% Sn, density 6.8-7.1 (gravity-amenable), the dominant ore.
- **Stannite Cu₂FeSnS₄** — minor; complex sulphide.

### B · Geology
- Granite-related Sn belts: SE Asia (Malaysia, Indonesia, Thailand, Myanmar Bawdwin belt), Bolivia tin belt (Llallagua, Cerro Rico tin), Cornwall (historical), Erzgebirge.
- Alluvial / placer derived from weathering of primary granite veins — Indonesia tin islands, Malaysia kinta valley.
- DRC/Rwanda **3T (tin-tungsten-tantalum)** — coltan-tin association — ITSCI traceability essential.

### C · Tanzania
- Limited Sn; some 3T-trace operations in NW pegmatites. Cross-border DRC/Rwanda far more significant.

### D-F · Mining & beneficiation
- Alluvial: dredge or hydraulic mining → spiral / shaking table / jig (cassiterite SG 6.8-7.1 is gravity-perfect).
- Primary vein: drilling, blasting, narrow-vein selective stoping; crush + grind + gravity (Wilfley table, Mozley, MGS) + magnetic separation (to remove magnetite, wolframite); flotation only for fines / slimes.

### G · Smelting & refining
- Cassiterite concentrate → reverberatory or **Ausmelt** smelter at 1300 °C with coke/anthracite reductant → metallic Sn (~ 95%) + slag.
- Slag retreatment: re-smelt to recover Sn from slag (high-Sn slag is feed to second pass).
- Refining: liquation, pyrometallurgical / electrorefining → 99.85% Sn (LME spec) or 99.99% for electronic-solder grade.

### H-I · Transport / pricing
- Sn metal: LME ingot / pyramid; not DG; FCL.
- LME Sn cash; ranges historically USD 18,000-40,000/t.

### J · EHS
- 3T ASM context in DRC/Rwanda — child labour, conflict-mineral risks; ITSCI / RMI / OECD due-diligence required.
- Cassiterite-bearing tailings often contain U/Th NORM — disposal regulated.

### K · Decision triggers
- Any 3T mineral in NW TZ → ITSCI tagging from day one.
- Cassiterite is gravity-perfect: do not over-complicate with flotation unless dealing with fines.
- Penalty elements in concentrate: As, S, Pb, Bi for solder-grade applications.

### L · Sources
- [International Tin Association](https://www.internationaltin.org/)
- [LME Tin](https://www.lme.com/en/Metals/Non-ferrous/LME-Tin)
- [ITSCI Tin-Tantalum-Tungsten programme](https://www.itsci.org/)

---

## 6 · Aluminium (Al) — bauxite → alumina → metal

### A · Identity
- Atomic number 13, mass 26.98, density 2.70 g/cm³, melting point 660 °C — the most abundant metal in Earth's crust (~ 8%).
- **Bauxite** is the ore — a weathering laterite containing:
  - **Gibbsite γ-Al(OH)₃** — most amenable to low-temp Bayer
  - **Boehmite γ-AlO(OH)** — needs higher Bayer temperature
  - **Diaspore α-AlO(OH)** — hardest, used in some Chinese bauxite

### B · Geology
- Tropical lateritic weathering of Al-rich source rocks (granite, syenite, basalt).
- Major basins: Guinea (45% world reserves), Australia (Weipa, Gove, Huntly), Brazil (Trombetas, Juruti), Jamaica, Indonesia.
- Average grade 45-55% Al₂O₃, < 5% reactive SiO₂, < 25% Fe₂O₃, < 5% TiO₂.

### C · Tanzania
- No bauxite economic deposits in TZ. Some lateritic profiles exist in NE highlands but never economic.

### D · Exploration
- pXRF on weathering profile; auger drilling shallow (10-30 m bauxite profile).
- Lab: Al₂O₃, SiO₂(reactive vs total), Fe₂O₃, TiO₂; Bond Wi; soda consumption test (predicts Bayer reagent cost).

### E · Mining
- Strip mining, dragline + truck-shovel; low overburden.

### F · Beneficiation
- Bauxite typically requires only **crushing, washing, screening** — no flotation/gravity.

### G · Bayer process → alumina

1. Crush bauxite to < 1 mm.
2. **Digestion** in NaOH at 145-280 °C, 30-60 bar: Al(OH)₃ + NaOH → NaAl(OH)₄ (sodium aluminate dissolves; iron, silica, titania stay solid).
3. **Red mud** separation by settling/filtration; major waste stream (1.5-2 t red mud per t alumina); storage controversy (Ajka 2010 dam failure).
4. **Precipitation**: cool the aluminate liquor + seed → Al(OH)₃ precipitates.
5. **Calcination** at 1000-1100 °C → α-Al₂O₃ (smelter-grade alumina, SGA), ≥ 98.5% Al₂O₃.

### H · Hall-Héroult electrolysis → metal

- Dissolve alumina in molten **cryolite Na₃AlF₆** + AlF₃ + CaF₂ at 950 °C.
- Steel cell, carbon-anode (Söderberg or pre-bake), liquid Al cathode at cell bottom.
- 4-6 V, 100-300 kA per cell; current efficiency 92-95%.
- 13-15 MWh per t Al → **single most energy-intensive metal**.
- Tapped liquid Al every 24-48 h; cast as ingot / sow / billet / T-bar.
- Casthouse: alloying to 1xxx-7xxx series; degassing (Ar/Cl₂), filtering, casting.

### I · Pricing
- **LME Aluminium P1020** (≥ 99.7% primary Al) cash + 3M; ranges USD 1900-3000/t recent.
- Regional premia (Midwest US, Rotterdam, Singapore) trade as separate contracts (CME).
- VAP (Value-Added Products): rolled, extruded, foundry alloys priced higher.
- Bauxite traded FOB Guinea / Australia at USD 30-65/t.

### J · EHS
- Red mud / bauxite residue — alkaline, requires neutralisation; landfill controversy.
- HF and PFC emissions from Hall-Héroult cells — major GHG.
- Worker exposure to fluoride and dust.
- The Al smelter is the largest single industrial electricity consumer in many countries.

### K · Decision triggers for Boji
- Tanzania bauxite → not economic; redirect.
- For Al-finished-product local market (window frames, sheets, beverage cans), advise SME owner to import primary metal or scrap-melt, not to attempt primary smelting (electricity-impossible without dedicated hydropower).

### L · Sources
- [International Aluminium Institute](https://international-aluminium.org/)
- [LME Aluminium](https://www.lme.com/en/Metals/Non-ferrous/LME-Aluminium)
- [USGS Bauxite & Alumina](https://www.usgs.gov/centers/national-minerals-information-center/bauxite-and-alumina-statistics-and-information)
- [Bayer process — Light Metal Age technical](https://www.lightmetalage.com/)

---

## 7 · Iron ore (Fe)

### A · Identity
- Atomic number 26, mass 55.85, density 7.87 g/cm³, melting point 1538 °C.
- **Hematite Fe₂O₃** — 69.9% Fe, dominant DSO (Direct-Shipping Ore) source.
- **Magnetite Fe₃O₄** — 72.4% Fe; requires beneficiation but produces premium concentrate.
- **Goethite FeO(OH)** — common in laterites and supergene; high water, lower Fe.
- **Siderite FeCO₃** — minor; high CO₂ on roasting.
- **BIF (Banded Iron Formation)** — sedimentary host, ~ 30-45% Fe, the foundation of every major iron province.

### B · Geology
- BIF basins: Hamersley (Pilbara), Carajás, Minas Gerais (Brazil Iron Quadrangle), Mesabi (USA), Sishen-Kolomela (RSA), Simandou (Guinea, world's largest undeveloped).
- Channel iron deposits (Pilbara channel iron): Pannawonica, Robe River.
- Magnetite skarn: Mexico, China, Iran.
- DSO vs magnetite-pellet feed: DSO is high-Fe ROM that ships directly; magnetite goes through grinding + magnetic separation + pelletisation.

### C · Tanzania
- **Liganga Fe-V-Ti magnetite** (Mchuchuma area, Mbeya region) — ~ 126 Mt @ 51% Fe + 0.8% V₂O₅ + 13% TiO₂; major project linked with Mchuchuma coal for steel-mill power.
- Minor BIF outcrops elsewhere.

### D · Exploration & determination
- **Magnetic survey** is decisive for magnetite (the most magnetically responsive common mineral).
- For hematite, gravity surveys + colour mapping of weathered outcrops.
- **Davis Tube Test (DTT)** — laboratory magnetic concentration test for magnetite-bearing ores; predicts recoverable Fe %.
- **Washability** for high-clay BIF (Tilden-style).
- Lab: ICP-OES + XRF for Fe, SiO₂, Al₂O₃, P, S, alkalis.

### E · Mining
- Open-pit dominant; bench heights 12-15 m; strip ratios 0.5-3.
- Truck-shovel + in-pit crushing/conveying for the largest mines.

### F · Beneficiation
- **DSO**: crush + screen + dry process; no chemical treatment.
- **Hematite low-grade**: gravity (DMS, spirals, jigs) → magnetic separation (LIMS/WHIMS).
- **Magnetite**: grind p80 30-75 µm + magnetic separation (LIMS) + flotation (reverse cationic, amine collector to float quartz, leaving magnetite) → 67-72% Fe concentrate; pelletised with bentonite or organic binder at 1300 °C in induration furnace.

### G · Pyrometallurgy → steel (downstream context)
- Pelletised concentrate or sinter (sintered fines) → **blast furnace** with coke + limestone → pig iron (4-5% C, 95% Fe).
- **BOS (Basic Oxygen Steelmaking)** in oxygen converter → steel.
- Alternatively **EAF (Electric Arc Furnace)** from DRI (Direct Reduced Iron) + scrap.
- DRI / HBI (Hot Briquetted Iron) — emerging "green iron" route via natural gas or hydrogen reduction (Midrex, Energiron, HYBRIT).

### H · Transport
- DSO and concentrate: **Capesize bulk** (180,000-200,000 DWT) on Brazil-China and WA-China routes.
- Pellets: same; specialised handling at port.
- IMSBC: iron ore Group A (TML risk) for fine wet ore.

### I · Pricing
- **62% Fe CFR China benchmark** (Platts IODEX, S&P Global) — daily; ranges USD 80-180/t recent.
- **65% Fe high-grade premium** (cleaner BF burden).
- **58% Fe discount** (lower-grade Australian).
- VIU (Value-In-Use) adjustments: Al₂O₃, SiO₂, P, S, moisture penalties.
- Met coal price + iron price together set blast-furnace steelmaker margin.

### J · EHS
- Dust (silicosis from BIF processing).
- Tailings dam failures — Brumadinho (Vale, Jan 2019, 270 dead), Samarco (Vale-BHP, 2015). GISTM is non-optional.
- Acid drainage from sulphide-bearing BIF horizons.

### K · Decision triggers
- **DSO vs magnetite**: DSO is direct cash; magnetite is capex-heavy. For Liganga-class projects: model both routes plus the vanadium credit.
- Boji must flag **VIU adjustments** — a 0.5% Al₂O₃ swing can be USD 5-10/t.
- TZ-domestic steel-mill opportunity: Mchuchuma coal + Liganga iron = potential integrated steelmaker; Boji should help the owner model the power-plant + furnace + market story.

### L · Sources
- [S&P Global Platts IODEX iron ore](https://www.spglobal.com/commodityinsights/en/our-methodology/price-assessments/metals/iodex-iron-ore-62)
- [USGS Iron Ore Statistics](https://www.usgs.gov/centers/national-minerals-information-center/iron-ore-statistics-and-information)
- [Liganga Iron and Steel Complex — STAMICO](https://stamico.co.tz/)
- [GISTM 2020](https://globaltailingsreview.org/global-industry-standard/)
- [worldsteel — steel production data](https://worldsteel.org/)

---

## 8 · Manganese (Mn)

### A · Identity
- Atomic number 25, mass 54.94, density 7.21 g/cm³, melting point 1246 °C.
- **Pyrolusite MnO₂** — most abundant Mn ore; tetragonal.
- **Psilomelane / Romanèchite (Ba,H₂O)₂(Mn⁴⁺,Mn³⁺)₅O₁₀** — supergene.
- **Rhodochrosite MnCO₃** — carbonate (rare red gem-quality variety).
- **Braunite (Mn²⁺,Mn³⁺)₆SiO₁₂**, **hausmannite Mn₃O₄**, **manganite MnO(OH)** — others.
- Sedimentary nodules on deep-ocean floors (CCZ in Pacific Clarion-Clipperton zone) — frontier "deep-sea mining" controversy.

### B · Geology
- Sedimentary basins: Kalahari (RSA, ~ 80% of world reserves), Moanda (Gabon), Nikopol (Ukraine), Groote Eylandt (Australia).
- Hydrothermal vein / replacement.
- Nodular: deep-sea (CCZ), terrestrial (Mn nodules in laterite).

### C · Tanzania
- Limited; some small ASM Mn occurrences in Mbeya/Mwanza but no commercial deposit.

### D-F · Exploration & beneficiation
- Magnetic / gravity / WHIMS routes; jigs + DMS for coarse-grained ore.
- Lab: XRF for MnO, MnO₂, Fe, SiO₂, Al₂O₃, P (P is a key penalty element).

### G · Smelting
- **Ferromanganese (FeMn)** — Mn ore + coke + flux + scrap iron in **submerged-arc furnace** at 1200-1400 °C → HC FeMn (high-carbon ~ 75% Mn, 6-7% C), MC FeMn (medium-C), LC FeMn (low-C for stainless).
- **Silicomanganese (SiMn)** — similar SAF route with quartz addition → SiMn (65-70% Mn, 14-21% Si).
- **Electrolytic Manganese Metal (EMM)** — sulphate-leach Mn ore → electrowin pure Mn metal (99.7%); China dominates.
- **Manganese sulphate (MnSO₄·H₂O) battery-grade** — emerging high-purity route for NMC cathode (Mn-rich cathodes).

### H · Transport
- Mn ore bulk vessel; not DG; dust suppression for fines.
- FeMn / SiMn lump alloys: bulk or super-sack.
- Battery-grade MnSO₄: super-sack.

### I · Pricing
- **Mn ore 44% CFR China** (Fastmarkets / Argus / Asian Metal); ranges USD 4-6/dmtu.
- FeMn HC: USD 1000-1700/t at port.
- SiMn: USD 900-1500/t.
- Battery-grade MnSO₄: USD 1000-2000/t premium over technical.

### J · EHS
- Manganism (Mn fume exposure → Parkinson-like syndrome) — historical smelter worker disease; controlled in modern plants.
- Tailings: low toxicity but dust.

### K · Decision triggers
- Mn for stainless steel market (FeMn/SiMn) vs battery-grade (MnSO₄) → very different processing routes.
- High-P Mn ore (> 0.10% P) carries smelter penalty for non-stainless feed.
- Boji should track the **deep-sea-mining** regulatory pipeline — Tanzania has no CCZ claim but is a relevant policy debate.

### L · Sources
- [International Manganese Institute](https://www.manganese.org/)
- [USGS Manganese Statistics](https://www.usgs.gov/centers/national-minerals-information-center/manganese-statistics-and-information)
- [Fastmarkets MB — Mn ore index](https://www.fastmarkets.com/)
- [Asian Metal — battery-grade MnSO₄](https://www.asianmetal.com/)

---

## Aggregate decision-trigger cheat sheet (cross-base-metals)

| Decision | Trigger | Boji response |
|---|---|---|
| Sulphide vs oxide Cu route | Sequential Cu (CuT, CuOx, CuCN) | Heap-leach SX-EW if oxide > X depth; otherwise concentrate sale via flotation |
| Pb-Zn differential float | Co-occurrence of galena + sphalerite | Test work mandatory; Ag credit drives revenue |
| Class I vs Class II nickel | Destination market (battery vs stainless) | Different prices, different specs, different refining route |
| HPAL vs sulphide flowsheet | Laterite vs sulphide ore source | HPAL = high capex / only for tier-1 operators; sulphide = standard flotation + smelter |
| DSO vs magnetite concentrate Fe | Hematite vs magnetite mineralogy | DSO = direct cash; magnetite = grinding + magnetic separation + pellet plant |
| FeMn vs MnSO₄ Mn route | End-market | Stainless / steel feed = SAF; battery cathode = sulphate purification |
| Cassiterite gravity vs flotation | Liberation grain size | Gravity-perfect at 50-2000 µm; flotation only for fines |
| Coltan-3T export | DRC/NW-TZ context | ITSCI tag from day one |
| Penalty elements (As, Sb, Hg, F, Cl, U) | Smelter offtake contract | Catch before quoting net revenue |
| By-product accounting (Au, Ag, Mo, Co, In, Ge, Ga, Cd) | Concentrate composition | Always model — under-priced asset risk |

---

## Cross-references
- See `00_MINERAL_PROCESSING_OVERVIEW.md` for the universal flotation chemistry, gravity-separator types, hydrometallurgy concepts and product-grade specs.
- See `01_precious_metals_and_pgms.md` for the Au, Ag, PGM by-product context.
- See `03_battery_and_critical_minerals.md` for the battery-grade Ni, Mn, Co cross-references.
- See `04_energy_minerals.md` for coal/coke (input to BF/BOS).
- See `07_specialty_and_refractory_metals.md` for the Cr, Mo, Ti, Zr family.

— end of base metals dossier —
