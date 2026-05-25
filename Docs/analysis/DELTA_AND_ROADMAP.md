# DELTA & ROADMAP — Closing Every Gap

**Project:** BORJIE101
**Date:** 2026-04-18 (post wave-5 deep scrub)
**Synthesis of:** `VOICE_MEMO_2026-04-18`, `GAP_voice_vs_docs`, `GAP_docs_vs_code`, `CONFLICT_RESOLUTIONS`, `MISSING_FEATURES_DESIGN`, `SCAFFOLDED_COMPLETION`, `RESEARCH_ANSWERS`, `SECURITY_REVIEW_WAVES_1-3`.

**Non-negotiable rule:** Amplify existing code. Never delete core logic without a replacement. Every item below is additive. Features are gated behind per-org flags during rollout.

---

## Executive summary

After a full pass across 60 voice-memo directives, 50 code features, 14 scaffolded components, 10 open research questions, and 3 "conflicts", the reality is:

- **28 features already BUILT** (AI personas, CPG, approval state machine, M-Pesa/Airtel/Tigo reconciliation, onboarding A0–A6, document intelligence/OCR, triage, immutable ledger, multi-tenant RBAC).
- **3 "conflicts" are not conflicts** — they're orthogonal layers. Voice memo adds on top of existing design without deleting anything.
- **14 SCAFFOLDED features** — mostly promoted to BUILT during waves 2–5 (see [SCAFFOLDED_COMPLETION.md](./SCAFFOLDED_COMPLETION.md)).
- **22 NOT_COVERED or MISSING features** — design + build in progress, tracked below.
- **1 research correction applied:** "Nanobanana" is image generation (wired behind `NANO_BANANA_API_KEY`); document rendering uses a template-first pipeline (`docxtemplater` + Typst + `@react-pdf/renderer`).

### Wave-5 status snapshot (2026-04-18)

- **10 domain endpoints LIVE with real Postgres data** (marketplace listings/enquiries/tenders, waitlist + vacancy outreach, gamification, negotiations, migration runs) — no more scaffolded 503s on those surfaces.
- **40 of 40 migrations apply clean** (`packages/database/src/migrations/0001*`–`0026_performance_indexes.sql`), including `0023_station_master_coverage`, `0024_identity_tables`, `0025_repo_amendments`, `0026_performance_indexes`.
- **All 4 apps build clean** (`admin-portal`, `owner-portal`, `customer-app`, `estate-manager-app`).
- **Toast + Toaster infrastructure shipped** in `@borjie/design-system` (`Toast.tsx`, `useToast.tsx`, `Toast.stories.tsx`) and mounted in every app shell.
- **Auth context shipped to `estate-manager-app`** (`apps/estate-manager-app/src/providers/AuthProvider.tsx` + `AppShell.tsx`); previously missing.
- **React Query provider shipped to `owner-portal`** (`apps/owner-portal/src/main.tsx`); previously missing.
- **124 domain-event subscribers registered** on the api-gateway bus (was 18). See `services/api-gateway/src/workers/event-subscribers.ts`.
- **41 hardcoded values eliminated** — tenant-locale/currency/country moved to `NEXT_PUBLIC_TENANT_CURRENCY` / `NEXT_PUBLIC_TENANT_LOCALE` / `NEXT_PUBLIC_TENANT_COUNTRY`; payment backend moved to `TANZANIA_PAYMENT_BACKEND`; OCR backend to `OCR_PROVIDER`; Typst bin to `TYPST_BIN`; Nano Banana imagery to `NANO_BANANA_API_KEY`.
- **All 5 wave-3 security blockers CLOSED** (see [SECURITY_REVIEW_WAVES_1-3.md](./SECURITY_REVIEW_WAVES_1-3.md)).

Total scope: ~40–55 engineering weeks in 5 sprints, all pure amplification.

---

## The 3 "conflicts" resolved

Details in [CONFLICT_RESOLUTIONS.md](./CONFLICT_RESOLUTIONS.md).

| Conflict | Resolution | Why not actually a conflict |
|---|---|---|
| **Admin L1–L4 hierarchy** | Add `AuthorityLevel` enum (tier 0…70) as a NEW attribute on `UserRoleAssignment`. Keep 8 RBAC roles + 10 AI personas untouched. | RBAC answers "what can I do", authority answers "how senior am I", persona answers "which AI hat". Three orthogonal axes. |
| **Universal tenant app** | New `TenantIdentity` + `OrgMembership` on top of existing `User`. Shadow User rows preserve RBAC/isolation. | Existing `User` stays scoped per platform tenant. `TenantIdentity` federates **login only**, not data. |
| **Elastic geo-hierarchy** | New `GeoNode` tree + per-org `GeoLabelType` depths. Existing `Address` stays. `RegionConfig` is explicitly NOT a location hierarchy. | `GeoLabelType.depth` is ordinal (demo-org uses District→Region; Kenya uses County→Sub-county) — no hardcoded global convention. |

**Sequencing:** AuthorityLevel → GeoNode → Universal app. (Lowest-risk additive type first, largest surface change last.)

---

## The full feature map

### ✅ Already BUILT (28) — protect, don't touch
AI Persona System • Orchestrator + Opus Advisor • Multi-Tenant RBAC (8 roles) • Canonical Property Graph (Neo4j) • Approval Routing State Machine • Tenant Onboarding A0–A6 • Document Intelligence + OCR scaffolding • Maintenance Triage & Work Orders • M-Pesa + Airtel + Tigo Pesa payments • Payment Reconciliation Engine • Immutable Ledger & Audit • Multi-service Reporting (PDF/Excel/CSV/scheduled) • Evidence Pack Builder • Inspection State Machine (move-in) • Procedure Library (TANESCO/LUKU SOPs) • …and more.

These are the load-bearing walls. All new work extends them.

---

### 🟡 SCAFFOLDED → BUILT (14) — finish what's started

Details in [SCAFFOLDED_COMPLETION.md](./SCAFFOLDED_COMPLETION.md).

| # | Feature | Complexity | Key missing piece |
|---|---|---|---|
| 1 | Migration Wizard commit path | M (2-3d) | Dry-run → real DB writes; parsers; runs table |
| 2 | Asset infinite subdivision | S (1d) | `parentUnitId`, closure path, service |
| 3 | Case state machine & SLA | M (2d) | Transition guards; SLA worker; events wired |
| 4 | Lease renewal workflow | M (2-3d) | Renewal columns; scheduler; Anthropic swap |
| 5 | Tenant financial statement intake | S (1d) | New tables + intake service |
| 6 | Credit/risk scoring engine | M (2d) | Deterministic floor + Anthropic narration |
| 7 | Migration Wizard copilot wiring | S (0.5d) | Register tools; copilot file |
| 8 | Notifications domain-event wiring | S-M (1-2d) | Subscribers; pref enforcement; DLQ |
| 9 | Vendor matcher DB-backed + Anthropic | M (2d) | Repository; scoring math; narration |
| 10 | API gateway hardening | M (2-3d) | Shared JWT; error envelope; idempotency; OpenAPI |
| 11 | Design system Storybook + publish | S (1d) | Storybook; docs; regression tests |
| 12 | Approval policy per-org configurability | S (1d) | Persistence + admin UI |
| 13 | OCR provider concrete impls | M (2d) | Textract + Vision; fixture corpus |
| 14 | Churn predictor deterministic baseline | M (2-3d) | Rule scorer; history; NBA integration |

**Total:** ~25 engineering days.

**Cross-cutting pattern:** Every AI service currently uses OpenAI. Migrate to Anthropic with Opus advisor gate. Factor shared client into `packages/ai-copilot/src/providers/anthropic-client.ts`.

---

### 🔴 NEW FEATURES (22) — fresh design + build

Details in [MISSING_FEATURES_DESIGN.md](./MISSING_FEATURES_DESIGN.md).

**Revenue-critical (must-have for demo launch):**
- GePG payment integration (with PSP shortcut per [RESEARCH_ANSWERS.md](./RESEARCH_ANSWERS.md) Q2)
- Arrears ledger + interactive Excel-like verification
- Gamification (3-layer: Tenant Score + early-pay credit + optional MNO cashback per Q3)
- Conditional survey reports with action plans
- FAR assignment → condition-monitoring trigger
- Compliance exports (TZ_TRA WHT/VAT, KE_DPA, KE_KRA)

**Tenant-experience must-haves:**
- Price negotiation engine (policy-sandboxed per Q4)
- Universal tenant identity + app (via CONFLICT 2)
- On-demand letter generation (4 letter types)
- Scan feature (camera → scanner replacement)
- Document-chat + document-group-chat
- Damage-deduction negotiation + evidence bundling
- End-of-tenancy inspection checklists
- Sublease permission workflow

**Marketplace & discovery:**
- Marketplace listings + AI-negotiating tenders
- Waitlist auto-outreach on vacancy
- Station-master-proximity routing
- Elastic geo-hierarchy (via CONFLICT 3)

**Reporting & advisory:**
- Interactive reports with embedded video + action plans
- Tenant risk report (financial + litigation + AI narrative)
- Occupancy timeline visualization
- Template-based document rendering (NOT Nanobanana — see research Q8)

---

## 📋 Research-driven decisions applied

From [RESEARCH_ANSWERS.md](./RESEARCH_ANSWERS.md):

1. **Property taxonomy:** Ship 7 L1 classes (Residential / Commercial / Industrial / Land / Hospitality / Mixed-Use / Special-Purpose) + vernacular L2 labels (Godown, Bareland-*, Hostel-Room) dual-stored alongside IPMS canonical.
2. **GePG:** Direct integration = 3–6mo. Recommend ClickPesa/Azampay/Selcom PSP shortcut for v1; direct GePG as phase-2 margin.
3. **Legal hard-stops:** Rent Restriction Act caps advance rent at 2 months (hard validation). TRA requires 10% WHT + VAT 18% on commercial >TZS 100M.
4. **AI negotiation:** NOT autonomous. Policy-sandboxed guardrails + JSON-validated offers + human approval on boundary exit (EliseAI/Pactum pattern).
5. **Gamification:** Flat rewards + cash-flow alignment (Till model) beat complex streaks/quests. 3-layer module.
6. **IoT monitoring:** Defer to enterprise tier. Use payment cadence, maintenance volume, utility bills, WhatsApp pulse surveys, annual satellite change-detection (Digital Earth Africa) instead.
7. **KPIs:** 13 metrics, 4 tiers. Tier 1: NOI, Occupancy, Economic Occupancy, Collection Rate, Time-to-Lease, Maintenance Response.
8. **Reports:** 25 out-of-the-box, with TZ_TRA WHT + VAT + provisional-tax + Return-of-Income as competitive moats.
9. **"Nanobanana" correction:** Image generation, not documents. Use `docxtemplater` / Typst + `@react-pdf/renderer` for docs; reserve Nano Banana for marketing imagery only.

---

## 🗓️ Phased delivery roadmap

### Wave 0 — Foundation (week 1-2)
**Goal:** Unblock everything else.

- [CONFLICT 1] AuthorityLevel (Wave 1 of conflict resolutions)
- [SCAFFOLDED 8] Notifications domain-event wiring
- [SCAFFOLDED 10] API gateway hardening (JWT parity, error envelope, idempotency, OpenAPI)
- [SCAFFOLDED 12] Approval policy per-org configurability
- Shared Anthropic client (`packages/ai-copilot/src/providers/anthropic-client.ts`)

### Wave 1 — Revenue unblockers (week 3-4)
**Goal:** Fix the research client's biggest pain points.

- [NEW 3] GePG payment integration (PSP-first)
- [NEW 4] Arrears ledger + interactive Excel-like UI
- [SCAFFOLDED 5] Tenant financial statement intake
- [SCAFFOLDED 6] Credit/risk scoring (deterministic + Anthropic narration)
- [SCAFFOLDED 3] Case state machine & SLA

### Wave 2 — Geography + Structure (week 5-7)
**Goal:** Handle the research client's unique organizational shape.

- [CONFLICT 3] GeoNode elastic hierarchy
- [NEW 18] Station-master-proximity routing
- [SCAFFOLDED 2] Asset infinite subdivision
- [NEW 6] Parcel genealogy tracking
- [NEW 16] FAR assignment → condition-monitoring trigger

### Wave 3 — Tenant Experience (week 8-10)
**Goal:** Turn the tenant app from tool to companion.

- [CONFLICT 2] Universal tenant identity + app
- [NEW 10] On-demand letter generation
- [NEW 14] Scan feature
- [NEW 21] SMS/WhatsApp preference engine (if not done in Wave 0)
- [NEW 9] Gamification (3-layer)
- [SCAFFOLDED 4] Lease renewal workflow
- [NEW 19] End-of-tenancy inspection checklists

### Wave 4 — Marketplace & Negotiation (week 11-13)
**Goal:** Elevate the platform to state-of-the-art commerce.

- [NEW 1] Price negotiation engine (policy-sandboxed)
- [NEW 11] Marketplace + tenders (AI-negotiating)
- [NEW 12] Waitlist auto-outreach
- [NEW 13] Tenant risk report (financial + litigation + AI narrative)
- [NEW 7] Sublease permission workflow
- [SCAFFOLDED 9] Vendor matcher (DB-backed + Anthropic)

### Wave 5 — Intelligence & Compliance (week 14-16)
**Goal:** Close the loop on reporting, compliance, advisor experience.

- [NEW 2] Conditional survey reports with action plans
- [NEW 17] Interactive reports with embedded video
- [NEW 15] Document-chat + document-group-chat
- [NEW 5] Template-based document rendering (+ Nano Banana imagery)
- [NEW 8] Damage-deduction negotiation + evidence bundling
- [NEW 20] Compliance report export (TZ_TRA / KE_DPA / KE_KRA)
- [NEW 22] Occupancy timeline visualization
- [SCAFFOLDED 14] Churn predictor deterministic baseline + NBA integration
- [SCAFFOLDED 11] Design system Storybook + publish
- [SCAFFOLDED 7] Migration Wizard copilot wiring

---

## 🔒 Cross-feature invariants (apply to every item above)

1. **Nothing mutates the ledger.** Arrears, gamification, damage deductions all post new adjustment entries referencing original via `relatedEntryId`.
2. **Every AI action emits a `PROPOSED_ACTION` or `HANDOFF_TO`** per `packages/ai-copilot/src/orchestrator/orchestrator.ts`.
3. **Opus advisor gate** preserved for irreversible/high-value actions (`packages/ai-copilot/src/providers/advisor.ts`).
4. **Tenant isolation via `tenantId`** on every new table; RLS tests mirror `packages/authz-policy/src/engine/tenant-isolation.test.ts`.
5. **Graph-sync updated** when new relationships affect queryable agent toolkit.
6. **Approvals flow via ApprovalService**, never ad-hoc.
7. **Notifications flow via preference engine**, never direct provider calls.
8. **Nothing deletes data** — statuses transition; archival is a status.
9. **Deterministic floor before LLM** for any scoring/negotiation — LLM narrates, doesn't decide.
10. **Every AI migration from OpenAI to Anthropic preserves existing `*ResultSchema`** — only transport changes.

---

## 📊 What this closes (questionnaire → code)

Every customer-discovery questionnaire answer is now addressed by a concrete design:

| Research-client question | Addressed by |
|---|---|
| Org structure / EMU / Director General approval | CONFLICT 1 (AuthorityLevel) + SCAFFOLDED 12 (per-org policies) |
| Application → HQ delay | NEW 18 (station-master routing) + SCAFFOLDED 3 (SLA) |
| District vs Region inversion | CONFLICT 3 (elastic geo-hierarchy) |
| Property classification gaps | RESEARCH Q1 taxonomy + SCAFFOLDED 2 (subdivision) |
| Condition survey once/year | NEW 2 + NEW 16 (FAR triggers → automated surveys) |
| Airbnb-for-demo-org showcase | NEW 11 (marketplace) + CONFLICT 2 (universal app) |
| Double-leasing / conflicts | BUILT Approval routing + NEW 6 (genealogy) |
| GePG-only payments, 2 debt figures | NEW 3 (GePG) + NEW 4 (arrears ledger) |
| Manual arrears / Excel pain | NEW 4 (Excel-like interactive) |
| Payment flexibility, no methodology | SCAFFOLDED 6 (credit engine) + NEW 9 (gamification) |
| Revenue/debt/customer-status reports | BUILT reports + NEW 17 (interactive) |
| Maintenance: customer pays, deducted from rent | NEW 8 (damage-deduction + adjustment entries) |
| Fixed Asset Register annually | NEW 16 (FAR trigger) + NEW 2 (conditional survey) |
| Registry office document retrieval pain | NEW 14 (scan) + NEW 15 (doc-chat) |
| Document verification | SCAFFOLDED 13 (OCR providers) |
| Renewal letters | SCAFFOLDED 4 + NEW 10 (letters) |
| Dispute evidence extraction | NEW 8 (damage) + BUILT Evidence Pack Builder |
| Rent payment disputes | SCAFFOLDED 3 (cases) + NEW 9 (gamification prevention) |
| Sublease issues | NEW 7 (sublease workflow) |
| Notices & deadlines | SCAFFOLDED 8 (notifications preferences) |
| Confirmation letters on demand | NEW 10 |
| Extensions / payment flexibility | SCAFFOLDED 6 + NEW 9 |
| Senior leader reports | BUILT + NEW 17 |
| Maintenance scattered data | NEW 16 + NEW 2 |
| LPMS integration / manual work | SCAFFOLDED 1 (migration wizard) |
| Areas calculation errors | NEW 4 (canonical ledger + audit) |
| Improved system → restored revenue | Entire roadmap |

**Result:** 100% of questionnaire directives mapped to concrete design.

---

## ⚠️ Known open decisions for founder

1. **GePG strategy:** PSP shortcut (v1, 2 weeks) vs direct integration (v1, 3–6 months)?
2. **Nanobanana replacement:** confirm template-first pipeline (docxtemplater + Typst + React-PDF) is acceptable?
3. **IoT deferral:** accept "software-only signals" for v1, defer hardware to enterprise tier?
4. **Universal tenant app blast radius:** accept shadow-User pattern (preserves RBAC) vs full refactor?
5. **Super Admin cap:** start with default 2 per org, or org-configurable from day 1?
6. **Property taxonomy:** adopt recommended 7-class + vernacular dual-store?
7. **Legal hard-stops:** enforce 2-month advance rent cap as validation, or advisory only?
8. **Gamification launch:** all three layers at once, or start with early-pay credit only?

---

## Final state

- **0 features lost.**
- **28 BUILT preserved.**
- **14 SCAFFOLDED with concrete completion paths.**
- **22 NEW features with implementation-ready specs.**
- **3 "conflicts" resolved as additive amplifications.**
- **10 research questions answered; 1 voice-memo correction applied.**
- **100% questionnaire coverage.**

See sibling docs for the full specs.

---

## Security blockers closed (wave-3 review follow-up)

All five production blockers flagged in [SECURITY_REVIEW_WAVES_1-3.md](./SECURITY_REVIEW_WAVES_1-3.md) are now fixed on `main`:

| ID | Summary | Fix location |
|----|---------|--------------|
| **C-1** | API-key auth granted SUPER_ADMIN with attacker-controlled `X-Tenant-ID`. | `services/api-gateway/src/middleware/api-key-registry.ts` — SHA-256 registry with per-key `{tenantId, role, scopes}`; `assertApiKeyConfig()` refuses to boot production without `API_KEY_REGISTRY` or legacy `API_KEYS`. |
| **C-2** | GePG direct-mode signature verification returned a stub. | `services/payments/src/providers/gepg/gepg-signature.ts` wired to `gepg-rsa-signature.ts`; startup asserts `GEPG_PSP_MODE=true` or `GEPG_SIGNING_KEY_PEM + GEPG_SIGNING_CERT_PEM`. |
| **H-1** | Cross-tenant spoofing via `X-Tenant-ID` / `?tenantId=` fallback. | `services/api-gateway/src/middleware/auth.middleware.ts` — `extractTenantId` now hard-requires the JWT claim. |
| **H-2** | `ensureTenantIsolation` middleware was defined but never applied. | `services/api-gateway/src/index.ts:199` — `api.use('*', ensureTenantIsolation)` mounted globally on `/api/v1/*`. |
| **H-5** | Webhook secrets silently absent. | `services/api-gateway/src/routes/notification-webhooks.router.ts` + boot assertions in production. |

---

## Production Readiness Matrix (per-feature status)

Canonical source-of-truth for what's wired end-to-end vs. what still degrades to 503. Updated 2026-04-18.

Legend: **LIVE** = real Postgres reads/writes through the composition root; **STUB** = route exists but degrades to 503/501 without external config; **DB_ONLY** = persistence landed, integration (webhook / external API) pending; **PLANNED** = not wired.

### Core platform

| Feature | Status | Evidence |
|---------|--------|----------|
| API-gateway auth + RBAC + tenant isolation | LIVE | `middleware/{auth,tenant-context,api-key-registry}.middleware.ts`, `ensureTenantIsolation` mounted globally |
| Composition root (service registry) | LIVE | `composition/service-registry.ts` — degraded skeleton when `DATABASE_URL` unset |
| Outbox drainer + domain event subscribers (124) | LIVE | `workers/outbox-worker.ts`, `workers/event-subscribers.ts` |
| Migrations runner | LIVE | `packages/database/src/run-migrations.ts` — 40/40 apply clean |
| Seed runner (demo-org fixture) | LIVE | `packages/database/src/seeds/{run-seed,demo-org-seed}.ts` |
| Health endpoints (`/health`, `/healthz`) | LIVE | `services/api-gateway/src/index.ts:144-162` |

### Domain services (wave 1-5)

| Feature | Status | Composition wiring | Router |
|---------|--------|--------------------|--------|
| Marketplace listings | LIVE | `ListingService` + `PostgresMarketplaceListingRepository` | `routes/marketplace.router.ts` |
| Marketplace enquiries | LIVE | `EnquiryService` (shares `NegotiationService`) | `routes/marketplace.router.ts` |
| Tenders + bids | LIVE | `TenderService` + `PostgresTenderRepository` + `PostgresBidRepository` | `routes/tenders.router.ts` |
| Negotiations | LIVE | `NegotiationService` + 3 postgres repos | `routes/negotiations.router.ts` |
| Waitlist (+ vacancy outreach) | LIVE | `WaitlistService` + `WaitlistVacancyHandler` (noop dispatcher pending NBA queue) | `routes/waitlist.router.ts` |
| Gamification | LIVE | `createGamificationService` + `PostgresGamificationRepository` | `routes/gamification.router.ts` |
| Migration wizard | LIVE | `MigrationService` + `PostgresMigrationRepository` | `routes/migration.router.ts` |
| Arrears ledger | LIVE | migration `0018_arrears_ledger.sql` + postgres repo | `routes/arrears.router.ts` |
| Approval policies | LIVE | migration `0018_approval_policies.sql` | handled in `domain-services` |
| Conditional surveys | DB_ONLY | migration `0018_conditional_surveys.sql` | pending router wiring |
| Tenant finance intake | DB_ONLY | migration `0018_tenant_finance.sql` | `routes/financial-profile.router.ts` |
| FAR asset components | DB_ONLY | migration `0019_far_asset_components.sql` | pending inspection-trigger |
| Intelligence history | DB_ONLY | migration `0019_intelligence_history.sql` | consumed by risk reports |
| Risk reports | LIVE | `routes/risk-reports.router.ts` + `0020_tenant_risk_reports.sql` | live |
| Compliance exports | LIVE | `routes/compliance.router.ts` + `0021_compliance_exports.sql` | live |
| Interactive reports | DB_ONLY | `0022_interactive_reports.sql` | `routes/interactive-reports.router.ts` stub |
| Geo hierarchy | DB_ONLY | `0023_geo_hierarchy.sql` | consumed by routing |
| Station-master coverage | STUB | `StationMasterRouter` type only — repo pending | `routes/station-master-coverage.router.ts` (503 until repo lands) |
| Occupancy timeline | STUB | `OccupancyTimelineService` type only — repo pending | `routes/occupancy-timeline.router.ts` (503 until repo lands) |
| Letters (on-demand) | LIVE | `routes/letters.router.ts` + `domain-services/documents/letters` | live |
| Doc-chat | LIVE | `routes/doc-chat.router.ts` + pgvector | live |
| Document render (Typst/docx/react-pdf) | LIVE | `routes/document-render.router.ts` — `TYPST_BIN` optional, falls back to zero-dep encoder |
| Scans (mobile camera ingest) | LIVE | `routes/scans.router.ts` |
| Renewals | LIVE | `routes/renewals.router.ts` + `0017_lease_renewal_extensions.sql` |
| Applications (A0–A6) | LIVE | `routes/applications.router.ts` |
| Notification preferences | STUB | `routes/notification-preferences.router.ts` — echoes posted shape until notifications service HTTP binding lands |
| Notification webhooks (AT / Twilio / Meta) | LIVE | `routes/notification-webhooks.router.ts` — signature verified, secrets asserted at boot |

### Payments + ledger

| Feature | Status | Notes |
|---------|--------|-------|
| M-Pesa Daraja | LIVE | `services/payments` — production-hardened |
| Airtel + Tigo | LIVE | reconciliation tested |
| GePG via PSP (ClickPesa default) | LIVE | `TANZANIA_PAYMENT_BACKEND=clickpesa` (default); `azampay` / `selcom` available |
| GePG direct | DB_ONLY | `TANZANIA_PAYMENT_BACKEND=gepg-direct` + RSA keys; fails closed without signing material |
| Immutable ledger | LIVE | `services/payments-ledger` + RS256-signed JWT |
| Arrears adjustments (never-mutate) | LIVE | new `adjustment` entries reference `relatedEntryId` |

### External integrations

| Integration | Status | Env gate |
|-------------|--------|----------|
| Anthropic (Brain) | LIVE | `ANTHROPIC_API_KEY` |
| OpenAI (embeddings) | LIVE | `OPENAI_API_KEY` |
| OCR — Textract / Vision / Mock | LIVE | `OCR_PROVIDER` ∈ `textract|google|mock` |
| Nano Banana imagery | DEGRADED | `NANO_BANANA_API_KEY` unset → placeholder image with `reason: 'NANO_BANANA_API_KEY unset'` |
| Typst PDF | LIVE | `TYPST_BIN` optional — falls back to zero-dep PDF encoder |
| Africa's Talking / Twilio / Meta webhooks | LIVE | per-provider secrets asserted at boot |
| Neo4j graph | LIVE | optional; falls back to demo mode when unset |

---
