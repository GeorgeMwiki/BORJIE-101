# 03 — Tanzania PDPA 2022 — Mapping & DPIAs

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** Data Protection Officer (DPO)
**Jurisdiction:** Tanzania
**Statute:** Personal Data Protection Act, 2022 (Act No. 11 of 2022, "PDPA"); Personal Data Protection (Personal Data Collection and Processing) Regulations, 2023.

> **Note on citations:** PDPA section numbering follows the Government of Tanzania Gazette publication of Act No. 11 of 2022 dated 1 December 2022. The authoritative article-by-article mapping (Articles 5-30) lives at `Docs/COMPLIANCE/TZ_PDPA_2022.md`; this regulator-pack document is the **examination-facing summary** with DPIAs.

---

## 1. Lawful basis (PDPA s.5–s.7)

Borjie processes personal data on the following lawful bases:

| Processing | Lawful basis | Notes |
|---|---|---|
| Tenant onboarding (KYC: NIDA lookup, ID OCR, liveness) | Consent + legal obligation (lease law) | Consent captured at signup; legal obligation under tenancy law |
| Rent collection + reconciliation | Contract performance (lease agreement) | Payment record retained for tax / accounting period |
| Lease lifecycle (renewal, eviction, transfer) | Contract performance | |
| Maintenance request handling | Contract performance + legitimate interest | |
| Owner / investor portfolio dashboards | Legitimate interest of property owner | Balancing test documented per institutional client |
| Voice agent ("Mr. Mwikila") recordings | Explicit consent | Tenant consents at start of every call; bilingual sw/en |
| Marketing communications | Consent (opt-in) | Withdrawable in one click |
| Audit log | Legal obligation | Required for tax record-keeping, dispute resolution |

Full register at `Docs/COMPLIANCE/lawful-basis-register.json`.

## 2. Section 24 — Notification to data subjects (right to information)

PDPA s.24 requires the data controller to inform data subjects of: (a) controller identity, (b) purposes of processing, (c) categories of recipients, (d) whether provision is mandatory, (e) data-subject rights, (f) cross-border transfer.

**Borjie implementation:**

| Requirement | Implementation | Source-of-truth |
|---|---|---|
| (a) Controller identity | Privacy notice presented at signup; bilingual (en/sw) | TODO — `apps/customer-app/src/app/legal/privacy/page.tsx` |
| (b) Purposes | Layered notice — short summary at point of collection, full notice linked | Same |
| (c) Categories of recipients | Live sub-processor list, updated on change | `Docs/regulator-pack/tz/09-vendors-and-subprocessors.md` |
| (d) Mandatory or optional | Per-field flag in onboarding flow | `apps/customer-app/src/components/onboarding/` |
| (e) Data-subject rights | In-app "Your data" page (access, rectify, delete, port, restrict, object) | `apps/customer-app/src/app/settings/privacy/` |
| (f) Cross-border transfer | Disclosed; current EU-resident; PDPC authorisation in preparation | doc 09 |

## 3. Section 25 — Conditions for processing sensitive data

PDPA s.25 identifies sensitive personal data (race, ethnicity, political opinion, religion, health, sexuality, criminal record, biometric data, financial data) and requires explicit consent or another statutory basis.

**Borjie handling:**

- **Biometric data (face liveness for KYC):** processed by Smile Identity (sub-processor); explicit consent at capture; retained as a hash + match score, not raw image; retention 7 years to match tenancy-record period.
- **Financial data:** core to the rent / billing purpose; lawful basis = contract performance; encrypted at field level (`packages/encryption/`).
- **National ID number:** stored encrypted under per-tenant DEK; access logged to `field_encryption_audit`.
- **Health data:** **NOT processed**. Where a tenant mentions health context to the voice agent, it is purged from chat logs after the operational window and never persisted as structured data.
- **Political opinion / religion / sexuality:** **prohibited inputs**; AI safety layer rejects such queries via the prompt-shield in `packages/ai-copilot/src/security/prompt-shield.ts` and PII scrubber in `packages/ai-copilot/src/security/pii-scrubber.ts` (511 lines).

## 4. Section 26 — Cross-border transfer

PDPA s.26 prohibits cross-border transfer unless: (i) destination provides adequate protection, (ii) consent given after informed-of-risks, (iii) necessary for contract or legal obligation, (iv) Commission has authorised.

**Borjie compliance:**

- All current cross-border transfers are to **EU-resident** providers (Supabase fra1, Vercel fra1) — EU is generally considered to provide an adequate level of protection.
- US transfers (Anthropic, OpenAI, Twilio, Stripe) rely on EU SCCs + PDPA-specific addenda.
- Tenant consent captured at signup with explicit mention of cross-border transfer.
- PDPC authorisation application: in preparation (target submission Q3 2026). See `Docs/COMPLIANCE/cross-border-transfer-policy.md`.

## 5. Section 56 — Offences and penalties

PDPA s.56 sets out offences (unlawful processing, false disclosure, obstruction of the Commission) and corresponding penalties (fines + imprisonment). Borjie controls to prevent such offences:

- **Unlawful processing:** field-level encryption, RLS, RBAC, kill-switches on AI agents — all access policy-mediated and audit-logged.
- **False disclosure:** access to PII for response to PDPC requests is restricted to DPO and CCO; four-eyes principle.
- **Obstruction:** internal policy mandates full cooperation; 24-h response SLA for PDPC enquiries.

## 6. Data Protection Impact Assessment (DPIA) Programme

PDPA s.31 requires a DPIA for processing likely to result in high risk to data-subject rights. Borjie maintains a DPIA register and conducts a fresh DPIA before any new high-risk processing goes live.

### DPIA Template

See `Docs/COMPLIANCE/dpia-template.md`. Structure:

1. Processing description (purpose, categories of data, retention)
2. Necessity & proportionality test
3. Risk identification (5x5 matrix: likelihood × severity)
4. Mitigations (technical + organisational)
5. Residual risk + sign-off (DPO + product owner + CISO)
6. Review cadence

### Completed DPIAs (current)

| DPIA-ID | Processing | Risk score | Status |
|---|---|---|---|
| DPIA-001 | Tenant identity onboarding (NIDA + liveness) | Medium-high | TODO — DPO sign-off pending |
| DPIA-002 | Voice agent ("Mr. Mwikila") — tenant call recording + STT | Medium-high | TODO — DPO sign-off pending |
| DPIA-003 | Predictive interventions agent — using payment history to flag arrears risk | High | TODO — DPO sign-off pending + fairness review (doc 06) |
| DPIA-004 | Adaptive layout engine — using tenant behaviour to rearrange UI | Low-medium | TODO — DPO sign-off pending |

## 7. Data subject rights — operational implementation

| Right | How exercised | SLA | Implementation (path:line) |
|---|---|---|---|
| Access (s.27) | Self-serve "Export my data" button | < 30 days | Route: `services/api-gateway/src/routes/dsar.router.ts` + `gdpr.router.ts`; persistence by `packages/database/src/schemas/gdpr.schema.ts` |
| Rectification (s.28) | Self-serve profile edit; DPO-routed for special-category | Immediate (self-serve), < 7 days (DPO) | Profile editor in `apps/customer-app/`; DPO queue in `services/api-gateway/src/routes/gdpr.router.ts` |
| Erasure / RTBF (s.29) | Self-serve "Delete my account" → 30-day grace → cryptographic erasure | < 30 days | Runbook `Docs/RUNBOOKS/tenant-offboarding-rtbf.md`; erasure orchestrated through `gdpr.router.ts` |
| Restriction (s.30) | DPO-routed; processing flagged with `restricted=true` | < 7 days | Restriction flag on `identity.schema.ts` + audit-event class `gdpr.restriction.applied` written to `audit-events.schema.ts` |
| Portability | JSON / CSV export bundle | < 30 days | Same routes as access; export packets shaped by `services/api-gateway/src/routes/gdpr.router.ts` |
| Object | DPO-routed; e.g., AI voice agent opt-out | < 7 days | Settings → AI preferences in `apps/customer-app/`; opt-out flag respected at `services/api-gateway/src/composition/voice-agent-wiring.ts` |

## 8. PDPC notification (s.45 — breach notification)

Statutory: 72 h. Borjie internal target: 24 h from confirmation. See doc 07 §5.

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| Data Protection Officer (DPO) | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-tz-03-v1.0` |
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-tz-03-v1.0` |
| Legal Counsel | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/legal/regulator-pack-tz-03-v1.0` |
| Board Compliance Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/bcc/regulator-pack-tz-03-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | DPO |
| 1.1.0 | 2026-05-22 | DSAR/RTBF implementation path:line refs (Wave-12) | DPO |

## Appendix C — Review Cadence

- **Annual** — full DPIA-register review by DPO
- **Out-of-cycle** — triggered by new high-risk processing, PDPC enforcement notice, or material change to consent flow in `apps/customer-app/`
- **Quarterly** — DPO reviews completed DSARs against SLA targets in §7
