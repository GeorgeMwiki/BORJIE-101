# BORJIE Compliance Runbooks — Cross-Reference Index

_Phase F.7 — Data Protection Authority (DPA) compliance runbooks._

This directory is the authoritative operational handbook for **how BORJIE
handles personal data** across every jurisdiction we operate in. Each runbook
is statute-anchored, cross-referenced to the technical implementation, and
written so an on-call engineer or DPO can act on it during an incident
without paging up the chain.

## Posture statement

BORJIE processes personal data of natural persons (tenants, owners,
operators) across **Tanzania, Kenya, Nigeria, and the European Union**. The
platform is built **privacy-by-design** (GDPR Art. 25) with:

- Per-column data classification (`packages/database/src/security/data-classification.ts`)
- Per-jurisdiction rule registry (`packages/domain-models/src/common/jurisdictional-rules.ts`)
- Field-level encryption at rest for `RESTRICTED` and `CONFIDENTIAL` columns
- Right-to-erasure executor (`packages/ai-copilot/src/gdpr/dsar-rtbf-executor.ts`)
- Sovereign Action Ledger for every regulator-visible action (`packages/database/src/services/sovereign-action-ledger.service.ts`)
- Tenant-isolated AI inference with prompt-shield + output-guard

The platform's **lawful basis** for processing is recorded per data flow in
[`lawful-basis-register.json`](./lawful-basis-register.json) — the legally
required Article 30 / PDPA s.7 record.

## Jurisdictional runbooks

| Jurisdiction | Statute | Regulator | Breach window | Localisation | Runbook |
|---|---|---|---|---|---|
| Tanzania | Personal Data Protection Act 2022 | PDPC | 72 hours | **Yes** | [PDPA-tz-runbook.md](./PDPA-tz-runbook.md) |
| Kenya | Data Protection Act 2019 | ODPC | 72 hours | No | [DPA-ke-runbook.md](./DPA-ke-runbook.md) |
| Nigeria | Nigeria Data Protection Act 2023 | NDPC | 72 hours | No (sector-specific) | [NDPA-ng-runbook.md](./NDPA-ng-runbook.md) |
| EU | GDPR (2016/679) | National DPAs | 72 hours | No (SCC required) | [GDPR-eu-runbook.md](./GDPR-eu-runbook.md) |

All four statutes converge on:
- 72-hour breach notification window
- Lawful-basis requirement (consent / contract / legal obligation / legitimate interest)
- Data-subject rights: access, rectification, erasure, portability, restriction
- Mandatory DPO appointment above threshold
- DPIA for high-risk processing

## Cross-cutting playbooks

| Playbook | Purpose |
|---|---|
| [right-to-erasure-playbook.md](./right-to-erasure-playbook.md) | Cross-jurisdictional RTBF handler — table-by-table walk |
| [breach-notification-runbook.md](./breach-notification-runbook.md) | 72-hour notification flows per jurisdiction + templates |
| [audit-log-retention-policy.md](./audit-log-retention-policy.md) | Per-jurisdiction retention rules (sovereign action ledger, audit_events) |
| [consent-revocation-runbook.md](./consent-revocation-runbook.md) | Action list when consent withdraws |
| [cross-border-transfer-policy.md](./cross-border-transfer-policy.md) | SCC / TIA / adequacy decisions |
| [dpia-template.md](./dpia-template.md) | Data Protection Impact Assessment template |
| [lawful-basis-register.json](./lawful-basis-register.json) | **Article 30 / PDPA s.7 record** — every PII column mapped |

## Legacy (pre-Phase F.7) compliance documents

These predate the F.7 runbook set and remain valid reference material:

- [DPA_TEMPLATE.md](./DPA_TEMPLATE.md) — generic DPA template
- [GDPR_ARTICLE_30.md](./GDPR_ARTICLE_30.md) — GDPR Art. 30 record-keeping notes
- [SOC2_CONTROLS.md](./SOC2_CONTROLS.md) — SOC 2 Type II control matrix
- [TZ_PDPA_2022.md](./TZ_PDPA_2022.md) — original PDPA 2022 reading notes

The F.7 runbooks supersede these for operational use; the legacy files
remain for historical context.

## How this directory maps to the codebase

| Compliance topic | Code location |
|---|---|
| Per-jurisdiction statute facts | `packages/domain-models/src/common/jurisdictional-rules.ts:dataProtection` |
| Per-column classification | `packages/database/src/security/data-classification.ts` |
| RTBF executor | `packages/ai-copilot/src/gdpr/dsar-rtbf-executor.ts` |
| PII scrubber (logs / LLM I/O) | `packages/ai-copilot/src/security/pii-scrubber.ts` |
| Sovereign Action Ledger | `packages/database/src/services/sovereign-action-ledger.service.ts` |
| Encryption at rest | `packages/database/src/security/encryption/` |
| Audit logger | `packages/observability/src/audit-logger.ts` |
| Tracing + OTel export | `packages/observability/src/tracing/` |

## DPO contacts (placeholders)

- **Global DPO**: `<DPO_CONTACT>`
- **EU representative (Art. 27)**: `<EU_REP_CONTACT>`
- **TZ data controller representative**: `<TZ_CONTROLLER_CONTACT>`
- **KE data controller representative**: `<KE_CONTROLLER_CONTACT>`
- **NG data controller representative**: `<NG_CONTROLLER_CONTACT>`
- **Incident hotline**: `<INCIDENT_HOTLINE>`
- **Legal counsel**: `<LEGAL_COUNSEL_CONTACT>`

These placeholders must be substituted in `.env` / secrets manager before
the first production deployment.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
