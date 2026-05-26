# Tanzania PDPA 2022 — Operational Runbook

| Field | Value |
|---|---|
| Statute | Personal Data Protection Act, No. 11 of 2022 |
| Effective date | 1 May 2023 (Operationalisation: 1 May 2024) |
| Regulator | Personal Data Protection Commission (PDPC) |
| Regulator URL | https://pdpc.go.tz |
| Breach-notification window | 72 hours from awareness |
| Data localisation | **Required** (`dataProtection.dataLocalizationRequired = true`) |
| Codebase anchor | `packages/domain-models/src/common/jurisdictional-rules.ts` → `TZ_RULES.dataProtection` |

## 1. Scope of application

The PDPA applies to processing of personal data:
- Where the controller / processor is established in the United Republic of Tanzania, OR
- Where the data subject is in Tanzania (extraterritorial reach — s. 4(1)(b))

BORJIE falls under both: we have data subjects in TZ (tenants, owners) and
process via TZ-based deployments.

## 2. Lawful basis (s. 7)

PDPA s. 7 enumerates the lawful bases. For BORJIE our primary bases are:

| Basis (s. 7) | When BORJIE uses it |
|---|---|
| s. 7(a) consent | Marketing comms, marketplace listings, customer-app feature opt-in |
| s. 7(b) contract performance | Lease management, rent invoicing, payment processing |
| s. 7(c) legal obligation | TRA VAT filing, KYC under POCAMLA 2006, court orders |
| s. 7(d) vital interests | Habitability emergencies (gas leak, fire) — opening unit |
| s. 7(f) legitimate interest | Fraud detection, system security, internal analytics |

The full mapping lives in [`lawful-basis-register.json`](./lawful-basis-register.json).

## 3. Data-subject rights (s. 31–37)

| Right | PDPA section | BORJIE handler |
|---|---|---|
| Access | s. 31 | `customer-app/api/me/data-export` — produces JSON bundle |
| Rectification | s. 32 | In-app profile editor; lease amendment workflow |
| Erasure | s. 33 | `packages/ai-copilot/src/gdpr/dsar-rtbf-executor.ts` |
| Restriction | s. 34 | Tenant flag `customers.processing_restricted = true` |
| Portability | s. 35 | JSON export via access endpoint |
| Objection | s. 36 | Consent revocation workflow (see consent-revocation-runbook) |
| Auto-decision | s. 37 | Credit-score model surfaces explanation; human review on appeal |

**SLA**: PDPA s. 38 requires response within **30 days** (extendable once by
30 days on complex requests, with notice).

## 4. Cross-border transfer (s. 51–54)

PDPA s. 51 prohibits transfer outside Tanzania unless one of:
- s. 51(2)(a) — adequacy declaration from PDPC (no country currently declared)
- s. 51(2)(b) — explicit consent after risks disclosed
- s. 51(2)(c) — contract performance requiring transfer
- s. 51(2)(d) — Standard Contractual Clauses (PDPC-approved template)

**BORJIE stance**: All TZ tenant primary storage lives in
`awsRegionDefault = 'eu-west-1'` (Ireland). Because eu-west-1 is **outside** TZ,
every TZ deployment requires:

1. Tenant consent collected at signup (lawful basis s. 7(a) + s. 51(2)(b))
2. SCC equivalent contract with the EU sub-processor (AWS Ireland)
3. Transfer Impact Assessment ([cross-border-transfer-policy.md](./cross-border-transfer-policy.md))

When the AWS Tanzania local zone opens (roadmap 2026+), TZ tenant data migrates
to in-country storage. Until then, the SCC + TIA must be on file with the PDPC.

## 5. Per-data-class retention (PDPA s. 27)

| Data class | Retention | Trigger |
|---|---|---|
| `RESTRICTED` (NIDA, TIN, biometric) | 7 years from last lease termination | Lease history retention obligation (Land Act Cap. 113) |
| `CONFIDENTIAL` (name, phone, email, address) | 7 years from last activity | Statute of limitations on rent claims |
| Voice transcripts | 90 days | Biometric-adjacent; short minimisation window |
| Audit events | **Permanent** (pseudonymised on RTBF) | s. 27(2) audit-trail exception |
| Marketing data | Until consent revoked + 30-day grace | s. 7(a) basis only |

See [audit-log-retention-policy.md](./audit-log-retention-policy.md) for the
per-table breakdown.

## 6. Breach-notification timeline (s. 28)

PDPA s. 28(1) requires notification to PDPC **within 72 hours** of becoming
aware of a "high-risk personal-data breach". See
[breach-notification-runbook.md](./breach-notification-runbook.md) for the
end-to-end flow.

### Drafted notification template (PDPC)

```
To: PDPC Tanzania <complaints@pdpc.go.tz>
Subject: Personal Data Breach Notification — PDPA s. 28 — <CONTROLLER_NAME>

Controller: BORJIE Ltd, <COMPANY_REGISTRATION_NUMBER>, Tanzania
DPO contact: <DPO_CONTACT>
Date of awareness: <YYYY-MM-DD HH:MM TZT>
Estimated incident start: <YYYY-MM-DD>

Nature of breach:
<concise factual description — what data, what mechanism, what scope>

Categories and approximate number of data subjects affected:
<e.g. 1,250 tenants in Dar es Salaam>

Categories and approximate number of records concerned:
<e.g. names + phone numbers — no NIDA / financial>

Likely consequences:
<spam risk, social-engineering, fraud>

Measures taken or proposed:
<e.g. rotated tokens, revoked sessions, patched issue ID-XXXX,
notified affected subjects via SMS, engaged forensics>

Cooperation contact:
<DPO_CONTACT>

Signed,
<DPO_NAME>
Data Protection Officer, BORJIE Ltd
```

## 7. DPO appointment (s. 18)

PDPA s. 18 requires a DPO when the controller processes personal data of
**more than 5,000 data subjects** OR processes "sensitive personal data"
systematically. BORJIE crosses both thresholds.

- DPO contact: `<DPO_CONTACT>`
- DPO must be independent, report directly to the board, and be registered
  with PDPC within 30 days of appointment (s. 19(2)).

## 8. Registration with PDPC (s. 16)

Controllers must register with PDPC and renew annually. Renewal window:
60 days before anniversary. Track in: `<COMPLIANCE_CALENDAR_URL>`.

## 9. Audit-trail requirements

- All access to `RESTRICTED`-classified columns must produce an `audit_events`
  row (`packages/database/src/schemas/audit-events.schema.ts`)
- Sovereign-action ledger captures every regulator-touching action with
  tenant-id, actor, timestamp, hash
- Audit events are append-only and pseudonymised (not deleted) when a data
  subject exercises RTBF — preserves the immutable trail PDPA s. 27(2) requires

## 10. Escalation path

1. **L1 (on-call SRE)** — detect / triage. Page: `<ONCALL_PAGER>`
2. **L2 (security incident commander)** — declare incident, draft notification
3. **L3 (DPO)** — review notification, file with PDPC
4. **L4 (CEO + Legal)** — public communication, if applicable

The 72-hour clock starts at L1 awareness. Move L1→L4 within 24 hours.

## 11. Regulator contact

- **Office**: Personal Data Protection Commission, P.O. Box 9148, Dar es Salaam
- **Phone**: `<PDPC_PHONE>`
- **Email**: `<PDPC_EMAIL>`
- **Portal**: https://pdpc.go.tz/file-complaint

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
