# Boji AI — UI Screen Catalogue

> Per-surface screen list for the four apps (Owner mobile, Owner web, Worker mobile, Boji internal web).
> Each screen names its primary junior agent, the LMBM nodes it reads/writes, and the success metric.
> Engineering uses this list as the storyboard for build sprints; design uses it as the wireframing brief.

---

## A · Owner Mobile App (Expo React Native)

> **Primary use:** decision-capture in the field; voice "ask Boji"; daily brief on the way to site; biometric authority sign-off. Optimised for one-thumb operation.

| # | Screen | Primary junior | Reads | Writes | Success metric |
|---|---|---|---|---|---|
| O-M-01 | **Home / Daily Brief** | Report Writer | decision_log, risks, forecasts, cash_balances | none | < 2 s open; owner reads top 3 cards |
| O-M-02 | **Ask Boji (chat + voice)** | Master Brain | LMBM, intelligence_corpus | decision_log | voice round-trip < 3 s |
| O-M-03 | **Decisions Pending** | Master Brain + Auditor | decision_log | tasks (approval) | every decision has 4-line reasoning |
| O-M-04 | **Portfolio Map** | Mine Planner + Licence | licences, sites, polygons | none | every PML visible with status colour |
| O-M-05 | **Site detail** | Operations / SIC | site, shift_reports, costs | none | latest shift, blockers, photos |
| O-M-06 | **Site Daily report** | Operations / SIC | shift_reports[latest] | none | < 30 s to read |
| O-M-07 | **Cash & runway** | FX/Treasury + Cost Engineer | cash_balances, forecasts | none | runway in days, big number |
| O-M-08 | **Documents (chat with docs)** | Document | documents, intelligence_corpus | decision_log | answer < 2 s with citation |
| O-M-09 | **Licence calendar** | Licence | licences, licence_events | tasks (renewals) | T-90 / T-30 / T-7 cards |
| O-M-10 | **Sales pipeline** | Sales / Off-take + FX/Treasury | ore_parcels, sales | sales (sign-off) | net price per parcel visible |
| O-M-11 | **Tasks assigned (approve / reject)** | every junior | tasks | tasks (state) | owner sees pending count |
| O-M-12 | **People** | HR | employees, attendance | assignments | site-by-site headcount |
| O-M-13 | **Assets / fleet** | Asset/Fleet + Maintenance | assets, maintenance_events | none | utilisation + service-due flag |
| O-M-14 | **Inventory & procurement** | Procurement | inventory_item, stock_move | reorder approvals | days-remaining per item |
| O-M-15 | **Safety & EHS** | Safety | risks, incidents | sign-offs | open critical-controls count |
| O-M-16 | **Community & CSR** | Community + Village CSR | csr_plans, grievances | sign-offs | commitments delivered % |
| O-M-17 | **FX & gold-window** | FX/Treasury | fx_rates, mineral_prices | none | sell vs stockpile recommendation card |
| O-M-18 | **27-Mar-2026 cliff status** | Contract-Currency Auditor | contracts | none | bar chart, days to cliff |
| O-M-19 | **Reports library** | Report Writer | documents (reports) | share actions | share-to-WhatsApp button on every report |
| O-M-20 | **Marketplace** | External-Stakeholder Window | marketplace_listings, ratings | listings (mine) | filter by category |
| O-M-21 | **Fingerprint sign-off flow** | (every junior) | document to sign | fingerprint_events | < 5 s including biometric |
| O-M-22 | **Onboarding interview** | Master Brain (Build mode) | none | owner_profile, companies, licences | < 30 min to first dashboard |
| O-M-23 | **Settings / billing / plan / team** | (Boji internal proxy) | users, plan | users (invite) | self-serve invite |
| O-M-24 | **Notifications hub** | (all juniors) | push + sms + WA history | none | mute per category |
| O-M-25 | **Audit pack export** | Auditor + Report Writer | documents, decision_log | expiring URL | regulator-ready watermarked PDF |

Total: **25 owner-mobile screens**.

---

## B · Owner Web App (Next.js 15)

> **Primary use:** the strategic cockpit. Document chat with screen-sized PDF preview, side-by-side comparison, board / investor / bank pack generation, portfolio-wide map.

| # | Screen | Primary junior | Notes |
|---|---|---|---|
| O-W-01 | **Cockpit dashboard** | Report Writer + Master | 10 cards per spec §13 |
| O-W-02 | **Conversational Master Brain** | Master | full chat + agent-call breadcrumbs visible |
| O-W-03 | **LMBM graph explorer** | Master | clickable graph nodes; provenance trace |
| O-W-04 | **Document chat (full PDF view)** | Document | bbox highlights; comparison view |
| O-W-05 | **Portfolio map (PostGIS + Mapbox)** | Licence + Mine Planner | layers: licences, sites, settlements, water, protected areas, roads |
| O-W-06 | **Site cockpit** | Operations + Geology + Cost Engineer | shift reconciliation, geology score, unit economics |
| O-W-07 | **Licence cockpit** | Licence + Compliance | renewal pack, dormancy score, payment history |
| O-W-08 | **People & roles** | HR | org chart, advances ledger, productivity by phase |
| O-W-09 | **Assets & fleet** | Asset + Maintenance | match-factor visualisation; predictive maintenance flags |
| O-W-10 | **Inventory & procurement** | Procurement | reorder timeline, supplier ITC compliance status |
| O-W-11 | **Geology workbench** | Geology + Drill-hole Logger + Lab | 3D site view; vein triangulation; assay QA/QC charts |
| O-W-12 | **Cost & finance** | Cost Engineer + FX/Treasury | full P&L, unit economics, break-even sensitivity |
| O-W-13 | **Sales & pipeline** | Sales | net-price comparison per buyer, payment trace |
| O-W-14 | **Compliance centre** | Compliance | regulator citation library, action checklist |
| O-W-15 | **Safety & EHS** | Safety | critical controls, incident heatmap |
| O-W-16 | **Community & CSR** | Community + Village CSR | minutes archive, delivery dashboard, grievance map |
| O-W-17 | **FX & treasury** | FX/Treasury | live rates, sell-vs-stockpile simulator, 27-Mar cliff tracker |
| O-W-18 | **Reports & exports** | Report Writer | daily / weekly / monthly / investor / bank / board / audit |
| O-W-19 | **Multi-company group view** | Master + Cost Engineer | only for `kampuni` / `group` plan tenants |
| O-W-20 | **Marketplace & external partners** | External-Stakeholder Window | dual-direction discovery |
| O-W-21 | **Onboarding & data import** | Document + Build-mode Master | bulk-upload PML PDFs etc. |
| O-W-22 | **Settings — users, roles, plan, billing, autonomy policy** | Boji internal proxy | RBAC editor |

Total: **22 owner-web screens**.

---

## C · Worker Mobile App (Expo React Native + PWA fallback)

> **Primary use:** field data capture; voice-first, photo-first, fingerprint-signed; offline-tolerant; bilingual (Swahili default).

| # | Screen | Primary junior | Inputs | Offline-OK? |
|---|---|---|---|---|
| W-M-01 | **Login (phone + biometric)** | — | phone, fingerprint | no |
| W-M-02 | **Today (worker home)** | Operations / SIC | shift plan from Boji | yes |
| W-M-03 | **Pre-shift briefing** | Operations / SIC | acknowledge | yes |
| W-M-04 | **Shift report (end-of-shift)** | Operations / SIC | workers, hours, fuel, photos, blockers, voice notes | yes |
| W-M-05 | **SIC ping response (hourly)** | Operations / SIC | loads since last, stoppages | yes |
| W-M-06 | **Excavator-count button** | Operations / SIC | tap-per-scoop | yes |
| W-M-07 | **Drill-hole logger** | Drill-hole Logger | hole id, GPS, kind, layers, photos, sample tag | yes |
| W-M-08 | **Sample bagging** | Lab/Assay | tag, weight, photo, chain-of-custody | yes |
| W-M-09 | **Weighbridge photo capture** | Sales | vehicle plate, driver, photo, video | yes |
| W-M-10 | **Inventory issue / return** | Procurement | item, quantity, recipient | yes |
| W-M-11 | **Fuel log** | Maintenance + Procurement | litres, asset, time | yes |
| W-M-12 | **Machine hour log** | Asset + Maintenance | start/end odometer | yes |
| W-M-13 | **Toolbox-talk acknowledgement** | Safety | topic, fingerprint | yes |
| W-M-14 | **Incident / near-miss report** | Safety | kind, severity, photos, voice | yes |
| W-M-15 | **PPE issue receipt** | Safety + HR | item, fingerprint | yes |
| W-M-16 | **Voice "ask supervisor / ask Boji"** | Master (proxied) | Swahili STT → answer | partial (queues) |
| W-M-17 | **Geo-tagged photo upload** | (any junior) | photo, location, tag | yes |
| W-M-18 | **Fingerprint sign-off (for letters)** | (every junior) | document to sign | partial (queues) |
| W-M-19 | **Attendance check-in / out** | HR | GPS-fenced punch | yes |
| W-M-20 | **Driver letter receipt (post-onloading)** | Sales | tap to view + share | yes |
| W-M-21 | **Sync status** | — | upload queue + reconciliation | yes |
| W-M-22 | **Help / training (offline videos)** | — | short voice-narrated micro-tutorials | yes |

Total: **22 worker-mobile screens.** All offline-tolerant by default; sync via PowerSync / Replicache against Postgres CDC.

---

## D · Boji Internal Web App (Next.js 15, SSO + IP allow-list)

> **Primary use:** the Boji team's own operations — multi-tenant directory, intelligence corpus management, prompt registry, audit-log viewer, regulatory-change pipeline, marketplace moderation, A/B test harness.

| # | Screen | Notes |
|---|---|---|
| I-W-01 | **Tenant directory** | sign-up, plan, billing, lifecycle |
| I-W-02 | **Tenant detail** | live ops view; can impersonate (audited) |
| I-W-03 | **Intelligence corpus management** | upload new research / minerals dossiers, supersede entries, version-bump, re-ingest |
| I-W-04 | **Citation library** | every TZ regulation indexed; gazette ingest pipeline |
| I-W-05 | **Prompt registry** | per-junior system prompts; GEPA scoreboard; promotion log |
| I-W-06 | **Model registry** | which Anthropic / Cohere / Whisper model per junior; cost / latency dashboards |
| I-W-07 | **Junior catalogue** | provision / suspend / revoke template juniors |
| I-W-08 | **A/B test harness** | run new prompt against golden set + canary tenants |
| I-W-09 | **Decision-log auditor** | per-tenant recommendation history with evidence chains |
| I-W-10 | **Audit-log viewer** | append-only event log per tenant |
| I-W-11 | **SLO dashboard** | latency, error, model-spend per tenant per junior |
| I-W-12 | **Feature-flag controls** | per-tenant roll-out |
| I-W-13 | **Regulator-change pipeline** | new Gazette / NEMC / BoT → review queue → corpus push |
| I-W-14 | **Marketplace moderation** | listings, ratings, disputes |
| I-W-15 | **Compliance review queue** | manual-approval gates the Compliance Agent escalates |
| I-W-16 | **Support tickets & escalations** | per-tenant CSAT, ticket SLA |
| I-W-17 | **Regulator audit-pack issuer** | mint expiring signed URLs |
| I-W-18 | **Onboarding / churn analytics** | funnel + cohort |
| I-W-19 | **Roll-back panel** | one-click revert of any promoted prompt / model / corpus version |
| I-W-20 | **Killswitch controls** | env vars HALT / DEGRADED per junior, per tenant |

Total: **20 Boji-internal screens.**

---

## Grand totals

| Surface | Screens |
|---|---|
| Owner mobile | 25 |
| Owner web | 22 |
| Worker mobile | 22 |
| Boji internal | 20 |
| **Total** | **89 screens** |

---

## Screen-to-junior matrix (top 5 most-touched juniors per surface)

| Surface | Top-touched juniors |
|---|---|
| Owner mobile | Master Brain · Operations/SIC · FX/Treasury · Report Writer · Document |
| Owner web | Master Brain · Geology · Cost Engineer · Compliance · Sales |
| Worker mobile | Operations/SIC · Drill-hole Logger · Safety · Procurement · Lab/Assay |
| Boji internal | Boji-Internal (proxied) · Compliance · Auditor · Document · Report Writer |

— end of UI catalogue v0.1 —
