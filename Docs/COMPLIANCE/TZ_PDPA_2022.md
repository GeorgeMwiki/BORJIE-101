# Tanzania Personal Data Protection Act, 2022 — Control Mapping

> Mapping of the Tanzania PDPA 2022 (Cap. 44, in force from 1 May 2023)
> Articles 5-30 to Borjie implementation. Tanzania is Borjie's
> primary jurisdiction; this is the authoritative compliance reference
> for TZ operations. Regulator: Personal Data Protection Commission (PDPC).

Last review: 2026-05-18.

---

## Article 5 — Principles of personal data processing

| Principle | Borjie implementation |
|---|---|
| Lawfulness | Every processing path is gated on consent (`gdpr_consent_records`) or contractual necessity (lease, payment). |
| Fairness & transparency | Privacy notice at sign-up; per-action disclosure in customer app. |
| Purpose limitation | Per-tenant scoped processing; tools tagged with `purpose` in kernel tool-spec. |
| Data minimisation | PII scrubber (`packages/ai-copilot/src/security/pii-scrubber.ts`) strips unnecessary fields. |
| Accuracy | Self-serve profile-edit endpoints; tenant DPO review queue. |
| Storage limitation | Retention policy per table (see `Docs/OPERATIONAL_SLA.md`). |
| Integrity & confidentiality | Field-level encryption + audit hash-chain. |
| Accountability | Audit trail + DPO role + this document. |

## Article 6 — Lawful basis for processing

Six bases recognised; Borjie relies on three primary:

1. **Consent** — sign-up + per-action confirmation.
2. **Contract** — lease, payment, service delivery.
3. **Legal obligation** — tax reporting (TRA), KYC (NIDA/CRB).

Withdrawal of consent triggers RTBF cascade (see
`Docs/RUNBOOKS/tenant-offboarding-rtbf.md`).

## Article 7 — Special-category personal data

National ID numbers, biometric data, financial data. Stored only
encrypted-at-rest under per-tenant DEKs (`pii.id_number_enc`, etc.).
Access logged to `field_encryption_audit`.

## Article 8 — Consent

- Affirmative, specific, informed, freely given.
- Capture: `gdpr_consent_records` table — version, timestamp, IP, UA.
- Withdrawal: customer portal `POST /api/v1/gdpr/withdraw-consent`.

## Article 9 — Processing of children's data

Tenants must be ≥18. KYC via NIDA verifies date-of-birth at sign-up.
Reject under-18 attempts; row written to `kyc_rejection_log`.

## Article 10 — Data subject rights (overview)

| Right (Article) | Endpoint | Runbook |
|---|---|---|
| Access (11) | `GET /api/v1/gdpr/dsar-export` | DSAR compiler |
| Rectification (12) | Self-serve profile-edit | n/a |
| Erasure (13) | `POST /api/v1/gdpr/erase-request` | `tenant-offboarding-rtbf.md` |
| Restriction (14) | `POST /api/v1/gdpr/restrict-processing` | n/a |
| Portability (15) | `GET /api/v1/gdpr/dsar-export?format=json` | DSAR compiler |
| Object (16) | `POST /api/v1/gdpr/object-processing` | DPO triage |

## Articles 11-16 — Detailed rights

Implemented per the table above. Response time: max 30 calendar days
per Article 17. Status tracked in `dsar_request_log`.

## Article 17 — Response timeline

30 calendar days from request. Status-page surfaces ETA to subject.
Cron `gdprDeadlineSupervisor` (TBD) pages DPO on T-3 days.

## Article 18 — Cross-border data transfer

Restrictions: transfer to non-TZ jurisdictions allowed only when:

1. The destination is on the PDPC adequate-jurisdictions list, OR
2. A Standard Contractual Clause is in place, OR
3. The subject has explicit consent for the transfer.

Borjie data-residency: primary Postgres in `af-south-1`
(Johannesburg). Sub-processor list documented in
`Docs/COMPLIANCE/SUB_PROCESSORS.md` (TBD).

## Articles 19-22 — Controller obligations

| Obligation | Implementation |
|---|---|
| Record of processing | `Docs/COMPLIANCE/GDPR_ARTICLE_30.md` (TZ equivalent) |
| Privacy by design | Kernel tool-spec `purpose` annotation; tenant isolation enforced |
| DPIA when required | Template at `Docs/COMPLIANCE/DPIA_TEMPLATE.md` (TBD) |
| Notification of processing to PDPC | Filed at registration; review on material change |

## Article 23 — Data Protection Officer

DPO designated. Contact: dpo@borjie.com. Independence guaranteed
by reporting line to CEO + board.

## Articles 24-26 — Security

| Element | Implementation |
|---|---|
| Risk-appropriate measures | Field encryption + TLS + audit chain |
| Pseudonymisation where possible | Anonymisation strategy in RTBF cascade |
| Breach notification (T+72h to PDPC) | See `audit-chain-verification.md` Step 3 |
| Subject notification on high-risk breach | Communications template in offboarding runbook |

## Article 27 — Breach notification

Maximum 72 hours from awareness. Notification template:

```
To: <pdpc-contact>
Subject: Personal Data Breach Notification — Borjie

Nature: <classify per PDPC taxonomy>
Categories affected: <approx subject count, data types>
Likely consequences: <…>
Measures taken / proposed: <…>
DPO contact: dpo@borjie.com
```

## Article 28 — Data Processing Agreement (with processors)

Mandatory between controller (tenant) and processor (Borjie).
Template at `Docs/COMPLIANCE/DPA_TEMPLATE.md`. Signed copy stored
per tenant in `tenant_legal_docs`.

## Article 29 — Penalties

Fines up to 5,000,000 TZS or 1% turnover. Documented in
`Docs/RISK_REGISTER.md` as compliance risk.

## Article 30 — Appeals

Subjects appeal to PDPC. Borjie cooperates fully and maintains
an appeal-response queue with the DPO.

---

## Implementation checklist for TZ-tenant onboarding

- [ ] DPA signed (per Article 28)
- [ ] Privacy notice translated to Swahili
- [ ] Consent record captured at first sign-up
- [ ] NIDA KYC verification completed
- [ ] Tenant's DPO contact captured (for B2B tenants)
- [ ] Sub-processor disclosure delivered

## Related

- `Docs/COMPLIANCE/SOC2_CONTROLS.md`
- `Docs/COMPLIANCE/GDPR_ARTICLE_30.md`
- `Docs/COMPLIANCE/DPA_TEMPLATE.md`
- `Docs/RUNBOOKS/tenant-offboarding-rtbf.md`
- `Docs/RUNBOOKS/audit-chain-verification.md`

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
