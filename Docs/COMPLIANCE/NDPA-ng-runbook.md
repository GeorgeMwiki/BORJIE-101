# Nigeria NDPA 2023 — Operational Runbook

| Field | Value |
|---|---|
| Statute | Nigeria Data Protection Act, 2023 |
| Effective date | 14 June 2023 |
| Regulator | Nigeria Data Protection Commission (NDPC) |
| Regulator URL | https://ndpc.gov.ng |
| Breach-notification window | 72 hours from awareness |
| Data localisation | No general requirement (sector-specific for CBN / NCC) |
| Codebase anchor | `packages/domain-models/src/common/jurisdictional-rules.ts` → `NG_RULES.dataProtection` |

## 1. Scope (s. 2)

NDPA applies to processing of personal data of data subjects in Nigeria,
regardless of where the controller / processor sits. BORJIE's Nigeria
deployment falls under both the territorial and personal-jurisdiction tests.

## 2. Lawful basis (s. 25)

| Basis (s. 25) | When BORJIE uses it |
|---|---|
| s. 25(1)(a) consent | Marketing, optional features, marketplace |
| s. 25(1)(b) contract performance | Lease, rent invoicing, OPay/PalmPay/Moniepoint transactions |
| s. 25(1)(c) legal obligation | FIRS tax, CBN AML, court orders |
| s. 25(1)(d) vital interests | Emergency property access |
| s. 25(1)(e) public interest | n/a |
| s. 25(1)(f) legitimate interest | Fraud detection, model training |

Full mapping: [`lawful-basis-register.json`](./lawful-basis-register.json).

## 3. Data-subject rights (s. 34–38)

| Right | NDPA section | BORJIE handler |
|---|---|---|
| Information | s. 34 | Privacy notice at signup |
| Access | s. 35 | `customer-app/api/me/data-export` |
| Rectification | s. 36 | In-app editor |
| Erasure | s. 37 | `dsar-rtbf-executor.ts` |
| Restriction | s. 38 | `customers.processing_restricted` flag |
| Portability | s. 38(2) | JSON export |
| Objection | s. 39 | Consent revocation |
| Auto-decision | s. 40 | Credit-score explanation route |

**SLA**: NDPC General Application Implementation Directive (GAID) Pt. III r. 6 —
controller must acknowledge within **7 days** and act within **1 month**.

## 4. Cross-border transfer (s. 41–44)

NDPA s. 41 permits transfer when:
- s. 41(1)(a) — recipient is in a country with an adequacy decision (NDPC list)
- s. 41(1)(b) — recipient is bound by an instrument that provides adequate protection
- s. 41(1)(c) — data subject has given explicit consent
- s. 41(1)(d) — contract performance with subject
- s. 41(1)(e) — public interest grounds

BORJIE NG deployment uses `awsRegionDefault = 'af-south-1'` (Cape Town).
TIA + SCC on file. CBN sector-specific localisation may apply to fintech
metadata — handled per-rail in the connector layer.

## 5. Per-data-class retention

| Data class | Retention | Trigger |
|---|---|---|
| `RESTRICTED` (NIN, FIRS TIN, biometric) | 7 years | FIRS Tax Procedures Act Cap. T2 + CBN AML |
| `CONFIDENTIAL` (basic PII) | 7 years | Limitation Act Cap. L19 |
| Voice transcripts | 90 days | Minimisation |
| Audit events | Permanent (pseudonymised on RTBF) | NDPA s. 38(1)(b) audit exception |
| Marketing data | Until consent revoked + 30 days | s. 25(1)(a) basis |

## 6. Breach notification (s. 40)

NDPA s. 40(2) — high-risk personal-data breach must be notified to NDPC
**within 72 hours**. Where the breach is likely to harm the data subject,
the subject must also be notified "without undue delay" (s. 40(3)).

### Drafted notification template (NDPC)

```
To: NDPC Nigeria <info@ndpc.gov.ng>
Subject: Personal Data Breach Notification — NDPA s. 40 — <CONTROLLER_NAME>

Controller: BORJIE Nigeria Ltd, RC <CAC_RC_NUMBER>
NDPC registration: <NDPC_REGISTRATION>
DPCO contact: <DPCO_CONTACT>
Date of awareness: <YYYY-MM-DD HH:MM WAT>

Nature of breach:
<factual description>

Categories of data + approximate subject count:
<e.g. 3,800 tenants Lagos; names, phones; NIN exposed for 90 subset>

Likely consequences:
<spam, fraud, identity theft via NIN>

Measures taken:
<rotated, patched, subject notification via WhatsApp + email>

Cooperation contact: <DPO_CONTACT>

Signed,
<DPO_NAME>
DPCO, BORJIE Nigeria Ltd
```

## 7. DPCO (NDPA's term for DPO) — s. 33

NDPA requires a Data Protection Compliance Officer (DPCO) when:
- Processing personal data of more than 200 data subjects per year, OR
- Processing sensitive personal data on any scale

BORJIE NG must appoint a DPCO and **license** it through an NDPC-licensed
Data Protection Compliance Organisation (DPCO is also the entity term).

- DPCO contact: `<DPCO_CONTACT>`
- Licensed DPCO firm: `<DPCO_FIRM>`

## 8. Registration

Controllers of "major importance" must register with NDPC (s. 44 GAID r. 14).
The "major importance" threshold is processing > 5,000 data subjects per year.
BORJIE qualifies.

## 9. Audit-trail

Same pattern as TZ/KE — `audit_events`, sovereign-action ledger, pseudonymisation
on RTBF.

## 10. Sector-specific overlays

| Sector | Regulator | Additional rule |
|---|---|---|
| Fintech (M-Pesa-like rails) | CBN | Primary storage in NG required for transaction metadata |
| Telecoms metadata | NCC | Subscriber metadata localisation |
| Credit referencing | CBN | CBN Regulatory Framework for Bank Verification Number applies |

The connector layer (`packages/connectors/src/adapters/`) enforces these
per-rail rather than at the platform level.

## 11. Escalation path

1. L1 SRE → triage
2. L2 security IC → declare
3. L3 DPCO → draft + file NDPC within 72h
4. L4 CEO + Legal → public comms

## 12. Regulator contact

- **Office**: Nigeria Data Protection Commission, Abuja
- **Phone**: `<NDPC_PHONE>`
- **Email**: `<NDPC_EMAIL>`
- **Portal**: https://ndpc.gov.ng/complaints

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
