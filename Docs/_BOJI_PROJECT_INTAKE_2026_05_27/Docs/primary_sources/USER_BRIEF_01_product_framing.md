# USER PRIMARY SOURCE 01 — Product framing & competitive analysis

> Captured verbatim from the founder (George Mwikila) on **2026-05-17**, in the first message of the session that initiated this project.
>
> **Status: primary source. Do not edit. Future Boji agents must treat this as ground truth for product intent and may quote from it directly. Any conflict with later artefacts should be resolved in favour of this document unless an explicit superseding decision has been recorded.**

---

> "Yes, I understand the goal fully.
>
> You are not trying to build a normal mining ERP. You are trying to build a **strategic intelligence platform for mining owners** — a system that behaves like a mining company "mind." The owner talks to it, uploads documents, gives updates, adds employees, adds sites, adds licences, adds costs, and the intelligence gradually builds a living mental model of the entire mining business. From that mental model, it creates structure, tasks, forecasts, warnings, company strategy, mine-by-mine strategy, document workflows, employee assignments, procurement timing, and owner-level decision advice. That is exactly the right framing from your earlier concept, where the system becomes a central AI manager that digests documents, tracks PLs, understands operations, creates reminders, forecasts costs, and helps the owner think strategically across the business.
>
> The product should be called something like:
>
> # Mining Company Brain
>
> ## An AI-native strategic operating system for building, running, and scaling mining businesses
>
> The most important distinction:
>
> **It does business management, but its primary product is strategic clarity.**
>
> A normal system records what happened. This platform should answer:
>
>> "What kind of mining company am I building, what is the current state of every operation, what is the next best move, who should do it, what will it cost, what documents are needed, what risk can kill us, and how do we become more profitable?"

## 1. Research synthesis: what the market already shows

Mining is moving toward integrated, AI-powered operating models, not isolated tools. Deloitte's 2026 mining digital transformation view says strong outcomes come from combining targeted quick-win use cases with a scalable, end-to-end, human-centered operating model; it also emphasizes that AI only creates value when it is integrated into workflows and human decision-making. [Deloitte][1]

BCG's 2026 view of AI-powered mining companies similarly emphasizes integrated operating models where engineers, planners, AI specialists, and AI agents work together, with governance around safety, transparency, and accountability. [BCG Global][2]

Microsoft's mining AI work frames AI across the mining value chain: exploration, production planning, equipment optimization, predictive maintenance, ore blending, recovery, processing, logistics, and workforce productivity. It also emphasizes hybrid cloud, edge, IoT, and operational data as foundations for real-time intelligence. [Microsoft][3]

Codelco and Microsoft's 2026 AI agreement shows where the global mining frontier is heading: intensive operational data use, AI for decision-making, autonomous operations, automation of critical processes, cybersecurity, and joint governance for strategic and operational tracking. [Reuters][4]

McKinsey's mine-to-market work is especially important for your idea. It argues that mining companies often operate in silos, while real value comes from treating the full chain — mine, equipment, processing, inventory, rail, port, sales, product mix, and customer demand — as one integrated system. McKinsey estimates that mine-to-market optimization can create a 10–15% EBITDA uplift by improving throughput, product margins, and operating costs. [McKinsey & Company][5]

So the research confirms your instinct: the opportunity is not just "AI chat." The opportunity is **an integrated strategic intelligence layer that connects planning, execution, documents, costs, people, machines, licences, compliance, and owner decisions.**

## 2. The platform's true job

The platform should help a mining owner do five things:

1. **Build the company from scratch.**  Understand what structure is needed: company, licences, sites, people, documents, suppliers, equipment, reporting lines, controls, budgets, and operating model.
2. **Understand the current business state.**  The AI continuously asks questions, reads documents, checks tasks, reads reports, and maintains a living model of the business.
3. **Create strategy.**  It advises on where to spend, where to pause, where to mechanize, where to hire, where to renew, where to abandon, where to negotiate, and where to raise money.
4. **Turn strategy into tasks.**  It assigns tasks to employees, tracks progress, follows up, detects delays, and updates the owner.
5. **Learn over time.**  Every document, answer, field report, cost entry, employee update, supplier delay, machine breakdown, and licence deadline improves the business map.

The system should feel like the owner has hired:

* a mining operations director;
* a document/compliance officer;
* a mineral rights manager;
* a cost engineer;
* a site manager;
* a procurement planner;
* a project manager;
* a financial controller;
* a safety/compliance advisor;
* a strategic chief of staff.

But all of them are coordinated through one central intelligence.

## 3. The master concept: the Living Mining Business Map

The most important product primitive is not a dashboard. It is the **Living Mining Business Map**.

This is the mental model the AI builds and improves continuously.

It should contain:

| Layer            | What the AI maps                                                                |
| ---------------- | ------------------------------------------------------------------------------- |
| Owner layer      | owner goals, risk appetite, available capital, time horizon, preferred minerals |
| Company layer    | companies, directors, shareholders, tax, bank accounts, documents, roles        |
| Licence layer    | PLs, PMLs, MLs, SMLs, permits, expiry dates, obligations, coordinates           |
| Mine/site layer  | location, mineral, phase, access, geology confidence, operations status         |
| People layer     | employees, contractors, roles, skills, availability, current assignments        |
| Asset layer      | excavators, compressors, pumps, generators, crushers, vehicles, tools           |
| Document layer   | applications, renewals, receipts, contracts, maps, reports, permits             |
| Cost layer       | wages, food, fuel, rent, equipment, licensing, transport, processing            |
| Inventory layer  | fuel, explosives-permit status, PPE, spare parts, tools, ore stockpiles         |
| Production layer | metres advanced, tonnes moved, grade estimates, recovery, sales                 |
| Risk layer       | licence risk, cash risk, geological risk, safety risk, community risk           |
| Strategy layer   | next actions, investment priorities, expansion paths, stop/go decisions         |

This map must be dynamic. The owner can say:

> "We have three PLs in Chunya, one site already has workers, one is still waiting for documents, and we may need an excavator next week."

The AI should convert that into structured business reality:

* create three licence records;
* create one active operation;
* create one document-blocked operation;
* create one equipment decision task;
* ask for expiry dates;
* ask for coordinates;
* ask for current workers;
* ask for daily cost;
* ask if the vein is confirmed;
* forecast cash needs;
* create an owner brief.

That is the intelligence.

## 4. Core user experience: conversation becomes company structure

The owner should not need to "fill an ERP." They should talk naturally.

Example:

> "I have two PLs. One is for gold. We are already working with 12 workers. We paid for renewal last month but no document yet. We may need a compressor."

The AI should respond:

> "I have created a draft structure for your mining business. You currently have:
> 1 active gold prospecting operation,
> 1 pending licence-renewal workflow,
> 12 workers assigned to Site A,
> 1 potential equipment need: compressor.
> I need five missing details to complete the operational map: licence number, expiry date, site location, daily worker cost, and current mining phase."

Then it creates:

* company profile;
* site profile;
* licence profile;
* HR structure;
* equipment decision;
* document follow-up task;
* cash forecast placeholder;
* missing information checklist.

The owner should feel the AI is **building the business structure while talking.**

## 5. The platform hierarchy

The system must support multiple businesses and multiple operations.

### A. Account level

One owner may have:

* one mining company;
* several companies;
* JVs;
* contractor operations;
* mineral trading company;
* processing company;
* equipment rental company.

So the top-level structure should be:

**Owner → Business Group → Company → Licence/Project → Mine/Site → Work Area → Task/Document/Asset/Cost**

Example:

> George Mining Group
> ├── Company A: Exploration company
> │   ├── PL-001 Gold
> │   ├── PL-002 Copper
> ├── Company B: Processing company
> │   ├── Crusher yard
> │   ├── Stockpile yard
> ├── Company C: Equipment company
> │   ├── Excavator rental
> │   ├── Generator rental

The AI must understand both the **holistic portfolio** and the **individual thread of each operation**.

### B. Operation thread

Every mine or licence has its own thread:

* documents;
* tasks;
* employees;
* costs;
* site reports;
* photos;
* maps;
* permits;
* equipment;
* risks;
* strategy;
* decisions;
* production;
* sales.

The owner should ask:

> "What is happening with Site B?"

And the AI should answer only from that site's thread.

The owner should also ask:

> "What is the state of my whole mining business?"

And the AI should synthesize across every site.

## 6. The strategic intelligence model

The AI should reason at five levels.

### Level 1: Foundation strategy

This is for building the company from scratch.

Questions the AI asks:

* What minerals are you targeting?
* Are you exploring, mining, processing, trading, or contracting?
* Do you own mineral rights already?
* Are you operating under PL, PML, ML, SML, processing licence, broker/dealer licence, or JV?
* How much capital do you have?
* Are you asset-light or equipment-heavy?
* Do you want quick cash flow or long-term reserve development?
* Are you building one mine or a portfolio?
* Do you have technical people?
* Do you have document/compliance support?
* Do you have buyers?
* Do you have land/community access?

Then it recommends an operating model.

### Level 2: Portfolio strategy

This is for owners with multiple sites.

The AI ranks sites:

| Ranking dimension     | Example                                                      |
| --------------------- | ------------------------------------------------------------ |
| Licence security      | Is the licence active, pending, expired, disputed?           |
| Geological confidence | Rumour, sample, trench, shaft, vein, assay, production proof |
| Cash requirement      | How much money needed for next 30/60/90 days?                |
| Cash return           | How soon could it produce saleable material?                 |
| Operational readiness | workers, access, equipment, documents                        |
| Risk                  | safety, community, environment, legal, funding               |
| Strategic value       | mineral type, location, buyer demand, expansion potential    |

Then it gives portfolio advice:

> "Site A deserves immediate funding because the vein is confirmed and the document status is clean. Site B should be paused until renewal confirmation. Site C should receive only low-cost sampling because geological confidence is weak."

### Level 3: Mine/site strategy

This is for each operation.

The AI tracks phase:

* licence application;
* exploration;
* access preparation;
* sampling;
* trenching;
* shafting;
* vein search;
* vein confirmation;
* expansion;
* extraction;
* sorting;
* processing;
* transport;
* sale;
* rehabilitation;
* renewal/conversion.

Each phase has different strategy.

For example:

* During vein search, use low-cost flexible methods.
* During confirmation, invest in evidence and sampling.
* During expansion, evaluate mechanization.
* During sorting, labour may be better than machinery.
* During transport/sale, documentation and chain-of-custody become critical.

### Level 4: Execution strategy

This is daily/weekly planning.

The AI asks:

* Who is available?
* What equipment is available?
* What task is blocked?
* Which document is pending?
* Which supplier is late?
* Which worker group is idle?
* Which asset is underused?
* Which site should be prioritized today?

This is where Short Interval Control matters. ABB describes one of modern mining's biggest challenges as coordinating tactical plans with operational plans; short interval control creates fast feedback loops so production can be tracked against targets and deviations corrected during the shift, not only after the fact. [ABB Group][6]

Deswik's operations software similarly connects short-term planning with operator task progress from the field, allowing dynamic decision-making during shifts and conformance-to-plan tracking. [deswik.com][7]

GroundHog's short interval control approach shows the same pattern: import daily, weekly, and monthly plans; allocate tasks; monitor production; and adjust based on actual reports from supervisors or fleet systems. [GroundHog][8]

So your system should have a simplified version for small/mid-sized operators:

> Plan → Assign → Report → Compare → Explain deviation → Recommend correction.

### Level 5: Strategic adaptation

This is the advanced intelligence.

Modern mine planning research is moving away from fixed plans toward adaptive decision-making under uncertainty. A 2026 POMDP mine-planning paper argues that extraction/routing decisions should update sequentially as new geological observations arrive, rather than relying only on a fixed ex-ante schedule. [arXiv][9]

For your platform, that means the AI should constantly update its beliefs:

* vein confidence changed;
* costs increased;
* machine broke;
* document delayed;
* worker productivity dropped;
* supplier price changed;
* buyer price changed;
* rainfall blocked road;
* licence risk increased;
* sample grade improved;
* cash availability changed.

Then the strategy changes.

This is the key: **the platform should not only manage mining operations; it should update strategy as reality changes.**

## 7. The onboarding intelligence: building the company from scratch

When a new owner joins, the AI should run a guided strategic interview.

### Stage 1: Owner intent

Questions:

* What kind of mining business are you trying to build?
* Are you currently exploring, mining, processing, trading, or still planning?
* Which minerals?
* Which region/district?
* What capital do you have?
* What documents do you already have?
* Do you own licences?
* Do you have workers?
* Do you have equipment?
* Do you already have buyers?
* What is your biggest current pain: documents, money, workers, machines, licence, geology, buyers, or management?

Output:

**Owner Strategy Profile**

Example:

> "You are building a small-to-mid-scale gold mining operation with limited capital, active field labour, weak document structure, and medium operational urgency. Recommended model: document-first, low-cost exploration discipline, staged mechanization only after vein confirmation."

### Stage 2: Company structure

The AI asks for:

* company name;
* registration documents;
* directors;
* shareholders;
* tax registration;
* bank details;
* licence holder;
* board resolutions;
* authority letters;
* signatories;
* office address;
* compliance contacts.

Output:

**Company Governance Map**

It should show:

* who owns what;
* who signs what;
* who files documents;
* who approves spending;
* who manages sites;
* who manages money;
* who reports to owner.

### Stage 3: Licence map

The owner uploads PL/PML/ML documents.

The AI extracts:

* licence number;
* licence type;
* mineral;
* holder;
* grant date;
* expiry date;
* coordinates;
* area size;
* obligations;
* renewal window;
* related payments;
* missing documents.

Tanzania's Mining Commission is the regulator responsible for issuing licences and regulating exploration, mining, processing, mineral trading, and permits under the Mining Act. [Tumemadini][10] The Commission also publishes licence application and renewal forms, including renewal forms for Prospecting Licences and Mining/Special Mining Licences. [Tumemadini][11]

So, in Tanzania-style deployments, the system should be able to maintain a **mineral rights calendar** and a **regulator-ready filing pack** for each licence.

### Stage 4: Site/operation map

For each site:

* location;
* licence;
* mineral;
* site manager;
* current phase;
* active workers;
* equipment;
* camp status;
* access road;
* nearest town;
* water availability;
* security;
* community issues;
* geology confidence;
* production status;
* blockers.

Output:

**Mine Operation Thread**

### Stage 5: Financial baseline

The AI asks:

* daily wage per worker;
* number of workers;
* food cost per person;
* fuel cost;
* site rent/security;
* equipment rental;
* transport cost;
* document cost;
* expected production;
* expected sale price;
* cash available.

Output:

* current daily burn;
* 7-day forecast;
* 30-day forecast;
* site break-even estimate;
* next funding need;
* high-risk cost category.

### Stage 6: Employee and role map

The AI builds:

* owner;
* operations manager;
* site manager;
* document officer;
* finance officer;
* geologist/consultant;
* supervisor;
* workers;
* equipment operators;
* security;
* drivers;
* contractors;
* buyers;
* suppliers.

Then it tracks:

* who is busy;
* who is idle;
* who is overloaded;
* who is assigned to which site;
* who has pending tasks;
* who requires follow-up.

### Stage 7: Strategic roadmap

The AI produces:

> "Your 30-day mining company setup plan."

Example:

Week 1:

* upload all licences;
* verify expiry dates;
* create site threads;
* create employee roles;
* establish daily reporting.

Week 2:

* complete missing documents;
* create cost baseline;
* assign site managers;
* start geological confidence scoring.

Week 3:

* introduce procurement planning;
* start machine-vs-labour analysis;
* create buyer/sale tracking.

Week 4:

* produce first monthly owner report;
* decide which sites to fund, pause, or escalate.

## 8. The core modules

### Module 1: Central Intelligence / Mining CEO Brain

This is the conversational command center.

Capabilities:

* understands uploaded documents;
* asks clarifying questions;
* creates business structure;
* updates mental maps;
* detects missing information;
* generates tasks;
* assigns employees;
* summarizes operations;
* forecasts cost;
* compares sites;
* recommends strategy;
* produces reports.

The AI should have modes:

| Mode                | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| Build Mode          | set up company, licences, employees, sites          |
| Strategy Mode       | evaluate options, expansion, funding, mechanization |
| Operations Mode     | daily execution, blockers, tasks                    |
| Document Mode       | filing, refiling, renewals, checklists              |
| Finance Mode        | cost, cash flow, profitability                      |
| Risk Mode           | licence, safety, environmental, community, cash     |
| Board/Investor Mode | clean reports and funding narratives                |

### Module 2: Company Builder

This module helps an owner build the mining business.

It should include:

* company profile;
* corporate documents;
* shareholders/directors;
* authority matrix;
* approval rules;
* operating model selection;
* org chart;
* job descriptions;
* responsibility map;
* reporting cadence;
* governance checklist.

Example AI output:

> "Your company currently has field activity but no formal operating structure. Recommended immediate structure: Owner → Operations Lead → Site Supervisors → Finance/Admin → Document Officer. Because documents are slowing operations, create a document officer role before adding more workers."

### Module 3: Mineral Rights / PL Brain

This is the licence intelligence layer.

Features:

* licence registry;
* PL/PML/ML/SML tracker;
* renewal windows;
* annual rent/payment tracker;
* cadastre link/reference;
* coordinate storage;
* GIS map;
* area watchlist;
* competitor/target area notes;
* conversion pathway;
* farm-out/JV tracking;
* dispute tracking;
* obligation tracker.

Tanzania has an online mining cadastre history and public portal infrastructure. Spatial Dimension reported that Tanzania's online mining cadastre portal was created to improve transparency and ease of interaction with government mineral rights data, and that it hosted tens of thousands of mineral licences. [Spatial Dimension][12]

For the platform, this means the owner should not just store licence PDFs. They should see:

> "This PL is an asset. It has deadlines, obligations, costs, risks, coordinates, strategic value, and future options."

### Module 4: Document Brain

This is the immediate high-value wedge.

Features:

* upload documents;
* OCR;
* classify document;
* extract dates, names, licence numbers, coordinates, fees;
* detect missing attachments;
* generate refiling documents;
* compare old and new submissions;
* create filing packs;
* create reminders;
* chat with one document;
* chat with multiple documents;
* create compliance checklist;
* produce printable packs.

Document categories:

* company registration;
* board resolutions;
* authority letters;
* PL/PML/ML/SML documents;
* applications;
* renewals;
* payment receipts;
* tax clearance;
* environmental reports;
* community agreements;
* land access letters;
* equipment rental contracts;
* employment records;
* supplier invoices;
* buyer contracts;
* transport documents;
* inspection/royalty documents.

The AI should answer:

> "What documents do I need to renew this PL?"
> "Which documents are expired?"
> "Which documents are missing signatures?"
> "Which documents did we submit last time?"
> "Create a refiling pack using the same structure but new dates and updated coordinates."
> "Which document is blocking Site A?"

### Module 5: Mine / Site Operations Brain

Every site should have its own operational cockpit.

Fields:

* site name;
* licence;
* location;
* mineral;
* phase;
* site manager;
* worker count;
* equipment;
* current task;
* daily progress;
* blockers;
* costs;
* photos;
* safety status;
* production;
* stockpile;
* next action.

Daily report form:

* date;
* site;
* workers present;
* tasks completed;
* metres advanced;
* tonnes moved;
* machine hours;
* fuel used;
* food consumed;
* tools used;
* incidents;
* photos;
* supervisor comment;
* tomorrow plan.

The AI turns this into:

* progress summary;
* deviation from plan;
* productivity analysis;
* cost update;
* risk update;
* next-day tasks.

GMG's short interval control case study highlights the value of monitoring deviations from plan, including hauling/loading positioning, planned speeds, premature transfer of loading equipment, and coordination challenges. [Global Mining Guidelines Group][13]

For your product, this becomes:

> "The owner does not need raw reports. The owner needs the AI to explain what changed, why it matters, and what to do next."

### Module 6: HR / Workforce Brain

This is not a generic HR module. It is a mining productivity and accountability system.

Features:

* employees;
* contractors;
* roles;
* site assignment;
* attendance;
* wage rates;
* advances;
* task history;
* skills;
* certifications;
* PPE/training status;
* productivity by phase;
* availability;
* idle-time detection;
* reassignment recommendations.

The AI should know:

* who is at which site;
* who is responsible for each task;
* who is delayed;
* who is waiting for materials;
* who is underutilized;
* who can be moved to another site;
* who should not be compared because their mining phase is different.

Example:

> "Team A appears more productive than Team B, but Team A is sorting confirmed material while Team B is searching for a vein. Productivity comparison should be phase-adjusted."

### Module 7: Inventory and Procurement Brain

Mining delays often come from late materials.

Inventory categories:

* fuel;
* oil;
* food;
* water;
* PPE;
* tools;
* spare parts;
* compressor parts;
* generator parts;
* pumps;
* pipes;
* batteries;
* sacks/bags;
* sample bags;
* assay supplies;
* camp supplies;
* lawful permit-linked explosive inventory/status only.

The system should track:

* current stock;
* consumption rate;
* reorder point;
* supplier;
* expected delivery date;
* site need date;
* delay risk;
* cash requirement.

The AI should say:

> "Fuel will run out in 3 days at current consumption. Compressor maintenance is due in 12 hours of use. Food stock supports 18 workers for 4 days. If the excavator arrives Tuesday, fuel purchase must happen by Monday."

For restricted materials like explosives, the platform should only support lawful compliance tracking: authorized personnel, permit status, approved supplier, inventory reconciliation, storage compliance, blast approval, exclusion-zone confirmation, and audit trail. It should not provide unsafe operational instructions.

### Module 8: Asset and Equipment Brain

Assets:

* excavators;
* compressors;
* generators;
* pumps;
* crushers;
* trucks;
* motorcycles;
* tools;
* PPE;
* fuel tanks;
* processing equipment.

Track:

* owned/rented;
* location;
* operator;
* status;
* hours used;
* fuel consumption;
* downtime;
* maintenance;
* cost per hour;
* output per hour;
* next service;
* utilization rate.

Microsoft's mining AI work highlights equipment optimization and predictive maintenance as major AI use cases, including systems that generate insights on machine condition and equipment performance. [Microsoft][3]

For this platform, start simple:

> "Machine used 6 hours, produced X tonnes, burned Y litres, idle 1.5 hours because trucks were unavailable."

Then the AI can detect:

* underutilization;
* excessive fuel consumption;
* bad rental economics;
* maintenance risk;
* equipment mismatch.

### Module 9: Cost and Finance Brain

This is the owner's survival layer.

Track:

* licence costs;
* document costs;
* wages;
* food;
* fuel;
* equipment;
* repairs;
* land/community;
* transport;
* processing;
* security;
* management/admin;
* debt;
* advances;
* sales;
* cash collected;
* receivables.

Outputs:

* daily burn rate;
* weekly burn;
* monthly burn;
* site-level P&L;
* cost per metre advanced;
* cost per tonne mined;
* cost per tonne sold;
* cost per machine hour;
* cost per worker-day;
* break-even price;
* cash runway;
* funding requirement;
* profitability forecast.

The platform should support:

* actual cost;
* forecast cost;
* committed cost;
* unpaid cost;
* disputed cost;
* hidden cost;
* document-blocked cost;
* idle-time cost.

Example:

> "Site A is not expensive because wages are high; it is expensive because 22 workers are waiting for compressor repair. Idle labour cost this week is TZS X."

### Module 10: Strategic Decision Engine

This is where the product becomes special.

Decision engines:

1. **Start / Pause / Continue / Kill**
2. **Manual labour vs machine**
3. **Rent vs buy equipment**
4. **Hire vs contractor**
5. **Explore more vs start extraction**
6. **Process vs sell raw**
7. **Renew licence vs abandon**
8. **Fund Site A vs Site B**
9. **Increase workers vs improve supervision**
10. **Stockpile vs sell now**
11. **Internal operation vs JV/farm-out**
12. **Quick cash vs long-term reserve development**

The manual-vs-machine model should be phase-sensitive:

| Phase                          | Strategy                                     |
| ------------------------------ | -------------------------------------------- |
| Searching for vein             | keep low-cost, flexible, evidence-driven     |
| Weak geological confidence     | avoid heavy machine spend                    |
| Confirming vein                | spend on evidence, sampling, controlled work |
| Following confirmed vein       | consider targeted mechanization              |
| Large expansion > several days | compare machine vs labour economics          |
| Sorting/grading                | usually manual/controlled labour             |
| Hauling/loading                | machinery often useful                       |
| Processing                     | depends on recovery, grade, and throughput   |

The AI should produce:

> "Recommendation: do not bring excavator yet. Geological confidence is still low. Spend first on sampling and two days of controlled trenching. Re-evaluate when confidence reaches 70%."

Or:

> "Recommendation: rent excavator for 4 days. Manual team will cost more after day 6, and the site already has confirmed vein continuity. Keep sorting manual."

### Module 11: Safety, Environment, and Community Brain

This is mandatory.

The system should track:

* safety risks;
* daily toolbox talks;
* PPE;
* incidents;
* near misses;
* shaft/pit hazards;
* water risks;
* dust/noise;
* tailings/waste;
* land disturbance;
* rehabilitation;
* community complaints;
* land access;
* compensation;
* village meetings;
* environmental obligations.

ICMM's Critical Control Management guidance focuses on identifying critical controls, assessing their adequacy, assigning accountability, and verifying that they work in practice. [Minerals Council of Australia][14] IFC's mining EHS guidelines emphasize issues such as water use, effluent/stormwater management, occupational health and safety, community health and safety, and environmental monitoring. [IFC][15]

For Tanzania and small-scale contexts, IIED notes that Primary Mining Licence holders may be expected to conduct baseline environmental and social investigations and prepare environmental protection plans before commencing operations, while land conflicts with other users are a recurring issue.

So the AI must ask:

> "Do you have land access proof?"
> "Has the village/community issue been resolved?"
> "Has the environmental baseline been done?"
> "Are there water sources, farms, graves, schools, or settlements nearby?"
> "What critical controls must be verified before work continues?"

### Module 12: Sales, Buyers, and Mine-to-Market Brain

Mining strategy is incomplete without the sale chain.

Track:

* ore parcel;
* source site;
* grade;
* weight;
* buyer;
* price;
* transport;
* inspection;
* royalty/payment documents;
* payment status;
* deductions;
* disputes;
* stockpile.

The AI should answer:

* Which buyer gives the best net price?
* Should we sell raw or process?
* What is the recovery loss?
* Which stockpile is ready?
* Which sale lacks documentation?
* Which site has revenue but no proper cost allocation?
* Which sale has unpaid balance?

McKinsey's mine-to-market view is directly relevant here: mining companies improve performance when they optimize throughput, product margins, operating costs, processing, inventory, logistics, and customer contracts as one connected system. [McKinsey & Company][5]

For your system:

> "From licence to ore to cash" should be traceable.

## 9. Strategic playbooks the AI should support

The system should not assume all mining owners are the same.

### Playbook A: Explorer-first company

Goal: acquire/hold PLs, prove mineral potential, raise money or farm out.

Needs:

* PL management;
* geological evidence;
* sampling;
* maps;
* reports;
* investor packs;
* cost discipline;
* renewal control;
* JV/farm-out tracking.

AI strategy:

> "Do not spend heavily on extraction. Spend on evidence quality and licence security."

### Playbook B: Small-scale operator

Goal: produce quickly with limited capital.

Needs:

* daily cost control;
* labour management;
* site reporting;
* equipment rental decisions;
* buyer tracking;
* document discipline.

AI strategy:

> "Maximize cash discipline and avoid over-mechanizing before confirmation."

### Playbook C: Multi-site portfolio owner

Goal: manage several PLs/sites.

Needs:

* portfolio ranking;
* capital allocation;
* site comparison;
* licence calendar;
* staff allocation;
* strategic pause/continue decisions.

AI strategy:

> "Fund the highest-confidence site; maintain only minimum licence obligations on lower-confidence assets."

### Playbook D: Processor / beneficiation company

Goal: buy/process ore or process own ore.

Needs:

* input quality;
* plant throughput;
* recovery;
* stockpile;
* buyer contracts;
* maintenance;
* energy cost.

AI strategy:

> "Optimize recovery and throughput, not just volume."

### Playbook E: Contractor/equipment-led company

Goal: earn from equipment/services.

Needs:

* asset utilization;
* rental contracts;
* maintenance;
* fuel;
* operator scheduling;
* customer/site tracking.

AI strategy:

> "Profit comes from uptime, utilization, fuel control, and contract discipline."

### Playbook F: Trading/logistics company

Goal: buy/sell minerals lawfully.

Needs:

* licences/permits;
* buyer/seller KYC;
* price tracking;
* transport;
* inspection;
* payment;
* compliance.

AI strategy:

> "Profit comes from documentation, price timing, trust, and fast settlement."

## 10. The AI agent system

Build it as a multi-agent architecture under one central brain.

| Agent                   | Function                                           |
| ----------------------- | -------------------------------------------------- |
| Chief Mining Strategist | owner-level strategy and business model            |
| Company Builder Agent   | company setup, org chart, operating model          |
| Document Agent          | uploads, refiling, compliance packs                |
| Licence / PL Agent      | mineral rights, renewals, cadastre, obligations    |
| Mine Planner Agent      | phases, work plans, site sequencing                |
| Operations Agent        | daily reports, blockers, progress                  |
| HR Agent                | employees, availability, assignments, wages        |
| Cost Engineer Agent     | burn rate, forecasts, cost decisions               |
| Equipment Agent         | utilization, maintenance, rent/buy decisions       |
| Procurement Agent       | inventory, reorder, supplier timing                |
| Safety/E&S Agent        | hazards, incidents, critical controls, environment |
| Sales Agent             | ore parcels, buyers, prices, payments              |
| Auditor Agent           | evidence, approvals, source traceability           |
| Report Writer Agent     | board packs, investor memos, owner briefs          |

The central intelligence coordinates them.

Example flow:

Owner says:

> "Should I send the excavator to Site B?"

Central brain asks:

* Licence Agent: is Site B legally ready?
* Operations Agent: what phase is Site B in?
* Cost Agent: manual vs excavator economics?
* Equipment Agent: is excavator available?
* HR Agent: what workers are assigned?
* Safety Agent: any access/slope/ground risks?
* Document Agent: any missing permission?
* Strategy Agent: does Site B deserve capital?

Then it gives one answer:

> "Send excavator only for access and bulk removal, not vein chasing. Site B is legally ready, but geological confidence is medium. Limit rental to 3 days and require daily photo/progress reports. If no vein continuity after 3 days, stop."

## 11. The data architecture

### Core database

Structured records:

* companies;
* users;
* roles;
* sites;
* licences;
* documents;
* tasks;
* employees;
* assets;
* inventory;
* costs;
* reports;
* production;
* sales;
* risks;
* approvals;
* reminders.

### Knowledge graph

The knowledge graph connects everything.

Example:

> Licence PL-001 → belongs to Company A → covers Site A → has Document X → expires on Date Y → requires Renewal Task Z → Site A uses Excavator E → operated by John → cost recorded under Project A → produced Ore Parcel OP-55 → sold to Buyer B.

This allows strategic questions:

> "Which costs are connected to this PL?"
> "Which sites depend on this employee?"
> "Which documents are blocking production?"
> "Which assets are idle but costing money?"
> "Which buyer payments are tied to which stockpile?"

### Vector database

For document chat:

* licence PDFs;
* contracts;
* reports;
* maps;
* invoices;
* communications;
* field notes.

### Time-series layer

For:

* daily costs;
* production;
* machine hours;
* fuel;
* attendance;
* progress;
* stockpile;
* cash flow.

### Geospatial layer

For:

* coordinates;
* licence boundaries;
* site locations;
* roads;
* villages;
* water;
* stockpiles;
* access routes;
* nearby licences.

## 12. The strategic dashboard

The owner dashboard should not be crowded. It should show the truth.

### Top cards

1. **Today's critical decisions**
2. **Licence risk**
3. **Cash runway**
4. **Site ranking**
5. **Document blockers**
6. **Employee/task status**
7. **Equipment utilization**
8. **Inventory risk**
9. **Safety/environment alerts**
10. **Revenue/sales status**

Example:

> **Critical Decision: Site A Mechanization**
> Manual labour cost will exceed excavator rental after 5.8 days. Vein confidence is 74%. Recommendation: rent excavator for 4 days, keep sorting manual, require daily evidence.

Example:

> **Document Risk: PL Renewal**
> Renewal deadline approaching. Missing: tax clearance, updated work programme, payment proof. Assign document officer today.

Example:

> **Cash Risk**
> Current cash supports 13 days of operations. If excavator is approved, runway drops to 7 days unless Buyer X pays outstanding balance.

## 13. The task system

Tasks should be AI-created, human-approved, and employee-executed.

Task fields:

* title;
* site/company;
* owner;
* due date;
* priority;
* reason;
* required documents;
* evidence required;
* dependencies;
* cost implication;
* risk if delayed;
* AI follow-up frequency;
* status.

Task types:

* document filing;
* payment;
* renewal;
* site work;
* procurement;
* machine maintenance;
* employee assignment;
* safety check;
* community meeting;
* buyer follow-up;
* report submission.

Example task:

> **Prepare PL Renewal Pack**
> Owner: Document Officer
> Due: Friday
> Evidence required: draft form, payment proof, tax clearance, updated work programme, map, director authorization.
> Risk if delayed: licence renewal risk, possible stoppage.
> AI follow-up: daily until completed.

## 14. The "business state" model

The AI should always maintain a live business state.

Possible states:

| Business state        | Meaning                                            |
| --------------------- | -------------------------------------------------- |
| Unstructured          | owner has assets/activity but no formal map        |
| Document-blocked      | operations depend on missing filings               |
| Cash-constrained      | good opportunity but insufficient funding          |
| Geology-uncertain     | spend should be controlled until evidence improves |
| Labour-heavy          | labour burn high; mechanization may be evaluated   |
| Equipment-constrained | productivity limited by machine availability       |
| Compliance-risk       | licence/safety/environment risk rising             |
| Production-ready      | enough evidence/documents/assets to produce        |
| Sale-ready            | stockpile ready and documents aligned              |
| Scale-ready           | repeatable operating model exists                  |

The AI should say:

> "Your business is currently document-blocked and cash-constrained, not operations-constrained."

That is powerful.

## 15. The strategic reports

The platform should generate:

### Daily Owner Brief

* yesterday's progress;
* today's priorities;
* blockers;
* costs;
* risks;
* required decisions.

### Weekly Strategy Memo

* site-by-site ranking;
* cash position;
* document status;
* major risks;
* recommended actions.

### Monthly Mining Business Report

* production;
* costs;
* revenue;
* P&L;
* licence status;
* HR;
* equipment;
* safety;
* next month plan.

### Investor / Bank Pack

* company structure;
* licence portfolio;
* operations status;
* production evidence;
* financial model;
* risks;
* use of funds;
* governance;
* repayment/source-of-cash logic.

### Board Pack

* executive summary;
* portfolio dashboard;
* capital allocation;
* major decisions;
* compliance status;
* performance charts.

## 16. Guardrails: how to make the AI trustworthy

The AI must not guess.

Every recommendation should include:

* evidence used;
* missing evidence;
* assumptions;
* confidence level;
* risk;
* alternative options;
* decision owner.

Example:

> Recommendation confidence: 68%.
> Evidence: 5 daily reports, 14 workers, 6 days of labour cost, 2 vein photos, supervisor confirmation.
> Missing: assay result, updated machine quote.
> Safer option: wait 2 days and collect more evidence before renting machine.

The system should separate:

* known facts;
* user claims;
* AI assumptions;
* calculated forecasts;
* external rules;
* recommendations.

This is non-negotiable.

## 17. MVP roadmap

### MVP 1: Strategic onboarding + Document/PL Brain

Build first:

* AI onboarding interview;
* company profile;
* upload documents;
* extract licence data;
* create PL tracker;
* expiry reminders;
* document checklist;
* chat with documents;
* refiling assistant;
* owner dashboard.

Why first: documents and licences are the fastest pain point and create the foundation for the mental map.

### MVP 2: Site Threads + Daily Reports

Add:

* mine/site profiles;
* daily site report;
* worker count;
* machine hours;
* costs;
* photos;
* blockers;
* AI site summary;
* task creation.

### MVP 3: Cost and Strategy Engine

Add:

* burn rate;
* cash runway;
* cost per site;
* manual vs machine model;
* site ranking;
* capital allocation recommendations.

### MVP 4: HR, Inventory, Assets

Add:

* employee roles;
* assignment;
* availability;
* wage tracking;
* inventory;
* procurement timing;
* asset utilization;
* maintenance reminders.

### MVP 5: Production and Sales

Add:

* ore parcel tracking;
* stockpile;
* grade;
* processing;
* buyer;
* sale;
* payment;
* royalty/compliance documents.

### MVP 6: Advanced Mining Intelligence

Add:

* geospatial map;
* geological confidence model;
* scenario simulation;
* portfolio optimization;
* investor reports;
* bank reports;
* multi-company command center.

## 18. The final product vision

The final platform should feel like this:

The owner logs in and sees:

> "Good morning. Your mining business has 4 active operations, 2 document risks, 1 cash risk, 1 equipment decision, and 3 employee follow-ups. Site A is your best current cash opportunity. Site B should be paused until renewal evidence is uploaded. Site C needs only low-cost sampling. Site D is consuming fuel without enough production evidence."

Then the owner asks:

> "What should I do this week?"

The AI answers:

> "This week, focus on three actions:
>
> 1. Complete PL renewal documents for Site B.
> 2. Rent excavator for Site A for 4 days only, with daily evidence.
> 3. Reassign 6 workers from Site C to sorting at Site A because Site C is still geology-uncertain.
>    If you do this, projected cash runway improves from 11 days to 18 days assuming Buyer X pays by Friday."

That is the product.

Not ERP.
Not a dashboard.
Not a chatbot.

A **strategic mining brain** that helps owners build, structure, operate, and scale mining businesses from scratch.

[1]: https://www.deloitte.com/global/en/industries/mining-metals/perspectives/digital-transformation-in-mining.html "Digital transformation in mining | Deloitte Global"
[2]: https://www.bcg.com/publications/2026/the-ai-powered-mining-and-metals-company "The AI-Powered Mining and Metals Company | BCG"
[3]: https://www.microsoft.com/en-us/microsoft-cloud/blog/mining/2025/05/29/embracing-ai-and-adaptive-cloud-to-drive-digital-transformation-in-mining/ "Driving digital transformation in mining with AI and adaptative cloud | The Microsoft Cloud Blog"
[4]: https://www.reuters.com/world/americas/codelco-microsoft-sign-ai-deal-mining-operations-2026-03-05/ "Codelco, Microsoft sign AI deal for mining operations | Reuters"
[5]: https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mine-to-market-value-chain-a-hidden-gem "The mining value chain: A hidden gem | McKinsey"
[6]: https://new.abb.com/mining/digital-applications/operations-management-system-oms-for-mining/digitalization-of-short-interval-control-%28sic%29-and-production-scheduling-in-mining "Digitalization of Short Interval Control (SIC) and Production Scheduling in mining — ABB"
[7]: https://www.deswik.com/products/ops "Mine scheduling software that connects planning to execution"
[8]: https://groundhogapps.com/groundhog-short-interval-control/ "Simple, Powerful Short Interval Control for Mining — Groundhog Apps"
[9]: https://arxiv.org/abs/2605.13702 "[2605.13702] Adaptive mine planning under geological uncertainty: A POMDP framework for sequential decision-making"
[10]: https://www.tumemadini.go.tz/?utm_source=chatgpt.com "TUME YA MADINI — Official Website"
[11]: https://www.tumemadini.go.tz/publications/forms/?utm_source=chatgpt.com "Forms"
[12]: https://www.spatialdimension.com/articles/tanzania-online-mining-cadastre-portal-launched/ "Tanzania Online Mining Cadastre Portal Launched | Spatial Dimension"
[13]: https://gmggroup.org/short-interval-control-monitoring-improves-mine-planning-in-large-scale-open-pit-operation/ "Short Interval Control Monitoring Improves Mine Planning in Large-Scale Open-Pit Operation — Global Mining Guidelines Group"
[14]: https://minerals.org.au/wp-content/uploads/2022/12/ICMM-Health-and-safety-critical-control-management-good-practice-guide.pdf?utm_source=chatgpt.com "Health and safety critical control management"
[15]: https://www.ifc.org/content/dam/ifc/doc/2000/2007-mining-ehs-guidelines-en.pdf?utm_source=chatgpt.com "Environmental, Health, and Safety Guidelines for Mining"
