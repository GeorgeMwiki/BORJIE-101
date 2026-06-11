# Mining Machinery & Equipment Advisory — World-Class Reference Dossier

**Last Updated:** 2026-06-08
**Audience:** Mr. Mwikila (the Borjie brain layer) and any LLM/engineer wiring the
machinery-advisory surfaces. Chief-engineer / 20-year-asset-manager depth.
**Scope:** The full mobile fleet + fixed plant an autonomous mining-estate MD must
master — excavators, loaders, haul trucks, dozers, drills, crushers, mills (SAG/ball),
screens, conveyors, slurry pumps, gensets, gravity/CIL/flotation processing, gold rooms,
weighbridges — across diagnosis, maintenance strategy, selection/sizing,
lease-vs-buy/financing, and procurement. Tanzania + pan-African ASM-to-mid-tier context
AND global best practice.

> **How to read this.** Each capability area gives (1) what an MD must *diagnose*,
> (2) the *maintenance strategy* that governs it, (3) *selection/sizing* logic,
> (4) *lease-vs-buy/financing* economics, and (5) *procurement* discipline. Every claim
> carries a real URL that was actually fetched or returned by live search. Items I could
> not independently confirm against a fetched page are marked **UNVERIFIED**.

---

## 0. The asset-manager's operating frame (why this matters financially)

- **Mobile fleet maintenance is 40–60% of a typical mine's total maintenance budget** —
  so the haul-fleet reliability program is the single largest controllable cost lever an
  MD has. ([Razor Labs](https://www.razor-labs.com/predictive-maintenance-haul-trucks-ai/))
- **A single haul truck's unplanned downtime costs $50,000–$150,000+ per day in lost
  output** at a producing mine — which is the economic basis for every condition-monitoring
  and predictive-maintenance dollar. ([Razor Labs](https://www.razor-labs.com/predictive-maintenance-haul-trucks-ai/))
- **Mobile equipment (loading + hauling) is typically 40–60% of total material-handling
  cost** in an open-pit operation — so equipment *selection* errors compound for the life
  of the mine. ([SustainE — Equipment Selection & Sizing](https://sustaine.org/equipment-selection-and-sizing-for-optimum-planning-and-design-of-an-open-pit-mine/))
- The governing financial metric for a gold producer is **All-in Sustaining Cost (AISC)
  per ounce**: it folds in *sustaining capital* (the ongoing capex to maintain current
  production), by-product credits, and — post-2019 WGC update — the **principal + financing
  component of lease cash payments**. Every machinery decision (buy, lease, rebuild, defer)
  moves AISC. ([World Gold Council — All-in costs](https://www.gold.org/about-gold/gold-supply/responsible-gold/all-in-costs))

The standards that frame the whole discipline:

| Standard | Role | Source |
|---|---|---|
| **ISO 55000:2024** | Asset-management vocabulary, principles, life-cycle value framework | [ISO 55000:2024](https://www.iso.org/standard/83053.html) |
| **ISO 14224** | Collection & exchange of reliability + maintenance data (failure taxonomy, the standardized data format that makes MTBF/MTTR comparable across assets) | [ISO 14224 — Wikipedia summary](https://en.wikipedia.org/wiki/ISO_14224) |
| **ISO 18436 (series)** | Certification of condition-monitoring personnel: Part 2 = vibration, Part 4/5 = lubricant/oil field & lab analysis | [ISO 18436-1:2021](https://www.iso.org/standard/67515.html) |
| **ISO 4406** | Particle-count cleanliness coding for oil (≥4µm, ≥6µm, ≥14µm three-number code) | (via [Dynamox oil-analysis guide](https://dynamox.net/en/blog/oil-analysis-a-complete-guide-for-your-industry)) |
| **EN 13306** | Maintenance terminology — defines preventive maintenance as work "at predetermined intervals or according to prescribed criteria" to reduce failure probability | (via [Hexagon ALI / Maintenance 5.0](https://aliresources.hexagon.com/operations-maintenance/the-problem-with-maintenance-5-0-and-how-the-new-iso-standards-can-help-maintenance-practices-make-economic-sense)) |
| **ISA-18.2** | Alarm-management standard — "alarm flood" = >10 alarms in a 10-minute window; mining monitoring routinely breaches this | ([Dingo — maintenance data overload](https://www.dingo.com/insights/mining-maintenance-data-overload/)) |

---

## 1. Diagnosis & troubleshooting — condition monitoring as the nervous system

### 1.1 The four condition-monitoring techniques every MD relies on

A structured reliability program in mining runs on four overlapping data streams:

1. **Oil / fluid analysis (SOS-type)** — detects wear metals, contamination, additive
   depletion *before* a failure mode becomes audible or visible.
2. **Vibration analysis** — measured in **mm/s**; the primary detector of imbalance,
   misalignment, bearing and gearbox defects on rotating plant.
3. **Telemetry / telematics** — real-time temperature, pressure, flow, load, fuel.
4. **Inspection routes & operator reports** — the human layer that catches structural,
   leak and bolting defects sensors miss.

These are integrated through an EAM/CMMS that stores "maintenance history, inspection data,
criticality rankings, and reliability strategies for each asset."
([Dingo — structured reliability in practice](https://www.dingo.com/insights/structured-reliability-in-practice/))

### 1.2 Oil / fluid analysis — the cheapest early-warning system in the fleet

Caterpillar's **S·O·S** program (the world's largest in-house OEM fluid-analysis program,
sampling for metals/viscosity/particle-count/contamination since 1968) tests four
categories: ([Cat SOS via Ohio CAT](https://ohiocat.com/service/maintenance/sos-fluid-analysis/))

- **Component wear rate** — wear metals (Fe, Cu, Cr, Al, Pb, Sn…) flag the *source*
  component (Fe = liners/gears, Cu = bearings/bushings/coolers, Cr = rings, Si = dirt
  ingress).
- **Oil condition** — oxidation, sulfur, viscosity drift.
- **Oil contamination** — water, fuel dilution, antifreeze (glycol), soot.
- **Oil identification** — confirms correct oil was used.

Two field heuristics worth wiring into advisory logic:
- **>40% of all engine failures trace to the cooling system** → coolant analysis (glycol,
  SCA, pH, conductivity, corrosion) is not optional.
- Diesel **stored >1 year has a ~50% chance of water/algae contamination** → fuel sampling
  before campaign starts. ([Ohio CAT — SOS](https://ohiocat.com/service/maintenance/sos-fluid-analysis/))

**Ferrography / wear-debris analysis** complements spectrometry because conventional
optical emission spectroscopy *cannot* see large particles; ferrography (a magnetic
separation technique developed in the early 1970s) deposits wear particles 1–250µm on a
ferrogram for microscopic typing of the *wear mode* (rubbing, cutting, fatigue,
spalling). Particle counts are reported as **ISO 4406** three-number codes.
([Dynamox — oil analysis guide](https://dynamox.net/en/blog/oil-analysis-a-complete-guide-for-your-industry))
For bearings specifically, ferrography "gives better ideas of machine deterioration,
specifically at the early stage of machine running."
([Springer — vibration + ferrography for CM](https://link.springer.com/article/10.1007/s40032-013-0079-8))

### 1.3 Telematics & AI predictive maintenance — the mobile fleet

Modern PdM ingests OEM fleet platforms (**Cat MineStar, Komatsu KOMTRAX, Cat ConSite,
Liebherr LiDAT**), historians (**OSIsoft PI**), and mine-management systems
(**Hexagon, Sandvik, Epiroc, Modular MineCare**) via a lightweight data-acquisition
device on the machine bus. Documented detections on haul trucks include:
([Razor Labs](https://www.razor-labs.com/predictive-maintenance-haul-trucks-ai/))

- **Engine** — early-stage fuel-injector degradation *before any OEM fault code fired*;
  combustion imbalance.
- **Cooling** — radiator blockage via gradually rising coolant temperature relative to
  ambient + engine load (detectable *months* in advance).
- **Drivetrain / bearings / hydraulics** — bearing wear and hydraulic leaks.

Performance envelope: **days-to-weeks** advance warning typically, **months** for
radiator/bearing degradation; targeted **30–50% reduction in unplanned downtime**.
([Razor Labs](https://www.razor-labs.com/predictive-maintenance-haul-trucks-ai/))
A separate vendor claims **90%+ accuracy** for common failure modes with **14–30 days**
warning. **UNVERIFIED** beyond the search snippet — treat as a vendor claim, not a benchmark.
([search snippet, Razor Labs / FleetRabbit](https://fleetrabbit.com/blogs/post/mining-fleet-maintenance-uptime))

**Data-overload is the real failure mode of CM programs.** The discipline is to classify
signals as **events** (no action) → **alarms** (immediate operator response) → **alerts**
(assessment by a specialist within hours/days/weeks), and to recognize that "most of what
mining calls an 'alarm' is, by the standard's own definition, an alert." Use
asset-specific calibration (thresholds from *that machine's* history, not generic
benchmarks), alarm conditioning (delay timers, n-out-of-m logic), and expert triage. The
honest KPI: **what % of last quarter's alerts converted into planned work.**
([Dingo — data overload](https://www.dingo.com/insights/mining-maintenance-data-overload/))

### 1.4 Failure-mode crib sheet by asset class (diagnosis)

**Haul trucks / loaders / dozers (mobile):** engine (injectors, combustion, cooling),
transmission/torque converter, final drives & wheel motors, brakes, struts/suspension,
tires; detected by SOS + telematics + vibration. Mobile fleet = 40–60% of maintenance
spend. ([Razor Labs](https://www.razor-labs.com/predictive-maintenance-haul-trucks-ai/))

**SAG / AG / ball mills:**
([WOMP / E&MJ "Minding the Grind" — search snippet, page 403'd on direct fetch](https://www.e-mj.com/features/minding-the-grind-maintenance-options-to-keep-sag-mills-turning/))
- **Trunnion-bearing oil-film collapse** from cooling-water loss; **contamination &
  emulsification of bearing oil causes nearly 18% of SAG-mill circuit shutdowns** (open
  trunnion bearings sealed with rubber rings that fail to keep water/solids out).
- **Ring-gear/pinion misalignment** → audible clatter; **cracks in gears/pinions** that
  progress to tooth breakage.
- **Ball-charge segregation** (small media migrate to discharge, starve the feed end).
- **Slurry wash under the liner** when rubber backing is missing/damaged.
- **Liner-bolt torque must be re-checked after the first 24 h** of new-liner operation —
  loose backing plates can destroy the shell weld in days.
- Major commissioning failures from **inching the mill without adequate lube flow →
  trunnion-bearing wiping.**

**Crushers (jaw/gyratory/cone/impact/roll):**
([Dynamox — crushers & their main failures](https://dynamox.net/en/blog/crushers-5-types-and-their-main-failures);
[FTM — crusher maintenance](https://www.ftmmachinery.com/blog/4-types-of-stone-crushers-and-corresponding-maintenance-methods.html))
- Common to all: **lubrication problems; faulty bearings & gears; misalignment, imbalance,
  unstable bases, bent/deformed shafts, mechanical looseness.**
- **Jaw:** plate wear (severe on single-shaft), choking when output ≠ input flow.
- **Gyratory/cone:** must run with the **chamber ~100% full** (choke-fed) or choking +
  concave deformation; mantle/concave are consumables; **mantle bolt looseness** destabilizes
  the mantle; **overheating lube oil → bearing failure** (cooling, wrong viscosity, internal
  friction).
- **Impact:** highest abrasion wear; non-crushable "tramp" metal causes mechanical damage.
- Liner over-wear roots: highly abrasive feed, poor feed distribution, wrong liner profile,
  operating outside choke feed, wrong CSS (closed-side setting).

**Conveyors:** belt mistracking (misaligned/damaged idlers → spillage, belt damage, jams);
idler-bearing seizure from material build-up / poor sealing; pulley lagging wear; belt
slip. Idlers need scheduled overhaul + correct grease at the seal ring.
([Misumi — idlers](https://in.misumi-ec.com/pr/blog/conveyors/understanding-the-idler-function-installation-and-performance/);
[Woodsage — pulley maintenance](https://www.woodsage.com/conveyor-pulley-maintenance-and-inspection-keeping-your-belt-conveyor-running-smoothly/))

**Slurry pumps (Warman/Metso):** the **throatbush is usually the shortest-lived wet-end
part** (shorter than impeller or liners); wear is driven by hydraulic recirculation at the
impeller/throatbush gap. Adjusting that gap restores efficiency and slows localized wear.
([Weir — WRT impeller/throatbush](https://im-mining.com/2020/07/24/weir-minerals-addresses-pump-impeller-throatbush-wear-life/);
[Weir — adjustment technology](https://im-mining.com/2019/01/09/weir-minerals-enhances-pump-maintenance-adjustment-technology/))

**Gensets:** wet-stacking from chronic <30–40% load (unburned fuel clogs exhaust); injector
wear, dirty filters, low-quality diesel raise fuel burn; over-90% sustained load shortens
engine life. ([asogenset — fuel consumption](https://asogenset.com/diesel-generator-fuel-consumption-chart-real-world-examples/);
[Electrical Trader — load variability](https://electricaltrader.com/blogs/news/load-variability-and-diesel-generator-performance))

**Gold room / weighbridge (process accounting as diagnosis):** a metallurgical balance is
itself a diagnostic — **over a week, gold stripped should equal fine gold poured**;
persistent discrepancy points to **weightometer/weighbridge calibration drift,
gold-in-circuit (GIC) errors, sampling/assay error**, and only "as a last cause" theft.
([911 Metallurgist — gold-room security](https://www.911metallurgist.com/blog/gold-room-security/))

---

## 2. Maintenance strategy — RCM, the strategy selector

### 2.1 RCM logic (function-first)

RCM starts from the *function* a machine performs and asks: "what can cause this function
to fail, what happens when it does, and what is the most cost-effective thing to do about
it?" That function-first logic is what separates RCM from blanket time-based PM, which
applies the same schedule regardless of failure consequence.
([Dingo — structured reliability](https://www.dingo.com/insights/structured-reliability-in-practice/))

RCM produces a **different strategy per failure mode** — some get preventive tasks, some
condition-based monitoring, some redesign, and some are deliberately **run-to-failure** —
because the economics and consequences differ in each case.
([Augury — RCM](https://www.augury.com/blog/asset-care/reliability-centered-maintenance/);
[NASA RCM Guide (PDF)](https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf))

**Documented mining result:** applying RCM to **class-A criticality** equipment achieved a
**91.7% reduction in corrective-maintenance interventions in 2022 vs 2021**, with increased
MTBF and reduced MTTR. ([academia.edu — RCM for automated mining machinery](https://www.academia.edu/109430210/Reliability_Centered_Maintenance_RCM_for_Automated_Mining_Machinery))

### 2.2 The four maintenance strategies (and when each wins)

| Strategy | Trigger | Best for | Note |
|---|---|---|---|
| **Run-to-failure (RTF)** | Failure itself | Low-criticality, cheap, redundant items | Deliberate, not negligent — only where consequence is trivial |
| **Preventive (time/usage-based)** | Calendar or run-hours | Known wear-out (filters, oils, liners) | Use the **greater** of hour-vs-calendar interval ([Cummins PM (PDF)](https://mart.cummins.com/imagelibrary/data/assetfiles/0056662.pdf)) |
| **Condition-based (CBM)** | Measured condition crosses threshold | Rotating plant with measurable degradation | Built on the **P-F interval** (see below) |
| **Predictive (PdM)** | Model/trend forecasts remaining life | High-value mobile + critical fixed plant | AI on telematics + SOS + vibration |

### 2.3 The P-F interval — the heartbeat of CBM/PdM

The whole point of condition monitoring is to act in the window between **P** (potential
failure first detectable) and **F** (functional failure). "If oil analysis indicates early
contamination in a haul-truck engine or transmission, maintenance teams can plan corrective
work before a major failure develops." The longer and more reliably you can detect P, the
more you can convert breakdowns into planned work.
([Dingo — structured reliability](https://www.dingo.com/insights/structured-reliability-in-practice/))

### 2.4 Reliability KPIs (define them once, identically, across the estate — ISO 14224)

- **MTBF** = total operating time ÷ number of failures (higher = more reliable).
- **MTTR** = total repair downtime ÷ number of failures (lower = faster recovery).
- **Availability** = uptime ÷ total time = MTBF / (MTBF + MTTR). Long MTBF + short MTTR =
  high availability.
- **Planned-maintenance %** — mature mines target **well above 80% planned work** (planned
  vs reactive ratio is the single best maturity signal).
([Dingo — structured reliability](https://www.dingo.com/insights/structured-reliability-in-practice/);
[True Geometry — MTBF/(MTBF+MTTR)](https://blog.truegeometry.com/engineering/Analytics_Impact_of_Mean_Time_Between_Failures_on_RCM_FunctionMTBF_MTBF_MTTR_.html))

ISO 14224 exists precisely so these numbers are comparable across plants, owners,
manufacturers and contractors — a standardized **failure taxonomy + data format**. Wire the
estate's reliability data to this taxonomy so cross-site benchmarking is meaningful.
([ISO 14224 — Wikipedia](https://en.wikipedia.org/wiki/ISO_14224);
[Maintenance & Engineering — RM data on ISO 14224](https://www.maintenanceandengineering.com/2017/09/01/reliability-and-maintenance-data-improvement-based-on-iso-14224/))

### 2.5 Criticality analysis & spares (where the maintenance dollars go)

Score every asset on **failure likelihood × consequence**; focus RCM effort on the
**top 10–20% of assets that drive most downtime/cost** — typically haul trucks, crushers,
mills, and life-safety systems get the heaviest effort while low-criticality machines get
lighter schedules. **Spare-parts stocking levels are filtered by the same criticality
score** — hold insurance/critical spares for class-A items (long-lead, single-point-of-
failure: mill pinions, trunnion bearings, transformer, crusher mainshaft), let class-C run
on consignment or just-in-time. ([Dingo — structured reliability](https://www.dingo.com/insights/structured-reliability-in-practice/);
[oxmaint — RCM strategies](https://oxmaint.com/blog/post/effective-strategies-for-implementing-reliability-centered-maintenance))

### 2.6 OEM service intervals (anchor PM here, then optimize with CBM)

- **Gensets:** intervals run daily / weekly / monthly / semiannual / annual / by-run-hours,
  toward a **20,000–30,000 h** service life; in dusty mining air, **filter life can be a
  small fraction of the published interval** — reduce intervals for severe duty. Core tasks:
  general inspection, lubrication, cooling, fuel, batteries, and regular exercise (to avoid
  wet-stacking). ([asogenset](https://asogenset.com/diesel-generator-fuel-consumption-chart-real-world-examples/);
  [Cummins (PDF)](https://mart.cummins.com/imagelibrary/data/assetfiles/0056662.pdf);
  [DEPCO checklist](https://www.depco.com/blog/diesel-generator-maintenance-checklist-for-long-term-reliability/))
- **Mills:** designed to run at **up to ~95% availability**; the lever is eliminating
  unscheduled downtime from liner/bolting failure and maximizing time between relines.
  ([FLS — SAG/AG mills](https://fls.com/en/equipment/grinding/sag-and-ag-mills);
  [search snippet — E&MJ](https://www.e-mj.com/features/minding-the-grind-maintenance-options-to-keep-sag-mills-turning/))
- **SOS-driven interval extension:** fluid analysis lets you safely extend oil-drain
  intervals; Cat cites up to **$2,800 saved and 30% less scheduled-maintenance downtime over
  a 3,000-hour ownership period** on specific equipment from less-frequent service.
  ([Cat — 5 ways fluid analysis minimizes cost (search snippet; direct fetch timed out)](https://www.cat.com/en_GB/support/maintenance/sos-services/5-ways-minimize-costs.html))

---

## 3. Equipment selection, sizing & requirements

### 3.1 Loader↔truck matching — the rules of thumb an MD must know cold

- **Pass-match / 9:1 rule:** size the truck at roughly **9× the loader bucket capacity in
  tons** so trucks are neither under- nor over-utilized (≈ 3–5 passes to fill). A clean
  algebraic version used in fleet design: **truck payload t = 9.0 × S^1.1**, where S =
  loader nominal dipper capacity (yd³).
  ([Volvo CE — 5 factors in truck-size selection](https://www.vcesvolvo.com/5-factors-that-can-impact-haul-truck-size-selection/);
  [SustainE — sizing formulas](https://sustaine.org/equipment-selection-and-sizing-for-optimum-planning-and-design-of-an-open-pit-mine/))
- **Excavator-weight rule:** excavator weight (metric t) ≈ **2× hauler load capacity
  (short ton)** for a good match. ([ARC Journals — loading & haulage selection (PDF)](https://www.arcjournals.org/pdfs/ijms/v5-i2/4.pdf))
- **Fill factor:** target **80–95%** bucket fill; matching evaluates fill factors, loading
  heights, material weights/volumes and number of passes to pick the combination.
  ([Austin Engineering — payload matching](https://www.austineng.com/getting-payload-matching-right/))
- **Compatibility:** the loader's **dump/loading height** must clear the truck body —
  check operational heights before payload math.
  ([Volvo CE](https://www.vcesvolvo.com/5-factors-that-can-impact-haul-truck-size-selection/))

### 3.2 Open-pit sizing formulas (truck-shovel)

([SustainE — Equipment selection & sizing](https://sustaine.org/equipment-selection-and-sizing-for-optimum-planning-and-design-of-an-open-pit-mine/))
- **Loader dipper size:** `S = Tp / (8 × 60)` (Tp = daily tonnage of ore+waste).
- **Number of loaders:** `Ns = (Tp × Lf) / (S × Df × ρ × Ca × E)` where Lf = load factor,
  Df = dipper fill factor, ρ = density, Ca = bucket capacity, E = efficiency.
- **Number of trucks (incl. repair provision):** `Nt = (Ns × Cm × Ct) / Lh` (Cm, Ct =
  matching coefficients, Lh = hauling efficiency).
- **Drill fleet rule of thumb:** ≥2 drills ≤25,000 tpd; 3 drills <60,000 tpd; ≥4 drills
  >60,000 tpd.
- **Calendar basis:** 250 d/yr (5-day) or 350 d/yr (continuous) — pick before you size.

### 3.3 Genset sizing (power plant for off-grid mines)

- **Prime-rated** for continuous variable load / off-grid; **standby** for emergency only
  (≤~200 h/yr).
- **Operate prime sets at 70–80% of rating**; add **20–30% margin** for standby; continuous
  sets are happiest at **70–100%**. Avoid chronic <30–40% (wet-stacking) and sustained
  >90% (life loss). Typical fuel burn **~200–240 g/kWh**, load-dependent.
  ([asogenset](https://asogenset.com/diesel-generator-fuel-consumption-chart-real-world-examples/);
  [Generac — prime vs standby ratings (PDF)](https://legacy.genconnect.generac.com/Media/vwDoc.axd?d=ff9eea42-b8e0-4464-a7ce-d0c340086835);
  [Electrical Trader — load variability](https://electricaltrader.com/blogs/news/load-variability-and-diesel-generator-performance))

### 3.4 Drills — selection by rock & hole

DTH (down-the-hole) vs rotary vs top-hammer chosen by hole diameter, rock hardness and
bench geometry; modern rigs (Sandvik DR412i, Epiroc Pit Viper) use **advanced compressor
management — matching air volume to the application to cut fuel burn and extend engine +
compressor life**, and ship **OEM maintenance kits** to protect major components.
([Sandvik DR412i](https://www.mining.sandvik/en/products/equipment/surface-drill-rigs/dr412i-rotary-blasthole-drill-rig/);
[Sandvik D45KS DTH](https://www.mining.sandvik/en/products/equipment/surface-drill-rigs/d45ks-rotary-blasthole-drill-rig/);
[Epiroc surface blasthole rigs](https://www.epiroc.com/en-us/products/drill-rigs/surface-blasthole-drill-rigs))

### 3.5 Comminution & gravity/CIL selection

- **Add a gravity circuit (jigs/spirals/centrifugal concentrators) ahead of CIL** when the
  ore carries coarse/free gold — recover it before leaching. Gravity is also the dominant,
  mercury-free recovery route for ASM.
  ([911 Metallurgist — gravity gold + flotation + CIL](https://www.911metallurgist.com/equipment/gravity-gold-recovery-rougher-concentrate-flotation-cil-leaching/);
  [Sepro — gold recovery 101](https://www.seprosystems.com/gold-recovery-101/);
  [MDPI — gravity concentration in ASM](https://mdpi.com/2075-163X/10/11/1026/htm))
- **CIL = leach + carbon adsorption in the same tanks** (vs CIP where adsorption follows
  leaching) — simpler tankage, the workhorse for mid-tier gold.
  ([Multotec — gold CIP/CIL flowsheet](https://www.multotec.com/en/gold-cip-cil);
  [ZJH Minerals — CIP/CIL design](https://www.zjhminerals.com/how-to-design-a-cip-or-cil-gold-processing-plant/))
- **Slurry pumps:** select to handle abrasive slurry at the target density; pump and wet/dry
  wear parts are duty-specific — match the pump to the duty point, not the catalog.
  ([Multotec — gold process plant](https://www.multotec.com/en/gold-process-plant);
  [Weir — WBH heavy-duty process pumps](https://www.global.weir/product-catalogue/pumps/warman-wbh-heavy-duty-process-pumps/))

### 3.6 OEM landscape (who supplies what)

| Domain | OEMs | Source |
|---|---|---|
| Haul trucks, excavators, loaders, dozers, rebuilds | **Caterpillar**, **Komatsu**, **Volvo CE**, Liebherr | [Cat support](https://ohiocat.com/service/maintenance/sos-fluid-analysis/), [Volvo CE](https://www.vcesvolvo.com/5-factors-that-can-impact-haul-truck-size-selection/) |
| Surface drills (rotary/DTH/top-hammer) | **Sandvik**, **Epiroc** | [Sandvik](https://www.mining.sandvik/en/products/equipment/surface-drill-rigs/dr412i-rotary-blasthole-drill-rig/), [Epiroc](https://www.epiroc.com/en-us/products/drill-rigs/surface-blasthole-drill-rigs) |
| Crushing, screening, grinding mills | **Metso**, **FLSmidth (FLS)**, Sandvik | [FLS SAG/AG mills](https://fls.com/en/equipment/grinding/sag-and-ag-mills) |
| Slurry pumps, hydrocyclones, mill liners | **Weir Minerals (Warman)**, Metso, Multotec | [Weir Warman WBH](https://www.global.weir/product-catalogue/pumps/warman-wbh-heavy-duty-process-pumps/) |
| Gravity/CIL/flotation, gold-room kit | Multotec, Sepro, 911 Metallurgist, JXSC | [Multotec](https://www.multotec.com/en/gold-process-plant), [Sepro](https://www.seprosystems.com/gold-recovery-101/) |

### 3.7 New vs used vs rebuilt

The **Cat Certified Rebuild** route "returns end-of-life machines to like-new condition at
a fraction of the cost of buying new," with an inspection process that includes **SOS fluid
analysis** + attachment inspection + maintenance-record review — i.e. a second (or third)
machine life. For ASM-to-mid-tier operators, a documented rebuild from a dealer with
warranty often beats both a fragile used import and a cash-draining new purchase.
([Cat — Certified Rebuild via Petersen (PDF)](https://www.petersoncat.com/sites/cat/files/downloads/catcertifiedrebuild.pdf);
[Thompson Machinery — rebuilds](https://thompsonmachinery.com/service/equipment-rebuilds/);
direct fetch of cat.com timed out — these are dealer mirrors of Cat program content)

---

## 4. Lease-vs-buy & financing — the capital decision

### 4.1 The two lease species (get the accounting right)

- **Operating lease** = a true rental: use it, return it; under many standards it stays
  *off* the balance sheet; typically **3–5 years** for equipment (shorter than useful
  life), so payments don't cover full cost and there's a **residual value** at end. Best for
  short-term need, uncertain ground, or capital conservation.
- **Finance (capital) lease** = financing-with-intent-to-own: transfers most ownership
  risks/rewards; equipment sits on your balance sheet as an asset. Best when you have the
  cash flow and expect long-term use.
([VisualLease — finance vs operating](https://visuallease.com/finance-leases-vs-operating-leases-understanding-the-differences-and-asc-842/);
[PwC — ASC 842 lease classification](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/leases/leases__4_US/chapter_3_lease_clas_US/33_lease_classificat_US.html);
[Crestmont — leasing vs financing](https://www.crestmontcapital.com/blog/equipment-leasing-vs.-equipment-financing))

### 4.2 The decision criteria

> Sufficient cash flow + long-term use → **buy/finance** (own the residual). Need to
> conserve capital or short-term/uncertain use → **lease** (flexibility, lower upfront,
> off-balance-sheet under operating treatment).
([Crestmont](https://www.crestmontcapital.com/blog/equipment-leasing-vs.-equipment-financing);
[ICARUS Fund — mining equipment leasing options](https://www.icarus-fund.com/mining-equipment-leasing-finance-options/))

### 4.3 Residual value, buyout & TCO

- Compare the lease **residual against projected resale value**; buyout structure shifts
  who keeps depreciation/residual risk: **$1 buyout** (lessee bears depreciation, keeps
  residual), **FMV** (lessor keeps it), **fixed-percentage** (shared). Buyout options can
  swing total cost of ownership by **10–40%.**
([Crestmont — lease buyout options](https://www.crestmontcapital.com/blog/equipment-lease-buyout-options-what-you-need-to-know))

### 4.4 AISC impact of the financing choice (critical for a gold MD)

Post-2019 WGC guidance includes **the principal portion of the lease cash payment plus the
financing component** in AISC/AIC — so leases are no longer a way to hide equipment cost
out of the headline per-ounce number. **Sustaining capital** (equipment to maintain current
production) is in AISC; **by-product credits** reduce it. The financing structure you pick
literally moves the reported AISC the market judges you on.
([World Gold Council — All-in costs](https://www.gold.org/about-gold/gold-supply/responsible-gold/all-in-costs))

### 4.5 Utilization breakeven (rent vs own)

Rental wins below the utilization breakeven; ownership (buy or finance lease) wins above it,
because rental's per-hour premium only pays off when the machine sits idle enough of the
year. Drive the decision off **expected annual operating hours vs the asset's economic life
and residual** — the same inputs that feed owning-and-operating cost models.
([Cat Performance Handbook — Owning & Operating Costs Sec 20 (PDF, dealer-hosted)](https://www.holtcat.com/Documents/PDFs/2012PerformanceHandbook/Owning%20&%20Operating%20Costs%20-%20Sec%2020.pdf);
[Financial Professionals — lease vs buy capital assets](https://www.financialprofessionals.org/training-resources/resources/articles/Details/how-to-decide-whether-to-lease-or-buy-capital-assets))

---

## 5. Procurement & total cost of ownership

### 5.1 TCO, not sticker price

"Mining procurement isn't just about the upfront price tag — a low-cost machine may end up
costing more due to fuel inefficiency, frequent breakdowns, or high spare-parts expenses,
which is why companies must evaluate **Total Cost of Ownership (TCO).**" Evaluate suppliers
on **product quality, delivery reliability, and after-sales service/support.**
([Minerra — optimizing mining-equipment procurement](https://minerra.co.za/optimizing-your-mining-equipment/))

### 5.2 RFQ/tender discipline (what to lock down in writing)

Confirm **Incoterms / local delivery, lead times, installation requirements, late-delivery
penalties, and warranty length (typically 12–24 months)**; assess after-sales service and
technical-assistance capability. ([eTender SA — RFQ tenders guide](https://etendersa.co.za/rfq-tenders-south-africa/);
[Minerra](https://minerra.co.za/optimizing-your-mining-equipment/))

### 5.3 Local content (pan-African reality)

South African public procurement applies **local-content rules and the 80/20 or 90/10
preference systems** when scoring tenders — a template increasingly mirrored across African
jurisdictions; bake local-content scoring into supplier evaluation.
([eTender SA](https://etendersa.co.za/rfq-tenders-south-africa/))

### 5.4 Aftermarket, lead-time & spares risk (the African TCO killer)

Parts availability and lead time dominate African TCO. Build the supplier network around
**in-country dealer presence + warehoused parts** (e.g. Kanu Equipment in Dar es Salaam),
and watch the **local-manufacturing of spares** trend (Tanzania's EACS spare-parts factory)
that reduces import dependence. ([Kanu Equipment Tanzania](https://www.kanuequipment.com/tanzania-2/);
[African Mining Market — Tanzania parts factory](https://africanminingmarket.com/tanzania-establishes-mining-and-industrial-equipment-parts-factory/19904/))

---

## 6. Tanzania + pan-African ASM-to-mid-tier context

- **Mechanization is the bottleneck.** Typical ASM mechanization is "dry pneumatic drills,
  air blowers, and explosives, with almost no dust reduction (e.g. wet drilling)" — a
  health hazard (silicosis) and a productivity ceiling that the transition to mid-tier must
  break. ([medRxiv — silicosis among Tanzanian small-scale miners (PDF)](https://www.medrxiv.org/content/10.1101/2023.12.13.23299915.full.pdf))
- **Capital access is the second bottleneck.** Government interventions show the gap:
  procurement of **15 modern rock-drilling machines**, **511 mining licences to small-scale
  groups in Geita & Shinyanga**, and **~TZS 30 billion facilitated through financial
  institutions.** ([Tanzania Ministry of Minerals](https://www.madini.go.tz/page/eaf0433c-aabe-43b5-af48-b1fac161b2a8/))
- **Spares localization is changing TCO.** Historically all spares were imported; a local
  EACS factory now lets operators acquire parts more easily, with calls for affordable loans
  to local manufacturers. ([African Mining Market](https://africanminingmarket.com/tanzania-establishes-mining-and-industrial-equipment-parts-factory/19904/))
- **Dealer footprint matters.** Kanu Equipment (Dar es Salaam sales + warehouse) is one of
  the in-country leaders — the kind of aftermarket presence that should weight a TCO/RFQ
  decision more than headline price. ([Kanu Equipment](https://www.kanuequipment.com/tanzania-2/))
- **Gravity-first, mercury-free processing** is the responsible ASM-to-mid-tier upgrade
  path: centrifugal concentrators and gravity circuits recover free gold without mercury and
  scale into a CIL plant as the operation grows.
  ([MDPI — gravity in ASM](https://mdpi.com/2075-163X/10/11/1026/htm);
  [Sepro](https://www.seprosystems.com/gold-recovery-101/))

---

## 7. Gold room, weighbridge & metal-accounting controls

Treat the gold room and weighbridge as the **financial sensor** of the estate, not just
plant: ([911 Metallurgist — gold-room security](https://www.911metallurgist.com/blog/gold-room-security/);
[Western Alliance — gold-room vulnerabilities](https://www.westernalliance.ca/gold-room-vulnerabilities/))

- **Access:** double-locked single-entry with card passes; key-holder/two-person controls so
  no individual has sole access; pour schedules confidential ("very few should know of gold
  pours or pickups").
- **Surveillance:** CCTV + motion sensors at minimum, **≥90-day recording**, seismic/movement
  detectors, alarm switches at vault/office.
- **Equipment in a gold room:** electrowinning cells, eluate tanks, drying ovens, retort,
  **smelting furnace** for the doré pour; lock cathode cake / gravity concentrate / smelted
  product in the strongroom when not actively handled.
- **Reconciliation:** **gold stripped ≈ fine gold poured weekly**, monthly metallurgical
  reconciliation; the strip-summary even **predicts the pour before the pour date**.
- **Discrepancy triage order:** weightometer/weighbridge calibration → gold-in-circuit (GIC)
  → sampling/assay → *theft as last hypothesis.* This ordering is the correct diagnostic
  discipline for an MD investigating a balance gap.
- **Dispatch controls:** secure/tracked transport, encrypted route details, tamper-evident
  seals, daily reconciliation of all metal transfers, digital end-to-end custody tracking.

> **Weighbridge accuracy / OIML calibration:** legal-metrology calibration (OIML R76/R134
> class weighbridge accuracy) underpins both royalty accounting and the metallurgical
> balance. The specific OIML class/tolerance figures were **UNVERIFIED** — no OIML primary
> page was successfully fetched in this pass; flag for a follow-up fetch of the OIML
> recommendation before quoting tolerances.

---

## 8. What to wire into Mr. Mwikila (advisory behaviors)

1. **Per-asset reliability ledger** keyed to **ISO 14224** taxonomy → MTBF/MTTR/availability
   computed identically across the estate; flag assets drifting below their own baseline.
2. **CBM alert pipeline** that classifies event/alarm/alert (ISA-18.2-aware), conditions
   alarms, and reports **alert→planned-work conversion %** as the program KPI.
3. **Criticality-driven spares engine** — class-A insurance spares stocked, class-C JIT;
   reorder points tied to lead time (the African long-pole).
4. **Selection/sizing calculator** baking the 9:1 match rule, `t = 9.0·S^1.1`, fill-factor
   80–95%, and the genset 70–80% load band.
5. **Lease-vs-buy + AISC engine** — utilization breakeven, residual/buyout structure, and
   the WGC lease-into-AISC treatment so every capital choice shows its per-ounce footprint.
6. **TCO-weighted RFQ scorer** — price + fuel + parts lead time + warranty + in-country
   dealer presence + local-content score; never rank on sticker price.
7. **Gold-room/weighbridge balance monitor** — weekly stripped-vs-poured, discrepancy
   triage in the correct order, dispatch custody chain.

---

## Sources (all live-fetched or returned by live search this session)

- Razor Labs — Predictive maintenance for haul trucks (AI): https://www.razor-labs.com/predictive-maintenance-haul-trucks-ai/ *(fetched)*
- Dingo — Structured reliability in practice: https://www.dingo.com/insights/structured-reliability-in-practice/ *(fetched)*
- Dingo — Mining maintenance data overload: https://www.dingo.com/insights/mining-maintenance-data-overload/ *(fetched)*
- Ohio CAT — S·O·S fluid analysis: https://ohiocat.com/service/maintenance/sos-fluid-analysis/ *(fetched)*
- Dynamox — Crushers: 5 types and their main failures: https://dynamox.net/en/blog/crushers-5-types-and-their-main-failures *(fetched)*
- SustainE — Equipment selection & sizing for open-pit: https://sustaine.org/equipment-selection-and-sizing-for-optimum-planning-and-design-of-an-open-pit-mine/ *(fetched)*
- 911 Metallurgist — Gold room security: https://www.911metallurgist.com/blog/gold-room-security/ *(fetched)*
- World Gold Council — All-in costs (AISC/AIC): https://www.gold.org/about-gold/gold-supply/responsible-gold/all-in-costs *(fetched)*
- Dynamox — Oil analysis: a complete guide: https://dynamox.net/en/blog/oil-analysis-a-complete-guide-for-your-industry *(search)*
- Springer — Vibration & oil analysis by ferrography for CM: https://link.springer.com/article/10.1007/s40032-013-0079-8 *(search)*
- ISO 14224 — Wikipedia summary: https://en.wikipedia.org/wiki/ISO_14224 *(search)*
- Maintenance & Engineering — RM data on ISO 14224: https://www.maintenanceandengineering.com/2017/09/01/reliability-and-maintenance-data-improvement-based-on-iso-14224/ *(search)*
- ISO 18436-1:2021: https://www.iso.org/standard/67515.html *(search)*
- ISO 55000:2024: https://www.iso.org/standard/83053.html *(search)*
- Hexagon ALI — Maintenance 5.0 / ISO 55000 / EN 13306: https://aliresources.hexagon.com/operations-maintenance/the-problem-with-maintenance-5-0-and-how-the-new-iso-standards-can-help-maintenance-practices-make-economic-sense *(search)*
- academia.edu — RCM for automated mining machinery: https://www.academia.edu/109430210/Reliability_Centered_Maintenance_RCM_for_Automated_Mining_Machinery *(search)*
- Augury — Reliability-centered maintenance: https://www.augury.com/blog/asset-care/reliability-centered-maintenance/ *(search)*
- NASA RCM Guide (PDF): https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf *(search)*
- oxmaint — Effective RCM strategies: https://oxmaint.com/blog/post/effective-strategies-for-implementing-reliability-centered-maintenance *(search)*
- True Geometry — MTBF/(MTBF+MTTR): https://blog.truegeometry.com/engineering/Analytics_Impact_of_Mean_Time_Between_Failures_on_RCM_FunctionMTBF_MTBF_MTTR_.html *(search)*
- E&MJ — Minding the Grind (SAG mill maintenance): https://www.e-mj.com/features/minding-the-grind-maintenance-options-to-keep-sag-mills-turning/ *(search snippet; direct fetch 403)*
- FLS — SAG and AG mills: https://fls.com/en/equipment/grinding/sag-and-ag-mills *(search)*
- FTM — Stone crushers maintenance: https://www.ftmmachinery.com/blog/4-types-of-stone-crushers-and-corresponding-maintenance-methods.html *(search)*
- Misumi — Idler function/installation/performance: https://in.misumi-ec.com/pr/blog/conveyors/understanding-the-idler-function-installation-and-performance/ *(search)*
- Woodsage — Conveyor pulley maintenance & inspection: https://www.woodsage.com/conveyor-pulley-maintenance-and-inspection-keeping-your-belt-conveyor-running-smoothly/ *(search)*
- Weir/IM — WRT impeller & throatbush wear life: https://im-mining.com/2020/07/24/weir-minerals-addresses-pump-impeller-throatbush-wear-life/ *(search)*
- Weir/IM — Pump maintenance adjustment technology: https://im-mining.com/2019/01/09/weir-minerals-enhances-pump-maintenance-adjustment-technology/ *(search)*
- Weir — Warman WBH heavy-duty process pumps: https://www.global.weir/product-catalogue/pumps/warman-wbh-heavy-duty-process-pumps/ *(search)*
- Volvo CE — 5 factors in haul-truck-size selection: https://www.vcesvolvo.com/5-factors-that-can-impact-haul-truck-size-selection/ *(search)*
- ARC Journals — Loading & haulage equipment selection (PDF): https://www.arcjournals.org/pdfs/ijms/v5-i2/4.pdf *(search)*
- Austin Engineering — Payload matching: https://www.austineng.com/getting-payload-matching-right/ *(search)*
- asogenset — Diesel genset fuel-consumption chart: https://asogenset.com/diesel-generator-fuel-consumption-chart-real-world-examples/ *(search)*
- Generac — Genset prime vs standby ratings (PDF): https://legacy.genconnect.generac.com/Media/vwDoc.axd?d=ff9eea42-b8e0-4464-a7ce-d0c340086835 *(search)*
- Electrical Trader — Load variability & genset performance: https://electricaltrader.com/blogs/news/load-variability-and-diesel-generator-performance *(search)*
- Cummins — Maintenance for genset reliability (PDF): https://mart.cummins.com/imagelibrary/data/assetfiles/0056662.pdf *(search)*
- DEPCO — Diesel generator maintenance checklist: https://www.depco.com/blog/diesel-generator-maintenance-checklist-for-long-term-reliability/ *(search)*
- Sandvik — DR412i rotary blasthole drill: https://www.mining.sandvik/en/products/equipment/surface-drill-rigs/dr412i-rotary-blasthole-drill-rig/ *(search)*
- Sandvik — D45KS DTH blasthole drill: https://www.mining.sandvik/en/products/equipment/surface-drill-rigs/d45ks-rotary-blasthole-drill-rig/ *(search)*
- Epiroc — Surface blasthole drill rigs: https://www.epiroc.com/en-us/products/drill-rigs/surface-blasthole-drill-rigs *(search)*
- 911 Metallurgist — Gravity gold + flotation + CIL: https://www.911metallurgist.com/equipment/gravity-gold-recovery-rougher-concentrate-flotation-cil-leaching/ *(search)*
- Sepro — Gold recovery 101: https://www.seprosystems.com/gold-recovery-101/ *(search)*
- MDPI — Gravity concentration in artisanal gold mining: https://mdpi.com/2075-163X/10/11/1026/htm *(search)*
- Multotec — Gold CIP/CIL flowsheet: https://www.multotec.com/en/gold-cip-cil *(search)*
- Multotec — Gold process plant: https://www.multotec.com/en/gold-process-plant *(search)*
- ZJH Minerals — CIP/CIL plant design: https://www.zjhminerals.com/how-to-design-a-cip-or-cil-gold-processing-plant/ *(search)*
- Cat — Certified Rebuild program (Petersen mirror, PDF): https://www.petersoncat.com/sites/cat/files/downloads/catcertifiedrebuild.pdf *(search)*
- Thompson Machinery — Equipment rebuilds: https://thompsonmachinery.com/service/equipment-rebuilds/ *(search)*
- Cat — 5 ways fluid analysis minimizes cost: https://www.cat.com/en_GB/support/maintenance/sos-services/5-ways-minimize-costs.html *(search snippet; direct fetch timed out)*
- Cat — Owning & Operating costs, Performance Handbook Sec 20 (HoltCAT mirror, PDF): https://www.holtcat.com/Documents/PDFs/2012PerformanceHandbook/Owning%20&%20Operating%20Costs%20-%20Sec%2020.pdf *(search)*
- VisualLease — Finance vs operating leases (ASC 842): https://visuallease.com/finance-leases-vs-operating-leases-understanding-the-differences-and-asc-842/ *(search)*
- PwC Viewpoint — ASC 842 lease classification: https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/leases/leases__4_US/chapter_3_lease_clas_US/33_lease_classificat_US.html *(search)*
- Crestmont — Equipment leasing vs financing: https://www.crestmontcapital.com/blog/equipment-leasing-vs.-equipment-financing *(search)*
- Crestmont — Equipment lease buyout options: https://www.crestmontcapital.com/blog/equipment-lease-buyout-options-what-you-need-to-know *(search)*
- ICARUS Fund — Mining equipment leasing options: https://www.icarus-fund.com/mining-equipment-leasing-finance-options/ *(search)*
- Financial Professionals — Lease vs buy capital assets: https://www.financialprofessionals.org/training-resources/resources/articles/Details/how-to-decide-whether-to-lease-or-buy-capital-assets *(search)*
- Minerra — Optimizing mining-equipment procurement: https://minerra.co.za/optimizing-your-mining-equipment/ *(search)*
- eTender SA — RFQ tenders guide (local content, 80/20, 90/10): https://etendersa.co.za/rfq-tenders-south-africa/ *(search)*
- Kanu Equipment — Tanzania: https://www.kanuequipment.com/tanzania-2/ *(search)*
- African Mining Market — Tanzania equipment-parts factory: https://africanminingmarket.com/tanzania-establishes-mining-and-industrial-equipment-parts-factory/19904/ *(search)*
- Tanzania Ministry of Minerals: https://www.madini.go.tz/page/eaf0433c-aabe-43b5-af48-b1fac161b2a8/ *(search)*
- medRxiv — Silicosis among small-scale Tanzanian miners (PDF): https://www.medrxiv.org/content/10.1101/2023.12.13.23299915.full.pdf *(search)*
- Western Alliance — Gold-room vulnerabilities: https://www.westernalliance.ca/gold-room-vulnerabilities/ *(search)*
- IIED — ASM in Tanzania (PDF, image-based — content not extractable this pass): https://www.iied.org/sites/default/files/pdfs/migrate/16641IIED.pdf *(fetch returned image-only)*
