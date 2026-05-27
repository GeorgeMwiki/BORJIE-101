# Boji AI — Corpus Synthesis & Build Reality Check

**Date:** 2026-05-25  
**Source integration:** BOJI_AI_SPEC.md (v0.3), USER_BRIEF_01-03, MVP1_BUILD_PLAN.md, DATA_MODEL.md, AGENT_PROMPT_LIBRARY.md (structural), UI_SCREEN_CATALOGUE.md, 06_BOSSNYUMBA_PATTERN_MAPPED.md, minerals/README.md

---

## A. Product vision in 5 sentences

Boji AI is a **mining company brain** — an AI-native strategic operating system that reads documents, talks to owners, and spawns 28 specialist Junior Agents that coordinate with supervisors, geologists, drivers, and officials to synthesize one living, accountable view of an entire mining business. From licence application through ore on the weighbridge to cash on the bank statement, Boji answers: *"What kind of mining company am I building, what is the current state of every operation, what is the next best move, who should do it, what will it cost, what documents are needed, and how do we become more profitable?"* Built for Tanzania's 2 million ASGM/SSM operators and the continent-wide mid-market. Clones BossNyumba's proven 13-step BrainKernel + Junior Factory + Consolidation Worker architecture verbatim into the mining domain. Never hard-coded — always learning, always updating.

---

## B. The 4 app surfaces (no customer/tenant app)

1. **Owner/Admin mobile app** (Expo RN; 25 screens)
   - Field decision-capture, daily brief, biometric authority sign-off, one-thumb operation
   - Core: Daily Brief, Ask Boji (voice), Decisions Pending, Portfolio Map, Site Detail, Cash & Runway, Documents, Licence Calendar, Sales Pipeline, Tasks, Marketplace
   - Optimized for rural 3G + offline; real-time sync via PowerSync

2. **Worker mobile app** (Expo RN; 22 screens)
   - Supervisor, driver, geologist, QC officer, stores-keeper field-data capture
   - Core: Shift report, SIC ping response, excavator-count, drill-hole logger, weighbridge capture, inventory, fuel log, machine hour, toolbox-talk, incident report, fingerprint sign-off
   - Completely offline-first; syncs on reconnect

3. **Owner/Admin web app** (Next.js 15; 22 screens)
   - Strategic cockpit: document chat with side-by-side PDF, LMBM graph explorer, portfolio map (PostGIS), site/licence/cost/geology/sales workbenches
   - Full compliance + audit pack export; board/investor/bank report generation
   - No time pressure; deep workflows

4. **Boji internal-platform web app** (Next.js 15; 20 screens)
   - Boji team operations: multi-tenant directory, intelligence corpus management, prompt registry, A/B harness, audit-log viewer, regulator-change pipeline, roll-back panel
   - **Not customer-facing.** Founder + team only

**Total: 89 screens across 4 surfaces. No customer/tenant app (this is the single biggest deviation from BossNyumba).**

---

## C. The 28 Junior Expert Agents

Organised by domain. Each Junior has a specific mandate, tool surface, confidence floor, daily action cap, and call graph.

**Document & Compliance Agents (5):**
1. **Document Agent** — OCR, classify, extract, file, generate refiling packs, chat with documents
2. **Licence / PL Agent** — Track PL/PML/ML/SML/Dealer/Broker lifecycle, calendar, cadastre overlap, renewal pack, dormancy risk
3. **Compliance Agent** — Cross-check every action against TZ Mining Act, EMA, Land Act, BoT FX rules; rule engine + citation library
4. **EPP Agent** — Compose EPP from photos + answers, route to NEMC officer, track approval
5. **Auditor / Evidence Agent** — Verify evidence chain for every recommendation; flag assumptions vs facts

**Community & Social Agents (3):**
6. **Village CSR Agent** — Schedule village meeting, capture minutes, record CSR commitments, emit fingerprint-signed letter
7. **Road Negotiation Agent** — Identify crossed landowners, compute compensation, generate district approval letters, schedule road clearing
8. **Community Agent** — Village complaints, CSR delivery, grievance log, land-use plan alignment

**Geology & Lab Agents (4):**
9. **Geology Agent** — Build geological-confidence score from local + professional methods; advise on next investigation step
10. **Drill-hole Logger Agent** — Structured capture of pit/shaft/RC/diamond holes; multi-hole vein triangulation; volume estimate
11. **Lab / Assay Agent** — Sample-tag chain-of-custody, lab order, QA/QC protocol, result ingestion
12. **Metallurgy Agent** — (implicit in mining-processing decisions; scope evolves MVP 3–6)

**Operations & Asset Agents (7):**
13. **Mine Planner Agent** — Sectionise site, expansion simulation, FMS-lite plan
14. **Operations / SIC Agent** — Build shift plan, hourly supervisor pings, end-of-shift reconciliation, deviation explanation
15. **HR Agent** — Roles, assignments, attendance, advances, productivity by phase, idle-time detection
16. **Asset / Fleet Agent** — Excavator/compressor/generator/pump/truck registry, rent vs buy, utilisation
17. **Maintenance Agent** — Hour-based service schedule, vibration / oil flags, downtime codes
18. **Procurement Agent** — Inventory, reorder, supplier timing, delay risk vs site need date
19. **Cost Engineer Agent** — Per-site, per-phase, per-tonne unit economics; break-even grade; idle-cost detection

**Finance & Sales Agents (4):**
20. **FX / Treasury Agent** — Cash runway, AR/AP, FX exposure, sell-or-stockpile recommendation; **27-Mar-2026 USD-contract cliff auditor**
21. **Sales / Off-take Agent** — Buyer routing, weighbridge image, batch sale letter, payment trace, NSR calc
22. **Report Writer Agent** — Daily Owner Brief, Weekly Strategy Memo, Monthly Mining Report, Investor / Bank pack
23. **Contract-Currency Auditor** (derived from FX/Treasury) — Scan, classify, draft addendum for USD-denominated domestic contracts (GN 198/2025)

**Safety, Environment, & Strategic Agents (4):**
24. **Safety / EHS Agent** — Critical-control register (ICMM CCM), toolbox talks, incident log, PPE, water/dust/noise
25. **External-Stakeholder Window Agent** — Surfaces local performance to externals, partner opportunities both ways, ratings
26. **(Master Brain)** — Mining CEO mode, Strategy mode, Build mode, Operations mode, Document mode, Finance mode, Risk mode, Board/Investor mode
27. **Junior AI Factory (lifecycle manager)** — Provision, adjust scope, record action, suspend, revoke subordinate agents
28. **Consolidation Worker** — Nightly synthesis (9 stages), weekly prompt compile (GEPA loop)

**Architecture note:** Not all 28 are first-class juniors in MVP 1 (Metallurgy, some depth in HR/Procurement/Asset are deferred to MVP 4). The list represents the full spec vision; MVP 1 ships Document, Licence, EPP, Village CSR, Geology, Operations, Cost Engineer, FX/Treasury, Sales, and Master Brain.

---

## D. Data model headline

**Postgres-first; PostGIS for geometry; pgvector (HNSW) for embeddings; Timescale for time-series; S3 for binary; Apache AGE optional, Neo4j Aura as v2 promotion target.**

**Top-level entities (39 tables):**

- **Multi-tenant boundary:** `tenants`, `users` (RLS enforced at row level)
- **Living Mining Business Map (bi-temporal):** `temporal_entities` (owner, company, director, licence, site, employee, asset, document, cost, production, sale, risk, task), `temporal_relationships` (OWNS, HOLDS_LICENCE, COVERS_SITE, ASSIGNED_TO, PRODUCED, SOLD_TO, REQUIRES_RENEWAL_OF, etc.), `temporal_communities` (Louvain nightly output)
- **Company layer:** `companies`, `directors`, `shareholders`, `bank_accounts`, `authorities`
- **Licence layer:** `licences` (PL/PML/ML/SML/DEALER/BROKER/PROCESSING), `licence_events` (renewal_due, payment_due, notice_of_breach)
- **Site layer:** `sites`, `site_sections` (start, camp, fuel_store, magazine, ore_stockpile, waste_dump, qc, wash_bay, road, rehab_nursery)
- **Geology layer:** `drill_holes`, `drill_hole_layers`, `samples`, `vein_models`
- **People & Assets:** `employees`, `attendance`, `advances`, `assets`, `maintenance_events`, `fuel_logs`
- **Production & Sales:** `shift_reports`, `production_records`, `ore_parcels`, `sales`, `buyers`
- **Treasury & Costs:** `cash_balances` (Timescale hypertable), `fx_rates`, `mineral_prices`, `costs`, `forecasts`
- **Documents & Audit:** `documents`, `fingerprint_events` (immutable, bi-temporal), `audit_log` (append-only), `decision_log`
- **Tasks & Risks:** `tasks`, `risks`
- **Marketplaces & KYC:** `marketplace_listings`, `ratings`
- **Intelligence corpus (vector):** `intelligence_corpus_chunks` (with `tenant_id = NULL` for global Boji bootstrap corpus; tenant-specific rows ingested on signup)

**Bi-temporal model ensures every fact is auditable through history.** PostGIS first-class (mining is geo-first). Timescale for high-frequency series (cash, FX, prices, shift telemetry). Append-only audit + immutable fingerprint events for non-repudiation to regulators. Row-level security at the database — defence in depth.

---

## E. The 7 onboarding stages and 12 modules

**7 onboarding stages (from USER_BRIEF_01 §7):**

1. **Owner intent** — What kind of mining business are you building? Current state? Capital? Pain points?
2. **Company structure** — Company name, registration, directors, shareholders, tax registration, bank, authority matrix
3. **Licence map** — Upload PL/PML/ML/SML documents; extract number, holder, grant, expiry, coordinates, obligations
4. **Site/operation map** — Location, licence, mineral, manager, current phase, workers, equipment, geology confidence, production status, blockers
5. **Financial baseline** — Daily wage, worker count, food cost, fuel cost, equipment rental, transport, document cost, expected production, expected sale price, cash available
6. **Employee and role map** — Owner, ops manager, site manager, document officer, finance officer, geologist, supervisor, workers, operators, security, drivers, contractors, buyers, suppliers
7. **Strategic roadmap** — "Your 30-day mining company setup plan" (Weeks 1–4 with explicit tasks and outputs)

**12 core modules (from USER_BRIEF_01 §8):**

1. **Central Intelligence / Mining CEO Brain** — Conversational command center; modes: Build, Strategy, Operations, Document, Finance, Risk, Board/Investor
2. **Company Builder** — Company profile, corporate documents, org chart, authority matrix, approval rules, responsibility map
3. **Mineral Rights / PL Brain** — Licence registry, renewal windows, cadastre link, coordinate storage, GIS map, obligation tracker
4. **Document Brain** (high-value wedge) — Upload, OCR, classify, extract, detect missing attachments, generate refiling packs, chat with documents
5. **Mine / Site Operations Brain** — Site cockpit, daily reports, blockers, costs, photos, safety, production, stockpile, next action
6. **HR / Workforce Brain** — Employees, contractors, roles, site assignments, attendance, wages, advances, task history, skills, certification, idle-time detection, reassignment recommendations
7. **Inventory and Procurement Brain** — Fuel, oil, food, water, PPE, tools, spare parts, current stock, consumption rate, reorder point, supplier, expected delivery, site need date, delay risk
8. **Asset and Equipment Brain** — Excavators, compressors, generators, pumps, crushers, trucks, tools, PPE; owned/rented, location, operator, status, hours, fuel consumption, downtime, maintenance, cost per hour, utilisation
9. **Cost and Finance Brain** — Licence costs, wages, food, fuel, equipment, repairs, land, transport, processing, security, admin, debt, advances; burn rate, P&L, cost per metre/tonne, break-even, runway, funding requirement
10. **Strategic Decision Engine** — 12 decision engines: Start/Pause/Continue/Kill, Manual vs machine, Rent vs buy, Hire vs contractor, Explore vs extract, Process vs sell, Renew vs abandon, Fund A vs B, Increase workers vs supervision, Stockpile vs sell, Internal vs JV, Quick cash vs reserves
11. **Safety, Environment, and Community Brain** — Safety risks, toolbox talks, PPE, incidents, shaft/pit hazards, water risks, dust/noise, land disturbance, rehab, community complaints, land access, compensation, village meetings, environmental obligations
12. **Sales, Buyers, and Mine-to-Market Brain** — Ore parcel, source site, grade, weight, buyer, price, transport, inspection, royalty, payment, stockpile; cost allocation; payment tracing; revenue reconciliation

---

## F. The 6-MVP roadmap

**MVP 1: Strategic onboarding + Document/PL Brain + Always-Learning skeleton (Weeks 1–12)**
- Tenant signup + NIDA/biometric enrolment
- 7-stage onboarding interview + LMBM population
- Document upload, OCR, classify, extract, chat with docs
- Licence registry, dormancy risk, renewal packs
- Contract-Currency Auditor (27-Mar-2026 cliff alert)
- Daily Owner Brief (Report Writer v1)
- Consolidation Worker stages 01-08 + weekly GEPA loop (stage 09)
- 4 surfaces (owner mobile/web, worker mobile shell, internal web shell)
- Pilot launch on a real pit

**MVP 2: Site Threads + Daily Reports + Operations/SIC (Weeks 13–20)**
- Mine/site profiles, daily shift reports, worker count, machine hours, costs, photos, blockers
- Operations Agent, end-of-shift reconciliation, deviation analysis
- SIC (Short Interval Control) pings, supervisor response loop
- Worker mobile full build-out (offline-first shift capture)
- Daily Owner Brief v2 (includes operational deviation + tomorrow plan)

**MVP 3: Cost and Strategy Engine (Weeks 21–26)**
- Burn rate, cash runway, cost per site, unit economics
- Manual vs machine decision model (phase-sensitive)
- Site ranking, capital allocation recommendations
- Cost forecasting + scenario simulation
- Financial controller persona depth

**MVP 4: HR, Inventory, Assets, Maintenance (Weeks 27–32)**
- Employee roles, assignment, availability, wage tracking
- Inventory tracking, procurement timing, reorder engine
- Asset utilization, maintenance schedules, predictive maintenance
- HR Agent, Procurement Agent, Asset/Fleet Agent, Maintenance Agent depth

**MVP 5: Production and Sales + Marketplaces (Weeks 33–38)**
- Ore parcel tracking, stockpile, grade, processing, buyer routing
- Batch sale workflow, payment tracing, royalty/compliance documents
- FX-aware sell-or-stockpile decision engine (BoT vs export route)
- Buyer marketplace, worker/equipment/lab/expert marketplaces
- External-Stakeholder Window (local performance visibility)

**MVP 6: Advanced Mining Intelligence + Multi-Company Group View (Weeks 39+)**
- Geospatial map, geological-confidence model, scenario simulation
- Portfolio optimization (multi-site, multi-mineral)
- Investor/bank report generation (bankable site reports)
- Multi-company group command center
- Drone imagery + Sentinel-2 advanced overlays
- Geological triangulation + multi-shaft volume estimation depth
- JV / streaming / off-take simulator

---

## G. The 13-step BrainKernel pipeline (how it works per turn)

**From BOSSNYUMBA_PATTERN_MAPPED.md §2, adopted verbatim for Boji:**

1. **Identity & Scope** — Resolve tenant, user, persona from request scope
2. **Killswitch Gate** — Check env-driven `HALT`/`DEGRADED` state (short-circuit if triggered)
3. **Memory Recall** — Query semantic graph + episodic store with embedding
4. **Cohort Signals** — Aggregate tenant-wide context (market intelligence, aggregated metrics)
5. **Self-Awareness** — Drift detection, confidence scoring, awareness of knowledge boundaries
6. **Theory of Mind** — Model user state, intent recognition, speech act understanding
7. **Tool Spec Resolution** — Load permitted tools for this persona (from AutonomyPolicy)
8. **Agent Loop** — Agentic reasoning: think → tool calls → reflect → stop condition
9. **Decision Trace** — Record every step taken (200-trace in-memory cap per tenant)
10. **Confidence Gate** — If low confidence, invoke Opus advisor mid-turn (counter-model hoist)
11. **Governance & Review** — Autonomy policy check, four-eye approval for sensitive actions
12. **Provenance Write** — Record fact to semantic memory with confidence + evidence_ids
13. **Response Synthesis** — Return message + decision breadcrumbs, cite sources

**Per-turn latency expectation: ~2–5 seconds (streaming enabled). Runs once per user turn.**

**Plus three permanent background processes:**
- **Junior Factory** — Provision/adjust/record/suspend/revoke subordinate agents; policy validation; daily-action caps
- **Consolidation Worker** (nightly) — 9-stage pipeline (ingest → cluster → reflect → promote → decay → consolidate → re-embed → publish → weekly GEPA)
- **Counter-Model Hoist** (optional, production-ready) — Secondary Haiku challenges primary Opus on sensitive/low-confidence actions

---

## H. The MVP1 build plan reality check (12 weeks, critical path)

**Pre-week 0 (4–7 days):** Repo bootstrap (fork BossNyumba → BOJI-AI, rebrand, provision AWS, delete unused apps, rename 4 surfaces, baseline Drizzle migrations from DATA_MODEL.md §1–3.5). Acceptance: `pnpm build` succeeds across all packages.

**Week 1:** Tenant + Auth + ingestion bootstrap (tenants/users + RLS, NIDA/Smile ID, WebAuthn/BiometricPrompt, Master Brain wiring, first-boot corpus ingestion from Docs/). Acceptance: new tenant signs up, gets enrolled, asks "What is a PML?" and gets corpus-grounded answer.

**Week 2:** Document Agent v1 (upload pipeline, Mistral OCR, document classifier, field extractor, pgvector embedding). Acceptance: tenant uploads PML PDF → classified, extracted (licence #, holder, mineral, area, grant, expiry), embedded, linked to LMBM.

**Week 3:** Licence Agent v1 + Dormancy Score (licences/licence_events tables, lifecycle calculator, dormancy risk daily job, renewal-pack tasks at T-90/30/7, GePG control-number tracker). Acceptance: tenant has 3 PMLs; expiry calendar, dormancy score, automated renewal pack assembly.

**Week 4:** Compliance Agent + citation library (ingest research/01_TZ_MINING_REGULATION into structured rules, Compliance check API, hot-paths coded as rules, Auditor Agent v1 gates every recommendation). Acceptance: Master Brain refuses to produce a recommendation without citation.

**Week 5:** Onboarding interview + Owner mobile shell (Expo skeleton, 7-stage interview flow, Owner profile + Company structure capture, Daily Owner Brief generator, O-M-01/02/03 screens). Acceptance: new tenant completes interview in <30 min, gets Daily Brief next morning.

**Week 6:** Owner web shell + Document chat (Next.js 15, O-W-01 cockpit, O-W-04 document chat with PDF preview + bbox highlights, O-W-05 portfolio map, O-W-14 compliance centre). Acceptance: owner can do strategic work on web.

**Week 7:** EPP Agent + Village CSR Agent (EPP wizard, NEMC officer marketplace, EPP draft PDF, village meeting capture + fingerprint sign-off, CSR Plan 14/7/30 day timer). Acceptance: tenant can run EPP + village-CSR mega-flow end-to-end (minus government API).

**Week 8:** Worker mobile core + offline sync (Expo skeleton, biometric login, PowerSync + WatermelonDB, W-M-04 shift report, W-M-05 SIC pings, W-M-06 excavator-count button). Acceptance: supervisor on intermittent rural 3G completes full shift cycle offline-first.

**Week 9:** FX/Treasury Agent + 27-Mar-2026 cliff auditor (daily FX rate ingest, NSR calculator, BoT-window vs export-route comparison, Contract-Currency Auditor). Acceptance: tenant sees every USD domestic contract flagged; can authorise conversion addendum + fingerprint flow.

**Week 10:** Operations / SIC + Daily Owner Brief v2 (end-of-shift reconciliation, deviation-code library in Swahili/English, tomorrow-plan auto-draft, excavator-idle alert). Acceptance: real pit generates defensible Daily Owner Brief at 06:00.

**Week 11:** Boji internal v1 (tenant directory, intelligence corpus management, prompt registry, audit-log viewer, roll-back panel). Acceptance: Boji team operates pilot tenants without SQL; every change has audit trail.

**Week 12:** Pilot launch + Consolidation Worker (stages 01-08 + stage 09 weekly GEPA, SLO instrumentation, real-pit pilot, retrospective + MVP2 backlog). Acceptance: **a real Tanzanian mining owner uses Boji daily for 5 days, submits 5 documents, 5 shift reports, 1 EPP, 1 village-meeting record, sees daily brief every morning, signs ≥3 documents biometrically.**

**Critical path dependencies:**
- Week 1 blocks all weeks (auth, Master Brain must be wired)
- Week 2 (Document Agent) blocks Week 3 (can't licence without docs)
- Week 3 (Licence Agent) blocks Week 4 (Compliance rules reference licences)
- Week 4 (Compliance) gates Week 9 (Contract-Currency Auditor depends on Compliance schema)
- Week 5 (Onboarding) blocks Week 6 (owner web needs owner profile data)
- Week 6 blocks Week 7 (EPP Agent needs owner web cockpit for scheduling)
- Weeks 1–7 can run in parallel with Week 8 (worker mobile is orthogonal until Week 10 integration)

**Hard constraints maintained throughout:**
- Every binding action requires owner approval above AutonomyPolicy ceiling
- Every recommendation carries provenance + evidence_ids
- Every TZ regulation cited in the spec is in citation library
- No domestic USD invoices. Period.
- No mercury operational instructions. Only abatement advice.
- No extraction advice in Ramsar/Selous-adjacent areas

---

## I. Explicit decisions made vs. open questions (TBD list)

**Decided:**

- **4 surfaces, no customer app** — Deviation from BossNyumba pattern; founder directive (USER_BRIEF_03 §Directive 03)
- **Bi-temporal LMBM** — Every fact auditable through history (BossNyumba pattern proven)
- **28 Junior Agents (full spec)** — MVP 1 ships ~10 core juniors; others deferred to MVP 2–6
- **No government-software integration in MVP 1** — Process flow is end-to-end *design*; execution is manual (founder directive)
- **13-step BrainKernel verbatim from BossNyumba** — Code-level fidelity ensures token-budget + weekly-prompt-compile learnings transfer
- **Consolidation Worker 9-stage + weekly GEPA loop** — Nightly ingest/cluster/reflect/promote; Sundays run GEPA (5 iterations max, Pareto-gated)
- **Contract-Currency Auditor in MVP 1** — 27-Mar-2026 USD cliff is a survival feature (spec Appendix F, forcing function)
- **Swahili-first UI** — Default language for Tanzanian tenants; English/French/Mandarin on request (USER_BRIEF_02 Marketplace §G.5)
- **Postgres + pgvector inline + PostGIS + Timescale** — No separate vector DB; bootstrap corpus ingested at first-boot; RLS at row level
- **Minerals intelligence corpus shipped with Boji** — 9 files, ~450k words, ~600 URLs; every junior queries this as ground truth

**Open questions (spec calls these TBD or leaves explicit gaps):**

1. **Government API integration timeline** — Spec says MVP 1 has no tumemadini.go.tz, NEMC officer booking, or GePG portal wiring. When do these land? (Likely MVP 3–4, if APIs stabilise)
2. **Drone imagery ingestion** — Spec mentions Sentinel-2 + Planet + DJI in MVP 6; no MVP 1 commitment. How will Geology Agent use drone data to refine confidence scores?
3. **Geological triangulation depth** — Multi-shaft vein triangulation promised in spec §6.3; MVP 1 has the schema (vein_models) but not the 3D volume-estimation algorithm. Algorithm TBD (likely needs a Qualified Person geologist in the loop, not pure AI).
4. **Metallurgy Agent operational scope** — Spec names 28 agents; Metallurgy is implicit (scope touches processing, recovery, ore blending). When is the processing-depth agent built? MVP 3–4?
5. **Marketplace depth (MVP 5 vs MVP 6)** — Spec MVP 5 has "marketplace for machinery, equipment, QC tools, workers, labs, experts, buyers" but also "External-Stakeholder Window" (local performance visibility). Are these the same system or separate? Integration point TBD.
6. **Multi-company group view** — Founder is building multi-site + multi-company portfolios. Spec MVP 6 promises "group command center" but relationship to company-hierarchy is unclear. Data model shows company → licence → site; what about `company.parent_company` or `portfolio`?
7. **Off-take simulator / streaming / JV tracking** — Spec mentions "JV / streaming / off-take simulator depth" in MVP 6. No detail on how Boji will model streaming deals (upfront cash vs future royalties). Algorithm TBD.
8. **Forecast model versioning** — Forecasts table has `model_version` column; GEPA loop only updates prompts. What controls model versioning (e.g., switching from Haiku to Sonnet for cost forecasts)? CI/CD integration TBD.
9. **Regulatory change ingest pipeline** — Spec mentions "Regulator updates (Gazette / SI / GN) → review queue → corpus push" in Boji internal §I-W-13. How is NEMC / BoT gazette parsed into structured rules? Likely manual + optional OCR; TBD.
10. **Marketplace moderation & dispute resolution** — Spec I-W-14 mentions "marketplace moderation, listings, ratings, disputes". No adjudication mechanism (escrow, arbitration, Boji team review). Escalation path TBD.
11. **Streaming / Swahili speech-to-text latency** — Worker mobile W-M-16 says "Swahili STT → answer" with "partial (queues)" for offline. Is Whisper v3 + Swahili model confirmed? Latency target TBD.
12. **Fingerprint template lifecycle** — Spec assumes local government officials' fingerprints are pre-enrolled. Who enrolls them? Boji team? LGA? What is the annual re-enrolment cadence? TBD.

---

## J. What the spec assumes about cloning BossNyumba

**Explicit filenames and patterns the spec says will be lifted:**

1. **Central kernel:** Clone `packages/central-intelligence/src/kernel/` verbatim (kernel.ts, compose.ts, agent-loop.ts); rename namespace from property to mining domain
2. **Junior Factory:** Clone `packages/ai-copilot/src/junior-ai-factory/` (types.ts, service.ts); reuse JuniorAIRecord, JuniorAILifecycle, policy validation
3. **Task Agents pattern:** Clone `packages/ai-copilot/src/task-agents/` (types.ts, executor.ts, registry.ts); replace 15 property-domain agents with 28 mining-domain agents
4. **Consolidation Worker:** Clone `services/consolidation-worker/` (9-stage pipeline + weekly GEPA loop); stages 01-08 reused verbatim; stage 09 weekly-compiler.ts (claude-mutator.ts, haiku-evaluator.ts) reused with Pareto gating
5. **Temporal Entity Graph (bi-temporal):** Clone `packages/database/src/schemas/temporal-entity-graph.schema.ts` (temporal_entities, temporal_relationships, temporal_communities tables); reuse Louvain community detection output
6. **Semantic Memory KV store:** Clone `packages/database/src/schemas/ai-semantic-memory.schema.ts`; reuse upsertFact, confidence scoring
7. **Document Intelligence service:** Clone `services/document-intelligence/src/` (OCR, fraud detection, validation, evidence pack builder); replace property-document types with mining-document types
8. **API Gateway composition:** Clone `services/api-gateway/src/composition/brain-kernel-wiring.ts` (kernel injection, env-driven killswitch, embedding provider fallback, per-tenant scope enforcement)
9. **HTTP routes:** Clone `services/api-gateway/src/routes/` (junior-ai.router.ts, hr.hono.ts pattern); add mining-specific endpoints (licence.router.ts, geology.router.ts, production.router.ts)
10. **Drizzle ORM:** Clone `packages/database/` (schema definitions, migrations, repository pattern); reuse Drizzle TS-first approach; add mining tables (licences, sites, drill_holes, samples, vein_models, ore_parcels, sales)
11. **Auth middleware:** Clone `services/api-gateway/src/middleware/` (JWT verification, scope extraction, RLS policy setting); reuse `req.scope.tenantId` pattern
12. **Autonomy policy loader:** Clone pattern from BossNyumba; adapt domains (e.g., from 'finance' → 'treasury', 'compliance', 'geology')
13. **Weekly prompt compiler (GEPA loop):** Clone `services/consolidation-worker/src/prompt-compile/` (weekly-compiler.ts, claude-mutator.ts, haiku-evaluator.ts); reuse 5-iteration limit + Pareto gating
14. **Counter-Model Hoist (Phase C-1):** Clone optional debate port from kernel composition (production commit 18c3f908); wire Haiku challenger on sensitive actions
15. **Packages to delete:** `apps/estate-manager-app`, `apps/customer-app`, `apps/bossnyumba_app` (all property-specific); rename `apps/admin-platform-portal` → `apps/internal-platform-portal`
16. **Env-driven killswitch:** Clone `HALT`/`DEGRADED` pattern from BossNyumba composition root; controls per-junior cutoff
17. **Persona model:** Clone persona framework from BossNyumba; adapt from 8 property personas (owner, tenant, estate manager, housekeeper, etc.) to mining personas (owner/admin, worker/supervisor, geologist, document officer, boji_team)
18. **Decision trace cap:** Reuse 200-trace in-memory cap per tenant; enforce in kernel step 9

**NOT being cloned (mining-specific, no BossNyumba analogue):**
- Mineral price feeds (LBMA, LME, Fastmarkets, BoT, local brokers)
- PostGIS geometry for mining sites, licence boundaries, water buffers, protected areas, road networks
- Drill-hole logging schema + multi-shaft vein triangulation algorithm
- Tanzanian mining regulation corpus (research/01 + 9 minerals files)
- FX-aware treasury logic (sell-or-stockpile as a currency decision)
- 27-Mar-2026 USD cliff auditor (GN 198/2025 compliance forcing function)
- Fingerprint-signed village CSR letters (biometric law compliance)
- BoT Domestic Gold Purchase Programme routing (4% royalty, 24-h TZS settlement)

---

## K. Key cross-file assumptions and potential friction points

1. **Docs/ folder as first-class runtime artefact** (USER_BRIEF_03 §Directive 04) — Every junior queries `Docs/primary_sources/`, `Docs/research/`, `Docs/research/minerals/` at runtime. First-boot ingestion must complete before any agent runs. Vector store failure blocks tenant signup.

2. **Founder directive: "no fluff, evidence required, decision-owner explicit"** — Every agent prompt enforces evidence chains, confidence scoring, assumption surfacing, decision-owner naming. Non-negotiable guardrail; non-compliance triggers Auditor Agent rejection.

3. **Tanzania-specific regulatory horizon (27-Mar-2026 USD cliff)** — CRITICAL FORCING FUNCTION. GN 198/2025 voids all domestic USD contracts on 27-Mar-2026. Contract-Currency Auditor in MVP 1 is **survival feature**, not nice-to-have. Without it, owners lose money and face TZS 4m penalties.

4. **Consolidation Worker / GEPA loop must be nightly + weekly, not on-demand** — Background job running on a scheduler (cron, Step Functions, K8s CronJob). Not user-triggered. Cost model depends on fixed schedule (5 iterations Sundays, ~25 Opus calls/week cheap, gate with Pareto).

5. **PostGIS for geometry is non-optional** — Every licence has a polygon, every site has a polygon, every section has a polygon, every water buffer is computed as geography(POINT, 4326) with distance checks. Without PostGIS the cadastre-overlap check and road-negotiation agent cannot function.

6. **Fingerprint biometric flow requires pre-enrolled local government officials** — Spec assumes village chair, VEO, district commissioner, NEMC officer have fingerprints in the system. Enrolment is a prerequisite, not an in-flow. If official is not enrolled, the system asks "Schedule biometric enrolment for [name] before proceeding." Enrolment kit TBD (likely Smile ID at a district office).

7. **Offline-first worker mobile is a hard constraint** — Rural sites have 3G drops. PowerSync + WatermelonDB are **required** for MVP 1, not optional. Sync on reconnect must reconcile without data loss. If sync fails, worker app queues and re-tries; owner is notified.

8. **Minerals intelligence corpus is versioned and append-only** — Files in `Docs/research/minerals/` are NEVER edited in-place. If a fact changes, append a dated changelog entry + add "supersedes" pointer. Corpus must remain auditable. Regular corpus re-ingestion (weekly GEPA step) propagates updates to tenant vector stores.

9. **No hard-coding of behaviour** — Spec title: "Always-Learning Brain." System prompts are mutable (GEPA loop), confidence thresholds are tunable, tool allowlists are per-tenant autonomy policies. Every junior is configurable without code deployment.

10. **4-eye approval is structural, not bolt-on** — Autonomy policy + Auditor Agent + confidence gates are the gating mechanism. Binding actions (filing renewal, authorizing TZS conversion, scheduling excavator) require explicit owner approval above the AutonomyPolicy ceiling. Not a UI checkbox; structural in the kernel.

---

**SYNTHESIS COMPLETE.**

This document synthesizes every design decision, every critical dependency, every open gap, and every confirmed pattern from Boji's planning corpus. Teams building MVP 1 should treat this as the **executive summary** before diving into individual specs.

