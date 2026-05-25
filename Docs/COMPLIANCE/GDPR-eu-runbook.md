# EU GDPR — Operational Runbook

| Field | Value |
|---|---|
| Statute | Regulation (EU) 2016/679 (General Data Protection Regulation) |
| Effective date | 25 May 2018 |
| Regulator | National Data Protection Authorities + EDPB |
| Lead supervisory authority | `<LEAD_SUPERVISORY_AUTHORITY>` (one-stop-shop) |
| Breach-notification window | 72 hours from awareness (Art. 33) |
| Data localisation | No general requirement (SCC required for transfer) |

## 1. Scope (Art. 3)

GDPR applies to:
- Controllers/processors established in the Union (Art. 3(1))
- Controllers/processors **outside** the Union offering goods/services to data
  subjects in the Union, or monitoring their behaviour (Art. 3(2))

BORJIE's primary processing is for TZ/KE/NG data subjects. **However**:
- AWS sub-processing happens in eu-west-1 (Ireland) — establishes Union
  processor footprint
- Any EU-resident user who creates a marketplace listing or signs up brings
  GDPR scope per Art. 3(2)

BORJIE appoints an Article 27 Representative in the Union:
`<EU_REP_CONTACT>`.

## 2. Lawful basis (Art. 6)

| Basis (Art. 6) | When BORJIE uses it |
|---|---|
| Art. 6(1)(a) consent | Marketing, marketplace listings, optional features |
| Art. 6(1)(b) contract | Lease, rent invoicing, payment processing |
| Art. 6(1)(c) legal obligation | Tax filing (per local statute), court orders |
| Art. 6(1)(d) vital interests | Emergency property access |
| Art. 6(1)(e) public interest | n/a |
| Art. 6(1)(f) legitimate interest | Fraud detection, security, internal analytics |

Full mapping in [`lawful-basis-register.json`](./lawful-basis-register.json),
which doubles as the **Article 30 Record of Processing Activities (RoPA)**.

## 3. Data-subject rights (Arts. 15–22)

| Right | GDPR article | BORJIE handler |
|---|---|---|
| Information | Arts. 13/14 | Privacy notice + layered consent at signup |
| Access | Art. 15 | `customer-app/api/me/data-export` |
| Rectification | Art. 16 | In-app profile editor |
| Erasure (RTBF) | Art. 17 | `packages/ai-copilot/src/gdpr/dsar-rtbf-executor.ts` |
| Restriction | Art. 18 | `customers.processing_restricted` flag |
| Portability | Art. 20 | JSON export in machine-readable format |
| Objection | Art. 21 | Consent revocation workflow |
| Auto-decision | Art. 22 | Credit-score explanation + human-review escalation |

**SLA**: GDPR Art. 12(3) — controller must respond **without undue delay and
within one month**. Extendable by two months for complex requests, with notice.

## 4. International transfers (Chapter V)

GDPR Arts. 44–50 govern transfers outside the EEA. BORJIE mechanisms:

| Mechanism | Article | When we use it |
|---|---|---|
| Adequacy decision | Art. 45 | UK (post-Brexit), Switzerland for backups |
| Standard Contractual Clauses (SCC 2021/914) | Art. 46(2)(c) | All onward transfers to TZ/KE/NG |
| Transfer Impact Assessment (Schrems II) | Art. 46 + recital 108 | Every SCC-backed transfer |
| Explicit consent | Art. 49(1)(a) | Marketplace cross-border listings |
| Contract performance | Art. 49(1)(b) | Cross-border rent contracts |

See [cross-border-transfer-policy.md](./cross-border-transfer-policy.md).

## 5. Retention (Art. 5(1)(e))

| Data class | Retention | Trigger |
|---|---|---|
| `RESTRICTED` | 7 years | Local statute retention obligations |
| `CONFIDENTIAL` | 7 years | Limitation periods in member state law |
| Voice transcripts | 90 days | Minimisation principle |
| Audit events | Permanent (pseudonymised on RTBF) | Art. 17(3)(e) — legal claims defence |
| Marketing data | Until consent withdrawn + 30 days | Art. 6(1)(a) basis |

## 6. Breach notification (Arts. 33, 34)

GDPR Art. 33 — controller notifies competent supervisory authority **within
72 hours** of awareness. Art. 34 — if high risk to subject rights, also notify
the data subject without undue delay.

### Drafted notification template (lead supervisory authority)

```
To: <LEAD_SUPERVISORY_AUTHORITY>
Subject: Personal Data Breach Notification — GDPR Art. 33 — <CONTROLLER_NAME>

Controller: BORJIE Ltd
EU Representative (Art. 27): <EU_REP_CONTACT>
DPO contact: <DPO_CONTACT>
Date of awareness: <YYYY-MM-DD HH:MM CET>

1. Nature of the personal data breach including, where possible:
   - Categories and approximate number of data subjects concerned:
     <e.g. ~150 EU-resident marketplace listers>
   - Categories and approximate number of personal data records concerned:
     <e.g. names, emails, addresses; no special-category data>

2. Name and contact details of DPO:
   <DPO_CONTACT>

3. Likely consequences:
   <spam, social-engineering, no financial / health implications>

4. Measures taken or proposed to address the breach and mitigate effects:
   <rotated, patched, ID-XXXX, subject-notification via email>

Signed,
<DPO_NAME>
DPO, BORJIE Ltd
```

## 7. DPO requirement (Art. 37)

Art. 37(1)(b)/(c) requires a DPO when core activities involve large-scale
systematic monitoring OR large-scale processing of special-category data.

BORJIE's "credit-scoring + ML inference + cross-jurisdictional rent
analytics" footprint triggers the threshold. DPO: `<DPO_CONTACT>`.

## 8. DPIA requirement (Art. 35)

DPIA required for high-risk processing (Art. 35(3)):
- (a) systematic + extensive evaluation of personal aspects (profiling)
- (b) large-scale special-category processing
- (c) systematic monitoring of public spaces

BORJIE's tenant credit-scoring model triggers (a). Initial DPIA delivered
on `<DPIA_VERSION_DATE>`. Template: [`dpia-template.md`](./dpia-template.md).

## 9. Article 30 RoPA

GDPR Art. 30 — controllers ≥250 employees OR processing risky data OR
processing not-occasional MUST maintain a record of processing activities.

BORJIE's RoPA lives at [`lawful-basis-register.json`](./lawful-basis-register.json) —
machine-readable, auto-validated, kept in version control.

## 10. Penalties (Art. 83)

Two tiers:
- Tier 1: Up to €10M or 2% global annual turnover (Art. 83(4))
- Tier 2: Up to €20M or 4% global annual turnover (Art. 83(5)) — applies to
  lawful-basis violations, data-subject-rights breaches, international-transfer
  violations

## 11. Escalation path

1. L1 SRE → triage
2. L2 security IC → declare incident
3. L3 DPO → draft notification, file with lead supervisory authority within 72h
4. L4 CEO + Legal + EU Rep → public comms + member-state notifications

## 12. Lead supervisory authority

- **Authority**: `<LEAD_SUPERVISORY_AUTHORITY>` (selected on one-stop-shop basis
  per Art. 56 — typically Ireland's DPC if main establishment is Dublin/Cork
  given AWS eu-west-1 footprint)
- **Phone**: `<LSA_PHONE>`
- **Email**: `<LSA_EMAIL>`
- **Portal**: `<LSA_PORTAL>`
