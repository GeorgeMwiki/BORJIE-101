# MISSING_FEATURES_DESIGN.md

**Project:** BORJIE101
**Date:** 2026-04-18
**Phase:** 2 (implementation-ready specs)
**Source gap docs:** `Docs/analysis/GAP_voice_vs_docs.md`, `Docs/analysis/GAP_docs_vs_code.md`

> **Rule applied to every spec:** Amplify existing code. Every feature cites concrete files to extend. No existing core logic is deleted without replacement.
>
> **DEFERRED to `CONFLICT_RESOLUTIONS.md`:** (1) Tenant app universal + multi-org identity, (2) Elastic geo-hierarchy / geofencing.

---

## Table of Contents

**Voice-memo directives (NOT_COVERED)**

1. AI Price-Negotiation Engine
2. Conditional Survey Report Generation with Action Plans
3. GePG Payment Integration + Tanzanian Compliance
4. Arrears Ledger + Interactive Verification (Excel-like editing)
5. Nanobanana Document Generation Integration
6. Asset Subdivision + Parcel Genealogy Tracking
7. Sublease Permission Workflow
8. Damage-Deduction Negotiation + Evidence Bundling
9. Carrot-and-Stick Rent Gamification
10. On-Demand Letter Generation (residency/tenancy/payment/reference)
11. Marketplace + Tenders (AI-negotiating)
12. Waitlist Auto-Outreach on Vacancy
13. Tenant Profile: Financial Statement + Litigation History + AI Risk Report
14. Scan Feature (phone camera → scanner replacement, bundles)
15. Document-Chat + Document-Group-Chat (Harvard-level estate manager AI)
16. Condition-Monitoring Trigger (FAR assignment → auto-notify)
17. Interactive Reports with Embedded Video + Action Plans
18. Station-Master-Proximity Routing for Applications

**Code gaps (MISSING from GAP_docs_vs_code.md)**

- D. End-of-Tenancy Inspection Checklists (#19)
- F. Compliance Report Export (DPA/KRA) (#20)
- G. SMS/WhatsApp Preference Engine (#21)
- H. Occupancy Timeline Visualization (#22)

---

## 1. AI Price-Negotiation Engine

**Source:** GAP_voice_vs_docs §4 (line 229–232); Cross-Cutting #6 (line 652).
**Why it matters:** Owners want AI that describes units and negotiates within owner-defined ranges. Today every price conversation is manual, slow, leaves money on the table.

**Existing code to amplify:**
- `packages/ai-copilot/src/personas/personas.catalog.ts` — add `PRICE_NEGOTIATOR` persona.
- `packages/ai-copilot/src/services/renewal-optimizer.ts` and `renewal-strategy-generator.ts` — reuse recommendation scaffolding.
- `packages/ai-copilot/src/skills/domain/leasing.ts` — add `NEGOTIATION_OPEN`, `NEGOTIATION_COUNTER`, `NEGOTIATION_CLOSE`.
- `packages/ai-copilot/src/orchestrator/orchestrator.ts` — hook negotiation intent.
- `packages/database/src/schemas/lease.schema.ts` — pricing reference.

**Data model:**
```ts
// packages/database/src/schemas/negotiation.schema.ts (NEW)
negotiationPolicies = {
  id, tenantId, unitId | propertyId,
  listPrice: decimal, floorPrice: decimal,
  maxDiscountPct: decimal,
  acceptableConcessions: jsonb<Concession[]>,
  approvalRequiredBelow: decimal,
  toneGuide: text,                 // firm | warm | flexible
  expiresAt: timestamp,
}

negotiations = {
  id, tenantId, unitId, prospectCustomerId,
  status: 'open'|'counter_sent'|'accepted'|'rejected'|'expired'|'escalated',
  policyId, currentOffer: decimal, roundCount: int,
  aiPersona: 'PRICE_NEGOTIATOR',
  createdAt, lastActivityAt, closedAt,
}

negotiationTurns = {
  id, negotiationId,
  actor: 'prospect'|'ai'|'owner'|'agent',
  offer: decimal | null,
  concessionsProposed: jsonb,
  rationale: text,
  createdAt,
}
```

**API surface:**
- `POST /v1/negotiation-policies`
- `POST /v1/negotiations` — opening message + offer
- `POST /v1/negotiations/:id/turns` — prospect reply → AI counter
- `POST /v1/negotiations/:id/accept` — emits `NegotiationAcceptedEvent` to lease draft flow
- `GET /v1/negotiations/:id/audit`

**AI integration:**
- Persona: **Price Negotiator Junior** (new). System prompt: professional leasing broker. Tools: `GET_UNIT_HEALTH`, `GET_MARKET_COMPARABLES`, `NEGOTIATION_COUNTER`, `GET_PORTFOLIO_OVERVIEW`.
- Opus advisor gate when offer < `approvalRequiredBelow`.
- Emits `PROPOSED_ACTION(offer_send)`; human toggle `negotiationPolicies.autoSendCounters`.

**UI surface:**
- **customer-app** `src/app/marketplace/[unitId]/negotiate/` — chat-style UI.
- **owner-portal** new `app/negotiations/` — live list, override/accept/escalate, floor-vs-offer diff.
- **estate-manager-app** `src/app/leases/` — Negotiations tab.

**Acceptance criteria:**
- Owner sets floor/ceiling per unit; history append-only.
- AI never counters below `floorPrice` (100-prompt adversarial test).
- Acceptance creates draft lease with agreed price.
- Every turn captured with timestamps.
- Opus advisor consulted on offers < `approvalRequiredBelow`.

**Dependencies:** Marketplace listings (#11), Messaging preferences (#21).

---

## 2. Conditional Survey Report Generation with Action Plans

**Source:** GAP_voice_vs_docs §7, §13, §15 (lines 560–564, 608).
**Why it matters:** Founder's single hardest report. Evidence scattered across photos, tenant feedback, inspection notes.

**Existing code to amplify:**
- `services/domain-services/src/inspections/inspection-service.ts` (662 lines) — structured findings exist.
- `services/domain-services/src/inspections/checklist-templates.ts`, `room-template.ts` — add `CONDITIONAL_SURVEY_TEMPLATE`.
- `services/reports/src/report-generation-service.ts` + `generators/` — new `conditional-survey` generator.
- `packages/ai-copilot/src/copilots/maintenance-triage.copilot.ts` — evidence classification logic.

**Data model:**
```ts
conditionalSurveys = {
  id, tenantId, propertyId, unitId | null,
  scheduledFor, completedAt,
  surveyorId, triggerSource: 'scheduled'|'far_assignment'|'tenant_request'|'ai_recommended',
  priorSurveyId: text | null,
  aggregateConditionScore: decimal,        // 0-100
  status: 'planned'|'in_progress'|'compiled'|'published',
}

conditionalSurveyFindings = {
  id, surveyId, component: text,
  severity: 'minor'|'moderate'|'major'|'critical',
  evidenceIds: jsonb<string[]>,
  recommendedAction: text,                 // AI-drafted
  estimatedCost: decimal, slaDays: integer,
  comparisonToPrior: 'new'|'improved'|'stable'|'deteriorated',
}

conditionalSurveyActionPlans = {
  id, surveyId, findingId,
  priority: int, assignedTo, dueDate,
  approvalRequestId: text | null,          // ties into ApprovalService
  status: 'proposed'|'approved'|'in_flight'|'done'|'rejected',
}
```

**API surface:**
- `POST /v1/conditional-surveys` — schedule or trigger
- `POST /v1/conditional-surveys/:id/findings` — surveyor attaches evidence
- `POST /v1/conditional-surveys/:id/compile` — AI assembles, diffs prior, generates action plans
- `GET /v1/conditional-surveys/:id/report?format=pdf|interactive`
- `POST /v1/conditional-surveys/:id/action-plans/:pid/approve` — via ApprovalService

**AI integration:**
- **Estate Manager Brain** orchestrates; delegates **Maintenance Junior** (cost) and **Communications Junior** (narrative).
- Tools: `GET_PROPERTY_HISTORY`, `COMPARE_PRIOR_SURVEY`, `ESTIMATE_REPAIR_COST`, `DRAFT_ACTION_PLAN`.
- Prompt: "You are a Harvard-trained estate manager. Given findings, prior survey, tenant feedback, produce (1) narrative, (2) prioritized action plan with cost bands, (3) risk flags."
- Opus advisor gate on any `critical` severity.

**UI surface:**
- **estate-manager-app** `src/app/inspections/` new `conditional-surveys/` sub-route.
- **owner-portal** new `app/reports/conditional-surveys/` — read-only browse, approvals queue, diff vs prior.
- **customer-app** — read-only per-unit: tenants see findings affecting their unit.

**Acceptance criteria:**
- Compilation pulls evidence from work orders, inspections, tenant messages, document OCR.
- Prior-vs-current flags `deteriorated` automatically.
- Every action plan flows through `ApprovalService`.
- Report exports PDF + interactive HTML (#17).
- FAR trigger (#16) auto-creates survey.

**Dependencies:** #16 FAR trigger, #17 interactive reports, approval service (BUILT).

---

## 3. GePG Payment Integration + Tanzanian Compliance

**Source:** GAP_voice_vs_docs §6 (line 288–290), Open Research #2; GAP_docs_vs_code MISSING #4.
**Why it matters:** Tanzania requires GePG control-number payments for government-linked rentals. Manual reconciliation leaks revenue.

**Existing code to amplify:**
- `services/payments/src/providers/mpesa/` — template for new `gepg/` provider (same callback/query pattern).
- `services/payments/src/reconciliation/reconciler.ts` (117 lines) — recognize GePG control numbers as match key.
- `services/payments/src/reconciliation/matcher.ts` — matcher for `controlNumber ↔ invoiceRef`.
- `packages/database/src/schemas/payment.schema.ts` — add `gepg_control_number`, `gepg_bill_reference` columns.

**Data model:**
```ts
gepgControlNumbers = {
  id, tenantId, invoiceId, controlNumber: text unique,
  spCode: text,                       // service provider code
  billReference: text,
  amount: decimal, currency: 'TZS',
  expiresAt, issuedAt, paidAt | null,
  gepgResponseRaw: jsonb,
  status: 'issued'|'paid'|'expired'|'cancelled',
}

gepgReconciliationEvents = {
  id, controlNumberId,
  eventType: 'control_issued'|'payment_received'|'reconciled'|'mismatch',
  payload: jsonb, createdAt,
}
```

**API surface:**
- `POST /v1/payments/gepg/control-numbers` — internal, called by invoice service
- `POST /v1/payments/gepg/callback` — GePG webhook with signature validation
- `GET /v1/payments/gepg/control-numbers/:id` — status

**AI integration:**
- **Finance Junior** skill `GEPG_REPAY_REQUEST` — re-issue expired control numbers, explain compliance.
- No LLM in critical payment path — deterministic only (follows M-Pesa provider pattern).

**UI surface:**
- **customer-app** `src/app/payments/` — "Pay via GePG" option; shows control number, expiry, QR.
- **estate-manager-app** `src/app/payments/` — reconciliation dashboard GePG buckets.
- **admin-portal** — GePG credentials config (SP code, signing key rotation).

**Acceptance criteria:**
- Control numbers unique per invoice, configurable expiry (default 30 days).
- Callback signature validation (fake-cert unit tests).
- Auto-match payments within 1 minor unit tolerance.
- Compliance field mapping: Land Act + Rent Restriction Act metadata.
- Staging E2E: issue → callback → ledger entry → invoice paid.

**Dependencies:** External: GePG sandbox credentials. Research note: recommend **ClickPesa/Azampay/Selcom PSP shortcut** for v1 (3-6mo direct GePG onboarding).

---

## 4. Arrears Ledger + Interactive Verification (Excel-like)

**Source:** GAP_voice_vs_docs §6 (line 297–300), §14 (line 589–592).
**Why it matters:** Founder calls arrears discrepancies the "biggest operational stressor." No interactive reconciliation UI for migration data drift.

**Existing code to amplify:**
- `packages/database/src/schemas/ledger.schema.ts` — immutable, **DO NOT delete**; add `adjustment`-type entry pattern.
- `services/payments-ledger/src/` — extend with `ArrearsProjectionService`.
- `packages/domain-models/src/financial/arrears-case.ts` — already exists; expand.
- `services/payments/src/reconciliation/reconciler.ts` — feed classified mismatches into arrears cases.
- `packages/ai-copilot/src/skills/domain/finance.ts` — add `ARREARS_EXPLAIN`, `ARREARS_RECONCILE_PROPOSE`.

**Data model:**
```ts
arrearsCases = {
  id, tenantId, customerId, leaseId,
  asOfDate,
  projectedBalance: decimal,              // from ledger replay
  verifiedBalance: decimal | null,        // after human reconciliation
  status: 'open'|'disputed'|'verified'|'closed',
  source: 'auto_projection'|'migration_import'|'tenant_disputed',
  aiExplanation: text,
}

arrearsLineProposals = {
  id, caseId, proposedEntry: jsonb<LedgerEntryDraft>,
  proposedBy: userId, rationale: text,
  reviewStatus: 'pending'|'approved'|'rejected',
  approvedLedgerEntryId: text | null,
}
```

**KEY RULE:** Arrears cases NEVER mutate `ledgerEntries`. Approval creates a new `adjustment`-type entry netting the difference. Immutable ledger preserved.

**API surface:**
- `GET /v1/arrears/:customerId/projection?asOf=YYYY-MM-DD`
- `POST /v1/arrears/cases`
- `POST /v1/arrears/cases/:id/propose` — agent edits cell in UI → proposal row
- `POST /v1/arrears/cases/:id/propose/:pid/approve` — via ApprovalService → commits adjustment
- `GET /v1/arrears/cases/:id/audit`

**AI integration:**
- **Finance Junior**: `GET /projection` returns narrative ("Balance grew by TZS 500k because Sept payment partially applied to Aug rent…").
- Skill `ARREARS_EXPLAIN` — ledger entries → narrative.
- Skill `ARREARS_RECONCILE_PROPOSE` — mismatch → draft adjustment for human review.

**UI surface:**
- **estate-manager-app** new `src/app/payments/arrears/` — Excel-like grid (TanStack Table/AG Grid), month-by-month ledger; editable cells create proposals NOT direct writes.
- Cell edit → diff → approve → commits adjustment entry.
- Color coding: verified green, disputed red, auto-projection grey.

**Acceptance criteria:**
- Original ledger immutable; adjustments reference original via `relatedEntryId`.
- UI prevents direct commits; only proposals.
- Audit: who/when/why/approval chain per cell edit.
- Tenant-facing view shows adjustments with rationale.
- Bulk migration import opens batch arrears case per customer.

**Dependencies:** ApprovalService (BUILT), Migration Wizard (SCAFFOLDED).

---

## 5. Nanobanana Document Generation Integration

**Source:** GAP_voice_vs_docs §5 (line 268–271), Open Research #8.
**Why it matters:** Founder mandates Nanobanana for state-of-the-art documents (announcements, tenancy packs, visual summaries).

> **⚠️ RESEARCH CORRECTION (from `RESEARCH_ANSWERS.md` Q8):** "Nanobanana" is Google's Gemini image-generation brand (Nano Banana / Nano Banana 2 / Nano Banana Pro). **NOT a document generator.** Using for contracts is wrong architecture.
>
> **Revised recommendation:** Template-first pipeline (`docxtemplater` / Typst + `@react-pdf/renderer`) with LLM-drafted clauses. Reserve Nano Banana for marketing imagery only.

**Revised spec — Template-based document generation (+ Nano Banana for imagery):**

**Existing code to amplify:**
- `services/domain-services/src/documents/document-service.ts` — already orchestrates templates; add renderer adapter interface.
- `services/domain-services/src/documents/templates/` — existing `lease-agreement`, `move-in-out-checklist`, `rent-receipt`; add docxtemplater variants.
- `services/reports/src/generators/` — PDF generator adds React-PDF renderer + Typst option.
- `packages/ai-copilot/src/skills/domain/comms.ts` — add `DRAFT_VISUAL_ANNOUNCEMENT` (text + Nano Banana cover image).

**Data model:**
```ts
documentRenderJobs = {
  id, tenantId, templateKey,
  rendererKind: 'docxtemplater'|'typst'|'react_pdf'|'nano_banana_image',
  inputPayload: jsonb, outputDocumentId: text | null,
  status: 'queued'|'rendering'|'complete'|'failed',
  providerJobId: text | null,
  errorMessage: text | null,
}
```

**API surface:**
- `POST /v1/documents/render` — `{ templateKey, inputs, renderer }`. Async; returns jobId.
- `GET /v1/documents/render/:jobId` — poll status.
- `POST /v1/webhooks/nanobanana` (imagery only) — under `services/webhooks/`.

**AI integration:**
- Orchestrator routes "create announcement" / "generate tenancy pack" → Communications Junior → `PROPOSED_ACTION(render_document)`.
- AI authors content; template renderer assembles; Nano Banana only generates cover imagery.
- Fallback to plain-text if any renderer unavailable (circuit breaker in `packages/enterprise-hardening/`).

**UI surface:**
- **estate-manager-app** `src/app/announcements/` — "Compose visual announcement".
- **owner-portal** — dashboard widget for recent generated packs.
- **admin-portal** — Template upload + brand-asset management (logo, palette).

**Acceptance criteria:**
- Renderer adapter isolated behind `IDocumentRenderer` — system works without any specific provider.
- Brand assets per-tenant, stored once, reused.
- Jobs produce immutable artifacts via existing document storage.
- Retry with exponential backoff, 3 attempts, then manual override.
- All rendered documents trigger same audit log.

**Dependencies:** Document service (BUILT); webhooks service (BUILT).

---

## 6. Asset Subdivision + Parcel Genealogy

**Source:** GAP_voice_vs_docs §2, §3, Cross-Cutting #9 (lines 156–159, 667–670).
**Why it matters:** Land/buildings get legally subdivided. Today `units.parentUnitId` exists but no workflow, lineage, or legal-event audit.

**Existing code to amplify:**
- `packages/database/src/schemas/property.schema.ts` — `units.parentUnitId` exists; add subdivision event + closure table.
- `packages/domain-models/src/operations/asset.ts` — extend with subdivision domain operations.
- `packages/domain-models/src/property/{unit,block,property}.ts` — amplify lineage types.
- `packages/graph-sync/src/schema/node-labels.ts` — add relationship `SUBDIVIDED_INTO`.

**Data model:**
```ts
subdivisionEvents = {
  id, tenantId, parentUnitId, performedBy, performedAt,
  legalReference: text,                 // gazette ref, title deed number
  reason: 'legal_subdivision'|'operational_split'|'merger'|'correction',
  surveyDocumentId: text | null,
  approvedBy: userId,
}

unitLineage = {                         // closure table
  ancestorUnitId, descendantUnitId, depth: int,
  subdivisionEventId: text,
}

// Extend units with
units.depth: int
units.subdivisionStatus: 'active'|'merged_into_parent'|'archived'
```

**API surface:**
- `POST /v1/units/:id/subdivide` — atomic: creates children, inserts lineage, emits event.
- `POST /v1/units/:id/merge` — inverse; never deletes records.
- `GET /v1/units/:id/lineage?direction=ancestors|descendants`
- `GET /v1/units/:id/subdivision-history`

**AI integration:**
- **Surveyor Coworker** (new variant of existing `COWORKER_TEMPLATE`) — map-centric prompt, tools `PROPOSE_SUBDIVISION`, `ATTACH_SURVEY_DOC`.
- **Compliance Junior** gates legal subdivision (requires `legalReference`).

**UI surface:**
- **estate-manager-app** `src/app/units/[id]/` — "Subdivide" action; visual tree view.
- **owner-portal** — approval queue.
- **customer-app** — tenants on affected units notified; lease-unit refs auto-migrate.

**Acceptance criteria:**
- Subdivision preserves all historical leases, payments, cases linked to parent.
- Depth limit configurable per tenant (default 5).
- Closure table O(1) ancestor lookups (reports, graph-sync).
- Merger never deletes — sets status + merge event.
- Neo4j reflects lineage via `SUBDIVIDED_INTO` edges.

**Dependencies:** None critical. Synergy with #16 FAR assignment.

---

## 7. Sublease Permission Workflow

**Source:** GAP_voice_vs_docs §10 (line 488–491).
**Why it matters:** Unauthorized subleasing = top dispute trigger. First-class request→approve→sub-tenant-group flow.

**Existing code to amplify:**
- `services/domain-services/src/approvals/approval-service.ts` — add `sublease_request` approval type.
- `packages/database/src/schemas/lease.schema.ts` — add `subleaseAllowed`, `subleaseOf` columns.
- `services/domain-services/src/cases/index.ts` — sublease violations become cases.
- `packages/ai-copilot/src/skills/domain/leasing.ts` — add `SUBLEASE_APPROVE_DRAFT`.

**Data model:**
```ts
subleaseRequests = {
  id, tenantId, parentLeaseId, requestedBy: customerId,
  subtenantCandidateId: customerId,
  reason: text, startDate, endDate,
  rentResponsibility: 'primary_tenant'|'subtenant'|'split',
  splitPercent: jsonb | null,
  status: 'pending'|'approved'|'rejected'|'revoked',
  approvalRequestId: text,
}

tenantGroups = {
  id, tenantId, primaryLeaseId,
  members: jsonb<{customerId, role:'primary'|'subtenant'|'co_tenant'}[]>,
  effectiveFrom, effectiveTo,
}
```

**API surface:**
- `POST /v1/leases/:id/sublease-requests`
- `GET /v1/leases/:id/sublease-requests`
- `POST /v1/sublease-requests/:id/approve` — creates/updates `tenantGroups`, audit entry
- `POST /v1/sublease-requests/:id/revoke`

**AI integration:**
- **Leasing Junior** drafts permission letter (→ #10 letter generation).
- **Compliance Junior** checks jurisdictional rules before auto-route.
- AI detects unusual occupancy signals → opens case.

**UI surface:**
- **customer-app** `src/app/lease/` — "Request sublease" card.
- **estate-manager-app** `src/app/leases/[id]/` — subleases tab + approval.
- **owner-portal** — audit log.

**Acceptance criteria:**
- Approval thresholds honored (owner-toggleable auto-approve).
- Subtenant in tenant group; receives comms; cannot delete primary.
- Rent responsibility split drives invoice generation.
- Revocation archives member, never deletes.

**Dependencies:** ApprovalService (BUILT). Universal Tenant Identity (DEFERRED) — meanwhile subtenant = customer within same org.

---

## 8. Damage-Deduction Negotiation + Evidence Bundling

**Source:** GAP_voice_vs_docs §9, §10 (lines 454–458, 483–486).
**Why it matters:** Move-out damage disputes produce chaotic email chains. Need structured negotiation + legally defensible evidence bundle.

**Existing code to amplify:**
- `services/document-intelligence/src/services/evidence-pack-builder.service.ts` — already builds packs; extend with damage assembler.
- `services/domain-services/src/cases/index.ts` — case state machine (SCAFFOLDED); build damage-deduction type.
- `services/domain-services/src/inspections/inspection-service.ts` — move-out inspection feeds evidence.
- `packages/database/src/schemas/cases.schema.ts` — add case subtype.

**Data model:**
```ts
damageDeductionCases = {
  id, tenantId, leaseId, caseId,
  moveOutInspectionId,
  claimedDeduction: decimal,
  proposedDeduction: decimal | null,
  tenantCounterProposal: decimal | null,
  status: 'claim_filed'|'tenant_responded'|'negotiating'|'agreed'|'escalated'|'resolved',
  evidenceBundleId: text | null,
  aiMediatorTurns: jsonb<NegotiationTurn[]>,
}
```

**API surface:**
- `POST /v1/damage-deductions` — owner files
- `POST /v1/damage-deductions/:id/tenant-response`
- `POST /v1/damage-deductions/:id/ai-mediate`
- `POST /v1/damage-deductions/:id/evidence-bundle` — signed PDF/ZIP download
- `POST /v1/damage-deductions/:id/agree` — posts adjustment (via #4 mechanism) into deposit ledger

**AI integration:**
- **Compliance Junior** orchestrates; invokes **Estate Manager Brain** as mediator: "You are a neutral Harvard-trained property mediator."
- Turn log pattern from #1.
- Opus advisor gate above owner-configured threshold.

**UI surface:**
- **customer-app** `src/app/lease/move-out/disputes/` — tenant counters + counter-evidence.
- **estate-manager-app** `src/app/leases/[id]/move-out/` — damage checklist + AI claim draft.
- **owner-portal** — final settlement approval.

**Acceptance criteria:**
- Evidence bundle: versioned, signed PDF/ZIP with hash anchored to ledger.
- Every turn preserved immutably.
- AI mediator cannot settle outside `deductionApprovalFloor` without advisor gate.
- On agreement, deposit refund auto-calculated and queued.

**Dependencies:** End-of-Tenancy Checklists (#19), Evidence Pack Builder (BUILT).

---

## 9. Carrot-and-Stick Rent Gamification

**Source:** GAP_voice_vs_docs §12, Cross-Cutting #7 (lines 526–529, 657–660).
**Why it matters:** Tenants have zero reward for early payment, no gentle late escalation. Improves collection rate, reduces disputes.

> **Research guidance (RESEARCH_ANSWERS.md Q3):** Flat rewards + cash-flow alignment (Till model) beat streaks/quests which decay. 3-layer: Tenant Score + early-pay credit + optional MNO cashback.

**Existing code to amplify:**
- `packages/ai-copilot/src/services/risk-scoring.ts` and `payment-risk.ts` — reuse for tier placement.
- `services/domain-services/src/payment/` + `packages/database/src/schemas/payment.schema.ts`.
- `services/notifications/src/` — channel for carrot/stick.
- `packages/ai-copilot/src/services/nba-manager-queue.ts` — surface gamification nudges.

**Data model:**
```ts
rewardPolicies = {                        // per tenant-org
  id, tenantId,
  earlyPayDiscountPct: decimal, earlyPayWindowDays: int,
  streakBonus: jsonb<{streak:int, reward:text}[]>,
  latePayFeeSchedule: jsonb<{daysLate:int, feePct:decimal}[]>,
  loyaltyTiers: jsonb<Tier[]>,
  enabled: boolean,
}

tenantGamificationProfile = {
  id, tenantId, customerId,
  currentStreak: int, longestStreak: int,
  currentTier: text, pointsBalance: int,
  lastAwardAt, updatedAt,
}

rewardEvents = {                          // append-only
  id, customerId, type: 'streak_award'|'early_pay_discount'|'late_fee'|'tier_change',
  amount: decimal | null, pointsDelta: int,
  linkedLedgerEntryId, createdAt,
}
```

**API surface:**
- `GET /v1/gamification/policies` / `PUT`
- `GET /v1/customers/:id/gamification` — tier, streak, upcoming rewards
- Internal: `POST /v1/gamification/evaluate` on each `PaymentPostedEvent`

**AI integration:**
- **Tenant Assistant** sends proactive congratulatory/warning messages via `conversational-personalization.ts`.
- **Finance Junior** drafts late-fee notices calibrated to tenant history.

**UI surface:**
- **customer-app** `src/app/payments/` — tier badge, streak counter, next-reward preview.
- **owner-portal** — gamification config + aggregate dashboard.
- **estate-manager-app** — per-tenant state on customer profile.

**Acceptance criteria:**
- Rewards/penalties post to ledger as distinct entry types, respecting immutability.
- Owner can disable per-tenant (flexible/strict mode from memo §12).
- Policies versioned — change doesn't retroactively recompute past periods.
- Leaderboards opt-in (privacy default OFF).

**Dependencies:** Payment reconciliation (BUILT), Notifications preference engine (#21).

---

## 10. On-Demand Letter Generation

**Source:** GAP_voice_vs_docs §11 (lines 502–515); GAP_docs_vs_code MISSING #7.
**Why it matters:** Tenants need residency-proof, tenancy-confirmation, payment-confirmation, reference letters — AI-generated, owner-approvable in one click.

**Existing code to amplify:**
- `services/domain-services/src/documents/templates/` — has `lease-agreement`, `move-in-out-checklist`, `rent-receipt`. Add: `residency-proof`, `tenancy-confirmation`, `payment-confirmation`, `tenant-reference`.
- `packages/ai-copilot/src/skills/domain/comms.ts` — existing `DRAFT_TENANT_NOTICE`; add `DRAFT_TENANT_LETTER` with `letterType` arg.
- `services/domain-services/src/approvals/approval-service.ts` — letters needing sign-off use existing workflow.

**Data model:**
```ts
letterRequests = {
  id, tenantId, customerId, leaseId | null,
  letterType: 'residency_proof'|'tenancy_confirmation'|'payment_confirmation'|'reference'|'custom',
  purpose: text,
  draftedText: text | null,
  approvalRequestId: text | null,
  renderedDocumentId: text | null,
  status: 'draft'|'pending_approval'|'approved'|'delivered'|'rejected',
}
```

**API surface:**
- `POST /v1/letter-requests` — tenant creates; AI drafts synchronously
- `POST /v1/letter-requests/:id/approve`
- `GET /v1/letter-requests/:id/download` — PDF via renderer pipeline (#5)

**AI integration:**
- **Communications Junior** drafts via `DRAFT_TENANT_NOTICE` pattern.
- Auto-approve toggle per letter type (memo §11 line 512–514).
- Default: auto-draft + human approve. Payment-confirmation (factual) → auto-approve OK.

**UI surface:**
- **customer-app** new `src/app/requests/letters/` — choose type, purpose, preview draft, submit.
- **estate-manager-app** `src/app/messaging/` — approval queue.

**Acceptance criteria:**
- All 4 letter types shipped with templates.
- Approval delegation honors authority hierarchy.
- Delivered letter linked to customer/lease/audit event.
- 100% factual citation from DB (no hallucinated dates/amounts).

**Dependencies:** document-service (BUILT), approval-service (BUILT), optional doc renderer (#5).

---

## 11. Marketplace + Tenders (AI-Negotiating)

**Source:** GAP_voice_vs_docs §4, §7, Cross-Cutting #6 (lines 224–228, 356–359, 652–655); GAP_docs_vs_code MISSING #2.
**Why it matters:** Front door for prospects + bidding arena for maintenance tenders. Today no listing catalog, no tender flow.

**Existing code to amplify:**
- `apps/customer-app/src/app/marketplace/page.tsx` — stub exists; scale.
- `packages/database/src/schemas/property.schema.ts` + `maintenance.schema.ts`.
- `services/domain-services/src/maintenance/index.ts` — extend to publish tenders.
- `services/domain-services/src/vendor/` — add bidding.
- `packages/ai-copilot/src/services/vendor-matcher.ts` — amplify for bid ranking.

**Data model:**
```ts
marketplaceListings = {
  id, tenantId, unitId,
  listingKind: 'rent'|'lease'|'sale',
  headlinePrice: decimal, negotiable: boolean,
  media: jsonb<{type:'photo'|'video'|'360'|'streetview', url:string}[]>,
  attributes: jsonb,
  publishedAt, expiresAt, status: 'draft'|'published'|'paused'|'closed',
}

tenders = {
  id, tenantId, workOrderId | null, scope: text,
  budgetRangeMin, budgetRangeMax,
  closesAt, status: 'open'|'closed'|'awarded'|'cancelled',
  aiNegotiatorEnabled: boolean,
}

bids = {
  id, tenderId, vendorId,
  price: decimal, timelineDays: int, notes: text,
  status: 'submitted'|'negotiating'|'awarded'|'rejected',
  negotiationTurns: jsonb<NegotiationTurn[]>,
}
```

**API surface:**
- `POST /v1/marketplace/listings` / `GET /v1/marketplace/listings` (search)
- `POST /v1/marketplace/listings/:id/enquiries` — starts negotiation (#1)
- `POST /v1/tenders` / `POST /v1/tenders/:id/bids`
- `POST /v1/bids/:id/counter` — triggers AI negotiation
- `POST /v1/tenders/:id/award` — creates work order

**AI integration:**
- **Price Negotiator** (#1) handles prospect negotiations.
- New **Tender Negotiator Junior** (coworker sub-variant) for vendor side; uses historic bids + `vendor-matcher.ts`.
- Both share negotiation-turn schema.

**UI surface:**
- **customer-app** `src/app/marketplace/` — expanded (Airbnb-style per founder's memo).
- **estate-manager-app** `src/app/vendors/` + new `tenders/` route.
- **owner-portal** — award approval + negotiation audit.

**Acceptance criteria:**
- Listings support photos, video, 360, street-view.
- Waitlist (#12) auto-feeds on vacancy.
- Tenders: public or invite-only.
- Award auto-generates work order with agreed terms.
- AI never awards below `bid.price` without human approval.

**Dependencies:** #1 Price Negotiation, #12 Waitlist, vendor/work-order services (BUILT).

---

## 12. Waitlist Auto-Outreach on Vacancy

**Source:** GAP_voice_vs_docs §9 (line 444–447).
**Why it matters:** Prior interested parties are valuable but lost today. Auto-outreach shortens vacancy.

**Existing code to amplify:**
- `packages/database/src/schemas/occupancy.schema.ts` — `on_notice`/`terminated` trigger.
- `services/notifications/src/` — outreach channel.
- `packages/ai-copilot/src/services/nba-manager-queue.ts` — outreach tasks.

**Data model:**
```ts
unitWaitlists = {
  id, tenantId, unitId | listingId,
  customerId, priority: int,
  createdAt, source: 'enquiry'|'failed_application'|'manual_add'|'marketplace_save',
  expiresAt, status: 'active'|'converted'|'expired'|'opted_out',
  notificationPreferenceId: text,
}

waitlistOutreachEvents = {
  id, waitlistId,
  eventType: 'vacancy_notified'|'viewed'|'applied'|'declined',
  channel: 'sms'|'whatsapp'|'email'|'push',
  messagePayload: jsonb, occurredAt,
}
```

**API surface:**
- `POST /v1/units/:id/waitlist/join`
- `GET /v1/units/:id/waitlist` — owner view
- Internal: `UnitVacatedEvent` → iterate waitlist (priority-ordered) → dispatch via NBA queue

**AI integration:**
- **Tenant Assistant** composes per-prospect outreach via `conversational-personalization.ts`.
- Throttle: top-N (default 5) in first wave; 48h SLA before next wave.

**UI surface:**
- **customer-app** `src/app/marketplace/[unitId]/` — "Notify me when available".
- **estate-manager-app** `src/app/units/[id]/` — waitlist tab + manual trigger.

**Acceptance criteria:**
- Opt-out captured as `opted_out`, not deleted.
- Dedup: same customer waitlisted for same unit once.
- `UnitVacatedEvent` fires outreach within 1min SLA.
- Outreach audit trail per event.

**Dependencies:** Notifications (#21), occupancy events (BUILT).

---

## 13. Tenant Profile: Financial Statement + Litigation History + AI Risk Report

**Source:** GAP_voice_vs_docs §4 (lines 244–247); GAP_docs_vs_code MISSING #6.
**Why it matters:** Owners need objective risk signal before approving tenancy. AI risk report = differentiator.

**Existing code to amplify:**
- `packages/database/src/schemas/customer.schema.ts` — add sub-tables.
- `services/document-intelligence/src/services/ocr-extraction.service.ts` — parse bank statements, court notices.
- `packages/ai-copilot/src/services/risk-scoring.ts` + `payment-risk.ts` — extend with litigation + financial inputs.
- `packages/domain-models/src/legal/case.ts`, `notice.ts` — amplify for tenant history.

**Data model:**
```ts
tenantFinancialStatements = {
  id, tenantId, customerId,
  reportingPeriodStart, reportingPeriodEnd,
  monthlyIncome: decimal, otherIncome: decimal,
  liabilities: jsonb<Liability[]>,
  bankReferences: jsonb<BankRef[]>,
  sourceDocumentIds: jsonb<string[]>,
  verified: boolean, verifiedAt, verifiedBy,
}

tenantLitigationRecords = {
  id, tenantId, customerId,
  caseNumber: text, jurisdiction: text,
  filedAt, partyRole: 'plaintiff'|'defendant'|'other',
  natureOfCase: text, outcome: text | null,
  amount: decimal | null,
  sourceDocumentIds: jsonb<string[]>,
  disputedByTenant: boolean,
}

tenantRiskReports = {
  id, tenantId, customerId, generatedAt,
  riskScore: int,                      // 0-100
  tier: 'low'|'medium'|'high'|'unacceptable',
  drivers: jsonb<Driver[]>,
  aiNarrative: text,
  advisorReviewed: boolean,
  expiresAt,
}
```

**API surface:**
- `POST /v1/customers/:id/financial-statements` — upload, OCR, parse
- `POST /v1/customers/:id/litigation-records`
- `POST /v1/customers/:id/risk-report/generate`
- `GET /v1/customers/:id/risk-report/latest`
- Tenant-facing: `GET /v1/me/profile/shared-with` — privacy

**AI integration:**
- **Compliance Junior** parses litigation; **Finance Junior** parses financials.
- **Estate Manager Brain** composes narrative risk report, Opus advisor gate.
- Report expires (default 90d).

**UI surface:**
- **customer-app** `src/app/profile/edit/` — upload docs.
- **owner-portal** + **estate-manager-app** — risk card (tier + drivers + narrative).

**Acceptance criteria:**
- Tenant consent captured per sharing event.
- OCR maps to structured schema; unmappable → human review.
- Risk tier change emits event usable by approval engine.
- Regeneration cheaper than first-pass (caches OCR).

**Dependencies:** Document Intelligence (BUILT), OCR provider wiring.

---

## 14. Scan Feature (phone camera → scanner, bundles)

**Source:** GAP_voice_vs_docs §8 (lines 381–383, 386–388).
**Why it matters:** Users email PDFs today. Camera-first scanning with batch upload removes friction.

**Existing code to amplify:**
- `apps/customer-app/src/app/documents/` — existing page; add scan entry point.
- `services/document-intelligence/src/services/ocr-extraction.service.ts` — feed from scan.
- `packages/design-system/src/` — add `ScannerCamera` component (shared).

**Data model:**
```ts
scanBundles = {
  id, tenantId, createdBy,
  purpose: 'lease_pack'|'id_verification'|'financial_pack'|'inspection'|'other',
  pages: jsonb<{order:int, documentId:string}[]>,
  autoAnnotateApplied: boolean,
  submittedAt,
}

// Extend documents table
documents.source: 'upload'|'email'|'whatsapp'|'scan'|'system_generated'
documents.scanBundleId: text | null
```

**API surface:**
- `POST /v1/scans/pages` — single image; returns de-skewed + OCR
- `POST /v1/scans/bundles` — ordered pages
- `POST /v1/scans/bundles/:id/submit` — attach to asset/customer/lease

**AI integration:**
- Image pre-processing deterministic (edge detect + perspective correct) — no LLM.
- **Document Intelligence** auto-classifies bundle type post-OCR.
- AI suggests linkage (customer A, asset B); human confirms.

**UI surface:**
- Shared camera viewfinder: edge-detect overlay, multi-capture, drag-reorder.
- **customer-app** entry from profile/requests/maintenance.
- **estate-manager-app** entry from customers/inspections/properties.

**Acceptance criteria:**
- Works offline (service worker caches; syncs online).
- Auto de-skew, glare-reduction, B/W optimization.
- Scan bundle immutable once submitted; corrections = new version.
- Integrates with existing document storage.

**Dependencies:** Document service (BUILT), OCR (BUILT).

---

## 15. Document-Chat + Document-Group-Chat

**Source:** GAP_voice_vs_docs §8, Cross-Cutting #4 (lines 395–398, 642–645).
**Why it matters:** Every document queryable; group-chat extends to arbitrary sets (all leases of a property, all maintenance photos).

**Existing code to amplify:**
- `services/document-intelligence/` — already OCR + extraction; add retrieval.
- `packages/ai-copilot/src/personas/personas.catalog.ts` — extend **Estate Manager Brain** with docchat tools.
- `packages/ai-copilot/src/skills/domain/` — new `docchat.ts`.
- `packages/ai-copilot/src/orchestrator/orchestrator.ts` — intent "query documents".

**Data model:**
```ts
documentEmbeddings = {
  id, documentId, chunkIndex: int, chunkText: text,
  vector: vector(1536),                 // pgvector
  metadata: jsonb,
}

docChatSessions = {
  id, tenantId, userId,
  documentIds: jsonb<string[]>,         // 1 = chat, N = group-chat
  createdAt, lastMessageAt,
}

docChatMessages = {
  id, sessionId, role:'user'|'assistant',
  content: text, citationDocumentIds: jsonb<string[]>,
  citationSpans: jsonb<{docId,start,end}[]>,
  createdAt,
}
```

**API surface:**
- `POST /v1/documents/:id/chat/sessions` (single) / `POST /v1/doc-chat/sessions` (group)
- `POST /v1/doc-chat/sessions/:id/messages` — ask, get answer + citations
- `GET /v1/doc-chat/sessions/:id/messages` — history

**AI integration:**
- Estate Manager Brain variant "You are a Harvard-trained estate-management attorney".
- Tools: `VECTOR_SEARCH_DOCUMENTS`, `FETCH_DOCUMENT_SECTION`.
- Every answer MUST cite span(s); UI highlights citation.
- Opus advisor gate on legal interpretation or financial commitments.

**UI surface:**
- All 3 apps — "Chat with document" on any document view + group-select mode in `documents/`.
- Citation hover → opens document at span.

**Acceptance criteria:**
- Every response cites or states "not found in documents."
- Embeddings regenerate on version update.
- Tenant-scope enforced per `ARCHITECTURE_BRAIN.md:72-80`.
- Group chat up to 50 documents; above → summary + drill-down.

**Dependencies:** Document Intelligence (BUILT), pgvector.

---

## 16. Condition-Monitoring Trigger (FAR assignment → auto-notify)

**Source:** GAP_voice_vs_docs §2 (lines 146–149).
**Why it matters:** Each unit carries a Fixed-Asset Register. Component changes should kick off monitoring cycles (tenants + technicians + managers).

**Existing code to amplify:**
- `packages/database/src/schemas/maintenance.schema.ts` + `inspections.schema.ts` — add `assetComponents` + `farAssignments`.
- `services/domain-services/src/inspections/inspection-service.ts` — subscribes to FAR events.
- `services/notifications/src/` — multi-party notify.
- `packages/ai-copilot/src/services/nba-manager-queue.ts` — recurring checks.

**Data model:**
```ts
assetComponents = {
  id, tenantId, unitId,
  category: 'appliance'|'structural'|'utility'|'fixture',
  name, serialNumber, installedAt,
  warrantyExpiresAt, expectedLifespanMonths: int,
  status: 'functioning'|'broken'|'in_transit'|'new'|'retired',
}

farAssignments = {
  id, componentId, unitId,
  assignedAt, assignedBy,
  monitoringCycleDays: int,
  nextCheckDueAt,
  responsibleManagerId, responsibleTechnicianId,
}

conditionCheckEvents = {
  id, farAssignmentId, occurredAt,
  conditionScore: int, notes, evidenceDocIds: jsonb,
  nextActionRequired: text | null,
}
```

**API surface:**
- `POST /v1/units/:id/components`
- `POST /v1/components/:id/far-assignment` — auto-schedules first check
- `POST /v1/far-assignments/:id/checks`
- Internal: scheduler fires on `nextCheckDueAt` → notifies 3 parties

**AI integration:**
- **Maintenance Junior** composes check-in messages to tenants.
- **Estate Manager Brain** aggregates FAR checks into conditional survey (#2).

**UI surface:**
- **estate-manager-app** `src/app/units/[id]/components/` — FAR grid, assign monitoring.
- **customer-app** `src/app/utilities/` or `src/app/maintenance/` — "Condition check due" card, 1-tap feedback.
- Technician mobile view for field checks.

**Acceptance criteria:**
- Assignment auto-generates first scheduled event.
- Notifications fan out simultaneously (manager + technician + tenant).
- Missed checks escalate after SLA.
- Status transitions logged (never overwritten).

**Dependencies:** Scheduler (`services/reports/src/scheduler/`), notifications (#21), #2.

---

## 17. Interactive Reports with Embedded Video + Action Plans

**Source:** GAP_voice_vs_docs §7, Cross-Cutting #8 (lines 361–364, 662–665).
**Why it matters:** Static PDFs lose value. Clickable video-embedded reports with actionable next steps.

**Existing code to amplify:**
- `services/reports/src/generators/` — add `interactive-html` alongside PDF/Excel/CSV.
- `services/reports/src/templates/` — enrich with media placeholders.
- `apps/owner-portal/` + `apps/estate-manager-app/src/app/reports/` — viewer.

**Data model:**
```ts
interactiveReportVersions = {
  id, reportInstanceId,
  renderKind: 'interactive_html',
  mediaReferences: jsonb<{placeholder:string, documentId:string, kind:'video'|'photo'|'chart'}[]>,
  actionPlans: jsonb<ActionPlanItem[]>,
  signedUrl, expiresAt,
}
```

**API surface:**
- `GET /v1/reports/:id/interactive` — returns signed URL to HTML bundle
- `POST /v1/reports/:id/action-plans/:aid/ack` — user acknowledges / creates work order
- Events propagate into ApprovalService.

**AI integration:**
- **Estate Manager Brain** generates action plans at compile time (reuses #2 logic).
- Click action plan → pre-filled form (work-order/approval request).

**UI surface:**
- Embedded viewer in estate-manager-app + owner-portal.
- Click video → inline playback. Click action → pre-filled form.

**Acceptance criteria:**
- HTML self-contained (media via signed URLs with TTL).
- Clicks traced to user+timestamp.
- Accessibility: transcripts + alt text.
- Print-to-PDF still works.

**Dependencies:** Reports service (BUILT), media storage (BUILT).

---

## 18. Station-Master-Proximity Routing for Applications

**Source:** GAP_voice_vs_docs §1 (lines 77–85).
**Why it matters:** similar large asset-owning organizations orgs need proximity routing — applications land on wrong desk today.

**Existing code to amplify:**
- `packages/authz-policy/src/system-roles.ts` — add `STATION_MASTER`.
- `services/domain-services/src/approvals/approval-service.ts` — extend routing with proximity.
- `packages/database/src/schemas/hr.schema.ts` + `property.schema.ts` — link staff to geographic clusters (will link to geo-hierarchy when #CONFLICT_3 lands; for now `properties.cityState` + tags).

**Data model:**
```ts
stationMasterCoverage = {
  id, tenantId, stationMasterId,
  coverageKind: 'tag'|'property_ids'|'city'|'polygon',
  coverageValue: jsonb,
  priority: int,
}

workerTags = {                          // per memo §1
  id, userId, tag: text,                // "station_master", "surveyor", "accountant"
  metadata: jsonb,
}
```

**API surface:**
- `POST /v1/applications/route` — `{ applicationId, location, assetType }` → station master
- `PUT /v1/staff/:id/coverage`

**AI integration:**
- Routing deterministic (geo-nearest + tag + workload). No LLM in critical path.
- AI explains routing when asked.

**UI surface:**
- **admin-portal** — station master coverage map.
- **estate-manager-app** `src/app/coworker/` — assignment queue.
- **customer-app** — application submit acknowledges station master name.

**Acceptance criteria:**
- Ties broken by (priority, backlog, last-assigned-at) deterministically.
- Coverage respects tenant isolation.
- Manual override always available.
- When geo-hierarchy lands, `coverageKind='polygon'` switches on without data loss.

**Dependencies:** Gains precision once Elastic Geo-Hierarchy (DEFERRED) lands; usable today via city/tag.

---

## 19. End-of-Tenancy Inspection Checklists

**Source:** GAP_docs_vs_code MISSING #5; GAP_voice_vs_docs §9 (line 449–451).
**Why it matters:** Move-out inspections prevent most damage disputes. Move-in template exists; move-out absent.

**Existing code to amplify:**
- `services/domain-services/src/inspections/checklist-templates.ts` — add `MOVE_OUT_TEMPLATE`.
- `services/domain-services/src/inspections/inspection-service.ts` (662 lines) — full state machine; add move-out state.
- `services/domain-services/src/documents/templates/move-in-out-checklist.template.ts` — already named for both; extend rendering path.
- Integrates with #8 damage-deduction.

**Data model:**
```ts
// Extend inspections.schema.ts
inspections.kind: enum('move_in','move_out','routine','conditional_survey')
inspections.joint: boolean
inspections.selfCheckoutAllowed: boolean
inspections.tenantSignatureId, inspections.landlordSignatureId
moveOutFindings = { ...existing findings + deductionRecommendation decimal }
```

**API surface:**
- `POST /v1/inspections` with `kind='move_out'`
- `POST /v1/inspections/:id/self-checkout`
- `POST /v1/inspections/:id/sign` — dual sign-off
- `POST /v1/inspections/:id/file-damage-claim` → creates #8 case

**AI integration:**
- **Maintenance Junior** compares move-in vs move-out photos, highlights deltas.
- **Compliance Junior** converts findings to deduction recommendations bounded by jurisdictional caps.

**UI surface:**
- **estate-manager-app** `src/app/inspections/move-out/` — mobile-first capture.
- **customer-app** `src/app/lease/move-out/` — tenant confirms/disputes each line.

**Acceptance criteria:**
- Move-in/move-out photo pairs side-by-side.
- One-click damage claim from inspection.
- Self-checkout captures geolocation + timestamp.
- Joint inspection requires both signatures else flagged.

**Dependencies:** Inspection service (BUILT), #8.

---

## 20. Compliance Report Export (DPA/KRA)

**Source:** GAP_docs_vs_code MISSING #8.
**Why it matters:** Kenya DPA + KRA compliance require exportable audit trails.

**Existing code to amplify:**
- `services/domain-services/src/audit/audit-service.ts` (BUILT) — source of truth.
- `packages/database/src/schemas/audit-events.schema.ts`.
- `services/reports/src/report-generation-service.ts` — new report type `compliance_dpa_kra`.

**Data model:**
```ts
complianceExportJobs = {
  id, tenantId, jurisdiction: 'KE_DPA'|'KE_KRA'|'TZ_LAND_ACT'|'TZ_TRA',
  periodStart, periodEnd,
  format: 'pdf'|'csv'|'xml',
  status, generatedDocumentId, requestedBy,
}
```

**API surface:**
- `POST /v1/compliance/exports`
- `GET /v1/compliance/exports/:id`

**AI integration:**
- **Compliance Junior** verifies schema conformance, explains redactions.

**UI surface:**
- **admin-portal** + **owner-portal** compliance tab.

**Acceptance criteria:**
- Every export signed (hash + tenant key).
- Contents match DPA/KRA specifications 1:1.
- Self-service for routine exports.

**Dependencies:** Audit logging (BUILT). Per research Q2: add TZ_TRA for 10% WHT + VAT 18% reporting.

---

## 21. SMS/WhatsApp Preference Engine

**Source:** GAP_docs_vs_code MISSING #9; GAP_voice_vs_docs §5 (line 259–261).
**Why it matters:** Notifications service scaffolded without preference engine.

**Existing code to amplify:**
- `services/notifications/src/` (SCAFFOLDED).
- `packages/database/src/schemas/messaging.schema.ts` — preference table exists; expose logic.
- `packages/ai-copilot/src/services/conversational-personalization.ts` — holds channel preferences; connect.

**Data model:**
```ts
notificationPreferences = {
  id, tenantId, customerId | userId,
  channel: 'sms'|'whatsapp'|'email'|'push'|'voice',
  category: 'payment'|'maintenance'|'announcement'|'marketing',
  frequency: 'immediate'|'daily_digest'|'weekly_digest'|'off',
  quietHoursStart, quietHoursEnd, timezone,
}
```

**API surface:**
- `GET /v1/me/notification-preferences` / `PUT`
- Internal: dispatcher honors preference before send.

**AI integration:**
- Tenant Assistant suggests preference adjustments based on engagement patterns.

**UI surface:**
- **customer-app** `src/app/settings/notifications/` — per-category per-channel toggles.

**Acceptance criteria:**
- Preference lookup O(1) per notification.
- Quiet-hours respected unless `emergency` priority.
- Category defaults per tenant-org; individual override allowed.

**Dependencies:** Notifications service wiring.

---

## 22. Occupancy Timeline Visualization

**Source:** GAP_docs_vs_code MISSING #10.
**Why it matters:** Owners need per-unit timeline of every tenant, rent level, gaps. Data present, no visualization.

**Existing code to amplify:**
- `packages/database/src/schemas/occupancy.schema.ts` (BUILT, full history).
- `services/domain-services/src/lease/` (BUILT).
- `apps/estate-manager-app/src/app/units/` — add timeline tab.
- `packages/graph-sync/src/queries/graph-agent-toolkit.ts` — add `GET_UNIT_OCCUPANCY_TIMELINE`.

**Data model:** No new tables. Derived view:
```ts
view unitOccupancyTimeline (unitId, periods:[{tenantId, from, to, rent, status, exitReason}])
```

**API surface:**
- `GET /v1/units/:id/occupancy-timeline`

**AI integration:**
- **Estate Manager Brain** summarizes gaps ("8 weeks vacant after tenant X").

**UI surface:**
- **estate-manager-app** `src/app/units/[id]/` — Gantt-style timeline.
- **owner-portal** aggregated across portfolio.

**Acceptance criteria:**
- Handles 20+ year histories performantly (paginated).
- Each segment clickable → drills to lease record (realizes "infinite portals" Cross-Cutting #2).
- Export as image/PDF.

**Dependencies:** Graph-sync (BUILT), Neo4j queries.

---

## Sequencing Recommendation (Phase 2)

**Sprint 1 (foundation):** #3 GePG, #21 Notifications preference, #10 Letters, #19 Move-out checklists, #22 Occupancy timeline — short-reach amplifications.

**Sprint 2 (revenue-critical):** #4 Arrears ledger, #13 Risk report, #9 Gamification.

**Sprint 3 (marketplace + negotiation):** #1 Price negotiation, #11 Marketplace + tenders, #12 Waitlist.

**Sprint 4 (document intelligence):** #14 Scan, #15 Document-chat, #5 Doc-render (+ Nano Banana imagery).

**Sprint 5 (evidence + compliance):** #2 Conditional survey, #8 Damage-deduction, #17 Interactive reports, #16 FAR trigger, #6 Subdivision, #7 Sublease, #18 Station-master routing, #20 Compliance export.

---

## Cross-Feature Invariants

1. **Nothing mutates the ledger.** Arrears, gamification, damage deductions all post new adjustment entries.
2. **Every AI action emits a `PROPOSED_ACTION` or `HANDOFF_TO`** per `packages/ai-copilot/src/orchestrator/orchestrator.ts`.
3. **Opus advisor gate** preserved for irreversible/high-value actions.
4. **Tenant isolation via `tenantId`** on every new table; RLS tests mirror `packages/authz-policy/src/engine/tenant-isolation.test.ts`.
5. **Graph-sync updated** when new relationships affect queryable toolkit.
6. **Approvals flow via ApprovalService**, never ad-hoc.
7. **Notifications flow via preference engine (#21)**, never direct provider calls.
8. **Nothing deletes data** — statuses transition; archival is a status, not a DELETE.
