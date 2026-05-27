# Boji AI Research Brief — Mine-to-Market, SIC, FMS & Mine Planning, 2025–2026

> **Source agent run:** Deep-research agent invoked 2026-05-17. Verbatim, with every URL preserved. Boji's Mine Planner Agent, Operations / SIC Agent, Asset / Fleet Agent and Maintenance Agent read from this brief.

## 1. Mine-to-Market (M2M) as an Operating Model

McKinsey frames the mining value chain as a single integrated process from **pit → load/haul → ROM stockpile → crusher/processing → stockyard → rail/truck → port → vessel → customer**, arguing that most miners run each link as an isolated cost centre and therefore leave 10–15% EBITDA on the table. McKinsey's "[The mine-to-market value chain: A hidden gem](https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mine-to-market-value-chain-a-hidden-gem)" (Oct 2020, still the reference text and reused in McKinsey's 2024 "OptimusAI" practice page) names 11 levers — planning integration, throughput, recovery, blend conformance, logistics, contract conformance, working capital, etc. ([Mining Digital recap](https://miningdigital.com/digital-mining/mckinsey-embrace-value-chain-and-boost-ebitda-10-15)). Key KPIs that travel across the chain:

- **Load/haul:** truck cycle time, queue time at shovel and dump, payload underloading vs rated capacity, match factor (target ~1.0; 0.97 is published as good ([Pathan 2025, Wiley](https://onlinelibrary.wiley.com/doi/full/10.1155/atr/7939037))), truck fill factor (~90% classic, ~100% with surge loaders).
- **ROM/processing:** plant throughput, recovery, blend conformance (head grade vs plan, dilution).
- **Stockyard/rail/port:** stock turn, train fill, ship-loader rate, demurrage cost per tonne, contract conformance (tonnage/quality vs lay-can).

Deloitte's [Tracking the Trends 2025](https://www.deloitte.com/cbc/en/about/press-room/tracking-the-trends-report-2025.html) (Jan 2025) and Accenture / BCG analyses ([Virtasant](https://www.virtasant.com/ai-today/big-five-consulting-betting-billions-on-ai-partnerships)) now wrap the M2M concept inside "Industry-AI" — Accenture is putting USD 3B into Data & AI and BCG X has ~3,000 engineers, with mining value-chain transparency and critical-mineral traceability as a stated priority.

## 2. Short Interval Control (SIC)

SIC originated in Toyota / lean manufacturing as "short interval management" — break a shift into 1–2 hour windows, compare actual vs plan, decide on a corrective action, log the deviation, repeat. In mining it is the operating cadence that connects daily/weekly plan to what is actually happening on the pit face.

Cadence in industry guidance ([GroundHog SIC](https://groundhogapps.com/groundhog-short-interval-control/), [ABB OMS](https://new.abb.com/mining/digital-applications/operations-management-system-oms-for-mining/digitalization-of-short-interval-control-(sic)-and-production-scheduling-in-mining)): pre-shift plan → hourly or 2-hourly check-ins → mid-shift bottleneck review → end-of-shift reconciliation → handover. GroundHog reports productivity uplifts of 30%+ from disciplined SIC; Deswik's [ORB](https://www.deswik.com/en-au/casestudies/world-s-first-highly-automated-short-interval-control-system-for-hard-rock-underground-mines) (the world's first highly automated SIC for hard-rock underground) uses "Industrial Mathematics" to keep schedules optimal in real time.

Vendors and stack roles:
- **ABB Ability OMS** — digitalised SIC + production scheduling, sits on top of FMS.
- **Deswik IOM / ORB** — schedule-driven SIC bridging tactical plan and execution ([Deswik news](https://www.deswik.com/news/an-integrated-and-scheduling-driven-approach-to-short-interval-control-in-mining/)).
- **GroundHog SIC** — open-pit and underground SIC, imports Deswik daily/weekly plans, focuses on supervisor-facing UX ([GroundHog SIC for Open Pit](https://groundhogapps.com/sic-for-open-pit/)).
- **MICROMINE Pitram** — mine control + FMS with SIC modules; 60+ deployments across 9 commodities ([Pitram](https://www.micromine.com/pitram/)).
- **Hexagon HxGN MineOperate** — operations management with SIC dashboards ([Hexagon MineOperate](https://hexagon.com/products/product-groups/hxgn-mineoperate)).
- **Modular Mining DISPATCH** and **Wenco** ([wencomine.com](https://www.wencomine.com/)) — FMS that feed live actuals into SIC.

Standard root-cause coding aligns 15–25 codes max ([Mining Doc](https://www.miningdoc.tech/2025/04/29/how-do-equipment-reliability-and-maintenance-issues-impact-mining-productivity-and-what-strategies-improve-uptime/)) across **mechanical, electrical, operational, weather, blast, fuel, road, blast-clearance, change of operator**, with 80% of stoppages historically resolvable in one shift ([Nature 2025 maintainability study](https://www.nature.com/articles/s41598-025-88505-3)). Why SIC matters for SMEs: an SME excavator that idles 90 minutes a shift is leaking 15–18% of revenue with no instrument to see it — SIC is the cheapest productivity lever available because it is fundamentally about discipline, not capex.

## 3. Fleet Management Systems (FMS)

Tier-1 FMS provide real-time **dispatch, dynamic load matching, queue minimisation, fuel telemetry, payload, GPS, geofencing, operator scoring, collision avoidance**. The current top stack:

- **Caterpillar Cat MineStar** — scalable from "Edge" to "Fleet/Terrain/Detect/Health/Command" autonomy ([Cat MineStar](https://www.cat.com/en_US/by-industry/mining/minestar-solutions.html)).
- **Modular Mining DISPATCH** — industry standard for surface-mine dispatch and the underlying algorithm everyone benchmarks against.
- **Wenco Mining Systems** (Hitachi) — open-interoperability FMS + machine guidance ([Wenco](https://www.wencomine.com/)).
- **Hexagon MineOperate / MineProtect** — fleet, safety, collision avoidance ([Hexagon mine fleet](https://hexagon.com/solutions/mine-fleet-management)).
- **Komatsu KOMTRAX** — OEM telematics, integrates with FrontRunner AHS ([Mining Technology profile](https://www.mining-technology.com/contractors/fleet-management-software/komatsu/)).
- **MICROMINE Pitram** — modular FMS popular mid-tier.

Cost reality: tier-1 deployments are USD 1M+ with USD 880k/yr licences; mid-tier offers like **Haultrax** start ~USD 300k capex + USD 150k/yr ([Haultrax overview](https://haultrax.com/everything-you-need-to-know-fleet-management-systems/)); SME-affordable options are Bluetooth/GPS beacons "$30 per unit" and smartphone-first telematics from **MiX by Powerfleet** and **Cartrack** ([Cartrack mining](https://www.cartrack.co.za/blog/fleet-management-for-the-mining-industry), [MiX](https://www.mixtelematics.com/us/industries/mining/)). Essential data flow for an SME: **location (1Hz), payload (per cycle), fuel level / consumption, engine hours, operator ID, geofence events, fault codes**. Everything else is gold-plating.

## 4. Mine Planning Software

Stack and ownership ([2026 mine planning comparison](https://indianminerology.blogspot.com/2026/02/mine-planning-software-comparison-2026.html?m=1), [highways.today top-7](https://highways.today/2026/01/13/top-7-mining-software-solutions/)):

- **Deswik** (Sandvik) — integrated suite, leader in scheduling.
- **MICROMINE** (Weir) — strong in mid-market; **Origin Copilot** (2024) brings neural-net grade modelling.
- **Datamine** — strong in coal (MineScape) and resource estimation.
- **Hexagon MinePlan** — formerly MineSight, geology-to-schedule.
- **Maptek Vulcan** — dominant Australia/NA open-pit, ML-based **DomainMCF** automated domaining.
- **GEOVIA Surpac** (Dassault) — most widely deployed in emerging markets, multilingual, cheap.
- **Leapfrog Geo / Seequent** (Bentley) — 3D geological modelling; **Leapfrog 2025.1/2/3** added Imago core-imagery streaming with ML AutoCrop and lithology classification, cloud collaboration via Seequent Evo ([Leapfrog 2025.1 release](https://im-mining.com/2025/06/04/seequent-out-for-faster-smarter-geological-modelling-and-resource-estimation-with-leapfrog-2025-1/), [Imago streaming](https://im-mining.com/2025/08/20/seequent-enables-streaming-of-high-resolution-core-imagery-into-leapfrog/)).
- **RPMGlobal XECUTE / MinePlanner** — short-term planning consuming live FMS + high-precision GPS feeds ([XECUTE](https://rpmglobal.com/product/xecute/)).

Levels of planning are converging under AI:
- **Strategic (LOM/NPV)** — hyper-heuristics under stochastic geology ([Lamghari & Dimitrakopoulos, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0305054818302958)).
- **Tactical (annual/quarterly)** — increasingly RL + simulation (47% cash-flow uplift reported in actor-critic truck-shovel allocation, [Dimitrakopoulos group](https://www.sciencedirect.com/science/article/pii/S1568494623001989)).
- **Operational (week/shift)** — POMDP / multi-agent DDPG for ore blending and shovel-allocation ([MDPI 2025](https://www.mdpi.com/2075-1702/13/5/350), [arXiv 1706.08264 Adaptive Strategies for OPMOSP](https://arxiv.org/abs/1706.08264)). Deep RL truck dispatching ([ScienceDirect 2024](https://www.sciencedirect.com/science/article/abs/pii/S0305054824002879)) is now beating heuristic DISPATCH-style assignment in published benchmarks.

## 5. Operator & Supervisor Mobile Workflows

A good shift report (composite of SafetyCulture and iFactory templates, [SafetyCulture supervisor shift report](https://safetyculture.com/library/mining/supervisor-shift-report-oliqN), [iFactory shift logbook](https://ifactoryapp.com/shift-logbook/)):

- Workers present + competencies, machine hours (start/end), fuel issued, payloads/loads, metres advanced, tonnes moved, blasts fired, scheduled vs unscheduled delays with code, weather events, near-misses & safety observations with photo + geotag, environmental notes, supervisor sign-off, hand-over notes to next shift.

Digital handover via mobile CMMS has cut "repeat faults" by **60–70%** ([oxmaint](https://oxmaint.com/blog/post/smart-logbook-digital-shift-handover-operations-management)). Mobile-first SIC examples: GroundHog SIC, Commit Works "Mining goes mobile" ([commit.works](https://www.commit.works/mining-goes-mobile/)), MICROMINE Pitram mobile, EHS Insight ([ehsinsight.com](https://www.ehsinsight.com/blog/mining-safety-software-msha-compliance-and-hazard-tracking)).

## 6. Hauling/Loading Economics

- **Haulage = 50–60% of total operating cost** in surface mining ([Mining Doc](https://www.miningdoc.tech/2025/05/22/effect-of-the-surge-loader-on-truck-productivity/), [GRT](https://globalroadtechnology.com/the-true-cost-of-poor-haul-road-maintenance/)).
- **Fuel = ~30% of mine energy** and **up to 70% of engine life-cycle cost** ([Cummins](https://www.cummins.com/news/2021/03/11/improving-financial-performance-and-reducing-maintenance-costs)).
- **Tyres**: 40.00R57 = USD 30–50k each × 6 per truck = USD 180–300k investment per truck; life 7–12 months; rolling-resistance +1% → speed −10% and fuel burn up; bad roads can cut tyre life 30–50% ([Sunhunk](https://www.sunhunk.com/about/groupnews-detail-592.htm), [IMI](https://www.imiproducts.com/blog/mining-productivity-relies-tires/)).
- **Match factor** (trucks-arrivals ÷ shovel-service rate): MF=1 is theoretical ideal; published optimum 0.85–1.0 depending on variability ([Pathan 2025](https://onlinelibrary.wiley.com/doi/full/10.1155/atr/7939037), [Wits queuing study](https://www.researchgate.net/publication/351850710_Optimisation_of_shovel-truck_haulage_system_in_an_open_pit_using_queuing_approach)).
- **Queue theory**: M/M/1 and M/M/2 models dominate; idle-shovel fuel cost >> queued-truck fuel cost, so the canonical SME KPI **"excavator never idle"** is mathematically defensible — shovel idle is the most expensive idle minute on site ([ResearchGate optimisation study](https://www.researchgate.net/publication/324730887_Optimising_Shovel-Truck_Fuel_Consumption_using_Stochastic_Simulation)).
- **Transpara's 10 real-time hauling KPIs](https://www.transpara.com/10-real-time-kpis-every-mine-hauling-operations-leader-should-keep-on-their-radar/)** centre on cycle time, queue time, payload variance, hang time, dump time, swing time, hauling speed loaded/empty, availability.

## 7. Demurrage & Contract Logistics

Demurrage is the daily compensation paid to a vessel after lay-time at load or discharge port has expired ([FreightRight](https://www.freightright.com/kb/demurrage)). In bulk minerals it is driven by stockpile-not-ready, ship-loader breakdown, draft restrictions, weather, rail cancellations, quality rejection at port, and customs/inspection delays ([CEPAL transport of natural resources](https://www.cepal.org/sites/default/files/news/files/escap.pdf)).

Incoterms govern who carries it: **FOB** (Free on Board) — buyer arranges shipping, seller exposure ends once cargo is on board; **CIF** (Cost, Insurance, Freight) — seller carries demurrage exposure on the sea leg; **FOT/Free-on-Truck** — common for inland sales in Africa where the buyer takes title at the mine gate or rail siding. Iron-ore traders generally prefer **FOB** to retain freight optionality ([LinkedIn Benjamin Cox FOB vs CIF](https://www.linkedin.com/pulse/iron-ore-you-care-fob-cif-benjamin-cox)). Bonded warehousing at port is the standard lever for SMEs to consolidate parcels and avoid demurrage on small lots. AJC Freight, MSC and similar 3PLs market multimodal mining logistics packages ([MSC Mining](https://www.msc.com/en/industries/mining-and-minerals), [AJC](https://ajcfreight.com/industries-we-serve/mining-and-quarrying)).

## 8. Predictive Maintenance & Asset Health

Modern stacks use **vibration, oil debris, oil viscosity/temperature, acoustic emission, exhaust temperature, current draw, IoT-streamed PLC tags**, fed into ML models or digital twins ([Mining Digital top-10](https://miningdigital.com/top10/top-10-predictive-maintenance-solutions), [MDPI Engineering 2025](https://www.mdpi.com/2673-4117/6/10/261)). Oil analysis is the "blood test" of a haul truck.

Headline economics:
- Single haul-truck downtime ≈ **USD 20,000/hr** ([Mining Digital PdM](https://miningdigital.com/digital-transformation/predictive-maintenance-reshaping-mining-operations)).
- Basic PdM: 25–40% downtime reduction in 8–14 months; comprehensive platforms 60–80% in 18–30 months.
- Anglo American + IBM Maximo cut unplanned downtime by up to **75%** in some sites.
- Glencore has invested in AI-driven maintenance for copper extraction ([Farmonaut Glencore CSA](https://farmonaut.com/mining/glencore-copper-csa-mine-5-powerful-innovations-for-2025)).

For SMEs the prescription is staged: (1) hour-based service schedule from a CMMS with mobile entry, (2) periodic oil analysis (USD 30–60/sample), (3) cheap vibration pucks on critical pumps/conveyors, (4) operator pre-start checklists with photos. **Cost-per-operating-hour** is the universal SME number — bucket it as fuel + lube + tyres + parts + labour + capex amortisation per hour.

## 9. AI in Mining 2025–2026

The flagship deals of the cycle:

- **Codelco × Microsoft** (Mar 2026) — 18-month MoU on AI, advanced analytics, automation and digital security covering Chile's whole copper estate ([Mining.com](https://www.mining.com/codelco-microsoft-team-up-on-ai-analytics-initiatives/), [Energy News](https://energynews.oedigital.com/mining/2026/03/05/codelco-and-microsoft-sign-ai-agreement-for-mining-operations), [SME ME](https://me.smenet.org/codelco-microsoft-sign-ai-deal-for-mining-operations/)).
- **BHP** — launched its **Industry AI Hub in Singapore** (May 2025) with AI Singapore; integrates GenAI with digital twins; Escondida + Azure ML reported **USD 18.9M operational uplift** on copper recovery ([BHP digital twins & AI Feb 2025](https://www.bhp.com/news/bhp-insights/2025/02/the-role-of-digital-twins-and-ai-in-enhancing-decision-making-in-the-mining-industry), [BHP from-discovery-to-decisions Mar 2026](https://www.bhp.com/news/bhp-insights/2026/03/from-discovery-to-decisions-data-ai-and-the-future-of-mining), [Microsoft Industry Blog Dec 2025](https://www.microsoft.com/en-us/industry/blog/energy-and-resources/mining/2025/12/08/transforming-mining-how-frontier-firms-lead-with-ai-and-agentic-innovation/)).
- **Rio Tinto** — AI for maintenance, production planning, environmental monitoring ([Klover.ai analysis](https://www.klover.ai/rio-tinto-ai-strategy-analysis-of-dominance-in-mining-ai/)).
- **Vale** — AI for truck fuel reduction, predictive failure analytics.
- **Freeport-McMoRan** — **Bagdad, Arizona** went fully autonomous Oct 2025 (33 trucks), projecting 18% haulage efficiency gain and 22% accident reduction ([FCX Bagdad Oct 2025](https://www.fcx.com/freeport-features/100125), [Sustainability Magazine](https://sustainabilitymag.com/news/freeport-mcmoran-ai-driven-autonomous-haulage)).
- **Anglo American** — AI for water, digital twins, optimisation.
- **Glencore** — AI-driven maintenance + ops analytics.

"AI agent" in mining means a goal-directed software agent that plans, calls FMS/MES/CMMS tools, and reports — Microsoft's Dec 2025 "[Frontier Firms](https://www.microsoft.com/en-us/industry/blog/energy-and-resources/mining/2025/12/08/transforming-mining-how-frontier-firms-lead-with-ai-and-agentic-innovation/)" piece explicitly frames the mining stack around agentic patterns (planner + supervisor agents over operational data).

Open-source ecosystem: RL/POMDP scheduling papers ([MDPI 2025 multi-agent RL](https://www.mdpi.com/2075-1702/13/5/350), [arXiv 1706.08264](https://arxiv.org/abs/1706.08264)), open core-imagery libraries via Seequent's Imago and a growing GitHub corpus around Imago + PyTorch, but no equivalent of an "open-source DISPATCH". This is a green-field area for Boji.

## 10. The SME Gap

None of the tier-1 stack — Deswik + Pitram + DISPATCH + MineStar + IBM Maximo — is operable, let alone affordable, for a **sub-USD-10M revenue Tanzanian PML holder**. The PML itself is statutorily a small-scale instrument capped at ~USD 5M investment, Tanzanian-owned, and now wrapped in the **Mining (Technical Support for PML Holders) Regulations 2025 / GN 260** ([Velma Law](https://velmalaw.co.tz/news/technical-support-for-small-scale-miners-regulations-2025/), [Bowmans](https://bowmanslaw.com/insights/tanzania-mining-technical-support-for-primary-mining-licence-holders-regulations-published/)) requiring a 30%-gross-profit floor to the licensee in any facilitation deal. Tanzanian internet penetration is only **31.9%** and ASGM produced ~30% of national gold by 2020 ([SmartAfrica](https://www.smartafrica.group/read/fueling-sme-growth-in-tanzanias-digital-era), [IGF ASGM case study](https://www.igfmining.org/wp-content/uploads/2025/02/igf-asgm-case-study-draft-02-2025.pdf), [Tanzania Mining Digest ASGM opportunities](https://tanzaniaminingdigest.tz/opportunities-in-tanzanias-asgm-mining-licenses/)).

An SME-grade equivalent must be:

- **Smartphone-first** — Android, offline-capable, sync on reconnect.
- **Supervisor-led, not IT-led** — the supervisor IS the system; the foreman owns the plan and the report.
- **Swahili + English bilingual UI and voice** — voice notes, voice-to-text in Swahili, AI translation of voice handovers.
- **Low-connectivity-tolerant** — store-and-forward, SMS fallback for plan and alert distribution, GSM-band cell-tower geolocation when GPS is poor.
- **Single device per supervisor + cheap GPS beacons / dashcams on machines** rather than full-fat FMS hardware.
- **AI-assisted** — the system writes the shift summary, flags the deviations, drafts tomorrow's plan, and explains "why we lost 90 minutes today" in plain Swahili.
- **Priced in monthly TZS, not USD capex** — sub-USD-200/month/site, no perpetual licence.

## Boji AI — Product Implications

1. **Mine-to-Market lite** — single dashboard from pit face to gate-out (tonnes mined, stockpiled, dispatched, invoiced) so the owner sees the whole chain on one phone screen; weekly EBITDA reconciliation auto-generated.
2. **Boji SIC Loop** — *Morning plan → hourly supervisor pings ("How many loads since 8am? Any stoppages?") → end-of-shift reconciliation in voice/photo → AI deviation explanation → tomorrow plan auto-drafted*. Default cadence 2 hours, configurable. Deviation codes pre-loaded with the 15–25 standard taxonomy in Swahili.
3. **Lightweight FMS** — Bluetooth/GPS beacons + driver phones; payload from operator confirmation (and optional load-cell when available); cycle-time and queue auto-derived; operator scoreboard.
4. **Mine Planning for SMEs** — a *plan ≤ 1-page* abstraction: weekly target tonnes, daily faces, blast schedule, equipment assignments; AI generates from the previous week's actuals + ore-body model (Surpac/Leapfrog export). No 3D pit-design required to start.
5. **Supervisor Shift App** — voice-first capture, photo + geotag, auto-fill of machine hours from beacons, biometric sign-off, auto-handover summary to next shift. Bilingual.
6. **Excavator-Never-Idle KPI** — single headline KPI on the home screen; counter resets when shovel queue = 0 and load activity detected; alert if idle > X minutes.
7. **Demurrage / Logistics Tracker** — bag/truck/rail/parcel ledger with free-on-truck vs FOB toggles, lay-can countdown, auto-flag risk of demurrage exposure on small-lot consolidations.
8. **Predictive Maintenance Starter Kit** — hour-based service schedule per machine, oil-sample reminder + QR-coded sample labels, optional vibration puck integration; cost-per-operating-hour rolled up automatically.
9. **Boji Agent** — agentic layer that reads FMS/SIC/CMMS data, drafts the shift report, drafts the weekly plan, answers owner queries in Swahili: "Kwa nini tani zilipungua jana?" → root-cause narrative with evidence links.
10. **PML-Compliant Mode** — built-in workflows for the 2025 GN-260 Technical Support Regulations, royalty/inspection-fee tracking, 30%-gross-profit-floor calculator, citizen-employment register; OECD/IGF ASGM responsible-sourcing chain-of-custody hooks for downstream traceability.

## Sources (consolidated)
- [McKinsey — The mine-to-market value chain: A hidden gem](https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mine-to-market-value-chain-a-hidden-gem)
- [Mining Digital — McKinsey 10-15% EBITDA](https://miningdigital.com/digital-mining/mckinsey-embrace-value-chain-and-boost-ebitda-10-15)
- [McKinsey OptimusAI](https://www.mckinsey.com/industries/metals-and-mining/how-we-help-clients/optimusai)
- [Deloitte Tracking the Trends 2025](https://www.deloitte.com/cbc/en/about/press-room/tracking-the-trends-report-2025.html)
- [Virtasant — Big Five Consulting AI](https://www.virtasant.com/ai-today/big-five-consulting-betting-billions-on-ai-partnerships)
- [ABB OMS digitalisation of SIC](https://new.abb.com/mining/digital-applications/operations-management-system-oms-for-mining/digitalization-of-short-interval-control-(sic)-and-production-scheduling-in-mining)
- [GroundHog SIC](https://groundhogapps.com/groundhog-short-interval-control/)
- [GroundHog SIC for Open Pit](https://groundhogapps.com/sic-for-open-pit/)
- [Deswik ORB case study](https://www.deswik.com/en-au/casestudies/world-s-first-highly-automated-short-interval-control-system-for-hard-rock-underground-mines)
- [Deswik integrated SIC](https://www.deswik.com/news/an-integrated-and-scheduling-driven-approach-to-short-interval-control-in-mining/)
- [MICROMINE Pitram](https://www.micromine.com/pitram/)
- [Hexagon HxGN MineOperate](https://hexagon.com/products/product-groups/hxgn-mineoperate)
- [Hexagon mine fleet management](https://hexagon.com/solutions/mine-fleet-management)
- [Wenco Mining Systems](https://www.wencomine.com/)
- [Cat MineStar](https://www.cat.com/en_US/by-industry/mining/minestar-solutions.html)
- [Komatsu KOMTRAX profile](https://www.mining-technology.com/contractors/fleet-management-software/komatsu/)
- [Haultrax FMS overview](https://haultrax.com/everything-you-need-to-know-fleet-management-systems/)
- [Cartrack mining fleet](https://www.cartrack.co.za/blog/fleet-management-for-the-mining-industry)
- [MiX by Powerfleet mining](https://www.mixtelematics.com/us/industries/mining/)
- [Commit Works — Mining goes mobile](https://www.commit.works/mining-goes-mobile/)
- [Indian Minerology — Mine planning 2026](https://indianminerology.blogspot.com/2026/02/mine-planning-software-comparison-2026.html?m=1)
- [Highways.today top-7 mining software 2026](https://highways.today/2026/01/13/top-7-mining-software-solutions/)
- [Maptek Vulcan reviews](https://www.miningsoftwarereviews.com/software/maptek-vulcan)
- [RPMGlobal XECUTE](https://rpmglobal.com/product/xecute/)
- [Seequent Leapfrog 2025.1](https://im-mining.com/2025/06/04/seequent-out-for-faster-smarter-geological-modelling-and-resource-estimation-with-leapfrog-2025-1/)
- [Seequent Imago streaming](https://im-mining.com/2025/08/20/seequent-enables-streaming-of-high-resolution-core-imagery-into-leapfrog/)
- [arXiv 1706.08264 — Adaptive Strategies for OPMOSP](https://arxiv.org/abs/1706.08264)
- [MDPI Machines 2025 — Multi-Agent RL Scheduling](https://www.mdpi.com/2075-1702/13/5/350)
- [Deep RL truck dispatching, ScienceDirect 2024](https://www.sciencedirect.com/science/article/abs/pii/S0305054824002879)
- [Simultaneous stochastic optimisation with RL, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1568494623001989)
- [SafetyCulture supervisor shift report mining](https://safetyculture.com/library/mining/supervisor-shift-report-oliqN)
- [iFactory digital shift logbook](https://ifactoryapp.com/shift-logbook/)
- [oxmaint smart logbook](https://oxmaint.com/blog/post/smart-logbook-digital-shift-handover-operations-management)
- [Transpara 10 real-time hauling KPIs](https://www.transpara.com/10-real-time-kpis-every-mine-hauling-operations-leader-should-keep-on-their-radar/)
- [Wiley/Pathan 2025 — shovel-truck simulation](https://onlinelibrary.wiley.com/doi/full/10.1155/atr/7939037)
- [Mining Doc — surge loader / cycle time](https://www.miningdoc.tech/2025/05/22/effect-of-the-surge-loader-on-truck-productivity/)
- [Cummins — fuel = 70% of engine LCC](https://www.cummins.com/news/2021/03/11/improving-financial-performance-and-reducing-maintenance-costs)
- [GRT — true cost of poor haul-road maintenance](https://globalroadtechnology.com/the-true-cost-of-poor-haul-road-maintenance/)
- [Sunhunk — mining truck tyres](https://www.sunhunk.com/about/groupnews-detail-592.htm)
- [Nature Sci Reports 2025 — maintainability & downtime](https://www.nature.com/articles/s41598-025-88505-3)
- [Mining Doc reliability strategies 2025](https://www.miningdoc.tech/2025/04/29/how-do-equipment-reliability-and-maintenance-issues-impact-mining-productivity-and-what-strategies-improve-uptime/)
- [MDPI Engineering 2025 — Predictive maintenance underground](https://www.mdpi.com/2673-4117/6/10/261)
- [Mining Digital — Predictive maintenance reshaping mining](https://miningdigital.com/digital-transformation/predictive-maintenance-reshaping-mining-operations)
- [Mining Digital top-10 PdM solutions](https://miningdigital.com/top10/top-10-predictive-maintenance-solutions)
- [Mining.com — Codelco × Microsoft AI](https://www.mining.com/codelco-microsoft-team-up-on-ai-analytics-initiatives/)
- [Energy News — Codelco Microsoft Mar 2026](https://energynews.oedigital.com/mining/2026/03/05/codelco-and-microsoft-sign-ai-agreement-for-mining-operations)
- [SME ME — Codelco Microsoft AI deal](https://me.smenet.org/codelco-microsoft-sign-ai-deal-for-mining-operations/)
- [BHP — Digital twins & AI Feb 2025](https://www.bhp.com/news/bhp-insights/2025/02/the-role-of-digital-twins-and-ai-in-enhancing-decision-making-in-the-mining-industry)
- [BHP — From discovery to decisions Mar 2026](https://www.bhp.com/news/bhp-insights/2026/03/from-discovery-to-decisions-data-ai-and-the-future-of-mining)
- [BHP — AI improving performance globally Jan 2026](https://www.bhp.com/news/articles/2026/01/ai-is-improving-performance-across-global-mining-operations)
- [Microsoft Industry Blog — Frontier Firms mining Dec 2025](https://www.microsoft.com/en-us/industry/blog/energy-and-resources/mining/2025/12/08/transforming-mining-how-frontier-firms-lead-with-ai-and-agentic-innovation/)
- [Klover.ai — Rio Tinto AI strategy](https://www.klover.ai/rio-tinto-ai-strategy-analysis-of-dominance-in-mining-ai/)
- [Sustainability Magazine — Freeport AHS](https://sustainabilitymag.com/news/freeport-mcmoran-ai-driven-autonomous-haulage)
- [FCX — Bagdad autonomous fully implemented Oct 2025](https://www.fcx.com/freeport-features/100125)
- [Farmonaut — Glencore CSA innovations 2025](https://farmonaut.com/mining/glencore-copper-csa-mine-5-powerful-innovations-for-2025)
- [LinkedIn — Iron ore FOB vs CIF, Benjamin Cox](https://www.linkedin.com/pulse/iron-ore-you-care-fob-cif-benjamin-cox)
- [FreightRight — Demurrage definition](https://www.freightright.com/kb/demurrage)
- [MSC — Mining and Minerals shipping](https://www.msc.com/en/industries/mining-and-minerals)
- [CEPAL — Transport of natural resources Latin America](https://www.cepal.org/sites/default/files/news/files/escap.pdf)
- [Velma Law — PML Technical Support Regulations 2025](https://velmalaw.co.tz/news/technical-support-for-small-scale-miners-regulations-2025/)
- [Bowmans — Tanzania PML Technical Support Regulations](https://bowmanslaw.com/insights/tanzania-mining-technical-support-for-primary-mining-licence-holders-regulations-published/)
- [Gerpat Solutions — Tanzania mining licences guide](https://gerpatsolutions.co.tz/mining-licenses-acquired-in-tanzania-the-comprehensive-guide/)
- [Tanzania Mining Digest — ASGM PML opportunities](https://tanzaniaminingdigest.tz/opportunities-in-tanzanias-asgm-mining-licenses/)
- [IGF — ASGM case study Feb 2025](https://www.igfmining.org/wp-content/uploads/2025/02/igf-asgm-case-study-draft-02-2025.pdf)
- [SmartAfrica — Fueling SME growth Tanzania digital](https://www.smartafrica.group/read/fueling-sme-growth-in-tanzanias-digital-era)
- [Africanminingmarket — Tanzania PML regulations](https://africanminingmarket.com/tanzania-issues-mining-regulations/21985/)
- [Wits queuing study](https://www.researchgate.net/publication/351850710_Optimisation_of_shovel-truck_haulage_system_in_an_open_pit_using_queuing_approach)
- [ResearchGate shovel-truck fuel stochastic simulation](https://www.researchgate.net/publication/324730887_Optimising_Shovel-Truck_Fuel_Consumption_using_Stochastic_Simulation)
