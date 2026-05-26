# GDPR Article 30 — Record of Processing Activities

> Per GDPR Article 30, every controller and processor must maintain a
> record of processing activities. This document is Borjie's
> RoPA (controller view for first-party data + processor view for
> tenant-owned data). It serves dual purpose: the equivalent
> requirement under TZ PDPA 2022 Article 19(c) is met by the same
> record.

Last review: 2026-05-18. Custodian: DPO (dpo@borjie.com).

---

## A. Controller information

| Field | Value |
|---|---|
| Name | Borjie Ltd (UR will be filled at registration) |
| Registration | TZ Companies Act registration #TBD |
| Registered office | Dar es Salaam, Tanzania |
| DPO contact | dpo@borjie.com |
| EU representative (if appointed) | n/a — no EU establishment as of 2026-Q2 |

## B. Processing activities

Each row is one processing activity. Add a row when introducing a
new data category, purpose, recipient, or retention period.

### Activity 1 — Customer account management

| Field | Value |
|---|---|
| Purpose | Account creation, authentication, profile management |
| Categories of subjects | Customers (tenants of property owners) |
| Categories of data | Name, email, phone, date of birth, national ID |
| Recipients | Internal staff (need-to-know), tenant property owner |
| Cross-border transfers | None (data resident in `af-south-1`) |
| Retention | Account lifetime + 7 years (TZ tax law) |
| Security measures | Field encryption (CC6.1), RBAC + RLS |

### Activity 2 — Property management

| Field | Value |
|---|---|
| Purpose | Lease management, rent collection, inspections |
| Categories of subjects | Property owners, customers, estate managers |
| Categories of data | Address, lease terms, payment history, inspection notes |
| Recipients | Tenant property owner, tenant estate manager |
| Cross-border transfers | None |
| Retention | Contract duration + 7 years |
| Security measures | TLS, audit hash-chain, four-eye approval on destructive ops |

### Activity 3 — Payment processing

| Field | Value |
|---|---|
| Purpose | Rent collection, disbursement, fee collection |
| Categories of subjects | Customers, property owners |
| Categories of data | Payment amount, currency, payment method id, mobile-money number |
| Recipients | Stripe (card payments), M-Pesa, TigoPesa, Airtel, GePG |
| Cross-border transfers | Stripe (US) — under SCC + DPA on file |
| Retention | 10 years (financial records, TZ tax + audit) |
| Security measures | Immutable payments-ledger, field encryption on payer details |

### Activity 4 — AI-assisted operations (the Brain)

| Field | Value |
|---|---|
| Purpose | Conversational property-management assistance, negotiations, document drafting |
| Categories of subjects | All authenticated users |
| Categories of data | Conversation transcripts, action-audit, tool inputs/outputs |
| Recipients | AI providers (Anthropic, OpenAI, DeepSeek) — under DPA |
| Cross-border transfers | Anthropic/OpenAI (US) — under SCC; DeepSeek (CN) — flagged risk, optional |
| Retention | Per kernel-memory tier: episodic 90 days, semantic 2 years, reflective 5 years |
| Security measures | Tenant isolation, prompt shield, PII scrubber pre-send, persona-drift detection |

### Activity 5 — KYC & regulatory compliance

| Field | Value |
|---|---|
| Purpose | Identity verification, credit checks, regulatory reporting |
| Categories of subjects | Customers, property owners |
| Categories of data | NIDA verification result, CRB credit score, KYC document images |
| Recipients | NIDA (TZ gov), CRB, BRELA, TRA |
| Cross-border transfers | None |
| Retention | 7 years (regulatory minimum) |
| Security measures | Encrypted at rest, no LLM transmission, sealed audit log |

### Activity 6 — Marketing & customer communications

| Field | Value |
|---|---|
| Purpose | Transactional notifications, marketing (consent-based) |
| Categories of subjects | All authenticated users |
| Categories of data | Email, phone, communication preferences, opt-out status |
| Recipients | Resend (email), Twilio (SMS/WhatsApp), Meta WhatsApp Cloud |
| Cross-border transfers | Resend (US/EU), Twilio (US), Meta (US) — under SCC |
| Retention | Communication preferences indefinite; transactional history 7 years |
| Security measures | Marketing opt-out enforced; per-recipient throttle |

### Activity 7 — Security & audit

| Field | Value |
|---|---|
| Purpose | Fraud detection, audit-log integrity, regulatory compliance |
| Categories of subjects | All users (audit subjects), bad actors (fraud subjects) |
| Categories of data | IP addresses, action audit trail, session-replay chunks |
| Recipients | Internal security team, regulators (on request) |
| Cross-border transfers | None |
| Retention | Audit trail 7 years; session replay 30 days |
| Security measures | Audit hash-chain, immutable storage, four-eye on access |

## C. Joint-controller arrangements

Where Borjie acts as processor on behalf of tenant property
owners (their customer data), the tenant is the controller. Joint
controllership is rare — declared in DPA.

## D. Sub-processor register

See `Docs/COMPLIANCE/SUB_PROCESSORS.md` (TBD — covers Supabase, AWS,
Cloudflare, Anthropic, OpenAI, DeepSeek, Stripe, Twilio, Resend,
Meta, ElevenLabs, Sentry, PostHog, Liveblocks).

## E. Records of breaches (Article 33-34)

Append a row per breach within 72h of awareness. Cross-link to the
incident ticket.

| Date | Severity | Subjects affected | Categories | Recipients notified | Mitigation |
|---|---|---|---|---|---|
| _(none reported)_ | | | | | |

## F. Breach notification template

```
To: ico-contact OR pdpc-contact  (jurisdiction-dependent)
From: Borjie DPO <dpo@borjie.com>
Subject: Personal Data Breach Notification — Incident <ID> — <Date>

Nature of breach:
<classification per GDPR Art. 33(3)(a) / TZ PDPA Art. 27>

Approximate number of data subjects:
<count or range>

Categories of personal data affected:
<list>

Likely consequences for the data subjects:
<assessment>

Measures taken or proposed:
<list>

Contact for further information:
DPO: dpo@borjie.com / +255 ...

Sent in compliance with GDPR Art. 33 / TZ PDPA Art. 27.
```

## Related

- `Docs/COMPLIANCE/SOC2_CONTROLS.md`
- `Docs/COMPLIANCE/TZ_PDPA_2022.md`
- `Docs/COMPLIANCE/DPA_TEMPLATE.md`
- `Docs/RUNBOOKS/tenant-offboarding-rtbf.md`

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
