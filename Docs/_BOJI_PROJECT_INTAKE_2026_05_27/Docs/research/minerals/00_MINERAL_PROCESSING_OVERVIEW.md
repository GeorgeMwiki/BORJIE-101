# Boji AI — Mineral Processing Overview (cross-cutting reference)

> **Purpose:** the cross-mineral unit-operations framework that Boji's Geology, Metallurgy, Cost Engineer, and Compliance Junior Agents reach for when a specific mineral dossier is consulted. Where this overview disagrees with a per-mineral dossier, the per-mineral file wins.

This file gives the *grammar* of mineral processing. Files 01–08 in this folder give the *vocabulary* per mineral family.

---

## 1 · The universal mining → market pipeline

Every mineral, no matter how exotic, follows the same skeleton from rock to revenue:

```
1.  Geological prospect       (rock in situ)
2.  Exploration & resource    (drill / channel / pit + assay + JORC/43-101/SAMREC)
3.  Pre-feasibility           (cost, recovery, market)
4.  Permitting                (mineral right + EPP/EIA + village/CSR + state participation)
5.  Mine development          (access, camp, road, dewatering, ventilation)
6.  Extraction                (open-pit / underground / placer / ISR / heap leach)
7.  Comminution               (crushing → grinding to liberation size)
8.  Beneficiation             (concentration: gravity / flotation / magnetic / electrostatic / leach)
9.  Hydrometallurgy &/or      (acid/alkaline leach → SX → IX → precipitation)
    Pyrometallurgy            (roast / smelt / convert / fire-refine)
10. Refining                  (electrolytic / chemical purification to product grade)
11. Conditioning & packaging  (bagging / cathode strapping / drum-filling / canning)
12. Transport                 (truck → rail → port → vessel → customer plant)
13. Sale & settlement         (assay-on-arrival / weight-tolerance / payable %)
14. Rehabilitation & closure  (backfill / capping / monitoring / bond release)
```

Each step has cost, recovery, environmental, regulatory, and decision-engine implications. Boji must reason at every step.

---

## 2 · Comminution — the crushing-grinding stage

> **Purpose:** reduce ore particle size until the valuable mineral is *liberated* from the gangue at the desired separation size.

### 2.1 Standard size hierarchy

| Stage | Equipment | Feed top-size | Product p80 | Typical energy (kWh/t) |
|---|---|---|---|---|
| Primary crush | jaw / gyratory | 1500 mm | 100-200 mm | 0.3-1.0 |
| Secondary crush | cone / impact | 100-200 mm | 30-50 mm | 0.5-1.5 |
| Tertiary crush | cone / HPGR | 30-50 mm | 6-15 mm | 1.0-3.0 |
| SAG / ball mill | tumbling mills | 6-15 mm | 75-150 µm | 8-15 |
| Regrind | tower / ISAmill / Vertimill | 50 µm | 10-30 µm | 5-15 |
| Ultra-fine / IsaMill | high-intensity stirred | 30 µm | 5-10 µm | 30-60 |

### 2.2 Bond Work Index (Wi) — the universal hardness number

Wi (kWh/t) measures the energy needed to reduce a mineral from infinite size to 80% passing 100 µm. Typical:

| Ore type | Wi range (kWh/t) |
|---|---|
| Limestone, gypsum (soft) | 7-12 |
| Bauxite | 9-14 |
| Average copper porphyry | 12-16 |
| Gold-bearing quartz | 14-18 |
| Magnetite (hard) | 14-20 |
| Banded iron formation | 14-22 |
| Pyrite-rich refractory gold | 16-24 |
| Tungsten / scheelite | 16-22 |

Boji's Cost Engineer Agent multiplies Wi × tonnes × power-cost per kWh to forecast grinding cost.

### 2.3 Liberation curve

For each mineral pair (e.g., chalcopyrite-in-quartz), a degree-of-liberation curve maps grind size to mineral exposure. Under-grinding leaves locked particles → recovery loss. Over-grinding wastes energy AND creates "slime fractions" that hurt downstream recovery.

**Rule of thumb:** liberation p80 = mean grain size of valuable mineral × 0.5 to × 1.0.

### 2.4 SME-tier shortcut

For ASM gold and gem operations, comminution is dominated by:
- Hammer mills + ball mills for gold reef → 75-150 µm
- Hand-cobbing + jaw + roll mill for gemstone hosts → controlled to preserve crystal size
- For graphite: gentle multi-stage crushing to preserve flake size — the single most expensive feature-decision in graphite

---

## 3 · Gravity concentration

> **Purpose:** separate minerals by specific gravity (SG) difference.

### 3.1 When gravity works

Concentration criterion: **(SGheavy − SGwater) / (SGlight − SGwater)**. Values > 2.5 are easy; 1.5-2.5 require careful work; < 1.5 are usually flotation candidates.

| Mineral | SG | Comment |
|---|---|---|
| Native gold | 19.3 | trivial gravity recovery if liberated |
| Cassiterite (Sn) | 6.8-7.1 | gravity-dominant |
| Wolframite | 7.1-7.5 | gravity-dominant |
| Scheelite | 5.9-6.1 | gravity; UV-fluorescent |
| Magnetite | 5.1-5.2 | gravity + magnetic |
| Hematite | 4.9-5.3 | gravity (DMS) |
| Ilmenite | 4.5-5.0 | gravity + magnetic |
| Zircon | 4.6-4.7 | gravity + electrostatic |
| Garnet (heavy var.) | 3.6-4.3 | gravity for HMS sand |
| Chalcopyrite (Cu) | 4.1-4.3 | usually flotation |
| Sphalerite (Zn) | 3.9-4.1 | usually flotation |
| Galena (Pb) | 7.4-7.6 | gravity + flotation |
| Quartz gangue | 2.65 | reference |

### 3.2 Equipment

| Equipment | Particle range | Use |
|---|---|---|
| Sluice / panning | 0.5-10 mm | ASM gold / gem gravel |
| Jig (Pan-American, IHC) | 0.5-50 mm | Coal washing, Sn, tungsten |
| Spiral concentrator | 50-2000 µm | HMS, Fe ore, Sn |
| Shaking table (Wilfley, Holman) | 50-2000 µm | W, Sn, Au gravity con |
| Knelson / Falcon centrifugal | 25-300 µm | Fine gold gravity |
| Mozley / FAL | 5-100 µm | Lab analytical |
| Dense Medium Separation (DMS) | 1-150 mm | Diamond, Fe (hematite), bauxite |
| Multi-Gravity Separator (MGS) | 1-100 µm | Fine slimes |

### 3.3 Heuristics Boji should apply

- "If host SG > 4 and target SG > 5.5 with > 50 µm grain size, gravity is preferred over flotation for energy reasons."
- "Knelson / Falcon centrifugal is the universal first-pass test for any fine-gold ore."
- "DMS heavy-media (FeSi at SG 2.7-3.2) is the diamond standard; same media works for hematite Fe and HMS sand."

---

## 4 · Flotation — froth-flotation chemistry

> **Purpose:** chemically render the valuable mineral surface hydrophobic, then bubble it to a froth phase that overflows.

### 4.1 Reagent families

| Reagent type | Function | Examples |
|---|---|---|
| **Collector** (anionic xanthate) | makes sulphide surfaces hydrophobic | SIPX, PAX, SIBX, KIBX, KAX — pick by chain length + selectivity |
| **Collector** (dithiophosphate) | sulphide flotation, more selective | Aerofloat 208, Aerofloat 211 |
| **Collector** (dithiocarbamate) | very strong, all-purpose | Z-200, sodium diethyl dithiocarbamate |
| **Collector** (hydroxamate / cationic amine / fatty acid) | oxide / non-sulphide flotation | for cassiterite, scheelite, REE, phosphate, ilmenite |
| **Frother** | reduces surface tension, stable bubbles | MIBC, polyglycol (Dowfroth 250, F-150, F-200) |
| **Modifier (depressant)** | inhibits unwanted mineral | NaCN (Zn, Fe), ZnSO₄ (Zn), SO₂/Na₂S₂O₅ (Zn, Cu in Pb), lime (pyrite) |
| **Modifier (activator)** | activates mineral that wouldn't otherwise float | CuSO₄ for sphalerite |
| **pH regulator** | sets pH for selective flotation | lime CaO, NaOH (up), H₂SO₄ (down) |

### 4.2 Standard flotation reagent regimes by mineral

| Mineral | Collector | Frother | pH | Modifiers |
|---|---|---|---|---|
| Chalcopyrite (Cu) | SIPX or PAX 30-80 g/t | MIBC 20-40 g/t | 10-12 (lime) | depress pyrite with lime |
| Sphalerite (Zn) | KAX after CuSO₄ activation | MIBC | 9-11 | CuSO₄ activator |
| Galena (Pb) | KAX or Aerofloat | MIBC | 8-10 | NaCN to depress Zn, Fe |
| Pyrite | KAX | MIBC | 6-7 | usually depressed, not floated |
| Molybdenite | diesel/kerosene + MIBC | MIBC | 9-10 (lime) | floated from Cu con by depressing Cu with NaSH |
| Nickel pentlandite | PAX/SIBX | MIBC | 9-10 | dextrin/CMC to depress talc |
| Spodumene (Li hard-rock) | fatty acid + amine reverse | MIBC | reverse flotation regime | mica depressed first |
| Phosphate apatite | fatty acid (Floate, oleic) | MIBC | 9 | silicate depression |
| Fluorspar | fatty acid | MIBC | 9-10 | quebracho depresses calcite |
| Bastnäsite REE | hydroxamate / fatty acid | MIBC | 9 | sodium silicate |
| Graphite | diesel/kerosene + MIBC | MIBC | 7-9 | mica/silicate by dextrin |
| Talc | naturally floatable | MIBC | 8 | floated first to remove from other ores |
| Coal (fine, < 0.5 mm) | diesel/kerosene | MIBC | 7-8 | non-selective |

### 4.3 Reverse flotation

In some flowsheets the *gangue* is floated and the valuable mineral reports to the underflow. Examples:
- Iron ore: reverse cationic flotation of quartz (amine collectors); magnetite/hematite stays in concentrate.
- Spodumene: reverse flotation of mica → spodumene rougher.

### 4.4 Tailings and water chemistry

Reagent residues end up in tailings. Boji must:
- Track xanthate biodegradation half-life (hours-days for SIPX, hours for SEX).
- Monitor cyanide in tailings (CN-free regulatory limits, INCO SO₂/air destruction, alkaline chlorination).
- Capture reagent cost per tonne ore — typically USD 0.50-3.50/t for sulphide ore; USD 3-12/t for spodumene / REE.

---

## 5 · Magnetic & electrostatic separation

### 5.1 Magnetic
- **LIMS** (Low-Intensity Magnetic Separator) — recovers magnetite Fe₃O₄ at < 2,000 G.
- **WHIMS / WHIMS-2** (Wet/Dry High-Intensity Magnetic Separator) — at 10,000-25,000 G, recovers weakly magnetic minerals: ilmenite, monazite, hematite, garnet, wolframite.
- **Rare-earth roll / drum** — permanent NdFeB magnets reach 10-12,000 G in compact dry units; ubiquitous in HMS.
- **Eddy-current** — separates non-ferrous metals from waste (recycling rather than mining).

### 5.2 Electrostatic
- **High-tension roll / corona-electrode** — separates *conductors* (rutile, ilmenite, native Au, native Cu) from *non-conductors* (zircon, quartz, kyanite).
- Standard HMS dry-mill flowsheet: ilmenite (magnetic + conductive) → rutile (non-magnetic + conductive) → zircon (non-magnetic + non-conductive).

### 5.3 Sorting (XRF / XRT / NIR / optical)
- **TOMRA / Steinert / BSI / Bourevestnik** — particle-by-particle sort at 50-300 mm; replaces a crushing/grinding stage if liberation is at coarse size.
- **X-ray transmission (XRT)** — diamonds, coal washability.
- **Hyperspectral / NIR** — copper sulphide vs oxide; ore-blending control.

---

## 6 · Hydrometallurgy — leach / SX / IX / precipitation

### 6.1 Leach chemistries

| Lixiviant | Targets | Conditions |
|---|---|---|
| H₂SO₄ + Fe³⁺/MnO₂/O₂ | oxide Cu, sandstone-hosted U, Co, Ni laterite (HPAL), Sc | 25-90°C; HPAL 250°C @ 50 bar |
| HCl | Ta-Nb (HF/H2SO4 combo), Zr (caustic + HCl), some REE | hot |
| Na₂CO₃ + NaHCO₃ (alkaline) | uranium (limestone-host), tungsten, vanadium (salt-roasted) | 70-90°C |
| NaCN + O₂ (cyanidation) | gold, silver | pH 10-11 (lime), 24-72 h, 2-5 ppm DO |
| HNO₃ | silver parting; Ag electrolyte | hot |
| NH₃/(NH₄)₂CO₃ (Caron) | Ni laterite reduction + ammonia leach | reduced calcine |
| H₂SO₄ + heap (oxide Cu) | dump/heap leach Cu | ambient, agglomerated stack |
| Bioleaching (Thiobacillus) | refractory Cu / Au, Co | 35-45°C; archaea up to 65°C |
| Glycine | non-toxic alt to cyanide for Au, Cu | trial/commercial 2020s |

### 6.2 Solvent extraction (SX)

| Reagent | Application |
|---|---|
| LIX 84-I, LIX 984N, Acorga M5640 | Cu PLS → loaded organic → strip with spent electrolyte |
| Cyanex 272 | Co/Ni separation (Co more extractable at lower pH) |
| D2EHPA | Zn impurity removal, Co/Ni, REE |
| PC88A / Cyanex 572 | REE separation cascade (12-18 stages) |
| Alamine 336 | uranium SX from acid sulphate |
| MIBK | Ta/Nb separation; Zr/Hf separation |
| Tributyl phosphate (TBP) | uranium nitrate (PUREX) |
| Versatic 10 | NdPr separation refinement |

### 6.3 Ion exchange (IX)
- Strong-base anion resins for U, V, Mo.
- Weak-acid cation for Sc, REE.
- IX is preferred over SX for *low* lixiviant concentrations (PLS).

### 6.4 Precipitation / cementation
- **Cementation:** Cu cementation onto Fe (legacy), In/Ge cementation onto Zn dust.
- **Hydroxide / carbonate precipitation:** Li₂CO₃, Ni(OH)₂, Co(OH)₂, MHP (mixed hydroxide precipitate).
- **Sulphide precipitation:** MSP (mixed sulphide precipitate) for Ni/Co.
- **Yellowcake:** ammonium di-uranate (NH₄)₂U₂O₇.

### 6.5 Electrowinning
- Cu cathode (LME Grade A) at 250-330 A/m², 2.0-2.2 V; current efficiency 88-92%.
- Zn cathode (SHG) at 400-500 A/m².
- Ni cathode (Class I) from sulphate or chloride.
- Au from cyanide eluate (Zadra / pressure Zadra / AARL) — final dore casting.

---

## 7 · Pyrometallurgy — roast / smelt / convert / refine

### 7.1 Roasting
- **Dead roast:** sulphide → oxide (e.g., ZnS → ZnO + SO₂).
- **Sulphating roast:** keeps metal as soluble sulphate (Cu).
- **Chloridising roast:** converts oxide to chloride (rarely used).
- **Off-gas SO₂:** captured for H₂SO₄ production at the smelter (acid plant).

### 7.2 Smelting
- **Flash smelter (Outotec):** Cu concentrate + O₂-enriched air → Cu-Fe-S matte (~65% Cu) + slag.
- **Isasmelt / Ausmelt / Mitsubishi:** continuous bath smelting; Cu, Pb, Sn.
- **Reverberatory:** legacy Cu, Pb; phased out for energy reasons.
- **Submerged-arc furnace:** ferro-alloys (FeMn, FeCr, FeSi, FeV).
- **Blast furnace:** iron + coke + limestone → pig iron (4-5% C).
- **Electric arc furnace (EAF):** scrap steel + DRI → steel.

### 7.3 Converting
- **Peirce-Smith / Hoboken / Mitsubishi:** Cu matte → blister Cu (98.5%) + iron silicate slag.
- **Pb softening:** Cu, Sn, As, Sb removed from Pb bullion.
- **Bessemer / BOS:** pig iron → steel; carbon blown out by O₂.

### 7.4 Fire-refining → casting
- Cu blister → fire-refined anode (99.5%) → cast as anode plate for electrorefining → cathode (99.99%, LME Grade A).
- Pb softening → Parkes (Zn-Ag-Au crust extraction) → Harris process → Au-Ag refining.
- Doré (Au-Ag) → cupellation → Au sponge → Au bullion (99.5%+).

### 7.5 Vacuum & specialty refining
- Vacuum distillation for Bi, Mg, Hg.
- Zone refining for Si (semiconductor 7N-9N), Ge.
- Mond carbonyl process for Ni: Ni + 4CO → Ni(CO)₄ gas → decompose to ultra-pure Ni.
- Kroll process for Ti, Zr: TiCl₄ + Mg → Ti sponge + MgCl₂.
- Hall-Héroult for Al: Al₂O₃ in molten cryolite Na₃AlF₆ at 950°C, 4-6 V, 100-300 kA per cell.

---

## 8 · Electrometallurgy — beyond electrowinning

| Process | Application |
|---|---|
| Electrorefining (Cu anode → Cu cathode) | Cu, Ni, Pb (Betts), Co, Au (Wohlwill), Ag (Moebius) |
| Molten-salt electrolysis | Al (Hall-Héroult), Mg, Na, Li |
| Anode-slime recovery | Ag, Au, Pt, Pd, Se, Te, Bi from Cu electrorefining slime |
| Electrodeposition | thin films, plating |

---

## 9 · Standard product specifications (quick reference)

| Product | Spec | Buyer test |
|---|---|---|
| Au doré | > 70% Au + Ag remainder | fire assay at buyer or accredited lab |
| Au Good Delivery bar | ≥ 99.5% Au, 350-430 oz, LBMA refiner | LBMA list |
| Ag granules / bars | ≥ 99.9% | fire / electrolyte assay |
| Pt / Pd / Rh sponge | ≥ 99.95% | ICP-MS |
| Cu cathode | ≥ 99.99%, LME Grade A | LME registry brand |
| Zn SHG | ≥ 99.995% | LME brand |
| Pb 99.97-99.99% | LME | LME brand |
| Ni Class I (briquette/cathode) | ≥ 99.8% | LME brand |
| Sn 99.85%+ | LME | LME brand |
| Al P1020 | 99.7%+ | LME brand |
| Steel (multiple grades) | per ISO / ASTM | mill cert |
| Fe ore 62% Fe CFR China | Platts IODEX | spec sheet |
| Coal thermal | 6000 kcal/kg NAR, low S, low ash | spec sheet |
| Coking coal | HCC Australian PLV | CSR/CRI |
| Spodumene SC6 | 6% Li₂O | ICP |
| Li₂CO₃ battery | 99.5%, low Na/Mg/Ca/K | ICP-MS |
| LiOH·H₂O battery | 56.5% LiOH | ICP-MS |
| Co metal / Co sulphate | LME / 20.5% Co | ICP |
| Ni sulphate battery | 22.3% Ni | ICP |
| Nd₂O₃ | ≥ 99.5% / 99.99% / 99.999% | ICP-MS |
| TiO₂ pigment (rutile / anatase) | ≥ 92-99% | spec |
| Zircon flour | ZrO₂+HfO₂+SiO₂ ≥ 98% | spec |
| Cement CEM I 42.5N | ASTM C150 / EN 197-1 | tested at customer |
| Salt food-grade | NaCl ≥ 99.5%, iodised | spec |
| Polished gem | GIA / SSEF / Gübelin grading report | per stone |
| Diamond rough | Kimberley Process Certificate + Rapaport per parcel | per parcel |

---

## 10 · Transport, hazard class & Incoterms

| Material | Hazard / class | Standard Incoterms | Typical packaging |
|---|---|---|---|
| Au doré bar | high security; not formally DG | DDP rare; usually CIP airport | armoured air freight |
| Cu cathode | not DG | FOB / CIF / CFR Asia | bundles strapped |
| Cu / Pb / Zn concentrate | Cu/Pb may be Class 4.2 if pyrophoric | FOB | bulk vessel |
| Zn con | Class 9 marine pollutant | FOB | bulk |
| Pb con | toxic | FOB | bulk |
| Ni Class I metal | not DG | FOB | drum/skid |
| Li₂CO₃ | not DG | CIF / DDP | super-sack |
| LiOH | UN 2680, Class 8 PG II | FCL | drum |
| CoSO₄ | UN 3077 PG III | FCL | super-sack |
| NiSO₄ | UN 3077 + carcinogen | FCL | super-sack |
| Yellowcake U₃O₈ | UN 2912 Class 7 LSA-I | dedicated route | 200-L steel drum in ISO container |
| UF₆ | UN 2978 Class 7 + Class 8 | dedicated | 48Y / 30B Type B(U) |
| Vermiculite | possible asbestos contamination | bulk | per asbestos cert |
| Coal | UN 1361 (self-heating bituminous) | FOB Newcastle / RB / Mtwara | bulk vessel |
| Soda ash | not DG | FOB | super-sack / bulk |
| Salt food | not DG | FOB | bulk |
| Gem rough parcel | not DG; high security | CIP airport | sealed parcel + insurance |
| Diamond rough | KP certificate required | CIP airport | parcel + insurance |
| HMS ilmenite/rutile/zircon | not DG; monazite-bearing is NORM | FOB | bulk vessel |

---

## 11 · Boji's universal decision triggers (apply across all minerals)

1. **Liberation-test-before-flowsheet** — for any new prospect, demand a mineralogical liberation test (QEMSCAN or MLA) before recommending a flowsheet.
2. **By-product credits** — when modelling economics, *always* compute payable for by-product metals (Au-Ag in Cu, Co-Ni in Cu, REE in apatite). Skipping this systematically under-prices the asset.
3. **Payable-vs-deduction at smelter** — most concentrate sales pay a fraction of contained metal (e.g., Cu con 96-97% payable, Pb con 95%, Zn con 85%); the rest is "smelter retention". Boji must encode the payable curve per metal.
4. **Cost-per-recoverable-unit, not cost-per-tonne-ore** — the right unit is USD/recovered g Au or USD/recovered t Cu, *not* USD/t ore. Many SME owners get this wrong.
5. **Refining-route choice** — for Cu, the SX-EW vs concentrate decision is set by oxide-vs-sulphide mineralogy. For Au, BoT vs export route is set by 24-hour-payment availability vs export-premium target.
6. **NORM disclosure** — any heavy-mineral sand or REE prospect that carries thorium → NORM regulatory pathway is required before sale.
7. **Tailings storage facility (TSF) compliance** — Global Industry Standard on Tailings Management (GISTM 2020) is the global standard. Boji must flag every operator's TSF state and dam-stability classification.
8. **Mercury under Minamata** — never advise commercial Hg use; only abatement, retort, banded washing, mercury-free alternatives (borax direct-smelt, glycine, gravity-only).
9. **Cyanide under ICMC** — flag every operator's cyanide-management status; require ICMC-aligned signage, secondary containment, INCO destruction.
10. **Energy intensity per recoverable unit** — power, fuel, water per unit of saleable product is the climate-disclosure metric most buyers now ask for (CBAM, customer scope-3 reporting).

---

## 12 · How Boji's juniors use this file

- **Geology Agent** — uses §1–3 for prospect characterisation and resource estimation; uses per-mineral dossiers (01–08) for deposit-type analogue lookup.
- **Mine Planner Agent** — uses §1, §7 (smelting), §9 (product specs) for offtake planning.
- **Metallurgy Agent (new in v0.4 of the spec)** — owns §2–8 entirely; recommends flowsheets per ore type with confidence and citations.
- **Cost Engineer Agent** — uses Wi from §2, reagent prices from §4, smelter-payable curves from §11.4.
- **Sales / Off-take Agent** — uses §9 (product specs), §10 (logistics).
- **Compliance Agent** — uses §11 (universal triggers) and §10 (hazard class) for every export decision.
- **Safety / EHS Agent** — uses §11 and the per-mineral EHS sections for incident-prevention.

---

## 13 · Living research

This overview is intentionally generic. The eight per-mineral dossiers (01_precious_metals_and_pgms.md through 08_construction_and_heavy_mineral_sands.md) carry the specifics. Either set without the other is incomplete. Both are version-controlled in `Docs/research/minerals/` and ingested into the tenant vector store on first boot.

When the founder adds a new mineral or the team finds a new process route, the relevant per-mineral file is appended with a dated entry, and the changelog at the top of that file is updated.

— end of cross-mineral processing overview —
