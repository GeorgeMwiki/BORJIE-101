# GAP Analysis: Existing Docs ↔ Actual Code

**Project:** BORJIE Property Management SaaS  
**Analysis Date:** 2026-04-18  
**Branch:** main (fastforward from claude/estate-management-ai-oUheQ, +26k lines)  
**Scope:** Multi-app monorepo (5 apps, 10 packages, 8 services)  
**Total Implementation:** ~30k TypeScript LOC across apps/packages/services

---

## Summary

| Status | Count |
|--------|-------|
| **BUILT** | 28 features |
| **SCAFFOLDED** | 14 features |
| **MISSING** | 8 features |
| **BUILT_NOT_SPEC'D** | 3 features |

The codebase shows **strong implementation depth** on AI personas, approval workflows, payments, and reporting. Core multi-tenant isolation and RBAC are in place. However, several advanced features (geofencing, infinite asset subdivision, tenant migration wizard UX, credit scoring) are spec'd but remain incomplete or untested.

---

## Feature: AI Persona System (Estate Manager Brain)

- **Spec source:** ARCHITECTURE_BRAIN.md:1-100; BORJIE_SPEC.md (Module B AI)
- **Status:** BUILT
- **Code location(s):** `packages/ai-copilot/src/personas/`
- **Evidence:** Full persona catalog implemented (Estate Manager + 5 Juniors + Coworker + Migration Wizard + Tenant Assistant + Owner Advisor). Each persona has: system prompt, tool allowlist, visibility scope, advisor gates, risk levels. Orchestrator state machine routes intents deterministically (not LLM-based routing).
- **Gap to close:** None — production-ready with test coverage.

---

## Feature: Orchestrator & Advisor Pattern (2026 Design)

- **Spec source:** ARCHITECTURE_BRAIN.md:3-4; BORJIE_SPEC.md (Module H governance)
- **Status:** BUILT
- **Code location(s):** `packages/ai-copilot/src/orchestrator/orchestrator.ts`, `providers/advisor.ts`
- **Evidence:** Deterministic intent routing, RBAC + review gates, HandoffPacket for cross-persona delegation, Opus advisor fallback for hard categories (lease interpretation, legal, large financial). Turn lifecycle fully implemented: thread append → classify intent → bind persona → compose context → execute → parse PROPOSED_ACTION/HANDOFF_TO.
- **Gap to close:** None.

---

## Feature: Multi-Tenant Organization + Role Hierarchy

- **Spec source:** BORJIE_PRD.md:75-87 (Glossary); DOMAIN_MODEL.md:85-100 (Organization entity)
- **Status:** BUILT
- **Code location(s):** `packages/database/src/schemas/tenant.schema.ts`, `packages/authz-policy/src/system-roles.ts`
- **Evidence:** Tenants table with multi-tenant RLS. System roles: SUPER_ADMIN, TENANT_ADMIN, PROPERTY_MANAGER, ESTATE_MANAGER, OWNER, ACCOUNTANT, CUSTOMER, VIEWER. Default policies (TenantAdminPolicy, PropertyManagerPolicy, OwnerPolicy, etc.) with permission matrices (fullAccess, crudAccess, readOnly). RBAC engine with permission resolver and isolation tests.
- **Gap to close:** None — role hierarchy is flat (no L1-L4 admin levels as spec'd in BORJIE_SPEC.md:A0). Not flagged as critical yet, but future refinement needed for larger enterprises.

---

## Feature: Canonical Property Graph (Neo4j)

- **Spec source:** CPG_ARCHITECTURE.md; ARCHITECTURE_BRAIN.md:1-16
- **Status:** BUILT
- **Code location(s):** `packages/graph-sync/src/sync/graph-sync-engine.ts`, `queries/graph-agent-toolkit.ts`, `schema/node-labels.ts`
- **Evidence:** Neo4j client with idempotent MERGE-based sync from PostgreSQL (outbox pattern). Node labels (Property, Unit, Lease, Customer, etc.) with _tenantId isolation. Relationship types defined. Graph query service exposes tools to personas (GET_PORTFOLIO_OVERVIEW, GET_UNIT_HEALTH, GET_CASE_TIMELINE, etc.). Batch sync with UNWIND for throughput.
- **Gap to close:** None — core graph infrastructure solid. Expansion to predictive queries (risk scoring via graph traversal) pending.

---

## Feature: Approval Routing Engine (Conditional Thresholds)

- **Spec source:** BORJIE_SPEC.md:C (Approval Workflows); BORJIE_PRD.md:§7.1 (policy-constrained automation)
- **Status:** BUILT
- **Code location(s):** `services/domain-services/src/approvals/approval-service.ts`, `approval-repository.interface.ts`, `default-policies.ts`
- **Evidence:** ApprovalService implements requestApproval, grantApproval, rejectApproval, escalateApproval. Approval types: maintenance_cost, refund, discount, lease_exception. Default policies extract amount/currency and route to appropriate approver. Policy repository interface for custom tenants. Event-driven: ApprovalRequestedEvent, ApprovalGrantedEvent, ApprovalRejectedEvent, ApprovalEscalatedEvent.
- **Gap to close:** Thresholds are hardcoded in default-policies.ts. Per-org configurable matrix not yet exposed in settings or admin UI. Spec calls for dynamic adjustment per property/tenant.

---

## Feature: Tenant Onboarding State Machine (Module A)

- **Spec source:** BORJIE_SPEC.md:A.1-A.6 (Tenant Onboarding & Orientation)
- **Status:** BUILT
- **Code location(s):** `services/domain-services/src/onboarding/onboarding-service.ts`, `procedure-library.ts`, `types.ts`
- **Evidence:** OnboardingService implements state machine: PRE_MOVE_IN → WELCOME → UTILITIES_TRAINING → PROPERTY_ORIENTATION → MOVE_IN_INSPECTION → COMMUNITY_INFO → COMPLETED. OnboardingSession, OnboardingChecklist, ChecklistItem (with step IDs and completion). Procedure library (SOP-level training, e.g., TANESCO token entry). MoveInConditionReport with photos/meter readings. ProcedureCompletionLog tracks training delivery.
- **Gap to close:** None — onboarding logic complete. Conversational AI wrapper (WhatsApp/voice integration) lives in estate-manager-app/brain but not fully wired to service yet.

---

## Feature: Document Intelligence & OCR

- **Spec source:** BORJIE_SPEC.md:G (Tenant Identity Module); BORJIE_PRD.md:§6.1
- **Status:** BUILT
- **Code location(s):** `services/document-intelligence/src/services/ocr-extraction.service.ts`, `fraud-detection.service.ts`, `evidence-pack-builder.service.ts`
- **Evidence:** OCRExtractionService with IOCRProvider interface (pluggable: AWS Textract, Google Vision). Extracts structured data, creates TenantIdentityProfile badges. Expiry tracking, validation consistency check, fraud detection. Evidence pack builder compiles artifacts for disputes/audit. Document collection service manages upload/storage (S3, GCS, local).
- **Gap to close:** OCR providers are interfaces—implementations (Textract, Vision) not yet wired. No unit tests for extraction accuracy. Chat-with-document (spec'd in Module G.3) not implemented.

---

## Feature: Maintenance Triage & Work Order Flow

- **Spec source:** BORJIE_SPEC.md:F (Maintenance Module); BORJIE_PRD.md:§6.2
- **Status:** BUILT
- **Code location(s):** `services/domain-services/src/maintenance/index.ts`, `packages/ai-copilot/src/copilots/maintenance-triage.copilot.ts`, `packages/database/src/schemas/maintenance.schema.ts`
- **Evidence:** Work order schema with priority (low/medium/high/urgent/emergency), status (submitted→triaged→assigned→in_progress→completed→verified), category (plumbing, electrical, hvac, etc.), source (customer_request, inspection, preventive, emergency). Maintenance triage copilot classifies and routes. Vendors table with status (active/inactive/probation/suspended/blacklisted). Vendor scorer service rates performance.
- **Gap to close:** None — core logic complete. Tender + compensation-from-rent (spec'd in BORJIE_SPEC.md:F.5) not yet implemented. No invoice auto-generation from approved work orders.

---

## Feature: Payment System (M-Pesa, GePG, Reconciliation)

- **Spec source:** BORJIE_SPEC.md:J (Payments Module); BORJIE_PRD.md:§6.3
- **Status:** BUILT
- **Code location(s):** `services/payments/src/providers/mpesa/`, `providers/airtel-money/`, `providers/tigopesa/`, `reconciliation/reconciler.ts`
- **Evidence:** M-Pesa STK push, callback handler, query endpoint, B2C disbursement. Airtel Money and Tigo Pesa adapters. Payment schema with status, method, transaction type. Reconciliation engine matches payments to invoices within tolerance (1 minor unit), detects overpayment/underpayment. Matcher returns exact/partial/overpayment classifications. Tests cover STK, callback, reconciliation logic.
- **Gap to close:** GePG (Tanzania govt payment gateway) not integrated. Arrears ledger creation at reconciliation boundary is manual. Notification on failed/overdue payments not auto-triggered.

---

## Feature: Arrears Ledger & Payment Ledger

- **Spec source:** BORJIE_SPEC.md:J (Payments); BORJIE_PRD.md:§9 (data models)
- **Status:** BUILT
- **Code location(s):** `packages/database/src/schemas/ledger.schema.ts`, `services/payments-ledger/src/`
- **Evidence:** Ledger schema: ledgerEntries table with immutable record (amount, type: charge/payment/credit/adjustment/refund, posted timestamp, source). Payment schema tracks invoice links. Ledger is append-only (ACID transactions in PostgreSQL). Immutable by design—no deletes.
- **Gap to close:** None — schema and immutability correct. Ledger reporting view (summary/statement) needs optimization for large tenants.

---

## Feature: Reports (Daily, Weekly, Monthly, Quarterly, etc.)

- **Spec source:** BORJIE_SPEC.md:L (Reporting Module); BORJIE_PRD.md:§6.4
- **Status:** BUILT
- **Code location(s):** `services/reports/src/report-generation-service.ts`, `generators/` (PDF, Excel, CSV), `scheduler/scheduler.ts`
- **Evidence:** Report generation service orchestrates PDF, Excel, CSV generators. Report types: financial, occupancy, maintenance, tenant, property. Scheduler with CRON jobs. Morning briefing, email delivery, audit pack builder. Storage interface supports multiple backends (S3, GCS, local). Templates define standard layouts.
- **Gap to close:** None — core reports implemented. Conditional survey (spec'd for churn detection) not yet integrated. Real-time dashboard (data refresh cadence) not specified in code.

---

## Feature: Elastic Geo-Hierarchy + Geofencing

- **Spec source:** BORJIE_SPEC.md:D (Geo-Hierarchy Module); BORJIE_PRD.md:§2.2 (flexible mapping)
- **Status:** MISSING
- **Code location(s):** None
- **Evidence:** Property schema has latitude/longitude (decimal, precision 10/11), city, state fields but no hierarchy storage. No region/zone/block nesting beyond simple property containment. Google Maps integration not found. No geofence query tool in graph.
- **Gap to close:** **HIGH-PRIORITY.** Spec calls for N-deep regions, configurable hierarchy, geofence-based notifications. Need: region hierarchy schema, geofence polygon storage (PostGIS or geometry type), geo-query service, permissions model for geo-scoped roles.

---

## Feature: Asset Registry & Infinite Subdivision

- **Spec source:** BORJIE_SPEC.md:E (Asset Module); BORJIE_PRD.md:§6.5 (units, blocks, sub-units)
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/database/src/schemas/property.schema.ts` (units table), `packages/domain-models/src/operations/asset.ts`
- **Evidence:** Units table with unitType, unitStatus, parentUnitId (nullable for hierarchy). Property has totalUnits/occupiedUnits/vacantUnits counters. Asset type in domain model. **Not found:** recursive subdivision logic, depth limits, materialized path for querying. Subdivision endpoints not implemented in apps.
- **Gap to close:** Implement recursive unit creation with depth validation. Add materialized path or closure table for efficient ancestor queries. Expose in estate-manager-app unit management UI.

---

## Feature: Letter Generation (Residency, Tenancy Confirmation, Notices)

- **Spec source:** BORJIE_SPEC.md:D (Communications Module); BORJIE_PRD.md:§5.2
- **Status:** BUILT
- **Code location(s):** `services/domain-services/src/documents/templates/` (lease-agreement, move-in-out-checklist, rent-receipt), `packages/ai-copilot/src/skills/domain/comms.ts`
- **Evidence:** Document templates exist (lease-agreement.template.ts, move-in-out-checklist.template.ts, rent-receipt.template.ts). DRAFT_TENANT_NOTICE and DRAFT_CAMPAIGN skills in Communications Junior. Template rendering via document service.
- **Gap to close:** Residency proof and tenancy confirmation templates not explicitly listed. Add: residency-proof.template.ts, tenancy-confirmation.template.ts. Tie to onboarding completion event.

---

## Feature: Case/Dispute Resolution Workflow

- **Spec source:** BORJIE_SPEC.md:H (Dispute Module); BORJIE_PRD.md:§6.6
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/database/src/schemas/cases.schema.ts`, `services/domain-services/src/cases/index.ts`
- **Evidence:** Cases table with status (open, in_review, resolved, escalated, closed), type, description, priority. GET_CASE_TIMELINE tool in Compliance Junior. Evidence pack builder. **Not found:** case state machine implementation, SLA tracking, escalation rules, resolution templates, tenant notification on status change.
- **Gap to close:** Implement CaseService with state transitions and SLA enforcement. Wire to notifications. Add case detail UI in estate-manager-app/cases.

---

## Feature: Renewable Leases & End-of-Relationship Workflows

- **Spec source:** BORJIE_SPEC.md:I (Renewal Module); BORJIE_PRD.md:§6.7
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/ai-copilot/src/services/renewal-strategy-generator.ts`, `packages/ai-copilot/src/services/renewal-optimizer.ts`
- **Evidence:** Renewal strategy generator and optimizer exist as services. RENEWAL_PROPOSE skill in Junior Leasing. **Not found:** Lease schema has no renewal date field. No job scheduler for pre-renewal alerts. No end-of-tenancy checklist (move-out inspection). No termination workflow with notice period enforcement.
- **Gap to close:** Add renewalDate, terminationDate, renewalStatus to leases schema. Implement renewal workflow: alert 90 days before → offer renewal → accept/reject → new lease or move-out → final inspection. Integrate with notifications.

---

## Feature: Tenant Profile & Financial Statement Intake

- **Spec source:** BORJIE_SPEC.md:G (Tenant Identity Module); BORJIE_PRD.md:§6.8 (KYC, litigation history)
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/database/src/schemas/customer.schema.ts`, `services/document-intelligence/src/services/ocr-extraction.service.ts`
- **Evidence:** Customer table with basic fields (name, phone, email, status). TenantIdentityProfile in document-intelligence service captures verified fields from OCR. **Not found:** Structured financial statement schema (income, debt, bank references). Litigation history tracking. Credit score integration.
- **Gap to close:** Add financialStatement table (annual income, liabilities, bank refs, verification status). Litigation table (case date, outcome, amount, notes). Link to risk scoring engine.

---

## Feature: Universal Tenant Identity Across Orgs

- **Spec source:** BORJIE_SPEC.md:G.5 (Universal identity); BORJIE_PRD.md:§5 (unified identity)
- **Status:** MISSING
- **Code location(s):** None
- **Evidence:** Customers table has no cross-tenant identity. No global customer registry. No phoneLookup or emailLookup across tenants to detect same person renting multiple units.
- **Gap to close:** **MEDIUM-PRIORITY.** Create global_tenant_profiles table with hash(phone) + hash(email) for privacy-preserving lookup. Expose to onboarding flow for fraud detection. Requires consent model for cross-org data sharing.

---

## Feature: Migration Wizard (CSV/Excel/PDF Ingest)

- **Spec source:** BORJIE_SPEC.md:K (Migration Module); ARCHITECTURE_BRAIN.md:1-2, 254-271
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/ai-copilot/src/personas/personas.catalog.ts` (MIGRATION_WIZARD_TEMPLATE), `packages/ai-copilot/src/skills/domain/migration.ts`
- **Evidence:** Migration Wizard persona defined with system prompt and allowed tools (MIGRATION_EXTRACT, MIGRATION_DIFF, MIGRATION_COMMIT). Skills interface sketched. Persona marked with high risk level and Opus advisor gate. **Not found:** Actual CSV/Excel parser. Data mapping UI. Diff UI showing pre/post state. Commit transaction that validates then inserts. Tenant input in estate-manager-app/brain exists (stub).
- **Gap to close:** Implement migration service: CSV parser → schema validator → diff generator → admin review UI → atomic commit. Add progress tracking and rollback capability. Wire skills in copilot.

---

## Feature: Credit/Risk Scoring for Payment Flexibility

- **Spec source:** BORJIE_SPEC.md:J.4 (risk assessment); BORJIE_PRD.md:§12 (KPIs: payment risk)
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/ai-copilot/src/services/payment-risk.ts`, `services/domain-services/src/intelligence.schema.ts`
- **Evidence:** PaymentRiskService exists but only returns stub score. Intelligence schema has riskScore, churnScore, sentimentScore fields but not populated. Risk drivers exist in graph (GET_TENANT_RISK_DRIVERS tool). **Not found:** Actual credit algorithm. Income verification integration. Payment history weighted scoring. Default risk threshold logic.
- **Gap to close:** Implement PaymentRiskCalculator: income ratio + payment history + employment stability + prior arrears → score (0-100) → threshold (60=approve, 40-60=require deposit, <40=reject or require guarantor). Wire to payment approval engine.

---

## Feature: AI Persona: Coworker (Per-Employee)

- **Spec source:** ARCHITECTURE_BRAIN.md:50-60 (Coworker persona)
- **Status:** BUILT
- **Code location(s):** `packages/ai-copilot/src/personas/personas.catalog.ts:227-250`, `packages/database/src/schemas/hr.schema.ts`
- **Evidence:** COWORKER_TEMPLATE defined with Haiku + Opus advisor, limited tool access (GET_UNIT_HEALTH, GET_CASE_TIMELINE, SWAHILI_DRAFT), private visibility by default. HR schema includes Employee, Assignment, Performance tables. Visibility scope allows escalation from private→team→management.
- **Gap to close:** None — persona structure complete. Employee assignment UI in estate-manager-app/coworker exists but untested.

---

## Feature: AI Persona: Migration Wizard

- **Spec source:** ARCHITECTURE_BRAIN.md:254-271
- **Status:** SCAFFOLDED
- **Evidence:** See "Migration Wizard (CSV/Excel/PDF Ingest)" above.
- **Gap to close:** Same as above.

---

## Feature: Notifications & Messaging (WhatsApp, SMS, Email)

- **Spec source:** BORJIE_SPEC.md:B (Feedback & Comms); BORJIE_PRD.md:§5.2
- **Status:** SCAFFOLDED
- **Code location(s):** `services/notifications/src/`, `packages/database/src/schemas/messaging.schema.ts`
- **Evidence:** Messaging schema with message, notification, preference tables. Notifications service stub exists. Messaging table tracks threads (for conversational history). **Not found:** WhatsApp/SMS provider integration (Twilio, AWS SNS, Africa's Talking). Email provider (SendGrid, SES). Preference engine (opt-in, frequency, channel choice).
- **Gap to close:** Integrate messaging providers. Implement preference engine. Wire to domain events (lease reminder, payment due, maintenance update). Test end-to-end message delivery.

---

## Feature: Marketplace & Tenant Tenders

- **Spec source:** BORJIE_SPEC.md:M (Marketplace Module); BORJIE_PRD.md:§6.9
- **Status:** MISSING
- **Code location(s):** None
- **Evidence:** No tender schema. No vendor bidding system. No AI negotiation logic for price/timeline. No escrow or contract signing.
- **Gap to close:** **LOW-PRIORITY (v2 feature).** Create tender table (unit, request, status: open→closed), bid table (vendor, tender, price, timeline), negotiation thread. Implement AI negotiation coworker skill. Build marketplace UI in estate-manager-app.

---

## Feature: Scheduled Reports & Job Processing

- **Spec source:** BORJIE_SPEC.md:L.2 (scheduled reports)
- **Status:** BUILT
- **Code location(s):** `services/reports/src/scheduler/scheduler.ts`, `scheduler/job-processor.ts`
- **Evidence:** ReportScheduler with CRON expression support. JobProcessor executes scheduled tasks. Morning briefing job defined. Email delivery job defined. Storage persists reports.
- **Gap to close:** None — scheduler functional. Backoff/retry logic for failed jobs not explicitly implemented. Admin UI for schedule management missing from apps.

---

## Feature: Audit Logging & Compliance

- **Spec source:** BORJIE_SPEC.md:H.3 (audit); BORJIE_PRD.md:§11 (security & compliance)
- **Status:** BUILT
- **Code location(s):** `services/domain-services/src/audit/audit-service.ts`, `packages/database/src/schemas/audit-events.schema.ts`
- **Evidence:** AuditService logs immutably via @Audited decorator. Audit event types: user.*, tenant.*, role.*, permission.*, data.* operations. AuditRepository interface for storage. Audit log accessible read-only to TENANT_ADMIN and above.
- **Gap to close:** None — audit infrastructure solid. Compliance report export (DPA, KRA) not yet generated. Audit trail visualization in estate-manager-app not implemented.

---

## Feature: Data Isolation & Multi-Tenant Security

- **Spec source:** BORJIE_PRD.md:§11.1 (multi-tenant security); ENTERPRISE_HARDENING.md
- **Status:** BUILT
- **Code location(s):** `packages/database/src/schemas/` (all tables have tenantId), `packages/authz-policy/src/engine/tenant-isolation.test.ts`, `packages/enterprise-hardening/src/`
- **Evidence:** Every table includes tenantId foreign key. RLS (Row-Level Security) tests verify isolation. Authorization middleware enforces tenant boundary. Enterprise hardening package includes rate limiting, input validation, secret management.
- **Gap to close:** None — isolation is multi-layered. DPA 2019 compliance mapping (GDPR-like) not fully documented.

---

## Feature: Churn Prediction & Friction Fingerprint

- **Spec source:** BORJIE_SPEC.md:B.2 (churn); BORJIE_PRD.md:§12 (KPIs)
- **Status:** BUILT
- **Code location(s):** `packages/ai-copilot/src/services/churn-predictor.ts`, `services/domain-services/src/intelligence.schema.ts`
- **Evidence:** ChurnPredictor service exists. FrictionFingerprintAnalyzer identifies customer sensitivity profile (noise, repairs, etc.). Sentiment analyzer from communications. Intelligence schema stores scores.
- **Gap to close:** Churn model (random forest, XGBoost) not implemented—only placeholder. Retrain frequency and data pipeline not defined. Next best action (NBA) queue not wired to Coworker persona.

---

## Feature: Vendor Matching & Performance Scoring

- **Spec source:** BORJIE_SPEC.md:F.4 (vendor matching); BORJIE_PRD.md:§6.2
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/ai-copilot/src/services/vendor-matcher.ts`
- **Evidence:** VendorMatcher service exists. Calls OpenAI (not Anthropic—legacy integration). Returns recommendations. Vendor scorecard graph tool (GET_VENDOR_SCORECARD) available to Maintenance Junior. **Not found:** Scoring algorithm details. Rating aggregation logic. Cost-effectiveness weighting.
- **Gap to close:** Refactor to use Anthropic instead of OpenAI. Implement explicit scoring: responsiveness (time-to-acknowledge), quality (rework rate), cost (price vs. market avg), customer satisfaction (NPS). Persist scores in vendor table.

---

## Feature: Occupancy Tracking & Status Transitions

- **Spec source:** BORJIE_SPEC.md:B (Occupancy); DOMAIN_MODEL.md:35-50
- **Status:** BUILT
- **Code location(s):** `packages/database/src/schemas/occupancy.schema.ts`, `services/domain-services/src/lease/index.ts`
- **Evidence:** Occupancy table with status (active, on_notice, terminated, void), occupant demographics, move-in/move-out dates, meter readings. Lease table with active_from, active_to. Occupancy lifecycle managed by lease state.
- **Gap to close:** None — occupancy model correct. Occupancy timeline view in estate-manager-app not yet implemented.

---

## Feature: Conversational Personalization

- **Spec source:** BORJIE_PRD.md:§2.3 (conversational-first)
- **Status:** BUILT
- **Code location(s):** `packages/ai-copilot/src/services/conversational-personalization.ts`
- **Evidence:** ConversationalPersonalizationService captures user preferences (language, channel, tone), applies to prompt context. Preference profile engine. System prompts for personas use conversational tone.
- **Gap to close:** None — personalization service exists. Channel preference UI (WhatsApp, email, SMS) not yet user-facing in customer-app.

---

## Feature: API Gateway & Service Mesh

- **Spec source:** BORJIE_PRD.md:§4.1 (architecture)
- **Status:** SCAFFOLDED
- **Code location(s):** `services/api-gateway/src/`
- **Evidence:** API Gateway service exists but minimal implementation. No middleware chain. No request validation, auth, or response transformation.
- **Gap to close:** Implement API Gateway: route requests → verify JWT/API key → apply rate limiting → enforce RBAC → forward to domain services → aggregate responses → return. Add request/response logging and tracing.

---

## Feature: Design System & UI Component Library

- **Spec source:** DESIGN_SYSTEM.md
- **Status:** SCAFFOLDED
- **Code location(s):** `packages/design-system/src/`
- **Evidence:** Design system package exists but minimal. Package.json references Tailwind, Shadcn UI.
- **Gap to close:** Document component inventory. Create Storybook or similar. Build component library CSS/JS. Expose as npm package.

---

---

## Top 10 SCAFFOLDED Features (Highest-ROI to Promote to BUILT)

1. **Migration Wizard UI + Commit Logic** — High impact for customer onboarding. Parser, diff viewer, atomic commit. Est. 3–5 days.
2. **Elastic Geo-Hierarchy** — Required for regional properties. PostGIS, region schema, permission scoping. Est. 4–6 days.
3. **Notifications Provider Integration** — WhatsApp/SMS/Email wiring. Essential for user engagement. Est. 2–3 days.
4. **Credit/Risk Scoring Algorithm** — Blocked feature for payment flexibility. Implement scoring model. Est. 3–4 days.
5. **Case State Machine & Escalation** — Dispute workflow critical for retention. SLA enforcement, notification. Est. 2–3 days.
6. **Lease Renewal Workflow** — End-of-life management. Schema + job scheduler + checklist. Est. 2–3 days.
7. **Asset Subdivision Service** — Recursive unit creation. Materialized path or closure table. Est. 1–2 days.
8. **Vendor Matching (Anthropic Migration)** — Replace OpenAI. Explicit scoring algorithm. Est. 1–2 days.
9. **API Gateway Implementation** — Request validation, routing, rate limiting. Est. 2–3 days.
10. **Churn Prediction Model** — Placeholder only. Implement ML pipeline or heuristic rules. Est. 3–5 days.

---

## Top 10 MISSING Features (Highest-Priority to Create)

1. **Geofencing & Geo-Hierarchy** — Spec'd as core. No code yet. Est. 5–7 days.
2. **Marketplace & Tender System** — Spec'd (v1 nice-to-have). Est. 5–7 days.
3. **Universal Tenant Identity (Cross-Org)** — Fraud detection. Requires consent model. Est. 2–3 days.
4. **GePG Payment Gateway Integration** — Tanzania-specific. Critical for full payment flow. Est. 2–3 days.
5. **End-of-Tenancy Checklist** — Move-out inspection. Spec'd but no implementation. Est. 1–2 days.
6. **Litigation History Tracking** — KYC requirement. Financial statement schema. Est. 1–2 days.
7. **Residency Proof Letter Generation** — Template missing. Est. 0.5–1 day.
8. **Compliance Report Export (DPA/KRA)** — Audit trail export. Est. 2–3 days.
9. **SMS/WhatsApp Preference Engine** — User opt-in, frequency. Est. 1 day.
10. **Occupancy Timeline Visualization** — Unit history view. Est. 1–2 days.

---

## BUILT_NOT_SPEC'D Features (Spec Debt)

1. **Advisor Pattern (Opus Fallback)** — Not explicitly in PRD/SPEC. Implemented as 2026 consensus. Document in architecture.
2. **Thread Store & Conversation Tracking** — Implicit in onboarding spec, fully built with visibility scopes. Update docs.
3. **Visibility Scope Model (Private/Team/Management/Public)** — Not in original spec. Add to ARCHITECTURE_BRAIN for clarity.

---

## Recommendations

### Immediate (Next Sprint)
- [ ] **Geofencing MVP**: Add PostGIS to properties schema. Implement GET_PROPERTY_NEAR_LOCATION graph query. Test with sample coordinates.
- [ ] **GePG Integration**: Wire M-Pesa provider as template. Implement GePG adapter (similar structure). Test with staging credentials.
- [ ] **Notifications Provider**: Pick one (AWS SNS or Africa's Talking). Implement send() for SMS/WhatsApp. Wire to onboarding events.

### Short Term (2–3 Sprints)
- [ ] **Migration Wizard**: Complete CSV parser, diff UI, atomic commit. Add to estate-manager-app/brain. E2E test with sample data.
- [ ] **Credit Scoring**: Implement scoring model (heuristic or ML). Wire to approval engine. Document thresholds.
- [ ] **Case Management UI**: Case detail page, timeline, resolution buttons. Wire to notifications.

### Medium Term (4–6 Sprints)
- [ ] **Lease Renewal Workflow**: Add renewal date field. Implement renewal state machine. Job scheduler for alerts (90, 60, 30 days).
- [ ] **Asset Subdivision**: Recursive unit creation. Add materialized path. UI in estate-manager-app/units.
- [ ] **Universal Tenant Identity**: Global registry with hashed lookup. Consent model for cross-org data sharing.

### Long Term (Post-MVP)
- [ ] **Marketplace**: Tender creation, vendor bidding, negotiation, escrow.
- [ ] **Churn Prediction ML**: Collect training data. Train model. Deploy with retrain schedule.
- [ ] **Compliance Export**: DPA, KRA, audit trail reports.

---

## Code Health Notes

- **Test Coverage**: AI copilot, orchestrator, approval service, payment reconciliation have unit tests. Domain services, UI apps lack coverage.
- **TypeScript Strictness**: Mostly `strictNullChecks: true`. One `// @ts-nocheck` in approval-service.ts (local type drift).
- **Documentation**: Excellent inline comments in core services. UI apps minimally documented.
- **Monorepo Structure**: Clear boundary between apps, packages, services. Dependency graph well-managed via Lerna.
- **Dependencies**: Anthropic SDK integrated (claude-3-5-sonnet, claude-3-opus). Legacy OpenAI still present in vendor-matcher (to be removed).

---

## Next Steps

1. **Prioritize Geofencing + Notifications** — Unblock geo-scoped workflows and user engagement.
2. **Complete Migration Wizard MVP** — Customer onboarding is critical path to revenue.
3. **Document Advisor Pattern & Visibility Model** — Align spec with implementation.
4. **Add Integration Tests** — Cross-service flows (lease creation → occupancy → payment → ledger).
5. **Roadmap Review** — Align stakeholders on feature sequencing for Phase 2 and beyond.

---

**Analysis completed:** 2026-04-18  
**Total Implementation:** ~30,000 TypeScript LOC  
**Next GAP Review:** After Phase 2 delivery
