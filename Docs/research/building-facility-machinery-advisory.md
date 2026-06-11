# Building / Facility Machinery & MEP Plant Advisory — World-Class Dossier

**Audience:** The autonomous real-estate / facilities Managing Director persona (chief-engineer / 20-year asset-manager depth).
**Purpose:** Give Mr. Mwikila (or any Borjie advisory agent) the technical ground truth to diagnose, maintain, specify, finance, and procure the full MEP plant stack across a building portfolio — East-Africa context fused with global FM best practice (IFMA / IWFM-BIFM, ASHRAE, NFPA, HSE-LOLER, ISO, IEC).
**Last researched:** 2026-06-08. All sources below were live-fetched; any claim that could not be confirmed against a fetched page is marked **UNVERIFIED**.

---

## 0. Cross-cutting frameworks an MD must hold in working memory

### 0.1 Maintenance-strategy spectrum (RCM, P-F curve, criticality)
Reliability-Centered Maintenance (RCM) does **not** start from the machine ("what maintenance does it need?"). It starts from the *function* and asks: what can cause this function to fail, what happens when it does, and what is the most cost-effective response per failure mode. RCM is used to build strategy for **existing** assets (sustaining function); FMEA is the design-phase cousin (anticipate/prevent). Full-facility RCM is a multi-year program — successful rollouts are **criticality-prioritized and phased**, proving ROI on highest-consequence assets in Phase 1 before expanding the asset register. ([maximomastery RCM intro](https://maximomastery.com/blog/2026/03/introduction-to-reliability-centered-maintenance-rcm-for-maintenance-professionals/), [NASA RCM Guide PDF](https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf))

The **P-F curve** is the central CBM concept: **P** = point where degradation first becomes *detectable* (vibration rises, gas appears in oil, approach temp creeps); **F** = functional failure. The **P-F interval** (time from P to F) is the parameter that decides whether condition-based monitoring is even feasible — your inspection/monitoring frequency must be **shorter than the P-F interval** to catch it in time. ([maximomastery RCM intro](https://maximomastery.com/blog/2026/03/introduction-to-reliability-centered-maintenance-rcm-for-maintenance-professionals/))

The four strategies an MD allocates per asset by criticality: **reactive** (run-to-failure, only for non-critical cheap assets), **preventive / PPM** (calendar/runtime), **condition-based** (act on evidence), **predictive** (sensor + ML forecast). Best-in-class portfolios blend all four — never one globally.

### 0.2 Vibration standard (ISO 10816 → ISO 20816)
Universal language for rotating plant (pumps, fans, motors, compressors). Severity is **broadband velocity in mm/s RMS**, measured on the bearing housing, **10–1000 Hz** band. Four zones: **A** newly commissioned, **B** acceptable for unrestricted long-term operation, **C** unsuitable for long-term continuous operation (remedial action required), **D** dangerous (immediate action). Indicative for a ~150 HP machine: ≤1.4 mm/s RMS = new/good; <2.8 mm/s = unrestricted operation; 2.8–4.5 mm/s = problem present; for small Class-I machines (≤15 kW) alarm ≈ 4.5 mm/s. Do **not** compare peak/narrowband readings against these RMS limits. ([dspanalytic ISO 10816-3 table](https://dspanalytic.com/en/vibrations/understanding-the-iso-10816-3-vibration-severity-table/), [Acoem ISO 10816-3](https://acoem.us/blog/other-topics/understanding-the-iso-10816-3-vibration-severity-chart/))

### 0.3 Asset register, CAFM/CMMS, lifecycle & CAPEX
A CMMS plans/organizes/directs forward maintenance and collates historical asset-performance data; CAFM automates data-intensive FM functions and improves asset utilization across the whole lifecycle. Best practice: **annual maintenance budgets broken down by category** — planned maintenance, reactive repair, capital replacement, utilities, vendor contracts — benchmarked against IFMA figures; and a **3-year CapEx forecast built on asset-condition data**, including a **deferred-maintenance liability** estimate for ownership reporting. Asset-lifecycle tracking records warranty, repair history, and **TCO**. IFMA practice standards and ISO 41001 both define six core components of an FM plan. ([IFMA CAFM glossary](https://knowledgelibrary.ifma.org/glossary/computer-assisted-facility-management-cafm/), [oxmaint FM plan best practices](https://oxmaint.com/industries/facility-management/facility-management-plan-template-best-practices-2026))

### 0.4 East-Africa operating reality (the context multiplier)
Grid is the variable, not the constant. **63.25% of 2025 African genset demand was standby/backup** — diesel is "insurance against grid collapse" with black-start in seconds for mission-critical loads. **72% of new Kenyan tower sites run hybrid diesel-solar.** Tanzania electrification ≈ **15.3% overall, 3.6% rural**; fuel supply and generator maintenance are genuinely hard in remote towns, pushing solar-hybrid to cut OPEX. Implication for the MD: every building plant strategy must assume **frequent grid outages, fuel-logistics risk, dust/humidity load on filters and coils, and a strong solar-hybrid + battery business case.** ([Mordor Africa diesel genset market](https://www.mordorintelligence.com/industry-reports/africa-diesel-generator-market), [trade.gov Kenya energy guide](https://www.trade.gov/country-commercial-guides/kenya-energy-electrical-power-systems))

### 0.5 Procurement, warranty→AMC, SLAs
The **warranty-to-AMC transition is the highest-risk window** in equipment management — warranty-expiry dates get missed and AMC procurement runs late. Best practice: **initiate AMC procurement ≥90 days before warranty expiry.** SLA response-time benchmarks: **P1 critical 15–30 min, P2 high 1–2 h, P3 medium 4–8 h, P4 low 1 business day.** The single most predictive maintenance KPI is **% of scheduled PPM completed on time** (predicts future reactive volume). Data-center cooling failure damages hardware within minutes; 97% of large enterprises put downtime >$100k/hr. ([IMARC warranty/AMC](https://www.imarcengineering.com/services/warranty-and-amc-coordination), [oxmaint HVAC KPIs](https://oxmaint.com/industries/hvac/hvac-maintenance-kpis-facility-manager-track), [clickmaint AMC glossary](https://www.clickmaint.com/glossary/annual-maintenance-contract-amc))

---

## 1. HVAC — Chillers, AHUs, Cooling Plant

### 1.1 Diagnosis & troubleshooting
**Chiller fault map (symptom → cause → action):**
- **High discharge pressure** → condenser fouling, reduced air/water flow, hot return water, overcharge, non-condensables, bad water-treatment regime → clean condenser tubes/fins, verify fans/pumps, check cooling-tower bypass, recover excess refrigerant, fix water treatment.
- **Low suction pressure** → undercharge, blocked expansion valve, low evaporator flow, low condenser-water temp, clogged strainer → leak check, clean/replace TXV, verify pumps, adjust CT bypass setpoints.
- **High suction pressure** → excess load, TXV overfeeding, overcharge → load shed, adjust superheat / replace valve, recover charge.
- **Electrical**: phase imbalance, loose lugs (thermal-image hot screws), lost phase, ground fault in compressor motor, thermal overload.
- **Controls**: flow-sensor failure blocks start; compressor anti-short-cycle lockout limits restarts. ([Engineering Mindset chiller fault troubleshooting](https://theengineeringmindset.com/chiller-fault-troubleshooting/))

**Condition monitoring / predictive (the lead-time numbers that matter):**
- **Condenser approach temp rising >3°F above baseline = tube fouling**; measurable within 2–3 weeks of onset, giving **4–8 weeks lead time** before severe efficiency penalty.
- **Bearing wear**: vibration-frequency change detectable **4–8 weeks before failure** (plan replacement in a window).
- **Slow refrigerant leak (1–3%/month)**: subcooling/superheat trends detectable **3–6 weeks** out.
- Sensor set: suction/discharge pressures, superheat/subcooling, water in/out temps, current draw, bearing vibration + temp. AI monitoring gives actionable advance warning on **~78% of common chiller failure modes.** ([oxmaint chiller predictive AI/IoT](https://oxmaint.com/industries/hvac/chiller-predictive-maintenance-ai-iot), [uptimecm chiller CM](https://uptimecm.com/condition-monitoring-for/chillers/))

**AHU faults (where the energy actually leaks):** dirty filters add 10–15% static pressure and ~15% energy; **fouled coils raise fan energy 20–30%** and a 20%-fouled coil raises **chiller energy 10–15%**; slipping belts waste 5–10% motor energy; **stuck economizer dampers waste 100% of free-cooling** (20–40% of annual cooling energy in temperate climates). The classic audit finding: a well-specified AHU running **30% degraded** because filters are changed on calendar (not ΔP), coils never cleaned since commissioning, economizer stuck. ([oxmaint AHU maintenance](https://oxmaint.com/industries/hvac/air-handling-unit-ahu-maintenance-filters-coils-belts-controls))

### 1.2 Maintenance strategy
- **PPM**: condenser tube cleaning, eddy-current tube testing, oil analysis (centrifugal), refrigerant leak check, calibrate sensors; AHU filters changed **on ΔP not calendar**, coil cleaning, belt tension, damper actuator stroke check, drain-pan/IAQ.
- **Move chillers/AHUs to CBM**: continuous approach-temp and vibration trending; act on the 3°F / 2.8 mm/s thresholds above.
- **KPI**: kW/ton drift vs commissioned baseline; % PPM on time.

### 1.3 Selection & requirements
- **Efficiency metrics**: **kW/ton, COP, EER, IPLV/NPLV.** IPLV (Integrated Part-Load Value, AHRI 550/590) weights efficiency at 100/75/50/25% load — the right metric because chillers rarely run at 100%. **ASHRAE 90.1** references IPLV for minimum efficiency (e.g., water-cooled centrifugal IPLV target on the order of ≤0.38 kW/ton). **Caveat:** never use IPLV/NPLV to estimate building energy consumption — it's test-condition data, not the building's load profile. ([aircondlounge kW/ton COP EER IPLV/NPLV](https://aircondlounge.com/chiller-efficiency-calculation-kw-ton-cop-eer-iplv-nplv/), [calcengineer IPLV](https://calcengineer.com/hvac/chiller-efficiency-calculator-iplv/), [DOE FEMP efficient chillers](https://www.energy.gov/cmei/femp/purchasing-energy-efficient-electric-chillers))
- **EA selection notes**: air-cooled vs water-cooled trade-off shifts with water scarcity/cost and dust (water-cooled condensers + cooling towers add water-treatment and Legionella burden); favor magnetic-bearing / VFD oil-free centrifugals where part-load hours dominate.

### 1.4 Lease-vs-buy & financing
"**Cooling-as-a-service / chiller-as-a-service**" is delivered through **ESCO Energy Performance Contracts (EPC)** — see §11 for the full model. A planned $500k chiller replacement can be folded into an ESPC, removing it from CapEx and counting it as **cost avoidance** toward the savings stack. ([energy.gov ESPC ESA](https://www.energy.gov/cmei/femp/energy-savings-performance-contract-energy-sales-agreements), [IEA ESCO contracts](https://www.iea.org/reports/energy-service-companies-escos-2/esco-contracts))

### 1.5 Procurement
RFQ on **IPLV/kW-ton at specified conditions** (apples-to-apples across OEMs), spare-parts lead time, refrigerant type/phase-down exposure, AMC with response SLA, eddy-current tube-test cadence. Start AMC ≥90 days before warranty expiry.

---

## 2. Elevators & Escalators

### 2.1 Diagnosis & condition monitoring
IoT sensors track **vibration, temperature, door-cycle and ride parameters**; can detect **bearing wear weeks before** a human inspector, with first actionable predictive alerts typically **14–21 days after sensor activation** (baseline build). ML on historical data flags patterns preceding door, drive (PMSM), and traction failures. ([oxmaint hotel elevator/escalator IoT](https://oxmaint.com/industries/hospitality/hotel-elevator-escalator-iot-condition-monitoring), [buildings.com top-10 IoT elevators](https://www.buildings.com/home/article/10186013/predictive-maintenance-top-10-ways-iot-is-changing-elevators))

### 2.2 Maintenance strategy & statutory inspection (LOLER — the hard rule)
Under **LOLER 1998** (UK, the global reference EA jurisdictions broadly mirror):
- **Equipment lifting people (passenger lifts): thorough examination every 6 months.**
- **All lifting accessories: every 6 months.**
- **Other lifting equipment (loads only): every 12 months.**
- The **competent person** must be **independent/impartial** — **must not be the same person who does the routine maintenance** (no marking your own homework). They perform a systematic, detailed examination and produce a **written report** (LOLER Schedule 1) stating: examination date, **date next exam is due**, and any defect that is or could become dangerous.
- On a **serious defect**: report **verbally and immediately** to the dutyholder, then in writing, **with a copy to the enforcing authority**; equipment **cannot be used until remedied.** ([HSE thorough examinations lifting equipment](https://www.hse.gov.uk/work-equipment-machinery/thorough-examinations-lifting-equipment.htm), [HSE INDG339 lifts](https://www.hse.gov.uk/pubns/indg339.htm), [HSE LOLER overview](https://www.hse.gov.uk/work-equipment-machinery/loler-overview.htm))

PPM is **separate from and in addition to** the statutory thorough examination — examination is not a substitute for maintenance. ([HSE INDG339 lifts](https://www.hse.gov.uk/pubns/indg339.htm))

### 2.3 Selection, lease-vs-buy, procurement
- **Selection**: traffic analysis (handling capacity / interval), machine-room-less (MRL) gearless for energy, regenerative drives, destination-dispatch for high-rise.
- **Lease/finance**: lifts are usually owned + covered by a **comprehensive maintenance contract** (full-cover vs basic/parts-extra). OEM "connected" contracts bundle IoT predictive monitoring.
- **Procurement**: contract must explicitly include statutory thorough-examination scheduling, **entrapment response SLA (P1)**, parts availability for obsolete controllers, and independence of the examining body.

---

## 3. Generators / Gensets (Standby Power)

### 3.1 Diagnosis & troubleshooting
**#1 failure-to-start cause = battery** (sulfation, loose connections, low charge). Other crank-but-won't-start: low/contaminated/stale fuel, clogged fuel filter, air in fuel lines, injection issues, blocked air intake, block-heater failure (cold-start over-crank), louvers failing to open (suffocation/overheat), rodent damage to wiring, breaker/false-alarm shutdowns. ([dieselgeneratortech fail to start](https://www.dieselgeneratortech.com/diesel-generators/why-diesel-generator-fail-to-start.html), [woodstockpower common problems](https://woodstockpower.com/blog/common-generator-problems/))

**Wet stacking** = unburned fuel/carbon in exhaust from running too long on **light load** (engine never reaches correct operating temp). Symptoms: black/oily exhaust residue → power loss, high EGT, fouled injectors, carbon on valves/turbo, **fuel diluting the oil** (premature wear). It is the silent killer of under-loaded standby sets — extremely relevant in EA where sets are oversized "just in case." ([CK Power wet stacking](https://ckpower.com/wet-stacking-avoid/), [Trystar load bank wet stacking](https://www.trystar.com/article/how-do-load-banks-prevent-generator-wet-stacking/))

### 3.2 Maintenance strategy & statutory testing (NFPA 110 — the reference)
- **Monthly test**: run **≥30 minutes** at **≥30% of nameplate kW** *or* at sufficient load to reach the **manufacturer's minimum EGT** (whichever the AHJ requires). Exercise the transfer switch monthly (primary→alternate→back).
- **Annual load-bank test** (required when monthly minimums aren't met from building load): **50% nameplate for 30 min, then 75% nameplate for 1 hour — total ≥1.5 continuous hours.** Burning EGT into the normal band clears wet-stacking deposits.
- **Level 1 systems**: a deeper test **at least every 36 months** for full assigned class duration (max 4 h), ≥30% load.
- **Fuel quality test ≥ annually** (ASTM D975 for diesel).
- **Batteries**: inspect **weekly**; lead-acid specific-gravity (or conductance) test **monthly**; replace on defect.
- **Records**: date, technician, any unsatisfactory condition + corrective action/parts, retest. ([Curtis Power NFPA 110 testing](https://www.curtispowersolutions.com/nfpa-110-maintenance-testing), [GenServe annual load-bank](https://genserveinc.com/2022/01/14/annual-load-bank-testing-could-be-the-most-critical-maintenance-for-your-generator/))

### 3.3 Selection, lease-vs-buy, procurement
- **Sizing**: derate for altitude/ambient (critical for highland EA sites — Nairobi/Arusha ~1,400–1,800 m); avoid the chronic-oversize trap that causes wet stacking; consider **paralleling smaller sets** for load-following efficiency and N+1 redundancy.
- **Lease / rental**: **generator rental** is a mature EA option for temporary/peaking/bridging needs and to avoid CapEx on rarely-run standby capacity; hybrid diesel-solar-battery (see §4) cuts diesel hours and fuel logistics. ([Mordor Africa diesel genset market](https://www.mordorintelligence.com/industry-reports/africa-diesel-generator-market))
- **Procurement**: AMC with fuel-polishing, load-bank service included, response SLA for black-start failure (P1), genuine-parts and filter lead times, fuel-storage/stability management.

---

## 4. Solar PV & Batteries (BESS)

### 4.1 Diagnosis & monitoring
- **Module degradation ≈ 0.5%/year** (PV O&M best-practice baseline); climate accelerates it (hot-dry / hot-humid worse — directly relevant to EA).
- **Performance Ratio (PR)**: target **~85%**, with **availability ~95%** achievable; "normal" = operating within **80% of weather-corrected PR**. Track production hourly/daily/monthly/annually vs model.
- **Inverter** = the highest-failure component: nuisance tripping, clogged air filters → overheat/derate. Use **condition-based** response (diagnose root cause after trips, not blind restart). **IR/UV thermal imaging** finds hidden module damage (hot cells, PID, diode failure) especially after weather events; IV-curve tracing for string diagnostics. ([DOE FEMP PV O&M lifecycle](https://www.energy.gov/cmei/femp/life-cycle-photovoltaic-systems-operate-and-maintain-existing-photovoltaic-system), [NREL performance loss rate PDF](https://docs.nrel.gov/docs/fy23osti/85463.pdf))
- **BESS**: the **BMS** monitors per-cell voltage/temp/current, computes SoC/SoH, balances cells, triggers protection cut-offs. **End-of-life = 60% capacity retention or 20 years.** Largely hands-off / no weather upkeep, but inspect per OEM schedule (commercial systems more frequently). ([SurgePV battery monitoring/BMS](https://www.surgepv.com/hub/energy-storage/monitoring-management/), [Power Factors BESS O&M Q&A](https://www.solarpowerworldonline.com/2024/04/qa-with-power-factors-on-large-scale-battery-om-considerations/))

### 4.2 Maintenance strategy
Preventive (panel cleaning — **dust is a major EA derate driver**, wire management, scheduled inspection); corrective (component replacement — **14–22% of annual O&M cost**, insurance 19–21%); condition-based (electrical inspection after inverter trips). ([DOE FEMP PV O&M lifecycle](https://www.energy.gov/cmei/femp/life-cycle-photovoltaic-systems-operate-and-maintain-existing-photovoltaic-system))

### 4.3 Selection, financing, procurement
- **Selection**: PR / specific-yield warranties, inverter MTBF, module degradation warranty (typically ~80%+ output at 25 yr — **UNVERIFIED** exact figure), DC:AC ratio, battery chemistry (LFP for safety/cycle life in commercial standby).
- **Financing**: **EaaS / PPA / solar-lease** are dominant in EA (e.g., industrial-solar "save up to 60%" models, mini-grid + battery + backup-genset) — owner avoids CapEx, pays per kWh or fixed monthly < grid+diesel cost. ([Ariya Finergy industrial solar EA](https://ariyafinergy.com/), [trade.gov Kenya energy guide](https://www.trade.gov/country-commercial-guides/kenya-energy-electrical-power-systems))
- **Procurement**: bankable EPC contractor, performance-ratio guarantee with M&V, O&M contract with cleaning cadence tied to soiling rate.

---

## 5. Electrical — Switchgear & Transformers

### 5.1 Diagnosis & condition monitoring
**Transformers** — five core CM activities: visual inspection, **oil testing**, **infrared (IR) scanning**, electrical testing, **partial-discharge (PD) testing**.
- **DGA (Dissolved Gas Analysis) is the single most powerful predictive tool** — fault gases dissolve in oil **months before** any external symptom. Example marker: **H₂ > 100 ppm with a rising trend → active partial discharge.** Different gas patterns map to overheating, arcing, PD, insulation breakdown.
- **Thermography caveat**: heat is a *final* failure mode; some internal transformer faults **never surface** externally — so IR alone is insufficient, pair it with DGA.
- Best practice = **hybrid**: periodic lab sampling for baseline/trend accuracy + continuous online DGA monitoring for real-time detection between samples. ([oxmaint transformer DGA/oil predictive](https://oxmaint.com/industries/power-plant/predictive-maintenance-transformer-power-plant-dga-oil-analysis), [SDMyers PD testing](https://www.sdmyers.com/transformer-services/testing-monitoring/partial-discharge-inspection/))

**Switchgear** — IR thermography on connections (hot lugs = loose/oxidized), PD detection in MV gear, contact-resistance and timing tests on breakers; ML + novel sensors emerging for MV switchgear predictive. ([oxmaint switchgear/transformer FM](https://oxmaint.com/industries/facility-management/electrical-transformers-switchgear-maintenance-facilities))

### 5.2 Maintenance strategy
PPM: annual IR survey under load, breaker exercise/contact-resistance, oil DGA cadence (annual baseline, accelerate on rising gas), tighten/torque connections, cleanliness, relay testing. Move critical transformers to **continuous online DGA** (CBM).

### 5.3 Selection, financing, procurement
- **Selection**: dry-type vs oil-filled (fire/indoor vs cost/efficiency), low-loss/amorphous-core efficiency, k-factor for harmonic loads, switchgear withdrawable vs fixed, arc-flash rating.
- **Procurement**: routine + type-test certificates, FAT witnessing, spare-breaker/relay lead times, AMC including IR + DGA service.

---

## 6. Fire Detection (NFPA 72) & Suppression (NFPA 25)

### 6.1 Fire alarm / detection — NFPA 72
- **Frequencies**: monthly (often facility-staff functional checks of panels/visual), **semi-annual** and **annual** comprehensive tests by qualified technicians; control panels weekly/monthly visual + annual test.
- **Smoke-detector sensitivity**: test **within 1 year of install, then every other year**; after the second pass within listed range, interval may extend to **max 5 years**. Out-of-range detectors must be **cleaned + recalibrated or replaced.**
- **Detector replacement**: smoke detectors replaced **10 years from manufacture date** regardless of passing tests.
- **Records retained ≥5 years.** ([fireservicepro NFPA 72 ITM](https://www.fireservicepro.com/Fire-Alarms/NFPA-72-fire-alarm-tests-inspections.html), [firesafetyalarms NFPA 72](https://firesafetyalarms.com/nfpa-72-testing-and-inspection-requirements-what-you-need-to-know/))

### 6.2 Water-based suppression & fire pump — NFPA 25
- **Fire-pump weekly/monthly no-flow (churn) test (§8.3.1)**: run no-flow **≥10 min electric / ≥30 min diesel**; confirm start, no overheating, normal controller readings.
- **Annual flow test (§8.3.3)**: full-performance at **three points — no-flow (churn), 100% rated capacity, 150% rated capacity.**
- **Internal pipe inspection every 5 years** (corrosion/scale/obstruction).
- General cadence is tiered monthly/quarterly/annual/multi-annual by component. ([NFPA churn-test blog](https://www.nfpa.org/news-blogs-and-articles/blogs/2022/09/09/weekly-or-monthly-no-flow-churn-tests-of-fire-pumps), [emergent NFPA 25 testing](https://www.emergent.tech/blog/nfpa-25-testing-requirements), [tfp1 NFPA 25 frequency](https://www.tfp1.com/blog/nfpa-25-inspection-frequency/))

### 6.3 Selection / procurement
Detection: addressable vs conventional, multi-sensor/aspirating (VESDA) for high-value/clean spaces. Suppression: wet vs dry vs pre-action vs gaseous (clean-agent for electrical/IT). Procurement must bind ITM cadence above to the AMC, with certificated technicians and AHJ-acceptable documentation.

---

## 7. Water Pumps, Boosters & Plumbing/Sanitary

### 7.1 Diagnosis & condition monitoring (centrifugal pumps)
Common failures: bearing wear, impeller imbalance/damage, shaft misalignment, **cavitation**, water hammer, seal degradation.
- **Cavitation** sounds like "gravel/rocks" through the pump (collapsing vapor bubbles); unchecked it **destroys an impeller in 4–8 weeks.**
- **Minimum viable sensor set**: one **triaxial vibration sensor on the drive-end bearing housing + an RTD for bearing temp** catches **70–75% of failure modes.**
- A **bearing running 15–20°C above baseline is ~2–4 weeks from failure.** Cavitation produces distinctive current pulsations; bearing faults show vibration sidebands; impeller wear shows gradual current baseline drift. ([oxmaint pump predictive guide](https://oxmaint.com/industries/manufacturing-plant/pump-predictive-maintenance-guide-centrifugal-positive-displacement-ai-monitoring), [denverpumps cavitation](https://denverpumps.com/why-does-my-centrifugal-pump-cavitate-causes-detection-prevention/))

### 7.2 Maintenance strategy & water hygiene
- PPM: seal/bearing inspection, alignment (laser), strainer cleaning, NPSH/suction checks, VFD tuning.
- **Legionella control is a life-safety + statutory hygiene duty**: growth favored at **water temps 25–43°C (77–108°F)**, stagnation, scale/sediment, biofilm. VFD booster sets that ramp to low speed need only a small (≈30-gal) hydropneumatic tank, reducing stagnant stored volume. PPM: tank cleaning/disinfection, temperature regime (hot ≥60°C stored / ≥50°C at outlet, cold <20°C — **UNVERIFIED** exact EA-jurisdiction figures), flushing of dead legs. ([Towle-Whitney Legionella harbors](https://towle-whitney.com/4-tips-to-mitigate-legionella-harbors%E2%80%8B-in-the-mechanical-room/), [Aqua Science VFD booster](https://aquascience.net/blog/post/variable-frequency-drives-vfd-in-residential-booster-pumps-optimizing-performance-and-energy))

### 7.3 Selection, financing, procurement
- **Selection**: right-size the booster package; **VFD + smart controls** is the best lever for energy + constant pressure + reduced wear (routine maintenance can extend service life ~30%). Duty/standby/assist multi-pump for resilience. ([Armstrong domestic booster intro](https://blog.armstrongfluidtechnology.com/an-introduction-to-domestic-water-pressure-booster-pumps), [Xylem B&G booster design manual PDF](https://www.xylem.com/siteassets/brand/bell-amp-gossett/resources/manual/teh-1096b-domestic-water-pressure-booster-design.pdf))
- **Procurement**: spare mechanical seals/bearings stocked, VFD parameter backup, AMC with vibration trending.

---

## 8. STP / Water Treatment

### 8.1 Diagnosis & monitoring (process faults)
- **Low dissolved oxygen (DO)** → sludge bulking + incomplete nitrification → high effluent ammonium. DO control is the master lever (also prevents over-aeration energy waste).
- **Sludge bulking** (poor settling) → wasting excess sludge at correct intervals maintains process stability; SBR's controlled settle phase usually settles better than continuous-flow.
- **MBR**: **membrane fouling** is the signature problem — monitor transmembrane pressure/flux, run regular chemical cleaning (CIP).
- Instrument with **SCADA + DO/pH/nutrient sensors** to optimize. ([sewagetreatmentplants.in improve STP](https://www.sewagetreatmentplants.in/how-to-improve-stp-water-quality/), [teamonebiotech SBR guide](https://www.teamonebiotech.com/blog/sequencing-batch-reactors-sbr-for-wastewater-treatment-a-comprehensive-guide/), [kelvinwatertreatment MBR STP](https://kelvinwatertreatment.com/blog/mbr-stp/))

### 8.2 Maintenance strategy
PPM: blower/diffuser service (fine-bubble diffusers for O₂-transfer efficiency), pump/aerator inspection, membrane CIP cadence (MBR), sludge wasting schedule, effluent-compliance lab testing, odor control. Energy strategy: efficient blowers + DO-trim control.

### 8.3 Selection, financing, procurement
- **Selection** by tech trade-off: **SBR** (low O&M, shock-load tolerant, good settleability, batch), **MBR** (smallest footprint + reuse-grade effluent but fouling + energy), **MBBR**, **ASP**. Choose for EA water-reuse value (irrigation/flushing) and operator-skill availability. ([nihaowater MBBR vs MBR vs SBR](https://www.nihaowater.com/news/mbbr-vs-mbr-vs-sbr-vs-sbbr-vs-asp-a-comprehensive-guide-to-wastewater-treatment-technologies.html))
- **Procurement**: O&M contract with **guaranteed effluent-compliance KPIs**, consumables (membranes/media/chemicals) lead time, operator training.

---

## 9. BMS / IoT & Fault Detection & Diagnostics (FDD)

### 9.1 The analytics layer over all plant
- **ASHRAE Guideline 36** = industry-standard, uniform HVAC control sequences with **embedded FDD logic** (sensor faults, mode conflicts, overrides). Most buildings already have the signals needed for the highest-priority G36 fault rules: supply/return/mixed air temp, valve positions, fan speed, filter ΔP.
- **The size of the prize**: poorly maintained/degraded/mis-controlled equipment wastes **15–30% of energy.** FDD platforms commonly **pay back their subscription within ~90 days** from caught faults; AFDD shifts the org from reactive service calls to proactive maintenance. ([carbonconnector ASHRAE 36 + FDD](https://carbonconnector.com/blog/incorporating-ashrae-36-into-fdd-solutions-limitations-and-potential/), [csemag HVAC FDD benefits](https://www.csemag.com/your-questions-answered-what-are-the-benefits-of-hvac-fault-detection-plus-how-to-specify-it/))

### 9.2 Strategy & procurement
Layer an **independent analytics/FDD platform** over the BMS (vendor-neutral), feed it chiller/AHU/pump/meter points, and prioritize rules by energy + comfort + criticality. Procurement: open protocols (BACnet/Modbus/MQTT), data ownership, point-list completeness, M&V of savings.

---

## 10. Predictive-Maintenance lead-time cheat-sheet (for the MD's fast recall)

| Asset | Earliest detectable signal | Threshold / signature | Typical lead time |
|---|---|---|---|
| Chiller condenser | Approach temp ↑ | **>3°F above baseline** | 4–8 weeks |
| Chiller bearing | Vibration freq change | ISO 20816 Zone C/D | 4–8 weeks |
| Chiller refrigerant | Subcool/superheat trend | 1–3% charge loss/mo | 3–6 weeks |
| Pump bearing | Bearing temp ↑ | **15–20°C above baseline** | 2–4 weeks |
| Pump cavitation | "Gravel" noise / current pulsation | impeller erosion | destroys impeller 4–8 wk |
| Transformer | DGA fault gas | **H₂ >100 ppm rising** | months |
| Elevator | Vibration/door-cycle | bearing wear pattern | weeks (alerts 14–21 d after sensor on) |
| Rotating plant (general) | Velocity RMS | **>4.5 mm/s = alarm (small)** | per P-F interval |

(Sources as cited in the relevant sections above.)

---

## 11. Lease-vs-Buy & Financing — the MD's decision model

### 11.1 ESCO / Energy Performance Contracting (the core mechanism)
Most ESCO deals run on **Energy Performance Contracts (EPC)**: the ESCO installs equipment, **guarantees performance**, and structures payments to be **less than the energy savings.** Terms **2–20 years.** Two models:
- **Guaranteed Savings**: ESCO guarantees the savings + takes **technical risk**; **client finances** (loan/equity) and keeps surplus. Dominant in developed-banking markets — and **Africa, North America, Europe, Australia favor Guaranteed Savings.**
- **Shared Savings**: **ESCO finances** and takes **both technical + credit risk**; savings split over term; **zero upfront for the owner.** Favored in India, Chile, Greece, Japan, Philippines.
- **Energy Savings Insurance (ESI)** de-risks both shortfall (technical) and default (credit). ([IEA ESCO contracts](https://www.iea.org/reports/energy-service-companies-escos-2/esco-contracts), [NAESCO ESCO story](https://www.naesco.org/esco/))

### 11.2 Lease-vs-buy heuristic
- **Buy (CapEx)** when: long asset life, low-risk tech, stable use, strong balance sheet, equipment is core (e.g., transformers, lifts usually owned).
- **Lease / EaaS / ESCO / rental (OpEx)** when: CapEx-constrained, want performance risk transferred, fast-moving tech (solar/inverters/BESS), variable/temporary need (generator rental), or savings can self-fund (chiller/lighting/HVAC retrofits). EA owners frequently prefer **PPA/EaaS for solar+battery** and **rental for standby diesel** to avoid stranded CapEx on rarely-run plant.
- **Always decide on TCO + payback + cost-of-capital, not sticker price.** In ESPCs the **owner ultimately owns** the installed equipment; financing can be a separate third-party loan/capital lease. ([energy.gov ESPC ESA](https://www.energy.gov/cmei/femp/energy-savings-performance-contract-energy-sales-agreements), [redaptive EaaS vs ESCO](https://redaptive.com/blog/how-is-energy-as-a-service-different-from-energy-service-companies/), [facilitiesdive EaaS vs EPC](https://www.facilitiesdive.com/news/energy-as-a-service-vs-energy-performance-contracts-a-primer/746882/))

---

## 12. Procurement playbook (applies to every asset class)

1. **RFQ on performance metrics, not nameplate** — IPLV/kW-ton (chillers), IE-class (motors), IPLV/PR-guarantee (solar), and life-cycle TCO; standardized conditions for apples-to-apples OEM comparison.
2. **Efficiency floor**: specify **IE3 minimum** for motors (global baseline; IE4/IE5 where part-load hours justify), ASHRAE 90.1 chiller minima. ([inframena IE classes IEC 60034](https://www.inframena.com/motor-efficiency-classes-iec-60034-ie2-ie3-ie4-ie5/), [IEC 60034 Wikipedia](https://en.wikipedia.org/wiki/IEC_60034))
3. **Lead times** drive resilience — pre-position critical spares (breakers, seals, bearings, membranes, filters) because EA import logistics are long.
4. **Warranty → AMC**: kick off AMC procurement **≥90 days before warranty expiry**; define scope (full-cover vs parts-extra), genuine-parts clause, statutory-inspection inclusion.
5. **SLA/KPI in every contract**: P1–P4 response times, uptime %, **% PPM-on-time**, MTTR; bind statutory cadences (LOLER 6-mo, NFPA 110 monthly/annual, NFPA 25 weekly churn / annual flow, NFPA 72 sensitivity). ([oxmaint FM SLA/KPI benchmarks](https://oxmaint.com/industries/facility-management/facility-management-sla-template-kpi-benchmarks), [IMARC warranty/AMC](https://www.imarcengineering.com/services/warranty-and-amc-coordination))

---

## Source register (all live-fetched 2026-06-08)

**Standards / authoritative bodies (high confidence):**
- HSE — Thorough examinations of lifting equipment (LOLER): https://www.hse.gov.uk/work-equipment-machinery/thorough-examinations-lifting-equipment.htm
- HSE — INDG339 thorough examination & testing of lifts: https://www.hse.gov.uk/pubns/indg339.htm
- HSE — LOLER overview: https://www.hse.gov.uk/work-equipment-machinery/loler-overview.htm
- NFPA — Weekly/monthly no-flow (churn) tests of fire pumps: https://www.nfpa.org/news-blogs-and-articles/blogs/2022/09/09/weekly-or-monthly-no-flow-churn-tests-of-fire-pumps
- Curtis Power — NFPA 110 maintenance & testing: https://www.curtispowersolutions.com/nfpa-110-maintenance-testing
- DOE FEMP — PV systems operate & maintain (O&M best practices): https://www.energy.gov/cmei/femp/life-cycle-photovoltaic-systems-operate-and-maintain-existing-photovoltaic-system
- DOE FEMP — Purchasing energy-efficient electric chillers: https://www.energy.gov/cmei/femp/purchasing-energy-efficient-electric-chillers
- DOE — ESPC energy sales agreements: https://www.energy.gov/cmei/femp/energy-savings-performance-contract-energy-sales-agreements
- NREL — Performance Loss Rate in PV (PDF): https://docs.nrel.gov/docs/fy23osti/85463.pdf
- IEA — ESCO contracts (guaranteed vs shared savings): https://www.iea.org/reports/energy-service-companies-escos-2/esco-contracts
- NASA — Reliability-Centered Maintenance Guide (PDF): https://www.nasa.gov/wp-content/uploads/2023/06/nasa-rcmguide.pdf
- IFMA Knowledge Library — CAFM glossary: https://knowledgelibrary.ifma.org/glossary/computer-assisted-facility-management-cafm/
- IEC 60034 (efficiency classes) — Wikipedia overview: https://en.wikipedia.org/wiki/IEC_60034
- trade.gov — Kenya energy / electrical power systems guide: https://www.trade.gov/country-commercial-guides/kenya-energy-electrical-power-systems

**Engineering / technical references (medium-high confidence):**
- The Engineering Mindset — Chiller fault troubleshooting: https://theengineeringmindset.com/chiller-fault-troubleshooting/
- aircondlounge — kW/ton, COP, EER, IPLV/NPLV: https://aircondlounge.com/chiller-efficiency-calculation-kw-ton-cop-eer-iplv-nplv/
- dspanalytic — ISO 10816-3 vibration severity table: https://dspanalytic.com/en/vibrations/understanding-the-iso-10816-3-vibration-severity-table/
- Acoem — ISO 10816-3 vibration severity chart: https://acoem.us/blog/other-topics/understanding-the-iso-10816-3-vibration-severity-chart/
- SDMyers — Partial discharge testing: https://www.sdmyers.com/transformer-services/testing-monitoring/partial-discharge-inspection/
- Xylem Bell & Gossett — Domestic water booster design manual (PDF): https://www.xylem.com/siteassets/brand/bell-amp-gossett/resources/manual/teh-1096b-domestic-water-pressure-booster-design.pdf
- Armstrong Fluid Technology — Domestic water booster intro: https://blog.armstrongfluidtechnology.com/an-introduction-to-domestic-water-pressure-booster-pumps
- CK Power — Wet stacking: https://ckpower.com/wet-stacking-avoid/
- Trystar — Load banks & wet stacking: https://www.trystar.com/article/how-do-load-banks-prevent-generator-wet-stacking/
- SurgePV — Solar battery monitoring / BMS: https://www.surgepv.com/hub/energy-storage/monitoring-management/
- inframena — Motor efficiency classes IEC 60034 (IE2–IE5): https://www.inframena.com/motor-efficiency-classes-iec-60034-ie2-ie3-ie4-ie5/
- nihaowater — MBBR vs MBR vs SBR vs ASP comparison: https://www.nihaowater.com/news/mbbr-vs-mbr-vs-sbr-vs-sbbr-vs-asp-a-comprehensive-guide-to-wastewater-treatment-technologies.html

**FDD / FM / predictive-maintenance & EA market (medium confidence — vendor/industry blogs, cross-checked):**
- carbonconnector — ASHRAE 36 + FDD: https://carbonconnector.com/blog/incorporating-ashrae-36-into-fdd-solutions-limitations-and-potential/
- CSE Mag — HVAC FDD benefits: https://www.csemag.com/your-questions-answered-what-are-the-benefits-of-hvac-fault-detection-plus-how-to-specify-it/
- oxmaint — Chiller predictive (AI/IoT): https://oxmaint.com/industries/hvac/chiller-predictive-maintenance-ai-iot
- oxmaint — AHU maintenance (filters/coils/belts/controls): https://oxmaint.com/industries/hvac/air-handling-unit-ahu-maintenance-filters-coils-belts-controls
- oxmaint — Pump predictive maintenance guide: https://oxmaint.com/industries/manufacturing-plant/pump-predictive-maintenance-guide-centrifugal-positive-displacement-ai-monitoring
- oxmaint — Transformer DGA/oil predictive: https://oxmaint.com/industries/power-plant/predictive-maintenance-transformer-power-plant-dga-oil-analysis
- oxmaint — Hotel elevator/escalator IoT monitoring: https://oxmaint.com/industries/hospitality/hotel-elevator-escalator-iot-condition-monitoring
- oxmaint — FM SLA/KPI benchmarks: https://oxmaint.com/industries/facility-management/facility-management-sla-template-kpi-benchmarks
- oxmaint — HVAC maintenance KPIs: https://oxmaint.com/industries/hvac/hvac-maintenance-kpis-facility-manager-track
- IMARC Engineering — Warranty & AMC coordination: https://www.imarcengineering.com/services/warranty-and-amc-coordination
- clickmaint — AMC glossary: https://www.clickmaint.com/glossary/annual-maintenance-contract-amc
- Mordor Intelligence — Africa diesel generator market: https://www.mordorintelligence.com/industry-reports/africa-diesel-generator-market
- Ariya Finergy — East African industrial solar (EaaS): https://ariyafinergy.com/
- emergent — NFPA 25 testing requirements: https://www.emergent.tech/blog/nfpa-25-testing-requirements
- tfp1 — NFPA 25 inspection frequency: https://www.tfp1.com/blog/nfpa-25-inspection-frequency/
- fireservicepro — NFPA 72 ITM: https://www.fireservicepro.com/Fire-Alarms/NFPA-72-fire-alarm-tests-inspections.html
- maximomastery — Introduction to RCM: https://maximomastery.com/blog/2026/03/introduction-to-reliability-centered-maintenance-rcm-for-maintenance-professionals/
- Towle-Whitney — Legionella harbors in the mechanical room: https://towle-whitney.com/4-tips-to-mitigate-legionella-harbors%E2%80%8B-in-the-mechanical-room/
- redaptive — EaaS vs ESCO: https://redaptive.com/blog/how-is-energy-as-a-service-different-from-energy-service-companies/

**UNVERIFIED items flagged inline:** PV module 25-yr output-warranty exact %; EA-jurisdiction exact Legionella temperature regime figures (60°C/50°C/20°C are global guidance, not confirmed against a fetched EA-specific regulation in this pass).
