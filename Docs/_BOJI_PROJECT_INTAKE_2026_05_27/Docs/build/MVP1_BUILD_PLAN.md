# Boji AI — MVP 1 Build Plan (Weeks 1–12)

> Concrete week-by-week ticket plan. The objective of MVP 1 is the **Document & PL Brain** plus **Daily Owner Brief** plus the **Always-Learning Brain skeleton** — the foundation that every subsequent milestone builds on. Acceptance criteria are explicit and testable.
>
> Target: shippable to a pilot tenant by end of Week 12.

---

## Pre-week 0 · Repo bootstrap (4–7 days, before Week 1)

Goal: working monorepo cloned from BossNyumba, rebranded, builds clean.

| # | Ticket | Acceptance |
|---|---|---|
| B-001 | Fork `BOSSNYUMBA101` → create `BOJI-AI` repo (private) | repo exists, GitHub Actions CI green |
| B-002 | Rebrand monorepo: package names, README, env files | `pnpm build` succeeds across all packages |
| B-003 | Provision AWS: Postgres (RDS), S3, R2, KMS, Secrets Manager | terraform plan + apply produces clean stack |
| B-004 | Provision Cloudflare zone for `boji.ai` + subdomains | DNS resolves, certs issued |
| B-005 | Anthropic + Cohere + Mistral OCR + Smile ID API accounts | smoke-test each from dev box |
| B-006 | Delete BossNyumba-specific apps not needed: `estate-manager-app`, `customer-app`, `bossnyumba_app` | repo is lean |
| B-007 | Rename and re-scope: `apps/owner-portal` stays; rename `apps/estate-manager-app` → `apps/worker-mobile` shell; add `apps/owner-mobile` shell; add `apps/boji-internal` shell | all 4 surfaces build clean |
| B-008 | Drizzle migrations baseline (from `DATA_MODEL.md` §1–§3.5) | `pnpm db:migrate` succeeds; RLS policies applied |

---

## Week 1 — Tenant + Auth + ingestion bootstrap

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-101 `tenants` + `users` tables + RLS | unit test creates 2 tenants; cross-read fails |
| Tue | T-102 NIDA / Smile ID integration | passport + face match returns success on test ID |
| Wed | T-103 WebAuthn / BiometricPrompt scaffold for fingerprint signing | sign-and-verify round-trip works on Android + iOS |
| Thu | T-104 Master Brain wiring: clone `packages/central-intelligence/kernel` from BossNyumba; rename namespace; smoke-test 13-step pipeline | trace shows all 13 steps run for "hello" |
| Fri | T-105 First-boot tenant bootstrap job ingests `Docs/primary_sources/` and `Docs/research/*.md` into `intelligence_corpus_chunks` | row count > 800; sample query returns relevant passage |

Acceptance for the week: a new tenant signs up, gets fingerprint-enrolled, and can ask "What is a PML?" — Master Brain answers grounded in the corpus with a citation.

---

## Week 2 — Document Agent v1 (the wedge)

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-201 Document upload pipeline: S3 + virus-scan + content-type validation | 200 MB upload completes; rejected types blocked |
| Tue | T-202 Mistral OCR integration; fallback Document AI for handwriting | OCR returns text with 0.85+ confidence on PML PDF samples |
| Wed | T-203 Document classifier (Zod-schemas per type) | precision ≥ 0.85 on a 30-doc validation set |
| Thu | T-204 Field extractor per type (PML, EPP, receipt, village_minutes) | extracted fields match ground truth ≥ 80% on validation set |
| Fri | T-205 pgvector embedding + retrieval over uploaded docs | "What does this document say about X?" returns the source passage |

Acceptance: tenant uploads a PML PDF → Document Agent classifies, extracts (licence #, holder, mineral, area, grant, expiry, fees, obligations), embeds, links to LMBM, and offers "chat with this document".

---

## Week 3 — Licence Agent v1 + Dormancy Score

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-301 `licences`, `licence_events` tables + Drizzle types | tests pass |
| Tue | T-302 Licence lifecycle calculator (PL: 4+3+2; PML: 7-year; renewals; 50% relinquishment on PL renewal) | unit tests for every licence type |
| Wed | T-303 Dormancy Risk Score daily job (cron) | scores stored in `licences.dormancy_score`; alert at > 75 |
| Thu | T-304 Renewal-pack assembly tasks at T-90 / T-30 / T-7 | tasks visible in worker / owner apps |
| Fri | T-305 GePG control-number tracker + manual ingest stub | owner can record a control number against a payment-due event |

Acceptance: tenant has 3 PMLs uploaded; Licence Agent shows expiry calendar, dormancy score per licence, automated renewal pack assembly tasks.

---

## Week 4 — Compliance Agent + citation library

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-401 Citation library schema; ingest `research/01_TZ_MINING_REGULATION_2025_2026.md` as structured rules | regulator search returns rule + section + URL |
| Tue | T-402 Compliance Agent `check_action(action)` API | refuses USD invoice for domestic tx with GN 198/2025 citation |
| Wed | T-403 Hot-paths (spec Appendix B) coded as rules | unit tests for water-60m, PML capital, royalty schedule, EPP-4-month, gold 20% set-aside |
| Thu | T-404 Auditor Agent v1 — every recommendation verified for citations + confidence | recommendations without citations are rejected and re-prompted |
| Fri | T-405 Telemetry: every compliance check logged to `audit_log` | dashboard counts checks per tenant per day |

Acceptance: Master Brain refuses to produce a recommendation without citation; Auditor + Compliance gate every binding action.

---

## Week 5 — Onboarding interview + Owner mobile shell

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-501 Owner mobile Expo project skeleton (i18n Swahili/English; Mapbox; NativeWind) | iOS + Android dev builds run |
| Tue | T-502 Strategic onboarding interview (7-stage flow, spec §7) | new tenant completes onboarding in < 30 min |
| Wed | T-503 Owner profile + Company structure capture (LMBM writes) | data lands in `companies`, `directors`, `shareholders`, `bank_account`, `authority`, `owner_profile` |
| Thu | T-504 Daily Owner Brief generator (Report Writer Agent v1) | Brief PDF + push notification at 06:00 daily |
| Fri | T-505 Owner mobile screens O-M-01 (Daily Brief), O-M-02 (Ask Boji chat), O-M-03 (Decisions Pending) | screens render with real LMBM data |

Acceptance: a brand-new tenant opens the app, completes the interview, uploads 2 PMLs, and gets a Daily Owner Brief tomorrow morning.

---

## Week 6 — Owner Web shell + Document chat

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-601 Next.js 15 project for `apps/owner-web`; shadcn/ui + Tailwind v4 + Mapbox | deploys to staging |
| Tue | T-602 O-W-01 Cockpit dashboard (10 cards per spec §13) | each card renders with real data |
| Wed | T-603 O-W-04 Document chat with full PDF preview + bbox highlights | clicking a citation jumps to PDF location |
| Thu | T-604 O-W-05 Portfolio map (licence polygons, sites, settlements, water buffers) | PostGIS query renders in < 1 s |
| Fri | T-605 O-W-09 Licence calendar + O-W-14 Compliance centre | dormancy + renewal tasks visible |

Acceptance: owner can do strategic work on web (document chat, portfolio map) and field decisions on mobile.

---

## Week 7 — EPP Agent + Village CSR Agent

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-701 EPP wizard screen flow (mobile) | guides through baseline photos, Q&A, mitigation, rehab |
| Tue | T-702 NEMC officer marketplace (read-only directory v1) | shows certified officers near the site |
| Wed | T-703 EPP draft PDF generator | document looks regulator-ready |
| Thu | T-704 Village meeting capture flow (worker app) + fingerprint sign-off | meeting record + signed letter PDF |
| Fri | T-705 CSR Plan 14/7/30 day timer + LGA notification | clock visible on owner app |

Acceptance: a tenant can run the EPP and village-CSR mega-flow end-to-end (minus government API).

---

## Week 8 — Worker mobile core + offline sync

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-801 Worker mobile Expo project; biometric login; Swahili default | iOS + Android dev builds run |
| Tue | T-802 PowerSync against Postgres CDC; local SQLite (WatermelonDB) | flight-mode test — data syncs on reconnect |
| Wed | T-803 W-M-04 Shift report (workers, hours, fuel, photos, blockers, voice notes) | offline capture + sync |
| Thu | T-804 W-M-05 SIC ping response (hourly cron from Operations Agent → push) | supervisor responds; LMBM updated |
| Fri | T-805 W-M-06 Excavator-count button + W-M-12 Machine hour log | counter persists across app restarts |

Acceptance: supervisor on intermittent rural 3G can complete a full shift cycle (briefing → SIC pings → end-of-shift report → handover) offline-first.

---

## Week 9 — FX/Treasury Agent + 27-Mar-2026 cliff auditor

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-901 Daily FX rate ingest: BoT mid, LBMA gold, LME basket (cron) | `fx_rates` and `mineral_prices` populated daily |
| Tue | T-902 NSR calculator with TZ-specific deductions (royalty / inspection / VAT / HIV levy / LG levy / WHT) | unit tests against worked examples in research/03 |
| Wed | T-903 BoT-window vs export-route comparison engine | recommends optimal route per parcel |
| Thu | T-904 Contract-Currency Auditor (spec Appendix F) — scan + classify + draft addendum | scans 100 documents, classifies domestic/cross-border with 90%+ precision |
| Fri | T-905 27-Mar-2026 cliff dashboard (mobile + web) | days-to-cliff + per-contract status visible |

Acceptance: tenant sees every USD-denominated domestic contract flagged; can authorise the conversion-addendum draft + fingerprint flow.

---

## Week 10 — Operations / SIC + Daily Owner Brief v2

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-1001 Operations Agent end-of-shift reconciliation logic | computes plan-vs-actual; explains deviation in Swahili |
| Tue | T-1002 Deviation-code library in Swahili + English | 20 standard codes available in worker app |
| Wed | T-1003 Tomorrow-plan auto-draft | uses previous shift's actuals + 7-day rolling baseline |
| Thu | T-1004 Daily Owner Brief v2: includes operational deviation + tomorrow plan | acceptance review by founder on his own pilot site |
| Fri | T-1005 Excavator-Never-Idle alert | push notification when shovel idle > 10 min |

Acceptance: a real pit running for one day in pilot generates a defensible Daily Owner Brief at 06:00 next morning.

---

## Week 11 — Boji internal v1 (the team's own surface)

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-1101 I-W-01 Tenant directory (sign-up, plan, billing) | Boji team can manage tenants |
| Tue | T-1102 I-W-03 Intelligence corpus management (re-ingest, supersede, version-bump) | new research doc lands in tenant vectors within 30 min |
| Wed | T-1103 I-W-05 Prompt registry + I-W-08 A/B harness (lite) | new prompt promoted only after golden-set holds |
| Thu | T-1104 I-W-10 Audit-log viewer per tenant | regulator-style PDF export from any tenant |
| Fri | T-1105 I-W-19 Roll-back panel | one-click revert of any promoted prompt/model |

Acceptance: Boji team operates pilot tenants without ad-hoc SQL; every change has audit trail + roll-back.

---

## Week 12 — Pilot launch + Consolidation Worker

| Day | Ticket | Acceptance |
|---|---|---|
| Mon | T-1201 Nightly Consolidation Worker stages 01-08 (ingest → reflect → promote → consolidate → re-embed → publish) | reservoir grows during day; consolidation runs at 02:00 UTC; promotion fraction observable |
| Tue | T-1202 Weekly GEPA prompt-compile harness (stage 09) | runs only on Sunday; tests against golden set; Pareto-gated |
| Wed | T-1203 SLO instrumentation (OpenTelemetry → Grafana) | latency / error / cost dashboards live |
| Thu | T-1204 Pilot-tenant onboarding (founder's own site or a friendly pilot) | full MVP1 flow used on a real pit |
| Fri | T-1205 Pilot retrospective + MVP2 backlog kick-off | published doc with 5 wins + 5 issues + 3 priorities for MVP2 |

Acceptance: a real Tanzanian mining owner uses Boji daily for 5 days and submits 5 documents, 5 shift reports, 1 EPP, 1 village-meeting record, sees a Daily Owner Brief every morning, and signs at least 3 documents biometrically.

---

## Definition of Done for MVP 1

A pilot tenant can:

1. **Sign up** (NIDA + biometric enrolment) in < 10 minutes.
2. **Complete onboarding** (7-stage interview) in < 30 minutes; LMBM populated with company, licences, sites, employees, baseline costs.
3. **Upload documents** (PMLs, EPPs, receipts, village minutes) and chat with each.
4. **See a Daily Owner Brief** at 06:00 every day, in Swahili by default.
5. **Receive renewal-pack and dormancy-risk tasks** as licences approach key dates.
6. **Run the EPP wizard** and produce a credible draft + officer booking.
7. **Run a village-meeting capture** with fingerprint sign-off and an auto-generated letter.
8. **Authorise a TZS-conversion addendum** for any USD-denominated domestic contract.
9. **Submit shift reports** from the worker app offline; sync on reconnect.
10. **See sell-vs-stockpile / BoT-vs-export comparisons** for every parcel.
11. **Generate a regulator-ready audit pack** in < 5 minutes.
12. **The Boji team can roll back** any prompt / corpus / model promotion if a regression appears.

**Hard constraints maintained throughout:**
- Every binding action requires owner approval above the AutonomyPolicy ceiling.
- Every recommendation carries provenance.
- Every TZ regulation cited in the spec is in the citation library.
- No domestic USD invoices issued. Period.
- No mercury operational instructions.
- No advice on extraction in Ramsar / Selous-adjacent areas.

---

## Out of scope for MVP 1 (deferred to MVP 2-6)

- HR, Inventory, Asset/Fleet, Maintenance Agents (depth) — MVP 4.
- Production records + Sales / Off-take pipeline — MVP 5.
- Marketplace v2 + External Stakeholder Window — MVP 5–6.
- Multi-company group view, investor / bank packs depth — MVP 6.
- Drone imagery ingestion + Sentinel-2 advanced overlays — MVP 6.
- Geological-confidence model + multi-shaft triangulation depth — MVP 6.
- JV / streaming / off-take simulator depth — MVP 6.

---

## Engineering team shape (recommended)

- 1 tech lead (full-stack, agent-experienced)
- 1 backend engineer (Postgres + PostGIS + pgvector)
- 1 mobile engineer (Expo RN; bilingual UI)
- 1 web engineer (Next.js + Mapbox)
- 1 AI engineer (LangGraph + Claude SDK + prompt engineering)
- 1 design (mobile-first; Swahili UI)
- 1 compliance / regulatory analyst (Tanzania mining law)

Plus founder (vision + pilot-tenant relationships) and an advisor pool (mining geologist, mining engineer, mining lawyer).

— end of MVP1 build plan v0.1 —
