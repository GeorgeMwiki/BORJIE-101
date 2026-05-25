# BORJIE Product Requirements Document (PRD)

**Version:** 1.0  
**Status:** Implementation-Ready  
**Last Updated:** 2026-02-12  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Strategy](#2-product-vision--strategy)
3. [Domain Glossary](#3-domain-glossary)
4. [System Architecture Overview](#4-system-architecture-overview)
5. [Product Surfaces](#5-product-surfaces)
6. [Functional Requirements by Module](#6-functional-requirements-by-module)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Acceptance Criteria by Product](#8-acceptance-criteria-by-product)
9. [Data Models](#9-data-models)
10. [Integration Points](#10-integration-points)
11. [Security & Compliance](#11-security--compliance)
12. [KPIs & Success Metrics](#12-kpis--success-metrics)
13. [Release Phases](#13-release-phases)

---

## 1. Executive Summary

### 1.1 Product Overview

**BORJIE** is an AI-native property management platform designed for the East African real estate market. The platform serves four distinct user personas through dedicated product surfaces while maintaining a unified operational backbone.

### 1.2 Core Value Proposition

| Stakeholder | Value Delivered |
|-------------|-----------------|
| **Property Owners/Investors** | Real-time portfolio visibility, automated reporting, optimized NOI |
| **Estate Managers** | Reduced administrative burden, intelligent task prioritization, vendor coordination |
| **Tenants/Customers** | Frictionless service requests, transparent billing, multi-channel communication |
| **Internal Operations** | Centralized control, policy enforcement, audit compliance |

### 1.3 Target Market

- Primary: Tanzania residential and commercial property managers
- Secondary: East African property management companies
- Tertiary: Institutional real estate investors (NHC, pension funds, DFIs)

---

## 2. Product Vision & Strategy

### 2.1 Vision Statement

> To be the operating system for East African property management—where every tenant interaction, maintenance request, and financial transaction flows through an intelligent, compliant, and transparent platform.

### 2.2 Strategic Pillars

1. **Operations-First AI**: Practical automation that saves time, not gimmicks
2. **Multi-Tenant Security**: Strict data isolation from day one
3. **Financial Transparency**: Bank-grade audit trails and reporting
4. **Channel Flexibility**: WhatsApp-first with progressive web/mobile experiences

### 2.3 Product Principles

| Principle | Implementation |
|-----------|----------------|
| **Conversational-First** | All workflows accessible via WhatsApp/Voice before building dedicated UIs |
| **Evidence-Grade** | Every action produces auditable artifacts |
| **Human-in-Loop Safety** | AI suggests; humans approve sensitive actions |
| **Policy-Constrained Automation** | No AI action exceeds defined policy thresholds |

---

## 3. Domain Glossary

### 3.1 Core Entities

| Term | Definition |
|------|------------|
| **Tenant** | The BORJIE SaaS customer organization (property management company, landlord, or institution) |
| **Organization** | Synonym for Tenant in multi-tenant context |
| **Property** | A physical real estate asset (building, compound, or standalone unit) |
| **Unit** | An individual rentable space within a Property |
| **Block** | A logical grouping of Units within a Property (e.g., "Block A") |
| **Customer** | End-user who rents or occupies a Unit (also called "Resident" or "Occupant") |
| **Owner** | The legal owner of a Property; may or may not be the Tenant |
| **Estate Manager** | On-site or regional personnel managing day-to-day operations |

### 3.2 Operational Entities

| Term | Definition |
|------|------------|
| **Lease** | Legal agreement between Owner and Customer for Unit occupancy |
| **Occupancy** | Active tenure of a Customer in a Unit |
| **Work Order** | Formal request for maintenance or service |
| **Vendor** | Third-party service provider (plumber, electrician, cleaner) |
| **Invoice** | Billing document for rent or services owed |
| **Payment Intent** | Record of expected payment before settlement |
| **Ledger Entry** | Immutable financial transaction record |
| **Statement** | Periodic summary of financial activity |

### 3.3 Workflow Entities

| Term | Definition |
|------|------------|
| **Onboarding Checklist** | State machine tracking new Customer setup completion |
| **Procedure** | Step-by-step SOP (e.g., TANESCO token entry) |
| **Case** | Dispute or issue requiring structured resolution |
| **Notice** | Formal communication with legal/compliance implications |
| **Evidence Pack** | Compiled artifacts for dispute resolution or audit |

### 3.4 Intelligence Entities

| Term | Definition |
|------|------------|
| **Friction Fingerprint** | Customer-specific sensitivity profile (noise, repairs, etc.) |
| **Sentiment Score** | Quantified emotional state from communications |
| **Churn Risk Score** | Probability of Customer non-renewal |
| **Payment Risk Score** | Probability of payment default |
| **Vendor Score** | Composite performance rating for service providers |
| **Next Best Action (NBA)** | AI-recommended intervention for a Customer or situation |

### 3.5 System Entities

| Term | Definition |
|------|------------|
| **Policy Constitution** | Configurable rules governing a Property/Tenant |
| **Approval Matrix** | Role-based thresholds for action authorization |
| **SLA** | Service Level Agreement defining response/resolution times |
| **Audit Log** | Immutable record of system actions and approvals |

---

## 4. System Architecture Overview

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATIONS                          │
├─────────────┬─────────────┬─────────────────┬──────────────────────┤
│ Owner Portal│ Admin Portal│  Customer App   │  Estate Manager App  │
│    (Web)    │    (Web)    │  (Mobile/Web)   │    (Mobile/Web)      │
└──────┬──────┴──────┬──────┴────────┬────────┴──────────┬───────────┘
       │             │               │                   │
       └─────────────┴───────────────┴───────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────────┐
│                      EDGE & IDENTITY LAYER                          │
├─────────────────┬─────────────────────┬────────────────────────────┤
│   API Gateway   │   Identity & Access │   Policy Decision Point    │
│     (BFF)       │       (OIDC/JWT)    │      (RBAC + ABAC)        │
└────────┬────────┴──────────┬──────────┴────────────┬───────────────┘
         │                   │                       │
┌────────┴───────────────────┴───────────────────────┴───────────────┐
│                        DOMAIN SERVICES                              │
├──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Tenant & │Customer &│Property &│Maintenance│Payments &│  Messaging  │
│   Org    │  Lease   │   Unit   │& WorkOrder│  Ledger  │& Notif.     │
├──────────┼──────────┼──────────┼──────────┼──────────┼─────────────┤
│ Document │Analytics │ Market   │ Vendor   │  Legal & │ Green &     │
│& E-Sign  │  & KPI   │  Intel   │Performance│ Dispute  │ Utilities   │
└──────────┴──────────┴──────────┴──────────┴──────────┴─────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────────┐
│                         DATA LAYER                                  │
├─────────────┬─────────────┬─────────────┬─────────────┬────────────┤
│Transactional│  Lakehouse  │   Object    │  Event Bus  │ Audit Log  │
│  Postgres   │ & Warehouse │   Storage   │  & Outbox   │   Store    │
└─────────────┴─────────────┴─────────────┴─────────────┴────────────┘
```

### 4.2 Module Mapping

| Module Code | Module Name | Primary Services |
|-------------|-------------|------------------|
| A | Tenant Onboarding & Orientation | Customer & Lease, Document & E-Sign |
| B | Feedback Engine & Engagement | Messaging, Analytics |
| C | AI Personalization Engine | Analytics, Customer & Lease |
| D | Communication Automation | Messaging & Notifications |
| E | Payments, Rent Collection & Accounting | Payments & Ledger |
| F | Maintenance & Asset Tracking | Maintenance & WorkOrder |
| G | Document Intelligence & Identity | Document & E-Sign, Identity |
| J | Reporting & Owner Dashboards | Analytics & KPI |
| K | Renewals, Offboarding & Turnover | Customer & Lease, Property & Unit |
| M | Monetization & Revenue Intelligence | Payments & Ledger, Analytics |
| P | Staff & Vendor Performance | Vendor Performance |
| Q | Legal & Dispute Resolution | Legal & Dispute |
| R | Multi-Property Enterprise Controls | Tenant & Org |

---

## 5. Product Surfaces

### 5.1 Owner Portal (B2B Web Application)

**Target Users:** Property owners, investors, institutional landlords

**Core Capabilities:**
- Portfolio performance dashboards
- Financial statements and disbursements
- Maintenance oversight and approvals
- Document access and e-signatures
- Owner-manager messaging
- Compliance and audit reports

### 5.2 Internal Admin Portal (Web Application)

**Target Users:** BORJIE operations staff, support team, platform administrators

**Core Capabilities:**
- Tenant (customer) onboarding and provisioning
- Role and policy governance
- Operations control tower
- Billing and subscription management
- Support tooling and escalation
- Audit and risk console
- AI operations cockpit

### 5.3 Customer App (Mobile-First PWA)

**Target Users:** Tenants, residents, occupants

**Core Capabilities:**
- Profile and onboarding completion
- Lease documents and e-signatures
- Rent payments and payment history
- Maintenance request lifecycle
- Communication with management
- Notifications and alerts

### 5.4 Estate Manager App (Mobile-First PWA)

**Target Users:** Property managers, field staff, regional managers

**Core Capabilities:**
- Work order management
- Inspection workflows
- Occupancy operations
- Lease lifecycle actions
- Collections workflows
- Vendor coordination
- SLA dashboards and escalations

---

## 6. Functional Requirements by Module

### 6.1 Module A: Tenant Onboarding & Orientation

#### 6.1.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| A0 - Pre-Move-in Setup | Lease pack assembled, identity verified, deposit policy set | All documents collected |
| A1 - Welcome & Channel Setup | Customer selects preferred channel, language preference set | Channel confirmed |
| A2 - Utilities Activation | Water, electricity, internet procedures delivered | Comprehension confirmed |
| A3 - Property Orientation | House rules, repair protocols communicated | Acknowledgment received |
| A4 - Move-In Condition Report | Guided inspection with photos, meter readings, signatures | Dual sign-off complete |
| A5 - Community Context | Local services, approved contacts provided | Information delivered |
| A6 - Onboarding Completion | Badge awarded, first check-in scheduled | Onboarding marked complete |

#### 6.1.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| A-001 | System SHALL support WhatsApp as primary onboarding channel | P0 |
| A-002 | System SHALL extract structured fields from conversational input | P0 |
| A-003 | System SHALL maintain a Procedure Library per property/region | P0 |
| A-004 | System SHALL guide room-by-room move-in inspection with media capture | P0 |
| A-005 | System SHALL require e-signatures from both parties on condition report | P0 |
| A-006 | System SHALL trigger Day 3 and Day 10 check-ins automatically | P1 |
| A-007 | System SHALL generate personalized Welcome Packs | P1 |
| A-008 | System SHALL track procedure completion per Customer | P1 |
| A-009 | System SHALL support voice note transcription in Swahili/English | P1 |
| A-010 | System SHALL escalate to human when identity verification uncertain | P0 |

#### 6.1.3 Data Artifacts Produced

- `TenantProfile` (language, channels, preferences, household)
- `OnboardingChecklist` (state machine + completion timestamps)
- `ProcedureCompletionLog` (which SOPs delivered + confirmation)
- `MoveInConditionReport` (photos, readings, signatures)
- `AccessHandoverRecord` (keys, remotes, lock codes)
- `UtilitySetupRecord` (responsibility, meter refs, notes)

---

### 6.2 Module B: Feedback Engine & Engagement

#### 6.2.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| B0 - Feedback Intake | Multi-channel input received | Structured feedback created |
| B1 - Structuring & Classification | Category, severity, sentiment extracted | Classification complete |
| B2 - Routing & Ownership | Path determined (service/policy/praise) | Owner assigned |
| B3 - Response & Recovery | Auto-acknowledgment, SLA-driven follow-up | Response sent |
| B4 - Verification & Closure | Tenant confirmation requested | Resolution confirmed |
| B5 - Learn & Improve | Clustering and trend analysis | Insights generated |
| B6 - Reputation & Brand | Compliant content generation | Materials produced |

#### 6.2.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| B-001 | System SHALL accept feedback via WhatsApp, voice, app, SMS, email | P0 |
| B-002 | System SHALL transcribe voice notes and retain original audio | P0 |
| B-003 | System SHALL classify feedback by category, severity, urgency | P0 |
| B-004 | System SHALL assign sentiment score and emotion label | P1 |
| B-005 | System SHALL auto-acknowledge feedback within 60 seconds | P0 |
| B-006 | System SHALL track SLA timers for response and resolution | P0 |
| B-007 | System SHALL cluster recurring issues across units/buildings | P1 |
| B-008 | System SHALL execute service recovery playbooks for negative feedback | P1 |
| B-009 | System SHALL obtain explicit consent before using testimonials | P0 |
| B-010 | System SHALL escalate harassment/safety concerns immediately | P0 |

#### 6.2.3 Data Artifacts Produced

- `FeedbackEvent` (raw message, channel, timestamp)
- `FeedbackCase` (category, severity, owner, SLA timers)
- `SentimentScore` + `EmotionLabel`
- `TopicCluster` (theme, frequency, trend)
- `ConsentRecord` (public use permissions)
- `ServiceRecoveryPlaybookRun` (actions executed, outcomes)

---

### 6.3 Module C: AI Personalization Engine

#### 6.3.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| C0 - Consent & Preferences | Capture tenant preferences and consent | Profile initialized |
| C1 - Baseline Initialization | First-week sentiment baseline established | Fingerprint created |
| C2 - Continuous Sensing | Behavioral signals aggregated | Scores updated |
| C3 - Segmentation | Dynamic segment assignment | Segment assigned |
| C4 - Interventions | Personalized actions executed | Action logged |
| C5 - Outcome Measurement | Intervention effectiveness measured | Loop closed |

#### 6.3.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| C-001 | System SHALL build Tenant Preference Profile from onboarding | P0 |
| C-002 | System SHALL create Friction Fingerprint from check-ins | P1 |
| C-003 | System SHALL calculate Payment Risk Score from history | P0 |
| C-004 | System SHALL calculate Churn Risk Score from signals | P1 |
| C-005 | System SHALL generate Next Best Action recommendations | P1 |
| C-006 | System SHALL constrain all offers by Policy Constitution | P0 |
| C-007 | System SHALL maintain fairness audit log for all offers | P0 |
| C-008 | System SHALL calculate Tenant Lifetime Value (LTV) | P2 |
| C-009 | System SHALL personalize channel, timing, and tone | P1 |
| C-010 | System SHALL remember past issues in conversational context | P1 |

#### 6.3.3 Data Artifacts Produced

- `TenantPreferenceProfile`
- `FrictionFingerprint`
- `TenantSegment` (dynamic)
- `RiskScores` (payment, churn, dispute)
- `OfferRecommendation`
- `InterventionLog` + `OutcomeLog`
- `FairnessAuditLog` (inputs + explanation)

---

### 6.4 Module D: Communication Automation

#### 6.4.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| D0 - Channel Setup | Preferred channels and consent configured | Preferences stored |
| D1 - Message Trigger | Time/event/risk/broadcast trigger fired | Message queued |
| D2 - Compliance Check | Policy and approval validation | Approved for send |
| D3 - Generation | Message variants created and personalized | Content ready |
| D4 - Delivery | Multi-channel send with tracking | Delivery confirmed |
| D5 - Outcome Logging | Response and action tracked | Evidence stored |

#### 6.4.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| D-001 | System SHALL support WhatsApp, SMS, email, in-app, voice channels | P0 |
| D-002 | System SHALL generate announcement variants (text, voice, email) | P1 |
| D-003 | System SHALL run policy-based reminder ladders | P0 |
| D-004 | System SHALL execute urgent alert protocols for safety incidents | P0 |
| D-005 | System SHALL convert freeform chat into structured workflows | P1 |
| D-006 | System SHALL track delivery, read, and response status | P0 |
| D-007 | System SHALL respect quiet hours and accessibility preferences | P1 |
| D-008 | System SHALL require manager approval for legal notices | P0 |
| D-009 | System SHALL provide Manager Copilot for difficult messages | P1 |
| D-010 | System SHALL log all communications with timestamps | P0 |

#### 6.4.3 Data Artifacts Produced

- `CommunicationPreference` (channel, language, quiet hours)
- `MessageTemplate` (policy-approved)
- `MessageInstance` (final message + metadata)
- `DeliveryReceipt` (delivered/read/replied)
- `EscalationChainRun`
- `IncidentCase` (for urgent events)
- `ConsentLedger`

---

### 6.5 Module E: Payments, Rent Collection & Accounting

#### 6.5.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| E0 - Billing Setup | Rent terms, channels, thresholds defined | Configuration complete |
| E1 - Invoice Generation | Invoice created with unique reference | Invoice delivered |
| E2 - Payment Intake | Payment received and recorded | Transaction logged |
| E3 - Reconciliation | Payment matched to invoice | Match confirmed |
| E4 - Receipt & Posting | Receipt issued, ledger updated | Status updated |
| E5 - Arrears Management | Collection ladder executed | Action taken |
| E6 - Close & Report | Period closed, statements generated | Reports delivered |

#### 6.5.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| E-001 | System SHALL support M-Pesa, bank transfer, card, cash channels | P0 |
| E-002 | System SHALL generate invoices with unique references | P0 |
| E-003 | System SHALL perform fuzzy matching for reconciliation | P0 |
| E-004 | System SHALL detect payment anomalies (duplicates, mismatches) | P1 |
| E-005 | System SHALL issue receipts automatically upon reconciliation | P0 |
| E-006 | System SHALL maintain immutable ledger entries | P0 |
| E-007 | System SHALL run behavior-aware reminder sequences | P1 |
| E-008 | System SHALL offer policy-compliant payment plans | P1 |
| E-009 | System SHALL generate owner statements and tax packs | P0 |
| E-010 | System SHALL prepare evidence packs for legal escalation | P1 |

#### 6.5.3 Data Artifacts Produced

- `Invoice` (tenant, unit, period, amount, reference, due date)
- `Transaction` (raw payment from gateway/bank)
- `ReconciliationMatch` (confidence score + evidence)
- `LedgerEntry` (double-entry style)
- `Receipt`
- `PaymentPlanAgreement`
- `ArrearsCase`
- `OwnerStatement`

---

### 6.6 Module F: Maintenance & Asset Tracking

#### 6.6.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| F0 - Request Intake | Maintenance request received with evidence | Ticket created |
| F1 - AI Triage | Issue classified, severity assigned | Triage complete |
| F2 - Manager Approval | Approval granted or additional info requested | Approved |
| F3 - Work Order Creation | Formal work order generated | WO assigned ID |
| F4 - Dispatch & Scheduling | Vendor selected, appointment set | Dispatch confirmed |
| F5 - Execution | Work performed, communications coordinated | Work completed |
| F6 - Proof of Completion | Evidence submitted, dual sign-off | Closure confirmed |
| F7 - Closeout | Asset history updated, forecasting triggered | WO closed |

#### 6.6.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| F-001 | System SHALL accept maintenance requests via WhatsApp/voice/app | P0 |
| F-002 | System SHALL classify issue type and severity automatically | P0 |
| F-003 | System SHALL require manager approval before work order creation | P0 |
| F-004 | System SHALL select vendors using composite scoring model | P1 |
| F-005 | System SHALL track SLA timers from creation to resolution | P0 |
| F-006 | System SHALL require before/after photo evidence | P0 |
| F-007 | System SHALL obtain dual sign-off (tenant + technician) | P0 |
| F-008 | System SHALL maintain Unit Health Ledger with repair history | P1 |
| F-009 | System SHALL track materials used and defects returned | P1 |
| F-010 | System SHALL generate predictive maintenance forecasts | P2 |

#### 6.6.3 Data Artifacts Produced

- `MaintenanceRequest`
- `WorkOrder`
- `DispatchEvent`
- `CompletionProof` (photos/videos + notes)
- `DualSignOff`
- `AssetDigitalTwin`
- `UnitHealthLedger`
- `MaterialUsed` + `DefectReturned`
- `ForecastMaintenanceBudget`

---

### 6.7 Module G: Document Intelligence & Identity Verification

#### 6.7.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| G0 - Requirements Setup | Document sets defined per tenant type | Config complete |
| G1 - Collection | Documents uploaded via any channel | Upload received |
| G2 - OCR Extraction | Fields extracted and normalized | Data structured |
| G3 - Validation | Cross-document consistency checked | Validation complete |
| G4 - Fraud Detection | Authenticity verified, risk scored | Decision made |
| G5 - Filing | Document indexed with access controls | Filed |
| G6 - Expiry Tracking | Renewal reminders scheduled | Tracking active |
| G7 - Evidence Pack | Dispute artifacts compiled | Pack generated |

#### 6.7.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| G-001 | System SHALL accept documents via WhatsApp, app, email, scan | P0 |
| G-002 | System SHALL validate image quality and request re-upload | P0 |
| G-003 | System SHALL extract fields via OCR into structured profiles | P0 |
| G-004 | System SHALL cross-check name/ID consistency across documents | P1 |
| G-005 | System SHALL detect tampering and metadata anomalies | P1 |
| G-006 | System SHALL detect duplicate identities across tenants | P1 |
| G-007 | System SHALL assign Verification Badges upon validation | P0 |
| G-008 | System SHALL enforce role-based document access | P0 |
| G-009 | System SHALL track document expiry and trigger reminders | P1 |
| G-010 | System SHALL generate Evidence Packs on demand | P1 |

#### 6.7.3 Data Artifacts Produced

- `DocumentRequirementSet`
- `DocumentUpload`
- `OCRExtraction`
- `IdentityProfile`
- `VerificationBadge`
- `FraudRiskScore`
- `DocumentVersionHistory`
- `AccessAuditLog`
- `ExpiryTracker`
- `EvidencePack`

---

### 6.8 Module J: Reporting, Owner Dashboards & Audit Packs

#### 6.8.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| J0 - Metric Definitions | KPIs, thresholds, role views defined | Governance set |
| J1 - Data Ingestion | Cross-module data pulled and validated | Data ready |
| J2 - Daily Dashboards | Live operational views updated | Dashboards live |
| J3 - Periodic Reports | Weekly/monthly/quarterly packs generated | Reports delivered |
| J4 - Investigations | Root cause analytics triggered | Insights generated |
| J5 - Audit Exports | Evidence bundles compiled | Packs exported |

#### 6.8.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| J-001 | System SHALL generate daily Morning Briefing summaries | P1 |
| J-002 | System SHALL provide root cause explanations for KPI changes | P1 |
| J-003 | System SHALL generate monthly Owner Packs with financials | P0 |
| J-004 | System SHALL compile one-click Audit Packs by tenant/unit/time | P0 |
| J-005 | System SHALL support read-only Data Room mode for investors | P2 |
| J-006 | System SHALL provide actionable dashboards with workflow buttons | P1 |
| J-007 | System SHALL track data provenance for all reported metrics | P1 |
| J-008 | System SHALL export to Excel/CSV/PDF formats | P0 |
| J-009 | System SHALL generate AI-written narrative summaries | P2 |
| J-010 | System SHALL maintain report version history | P1 |

#### 6.8.3 Data Artifacts Produced

- `KPIRegistry` (definitions + thresholds)
- `DataSnapshot`
- `ReportTemplate`
- `ReportInstance` (versioned)
- `EvidencePack` (linked index + integrity hash)
- `AccessLog`
- `ExceptionAlert`
- `ActionRecommendation`

---

### 6.9 Module K: Renewals, Offboarding & Turnover Intelligence

#### 6.9.1 State Machine

| State | Description | Exit Criteria |
|-------|-------------|---------------|
| K0 - Renewal Detection | Lease end date detected, window triggered | Process initiated |
| K1 - Risk Scoring | Churn probability and drivers calculated | Score available |
| K2 - Offer Generation | Renewal options drafted with rationale | Options ready |
| K3 - Move-Out Notice | Non-renewal processed, procedures sent | Notice confirmed |
| K4 - Pre-Move-Out Prep | Checklist delivered, inspection scheduled | Ready |
| K5 - Move-Out Inspection | Evidence comparison with move-in | Report generated |
| K6 - Deposit Settlement | Deductions itemized, dispute handling | Settlement complete |
| K7 - Turnover Orders | Cleaning/repair work orders created | Turnover started |
| K8 - Relet Launch | Listing generated, viewings scheduled | Unit marketed |

#### 6.9.2 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| K-001 | System SHALL detect lease expiry at T-90/60/30 days | P0 |
| K-002 | System SHALL calculate renewal probability with drivers | P1 |
| K-003 | System SHALL generate multi-option renewal strategies | P1 |
| K-004 | System SHALL process move-out notice via conversation | P0 |
| K-005 | System SHALL guide evidence-grade move-out inspection | P0 |
| K-006 | System SHALL compare move-out vs move-in condition | P0 |
| K-007 | System SHALL generate itemized deposit deductions with evidence | P0 |
| K-008 | System SHALL auto-create turnover work orders | P1 |
| K-009 | System SHALL generate optimized listing packs | P2 |
| K-010 | System SHALL handle deposit disputes via Module Q | P0 |

#### 6.9.3 Data Artifacts Produced

- `RenewalWindow`
- `ChurnRiskScore` + `Drivers`
- `RenewalOffer` + `ApprovalLog`
- `MoveOutNotice`
- `MoveOutChecklistCompletion`
- `InspectionReport` (move-in + move-out link)
- `DepositSettlement` + `DisputeFlag`
- `TurnoverPipeline`
- `ListingPack`

---

### 6.10 Module M: Monetization & Revenue Intelligence

#### 6.10.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| M-001 | System SHALL detect revenue leakage (unbilled fees, missed charges) | P1 |
| M-002 | System SHALL recommend value-add upsells based on segment | P2 |
| M-003 | System SHALL optimize renewal pricing with churn impact | P1 |
| M-004 | System SHALL minimize vacancy loss via turnover speed | P1 |
| M-005 | System SHALL calculate cost-to-serve per tenant/unit | P2 |
| M-006 | System SHALL enforce fee governance with evidence gates | P0 |
| M-007 | System SHALL track NOI impact of monetization actions | P1 |
| M-008 | System SHALL provide SaaS pricing intelligence for self-service | P2 |

---

### 6.11 Module P: Staff & Vendor Performance

#### 6.11.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| P-001 | System SHALL onboard vendors with identity and license verification | P0 |
| P-002 | System SHALL recommend vendors using composite scoring | P1 |
| P-003 | System SHALL enforce SLA acceptance windows with auto-escalation | P0 |
| P-004 | System SHALL audit evidence quality for ghost work detection | P1 |
| P-005 | System SHALL validate invoices against rate cards | P1 |
| P-006 | System SHALL generate vendor performance scorecards | P1 |
| P-007 | System SHALL deliver coaching nudges to underperforming vendors | P2 |
| P-008 | System SHALL maintain preferred vendor bench with coverage map | P1 |

---

### 6.12 Module Q: Legal & Dispute Resolution

#### 6.12.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| Q-001 | System SHALL auto-create Case when dispute thresholds hit | P0 |
| Q-002 | System SHALL classify case by type and severity | P0 |
| Q-003 | System SHALL compile evidence timeline automatically | P0 |
| Q-004 | System SHALL generate compliant notice templates | P0 |
| Q-005 | System SHALL require manager approval for legal notices | P0 |
| Q-006 | System SHALL log proof of notice delivery | P0 |
| Q-007 | System SHALL provide deposit dispute resolution workflow | P0 |
| Q-008 | System SHALL escalate safety/harassment cases immediately | P0 |
| Q-009 | System SHALL maintain policy-approved knowledge base | P1 |
| Q-010 | System SHALL export case files as legal evidence packs | P0 |

---

### 6.13 Module R: Multi-Property Enterprise Controls

#### 6.13.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| R-001 | System SHALL support hierarchical org structure (Region→Property→Unit) | P0 |
| R-002 | System SHALL enforce policy inheritance with local overrides | P1 |
| R-003 | System SHALL implement delegated approval matrix | P0 |
| R-004 | System SHALL provide regional command center dashboards | P1 |
| R-005 | System SHALL enable cross-property benchmarking | P2 |
| R-006 | System SHALL support enterprise data room mode | P2 |
| R-007 | System SHALL detect anomalous manager behavior patterns | P2 |

---

## 7. Non-Functional Requirements

### 7.1 Performance

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| API response time (p95) | < 500ms | APM monitoring |
| WhatsApp message processing | < 3 seconds | End-to-end latency |
| Dashboard load time | < 2 seconds | Real User Monitoring |
| Report generation | < 30 seconds | Job duration |
| Concurrent users per tenant | 100+ | Load testing |

### 7.2 Availability

| Requirement | Target | Notes |
|-------------|--------|-------|
| Platform uptime | 99.5% | Monthly SLA |
| Planned maintenance window | < 4 hours/month | Scheduled notification |
| RTO (Recovery Time Objective) | < 4 hours | Disaster recovery |
| RPO (Recovery Point Objective) | < 1 hour | Data loss tolerance |

### 7.3 Scalability

| Requirement | Target | Notes |
|-------------|--------|-------|
| Tenants supported | 1,000+ | Multi-tenant isolation |
| Units per tenant | 10,000+ | Large institutional |
| Messages per day per tenant | 50,000+ | WhatsApp throughput |
| Concurrent report generation | 50+ | Queue-based |

### 7.4 Security

| Requirement | Implementation |
|-------------|----------------|
| Authentication | OIDC/OAuth 2.0 with MFA support |
| Authorization | RBAC + ABAC with centralized policy decision |
| Data encryption at rest | AES-256 |
| Data encryption in transit | TLS 1.3 |
| Tenant data isolation | Row-level security, separate encryption keys |
| Audit logging | Immutable, tamper-evident logs |
| Session management | Secure tokens, configurable timeout |

### 7.5 Compliance

| Requirement | Implementation |
|-------------|----------------|
| Data residency | Regional deployment support (East Africa) |
| Data retention | Configurable per tenant, policy-enforced |
| GDPR-style rights | Data export, deletion workflows |
| Financial audit trail | Immutable ledger, dual-control for adjustments |
| Document retention | Configurable per document type |

---

## 8. Acceptance Criteria by Product

### 8.1 Owner Portal Acceptance Criteria

#### 8.1.1 Authentication & Access

| ID | Criteria | Verification |
|----|----------|--------------|
| OP-AC-001 | Owner can register and complete MFA setup | E2E test: registration flow |
| OP-AC-002 | Owner sees only properties they own/manage | E2E test: data isolation |
| OP-AC-003 | Owner can invite co-owners with role assignment | E2E test: invitation flow |
| OP-AC-004 | Session expires after configurable inactivity | E2E test: timeout behavior |

#### 8.1.2 Portfolio Dashboard

| ID | Criteria | Verification |
|----|----------|--------------|
| OP-AC-010 | Dashboard displays total portfolio value, occupancy rate, collection rate | E2E test: metric accuracy |
| OP-AC-011 | Dashboard updates within 5 minutes of underlying data change | E2E test: data freshness |
| OP-AC-012 | Owner can filter by property, date range, unit type | E2E test: filter functionality |
| OP-AC-013 | Dashboard displays arrears aging buckets (0-7, 8-14, 15-30, 31-60, 60+) | E2E test: bucket calculation |
| OP-AC-014 | Click on any metric drills down to detail view | E2E test: navigation |

#### 8.1.3 Financial Statements

| ID | Criteria | Verification |
|----|----------|--------------|
| OP-AC-020 | Owner can view monthly income statement by property | E2E test: statement generation |
| OP-AC-021 | Statement shows rent collected, fees, expenses, net income | E2E test: line item accuracy |
| OP-AC-022 | Owner can download statement as PDF or Excel | E2E test: export functionality |
| OP-AC-023 | Statement includes transaction-level detail with references | E2E test: drill-down |
| OP-AC-024 | Owner can view disbursement history and pending amounts | E2E test: disbursement display |

#### 8.1.4 Maintenance Oversight

| ID | Criteria | Verification |
|----|----------|--------------|
| OP-AC-030 | Owner can view all work orders by status (open, in-progress, closed) | E2E test: status filtering |
| OP-AC-031 | Work order detail shows timeline, evidence, costs | E2E test: detail view |
| OP-AC-032 | Owner can approve work orders above threshold via portal | E2E test: approval workflow |
| OP-AC-033 | Owner receives notification for urgent maintenance | E2E test: notification delivery |
| OP-AC-034 | Owner can view maintenance cost trends by category | E2E test: trend visualization |

#### 8.1.5 Document Access

| ID | Criteria | Verification |
|----|----------|--------------|
| OP-AC-040 | Owner can view all property documents (leases, reports, notices) | E2E test: document listing |
| OP-AC-041 | Owner can download documents individually or as bundle | E2E test: download functionality |
| OP-AC-042 | Owner can e-sign documents requiring owner signature | E2E test: e-sign workflow |
| OP-AC-043 | Document versions are tracked with change history | E2E test: version display |

#### 8.1.6 Messaging

| ID | Criteria | Verification |
|----|----------|--------------|
| OP-AC-050 | Owner can send messages to estate manager via portal | E2E test: message send |
| OP-AC-051 | Owner can view conversation history with timestamps | E2E test: history display |
| OP-AC-052 | Owner receives email notification for new messages | E2E test: notification delivery |

---

### 8.2 Internal Admin Portal Acceptance Criteria

#### 8.2.1 Tenant Management

| ID | Criteria | Verification |
|----|----------|--------------|
| AP-AC-001 | Admin can create new tenant organization | E2E test: tenant creation |
| AP-AC-002 | Admin can configure tenant's Policy Constitution | E2E test: policy setup |
| AP-AC-003 | Admin can assign subscription plan to tenant | E2E test: billing setup |
| AP-AC-004 | Admin can view tenant's usage metrics | E2E test: usage display |
| AP-AC-005 | Admin can suspend/reactivate tenant account | E2E test: status toggle |

#### 8.2.2 User & Role Management

| ID | Criteria | Verification |
|----|----------|--------------|
| AP-AC-010 | Admin can create custom roles with permission sets | E2E test: role creation |
| AP-AC-011 | Admin can assign users to roles within tenant | E2E test: assignment |
| AP-AC-012 | Admin can view audit log of permission changes | E2E test: audit display |
| AP-AC-013 | Admin can configure approval matrices per tenant | E2E test: matrix setup |

#### 8.2.3 Operations Control Tower

| ID | Criteria | Verification |
|----|----------|--------------|
| AP-AC-020 | Admin can view cross-tenant system health metrics | E2E test: health dashboard |
| AP-AC-021 | Admin can view exception queue (failed payments, reconciliation issues) | E2E test: queue display |
| AP-AC-022 | Admin can intervene in stuck workflows | E2E test: intervention action |
| AP-AC-023 | Admin can view AI decision logs with explanations | E2E test: AI audit trail |

#### 8.2.4 Support Tooling

| ID | Criteria | Verification |
|----|----------|--------------|
| AP-AC-030 | Admin can search customers across tenants (with authorization) | E2E test: search functionality |
| AP-AC-031 | Admin can view customer's full activity timeline | E2E test: timeline display |
| AP-AC-032 | Admin can escalate cases to specialized teams | E2E test: escalation workflow |
| AP-AC-033 | Admin can impersonate user for troubleshooting (with audit) | E2E test: impersonation + logging |

#### 8.2.5 Billing & Subscription

| ID | Criteria | Verification |
|----|----------|--------------|
| AP-AC-040 | Admin can view all tenant invoices and payment status | E2E test: billing dashboard |
| AP-AC-041 | Admin can apply credits or adjustments with approval | E2E test: adjustment workflow |
| AP-AC-042 | Admin can generate usage reports for billing reconciliation | E2E test: usage report |

---

### 8.3 Customer App Acceptance Criteria

#### 8.3.1 Onboarding

| ID | Criteria | Verification |
|----|----------|--------------|
| CA-AC-001 | Customer can complete registration via WhatsApp link | E2E test: WhatsApp → App flow |
| CA-AC-002 | Customer can upload ID documents via camera or gallery | E2E test: document upload |
| CA-AC-003 | Customer receives real-time feedback on document quality | E2E test: quality validation |
| CA-AC-004 | Customer can complete move-in inspection with guided prompts | E2E test: inspection flow |
| CA-AC-005 | Customer can e-sign lease and condition report | E2E test: e-sign completion |
| CA-AC-006 | Customer sees onboarding progress indicator | E2E test: progress display |
| CA-AC-007 | Customer receives Welcome Pack upon completion | E2E test: pack delivery |

#### 8.3.2 Payments

| ID | Criteria | Verification |
|----|----------|--------------|
| CA-AC-010 | Customer can view current balance and due date | E2E test: balance display |
| CA-AC-011 | Customer can pay via M-Pesa with one-click | E2E test: M-Pesa integration |
| CA-AC-012 | Customer can pay via bank transfer with reference display | E2E test: bank instructions |
| CA-AC-013 | Customer receives instant receipt upon payment confirmation | E2E test: receipt delivery |
| CA-AC-014 | Customer can view full payment history | E2E test: history display |
| CA-AC-015 | Customer can request payment plan via chat | E2E test: plan request |
| CA-AC-016 | Customer receives reminder notifications before due date | E2E test: reminder delivery |

#### 8.3.3 Maintenance Requests

| ID | Criteria | Verification |
|----|----------|--------------|
| CA-AC-020 | Customer can submit request via app with description | E2E test: request submission |
| CA-AC-021 | Customer can attach photos/videos to request | E2E test: media attachment |
| CA-AC-022 | Customer can submit request via WhatsApp voice note | E2E test: voice transcription |
| CA-AC-023 | Customer receives estimated response time upon submission | E2E test: SLA display |
| CA-AC-024 | Customer receives updates at each status change | E2E test: status notifications |
| CA-AC-025 | Customer can confirm or dispute completion | E2E test: sign-off flow |
| CA-AC-026 | Customer can rate service after completion | E2E test: rating submission |

#### 8.3.4 Documents & Lease

| ID | Criteria | Verification |
|----|----------|--------------|
| CA-AC-030 | Customer can view signed lease document | E2E test: document display |
| CA-AC-031 | Customer can view house rules and procedures | E2E test: content display |
| CA-AC-032 | Customer receives notification when renewal offer available | E2E test: notification delivery |
| CA-AC-033 | Customer can accept renewal via app | E2E test: acceptance flow |
| CA-AC-034 | Customer can submit move-out notice via app | E2E test: notice submission |

#### 8.3.5 Communication

| ID | Criteria | Verification |
|----|----------|--------------|
| CA-AC-040 | Customer can message management via in-app chat | E2E test: chat functionality |
| CA-AC-041 | Customer receives announcements in notification center | E2E test: announcement display |
| CA-AC-042 | Customer can set notification preferences | E2E test: preference settings |
| CA-AC-043 | All communications sync between WhatsApp and app | E2E test: cross-channel sync |

---

### 8.4 Estate Manager App Acceptance Criteria

#### 8.4.1 Work Order Management

| ID | Criteria | Verification |
|----|----------|--------------|
| EM-AC-001 | Manager can view all work orders by status with filters | E2E test: list display |
| EM-AC-002 | Manager can view work order detail with full evidence | E2E test: detail view |
| EM-AC-003 | Manager can approve or request more info on pending orders | E2E test: approval action |
| EM-AC-004 | Manager can assign vendor from recommended list | E2E test: assignment action |
| EM-AC-005 | Manager can override AI vendor recommendation with reason | E2E test: override + logging |
| EM-AC-006 | Manager receives alert for SLA breach risk | E2E test: alert delivery |
| EM-AC-007 | Manager can close work order with dual sign-off verification | E2E test: closure flow |

#### 8.4.2 Inspection Workflows

| ID | Criteria | Verification |
|----|----------|--------------|
| EM-AC-010 | Manager can initiate move-in inspection for new customer | E2E test: initiation |
| EM-AC-011 | Manager can conduct inspection with guided checklist | E2E test: checklist flow |
| EM-AC-012 | Manager can capture photos with automatic tagging | E2E test: media capture |
| EM-AC-013 | Manager can record meter readings with validation | E2E test: reading capture |
| EM-AC-014 | Manager can complete inspection with customer signature | E2E test: sign-off |
| EM-AC-015 | Manager can initiate move-out inspection with baseline comparison | E2E test: comparison display |

#### 8.4.3 Occupancy Operations

| ID | Criteria | Verification |
|----|----------|--------------|
| EM-AC-020 | Manager can view occupancy status of all units | E2E test: occupancy dashboard |
| EM-AC-021 | Manager can update unit status (occupied, vacant, turnover) | E2E test: status update |
| EM-AC-022 | Manager can view customer profile with all relevant details | E2E test: profile display |
| EM-AC-023 | Manager can initiate customer onboarding workflow | E2E test: onboarding start |

#### 8.4.4 Collections Workflows

| ID | Criteria | Verification |
|----|----------|--------------|
| EM-AC-030 | Manager can view arrears list with aging | E2E test: arrears display |
| EM-AC-031 | Manager can send reminder via app (routes to customer's channel) | E2E test: reminder send |
| EM-AC-032 | Manager can approve payment plan within policy limits | E2E test: plan approval |
| EM-AC-033 | Manager can escalate to legal workflow with evidence | E2E test: escalation action |
| EM-AC-034 | Manager can waive fees within approval authority | E2E test: waiver action |

#### 8.4.5 Vendor Coordination

| ID | Criteria | Verification |
|----|----------|--------------|
| EM-AC-040 | Manager can view vendor performance scorecards | E2E test: scorecard display |
| EM-AC-041 | Manager can contact vendor via integrated messaging | E2E test: messaging |
| EM-AC-042 | Manager can approve vendor invoices within threshold | E2E test: approval action |
| EM-AC-043 | Manager can flag vendor for review with reason | E2E test: flag action |

#### 8.4.6 SLA Dashboards

| ID | Criteria | Verification |
|----|----------|--------------|
| EM-AC-050 | Manager can view SLA compliance metrics by category | E2E test: metric display |
| EM-AC-051 | Manager can view at-risk items requiring attention | E2E test: risk list |
| EM-AC-052 | Manager can drill down from metric to individual items | E2E test: drill-down |
| EM-AC-053 | Manager receives daily briefing summary | E2E test: briefing delivery |

---

## 9. Data Models

### 9.1 Core Domain Model Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TENANT DOMAIN                               │
├─────────────────────────────────────────────────────────────────────┤
│  Tenant ──< User ──< Role                                           │
│    │                                                                │
│    └──< Property ──< Block ──< Unit ──< Asset                      │
│              │                    │                                 │
│              └──< PolicyConstitution                                │
│                                   │                                 │
│                                   └──< Lease ──< Occupancy         │
│                                          │                          │
│                                          └── Customer               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       FINANCIAL DOMAIN                              │
├─────────────────────────────────────────────────────────────────────┤
│  Invoice ──< PaymentIntent ──< Transaction ──< LedgerEntry         │
│     │              │                                                │
│     └── Receipt    └── ReconciliationMatch                         │
│                                                                     │
│  PaymentPlanAgreement ──< Statement ──< OwnerAccount               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      OPERATIONS DOMAIN                              │
├─────────────────────────────────────────────────────────────────────┤
│  MaintenanceRequest ──< WorkOrder ──< DispatchEvent                │
│         │                    │              │                       │
│         └── Evidence         └── CompletionProof                   │
│                                      │                              │
│  Vendor ──< VendorScorecard         └── DualSignOff                │
│     │                                                               │
│     └──< Assignment                                                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      INTELLIGENCE DOMAIN                            │
├─────────────────────────────────────────────────────────────────────┤
│  Customer ──< TenantPreferenceProfile                              │
│     │           │                                                   │
│     │           └── FrictionFingerprint                            │
│     │                                                               │
│     └──< RiskScore (payment, churn, dispute)                       │
│     │                                                               │
│     └──< TenantSegment                                             │
│                                                                     │
│  NextBestAction ──< InterventionLog ──< OutcomeLog                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        LEGAL DOMAIN                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Case ──< TimelineEvent ──< EvidenceAttachment                     │
│    │                                                                │
│    └──< Notice ──< NoticeServiceReceipt                            │
│    │                                                                │
│    └──< ResolutionProposal ──< SettlementAgreement                 │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 Entity Definitions

| Entity | Key Attributes | Relationships |
|--------|----------------|---------------|
| `Tenant` | id, name, plan, status, createdAt | has many Properties, Users |
| `User` | id, email, phone, tenantId, roleId | belongs to Tenant, Role |
| `Role` | id, name, permissions[] | has many Users |
| `Property` | id, tenantId, name, address, type | belongs to Tenant, has many Units |
| `Unit` | id, propertyId, blockId, number, status | belongs to Property, has Lease |
| `Customer` | id, tenantId, firstName, lastName, idNumber | has Lease, PreferenceProfile |
| `Lease` | id, unitId, customerId, startDate, endDate, rentAmount | belongs to Unit, Customer |
| `Invoice` | id, leaseId, amount, dueDate, status, reference | belongs to Lease |
| `WorkOrder` | id, unitId, category, status, slaDeadline | belongs to Unit, has Vendor assignment |
| `Vendor` | id, tenantId, name, specializations[], status | has many Assignments |
| `Case` | id, type, severity, status, customerId | belongs to Customer |

---

## 10. Integration Points

### 10.1 External Integrations

| System | Purpose | Protocol | Priority |
|--------|---------|----------|----------|
| WhatsApp Business API | Primary customer communication | REST/Webhooks | P0 |
| M-Pesa API | Mobile money payments | REST | P0 |
| Bank APIs (NMB, CRDB) | Bank transfers, reconciliation | REST/SFTP | P1 |
| SMS Gateway (Africa's Talking) | Fallback communication | REST | P1 |
| Email (SendGrid/SES) | Formal communications, reports | REST | P1 |
| Cloud Storage (S3/GCS) | Document and media storage | SDK | P0 |
| OCR Service (Textract/Vision) | Document processing | SDK | P1 |

### 10.2 Internal Service Interfaces

| Service | Exposes | Consumes |
|---------|---------|----------|
| Identity Service | Auth tokens, user profiles | — |
| Customer Service | Customer CRUD, onboarding status | Identity, Document |
| Property Service | Property/Unit CRUD, occupancy | Tenant |
| Payments Service | Invoice, transaction, reconciliation | Customer, Property |
| Maintenance Service | Work orders, dispatch | Customer, Property, Vendor |
| Document Service | Upload, OCR, verification | Customer, Storage |
| Messaging Service | Send/receive messages | Customer, Templates |
| Analytics Service | KPIs, reports | All services |

---

## 11. Security & Compliance

### 11.1 Authentication Requirements

| Requirement | Implementation |
|-------------|----------------|
| Multi-factor authentication | TOTP or SMS for admin/owner roles |
| Session management | JWT with refresh tokens, configurable expiry |
| Password policy | Minimum 12 characters, complexity requirements |
| Account lockout | 5 failed attempts → 15-minute lockout |
| SSO support | SAML 2.0 / OIDC for enterprise tenants |

### 11.2 Authorization Model

| Level | Mechanism | Example |
|-------|-----------|---------|
| Tenant isolation | Row-level security | User can only access own tenant's data |
| Role-based (RBAC) | Permission sets | "Estate Manager" can approve work orders |
| Attribute-based (ABAC) | Policy rules | "Can approve invoices up to $1000" |
| Resource-level | Ownership check | "Owner can only see their properties" |

### 11.3 Audit Requirements

| Event Type | Logged Fields | Retention |
|------------|---------------|-----------|
| Authentication | userId, timestamp, IP, success/fail | 2 years |
| Data access | userId, resource, action, timestamp | 1 year |
| Data modification | userId, resource, before/after, timestamp | 7 years |
| Financial transactions | All fields, immutable | 10 years |
| Approvals | approverId, decision, reason, timestamp | 7 years |

### 11.4 Data Protection

| Requirement | Implementation |
|-------------|----------------|
| Encryption at rest | AES-256, tenant-specific keys |
| Encryption in transit | TLS 1.3 |
| PII handling | Masked in logs, encrypted storage |
| Data export | Customer-initiated, structured format |
| Data deletion | Soft delete, hard delete after retention |
| Backup | Daily automated, encrypted, geo-redundant |

---

## 12. KPIs & Success Metrics

### 12.1 Platform KPIs

| KPI | Target | Measurement |
|-----|--------|-------------|
| Tenant activation rate | > 80% | Tenants completing onboarding / signed |
| Daily active users | > 60% | Unique logins / total users |
| API error rate | < 0.1% | Failed requests / total requests |
| Support ticket volume | < 5/tenant/month | Tickets opened |

### 12.2 Module-Specific KPIs

| Module | KPI | Target |
|--------|-----|--------|
| A - Onboarding | Completion rate | > 95% |
| A - Onboarding | Time-to-operational | < 48 hours |
| B - Feedback | Response rate to check-ins | > 70% |
| B - Feedback | Time to first response | < 4 hours |
| E - Payments | Collection rate (by due date) | > 85% |
| E - Payments | Auto-reconciliation rate | > 90% |
| F - Maintenance | First-time fix rate | > 80% |
| F - Maintenance | Mean time to resolution | < 48 hours |
| K - Renewals | Renewal rate | > 75% |
| K - Renewals | Vacancy days | < 14 days |
| Q - Disputes | Resolution without escalation | > 90% |

### 12.3 Business Outcome KPIs

| KPI | Calculation | Target |
|-----|-------------|--------|
| NOI improvement | (Post-NOI - Pre-NOI) / Pre-NOI | > 10% |
| Admin hours saved | (Pre-hours - Post-hours) / tenant | > 20 hours/month |
| Tenant NPS | Net Promoter Score survey | > 40 |
| Customer (resident) NPS | Net Promoter Score survey | > 30 |

---

## 13. Release Phases

### Phase 0: Foundation (Sprint 1)

**Objective:** Establish implementation-ready documentation and architecture baseline

**Deliverables:**
- [x] Implementation-ready PRD (this document)
- [ ] Architecture Decision Records (ADRs)
- [ ] API contract definitions (OpenAPI)
- [ ] Database schema design
- [ ] CI/CD pipeline setup

**Exit Criteria:**
- All stakeholders sign off on PRD
- Architecture reviewed and approved
- Development environment operational

---

### Phase 1: Multi-Tenant Core Platform (Sprints 2-4)

**Objective:** Secure backbone enabling all four apps

**Deliverables:**
- Tenant/Organization model with RBAC
- Authentication stack (OIDC, JWT, MFA)
- Policy decision point integration
- Audit logging infrastructure
- Event bus with outbox pattern
- Observability stack (logs, metrics, traces)

**Acceptance Criteria:**
- AP-AC-001 through AP-AC-013 passing
- Tenant isolation verified via security testing
- < 500ms API response time achieved

---

### Phase 2: Payments, Ledger, and Financial Truth (Sprints 5-7)

**Objective:** Reliable money movement and reporting

**Deliverables:**
- Payment orchestration (M-Pesa, bank)
- Immutable ledger implementation
- Invoice generation and delivery
- Reconciliation engine
- Statement generation
- Disbursement workflows

**Acceptance Criteria:**
- E-001 through E-010 passing
- 90%+ auto-reconciliation rate
- Owner statements accurate within 0.01%

---

### Phase 3: Owner Portal + Admin MVP (Sprints 8-11)

**Objective:** B2B value realization and internal control

**Deliverables:**
- Owner Portal: Dashboard, statements, documents, messaging
- Admin Portal: Tenant management, user/role governance, support tooling
- Self-serve analytics widgets
- Export functionality

**Acceptance Criteria:**
- All OP-AC-* criteria passing
- All AP-AC-* criteria passing
- < 2 second dashboard load time

---

### Phase 4: Customer App + Estate Manager App MVP (Sprints 12-16)

**Objective:** Full ecosystem operating loop

**Deliverables:**
- Customer App: Onboarding, payments, maintenance, communication
- Estate Manager App: Work orders, inspections, collections, vendor coordination
- WhatsApp integration for all workflows
- Offline-capable field operations

**Acceptance Criteria:**
- All CA-AC-* criteria passing
- All EM-AC-* criteria passing
- WhatsApp message processing < 3 seconds

---

### Phase 5: Intelligence and Automation Layer (Sprints 17-20)

**Objective:** Measurable productivity uplift

**Deliverables:**
- AI copilots for maintenance triage
- Owner reporting summaries
- Predictive risk signals (arrears, churn, maintenance)
- Next Best Action engine
- Governed prompt library

**Acceptance Criteria:**
- Churn prediction accuracy > 70%
- Maintenance triage accuracy > 85%
- Human-in-loop for all sensitive decisions

---

### Phase 6: Enterprise Hardening (Sprints 21-24)

**Objective:** Scale-ready SaaS posture

**Deliverables:**
- Security hardening (penetration testing, SOC 2 controls)
- Performance optimization
- Multi-region readiness
- Disaster recovery validation
- Enterprise modules (custom workflows, API marketplace)

**Acceptance Criteria:**
- Security audit passed
- 99.5% uptime demonstrated
- Recovery drill completed successfully
- Enterprise pilot tenant onboarded

---

## Appendix A: Glossary Cross-Reference

| Spec Term | PRD Term | Notes |
|-----------|----------|-------|
| Boss Nyumba (AI) | BORJIE Platform | AI capabilities embedded throughout |
| Tenant (in spec) | Customer | "Tenant" reserved for SaaS customer |
| Module A | Onboarding Service | Mapped to Customer & Lease domain |
| Property Constitution | Policy Constitution | Configurable rules engine |

## Appendix B: Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-12 | System | Initial PRD creation from spec |

---

*This PRD is a living document. Updates require review by Product Council.*
