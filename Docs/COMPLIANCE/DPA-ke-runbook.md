# Kenya DPA 2019 — Operational Runbook

| Field | Value |
|---|---|
| Statute | Data Protection Act, No. 24 of 2019 |
| Effective date | 25 November 2019 |
| Regulator | Office of the Data Protection Commissioner (ODPC) |
| Regulator URL | https://www.odpc.go.ke |
| Breach-notification window | 72 hours from awareness |
| Data localisation | No (sector-specific localisation for fintech, health) |
| Codebase anchor | `packages/domain-models/src/common/jurisdictional-rules.ts` → `KE_RULES.dataProtection` |

## 1. Scope of application

DPA s. 4 applies extraterritorially to controllers/processors **located in
Kenya** or **processing data of Kenyan data subjects** regardless of location.

## 2. Lawful basis (s. 30)

| Basis (s. 30) | When BORJIE uses it |
|---|---|
| s. 30(1)(a) consent | Marketing, marketplace listings, optional features |
| s. 30(1)(b) contract performance | Lease, rent collection, M-Pesa STK push |
| s. 30(1)(c) legal obligation | KRA tax filing, CBK AML, court orders |
| s. 30(1)(d) vital interests | Emergency property access |
| s. 30(1)(e) public interest | None — commercial entity |
| s. 30(1)(f) legitimate interest | Fraud detection, ML model training |

Full mapping: [`lawful-basis-register.json`](./lawful-basis-register.json).

## 3. Data-subject rights (s. 26)

| Right | DPA section | BORJIE handler |
|---|---|---|
| Information | s. 26(a) | Privacy notice surfaced at signup; consent screens |
| Access | s. 26(b) | `customer-app/api/me/data-export` |
| Rectification | s. 26(c) | In-app editor + audit log |
| Erasure | s. 26(d) | `dsar-rtbf-executor.ts` |
| Objection | s. 26(e) | Consent revocation; opt-out flags on `customers` |
| Portability | s. 38 | JSON export |
| Auto-decision | s. 35 | Credit-score explanation; appeal route |

**SLA**: ODPC Complaint Handling Procedure Regulations 2021 r. 12 — controller
must respond within **7 days of complaint**; full action within **21 days**.

## 4. Cross-border transfer (s. 48–50)

DPA s. 48 permits transfers when:
- s. 48(1)(a) — adequacy decision by Cabinet Secretary (limited list)
- s. 48(1)(b) — appropriate safeguards (Standard Contractual Clauses)
- s. 48(1)(c) — explicit consent
- s. 48(1)(d) — necessary for contract performance

BORJIE KE deployments use `awsRegionDefault = 'eu-west-1'`. Same TIA / SCC
framework as TZ applies — see
[cross-border-transfer-policy.md](./cross-border-transfer-policy.md).

**Note**: Sector-specific localisation applies to:
- **Health data** — Health Act 2017 + DPA — must remain in Kenya for primary copy
- **CBK-regulated fintech metadata** — Central Bank Prudential Guideline CBK/PG/08 — primary
  in-country storage; cross-border allowed for processing only

BORJIE does not process health data. M-Pesa payment metadata stored via
the `payments` table follows CBK guidance: primary record in Kenya (when AWS
ke-central-1 opens; today: SCC + TIA on file).

## 5. Per-data-class retention

| Data class | Retention | Trigger |
|---|---|---|
| `RESTRICTED` (KRA PIN, Huduma, biometric) | 7 years from last activity | Tax Procedures Act s. 23 record-keeping |
| `CONFIDENTIAL` (PII basic) | 7 years from last activity | Limitation of Actions Act Cap. 22 |
| Voice transcripts | 90 days | Minimisation |
| Audit events | Permanent (pseudonymised on RTBF) | KRA / CBK audit trail |
| Marketing data | Until consent revoked + 30 days | s. 30(1)(a) basis only |

## 6. Breach notification (s. 43)

DPA s. 43(1) — controller must notify ODPC **within 72 hours** of becoming aware
that personal data has been accessed, acquired, or disclosed unauthorised.

### Drafted notification template (ODPC)

```
To: ODPC Kenya <info@odpc.go.ke>
Subject: Personal Data Breach Notification — DPA s. 43 — <CONTROLLER_NAME>

Controller: BORJIE Kenya Ltd, <REGISTRATION_NUMBER>
Data Commissioner Reg. No.: <ODPC_REG_NO>
DPO contact: <DPO_CONTACT>
Date of awareness: <YYYY-MM-DD HH:MM EAT>

Nature of breach:
<factual description>

Categories of data and approximate number of subjects:
<e.g. ~2,400 Kenyan tenants — names, phone numbers, KRA PINs of 180 subset>

Likely consequences:
<spam, fraud, financial harm via KRA-PIN exposure>

Measures taken:
<rotated, patched, notified subjects via SMS + email, engaged forensics>

Signed,
<DPO_NAME>
DPO, BORJIE Kenya Ltd
```

See [breach-notification-runbook.md](./breach-notification-runbook.md) for
end-to-end flow.

## 7. DPO requirement (s. 24)

DPA s. 24 + Data Protection (General) Regulations 2021 r. 14 — DPO required
for public bodies, processors of large-scale personal data, or systematic
monitoring. BORJIE qualifies on volume.

DPO contact: `<DPO_CONTACT>` — must be filed with ODPC.

## 8. Registration (s. 18)

Both controllers and processors must register with ODPC. Annual renewal.
BORJIE registration number: `<ODPC_REGISTRATION_NUMBER>`.

## 9. Audit-trail requirements

Same as PDPA TZ — every `RESTRICTED` access logs to `audit_events`, sovereign
ledger captures regulator-touching actions, pseudonymisation preserves trail
on RTBF.

## 10. Escalation path

1. L1 SRE → triage
2. L2 security IC → declare incident
3. L3 DPO → draft + file ODPC notification within 72h
4. L4 CEO + Legal → public comms

## 11. Regulator contact

- **Office**: Office of the Data Protection Commissioner, Britam Tower, Nairobi
- **Phone**: `<ODPC_PHONE>`
- **Email**: `<ODPC_EMAIL>`
- **Portal**: https://www.odpc.go.ke/complaint
