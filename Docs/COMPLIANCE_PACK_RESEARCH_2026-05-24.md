# Compliance Pack Research — 2026-05-24

Research notes feeding the design of `packages/compliance-pack`. Sources
cited inline; this file is the durable trail for auditors and future
maintainers asking "why these choices?".

## Scope

Frameworks covered, each modeled as a `ControlSpec[]` catalog in
`src/frameworks/`:

| Code             | Framework                                              | Jurisdiction(s)                 |
|------------------|--------------------------------------------------------|---------------------------------|
| `soc2`           | SOC 2 Type II (AICPA TSC 2017, rev 2022)               | Global (US auditor standard)    |
| `iso27001`       | ISO/IEC 27001:2022 (Annex A, 93 controls in 4 themes)  | Global (ISO/IEC)                |
| `gdpr`           | GDPR (EU Regulation 2016/679)                          | EU/EEA + extraterritorial       |
| `ccpa`           | California Consumer Privacy Act + CPRA                 | California (US)                 |
| `popia`          | Protection of Personal Information Act (Act 4 of 2013) | South Africa                    |
| `tz-dpa`         | Tanzania Personal Data Protection Act, 2022            | Tanzania                        |
| `ke-dpa`         | Kenya Data Protection Act, 2019                        | Kenya (ODPC enforces)           |
| `ug-dpa`         | Uganda Data Protection and Privacy Act, 2019           | Uganda                          |
| `rw-dpa`         | Rwanda Data Protection and Privacy Law 058/2021        | Rwanda                          |
| `ng-ndpr`        | Nigeria NDPR + Data Protection Act 2023                | Nigeria (NDPC enforces)         |

## 12 cited sources (online research)

1. **GDPR Article 15 (right of access)** — https://gdpr-info.eu/art-15-gdpr/  
   Subject access request: confirm processing, copy of data, purposes,
   recipients, retention. Electronic requests get electronic form.
2. **GDPR Article 17 (right to erasure / "right to be forgotten")** —
   https://en.wikipedia.org/wiki/Right_to_be_forgotten  
   Erasure triggers (consent withdrawn, no-longer-necessary, child data);
   exemptions (journalism, public interest, archival); cascade duty —
   controller must take "all reasonable steps incl. technical measures"
   to inform downstream processors.
3. **GDPR full article index** — https://gdpr-info.eu  
   Articles 13/14 (notice at collection), 20 (portability), 25 (PbD &
   PbDefault), 30 (records of processing), 32 (security of processing),
   33 (breach notification — 72h to SA), 35 (DPIA when high risk).
4. **CCPA + CPRA consumer rights** —
   https://en.wikipedia.org/wiki/California_Consumer_Privacy_Act  
   Six rights: know, transparency, opt-out (sale/share), access, delete,
   non-discrimination. 45-day verifiable-request response window (one
   45-day extension permitted). CPRA added the California Privacy
   Protection Agency (CPPA).
5. **CCPA regulations index (OAG)** — https://oag.ca.gov/privacy/ccpa/regs  
   Cited the regs filing trail; relied on the statute (Civil Code
   §1798.100 et seq.) for specifics.
6. **SOC 2 — Trust Services Criteria** —
   https://en.wikipedia.org/wiki/SOC_2  
   Five categories (Security, Availability, Processing Integrity,
   Confidentiality, Privacy). Common Criteria CC1–CC5 (control env,
   communication, risk, monitoring, control activities); CC6–CC9 added
   for system ops, change mgmt, risk mitigation, and vendor mgmt.
7. **ISO/IEC 27001** — https://en.wikipedia.org/wiki/ISO/IEC_27001  
   2022 edition restructures Annex A into 4 themes — Organizational
   (A.5), People (A.6), Physical (A.7), Technological (A.8) — totaling
   93 controls. Down from 114 in the 2013 edition (consolidation, not
   reduction).
8. **POPIA (South Africa)** —
   https://popia.co.za/section-18-notification-to-data-subject-when-collecting-personal-information/  
   Sections 18 (notification at collection), 19 (security safeguards —
   "appropriate, reasonable technical and organisational measures"),
   20 (operator processing per controller instruction), 21 (operator
   security measures), 22 (breach notification — "as soon as reasonably
   possible" to Information Regulator + data subjects).
9. **Kenya DPA 2019 + ODPC** —
   https://www.dataprotection.go.ke/  
   30-day DSAR response, 72-hour breach notification to ODPC,
   mandatory registration of data controllers/processors above certain
   thresholds, cross-border transfer restrictions.
10. **AWS KMS concepts (key hierarchy)** —
    https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html  
    Customer Managed Keys (CMK), HSM-backed; key hierarchy:
    Domain key → HBK → Derived encryption key → Customer Data Key.
    Multi-region keys (`mrk-…`) for residency replication.
11. **AWS Encryption SDK envelope encryption + encryption context** —
    https://docs.aws.amazon.com/encryption-sdk/latest/developer-guide/concepts.html  
    Envelope encryption pattern. **Encryption context = additional
    authenticated data (AAD)**. Bound cryptographically to ciphertext;
    same context required to decrypt. Use `{tenantId, fieldName,
    resourceType}` as context to prevent cross-tenant decryption.
    Key commitment guarantees one ciphertext → exactly one plaintext.
12. **Right to be forgotten — cascade duties** —
    https://en.wikipedia.org/wiki/Right_to_be_forgotten  
    Controller must inform third parties processing the data so they
    can also erase. Implementation = downstream cascade (joins,
    derived analytics, backups, search indices). Backup-tape erasure
    is "best-effort within reasonable time + technical measure".

## Per-jurisdiction breach SLAs

| Jurisdiction | Notify Regulator       | Notify Subjects        |
|--------------|------------------------|------------------------|
| GDPR (EU)    | 72 hours               | "Without undue delay" if high risk |
| UK GDPR      | 72 hours               | "Without undue delay" if high risk |
| CCPA (CA)    | None (AG enforcement)  | "In most expedient time possible" |
| POPIA (ZA)   | "ASAP" (no fixed hours)| "ASAP"                 |
| TZ-DPA       | 72 hours               | 72 hours               |
| KE-DPA       | 72 hours               | 72 hours               |
| UG-DPA       | 72 hours               | "Without undue delay"  |
| RW-DPA       | 48 hours               | "Without undue delay"  |
| NG-NDPR/DPA  | 72 hours               | "Without undue delay"  |

Codified in `src/breach/sla-table.ts`.

## DSAR automation pattern (Transcend / OneTrust / DataGrail observed)

1. **Intake** — verifiable consumer request, identity proof, channel
   (web form, email, phone, mailed letter, authorised agent).
2. **Triage** — kind ∈ {access, erasure, portability, rectification,
   opt-out, limit-use}; jurisdiction binding determines SLA.
3. **Fan-out collector** — walks every PII-bearing table for the
   subject id; calls registered "collectors" per package.
4. **Manifest** — deterministic JSON manifest with `{table, rows, cols,
   action}` for review / audit.
5. **Execution** — `processX` runs the manifest in a transaction with
   per-row idempotency keys so replays are safe.
6. **Response** — packaged for the data subject (JSON / CSV / signed
   download URL).

`src/dsar/*` implements this pipeline pure-functionally with pluggable
collectors (Drizzle-style query interface, no DB dependency at type
level so it's testable with fixtures).

## Erasure cascade — strategies

For each tenant-data table the cascade declares **one** strategy:

- **`hard_delete`** — row physically removed. Used for ephemeral data
  (sessions, draft comms, transient artefacts).
- **`anonymize`** — PII fields replaced with deterministic stable
  hashes; row remains for referential integrity. Used for
  audit-relevant rows where the action (not the actor) matters.
- **`pseudonymize`** — PII fields encrypted with a key destroyed at
  erasure time; row recoverable only with the destroyed key (i.e.
  effectively unrecoverable). Used where regulator demands
  reversibility option pre-disposal.
- **`tombstone`** — row replaced with a marker row (`{erased_at,
  reason}`). Used where downstream joins would break.
- **`legal_hold`** — row NOT erased; flagged with retention reason
  + earliest-erasure date. Used for financial records under TZ Income
  Tax Act § 80 (7-year retention) and similar.

The cascade respects a **legal-hold priority** — if any rule on a
table is `legal_hold`, the table is NOT erased regardless of any
other matching rule.

## Envelope encryption — design

Adapters: `createInMemoryEnvelopeEncryptor()` (tests) and
`createAWSKMSEnvelopeEncryptor({ keyId, region })` (production).

API:
```
encrypt({ plaintext, context }): { ciphertext, dek }
decrypt({ ciphertext, dek, context }): plaintext
```

The **`context`** is a `{ tenantId, field, resource }` triple bound to
the ciphertext as AAD. A ciphertext encrypted for tenant A with field
`email` cannot be decrypted with context `{tenant: B, field: email}` —
the decryption will throw `EncryptionContextMismatchError`. This is the
multi-tenant SaaS isolation guarantee, verified by a test that MUST
fail if removed.

DEKs are unique per encryption call (no caching), and the wrapping key
(KEK) is held in KMS — the in-memory adapter holds it in process
memory for tests only and is exported with the `UNSAFE_` prefix.

## Residency policy

Per-tenant policy:
```
{ tenantId, region: 'eu-west-1' | 'us-east-1' | 'af-south-1' | ...,
  allowFailover?: boolean }
```

Decision matrix for `checkResidency({ operation, region })`:

| tenant.region | operation.region | allowFailover | Decision                       |
|---------------|------------------|----------------|--------------------------------|
| eu-west-1     | eu-west-1        | n/a            | `allow`                        |
| eu-west-1     | eu-central-1     | true           | `allowed_with_replication`     |
| eu-west-1     | eu-central-1     | false          | `deny`                         |
| eu-west-1     | us-east-1        | n/a            | `deny` (cross-region forbidden)|

Per-table overrides exist (some tables are global by design — e.g.
the `country_metadata` reference table).

## Test plan (target 60+)

- **Frameworks** (10 files × ≥5 controls = 50+ catalog entries) — every
  framework exports ≥ 5 controls; `controlsByJurisdiction` and
  `featuresSatisfyingControl` return expected sets.
- **DSAR** — access request gathers expected rows from fixtures;
  erasure produces a deterministic manifest; portability format obeys
  user choice.
- **Erasure cascade** — each strategy produces the right end state;
  legal-hold respected even with a competing rule.
- **Encryption** — round-trip works; cross-tenant decryption FAILS;
  context tampering FAILS.
- **Residency** — every decision matrix row covered.
- **Breach** — required-notifications respects per-jurisdiction SLAs;
  letters generated per template; severity escalation correct.

## Risks + deviations

- We do NOT implement actual AWS KMS calls (would require AWS SDK +
  credentials). The KMS adapter exposes the contract and a deterministic
  stub that mirrors the KMS error surface. Production wiring to live
  KMS is a separate ticket.
- We do NOT touch the database. The DSAR collector takes a typed
  `Database` port so consumers wire it to Drizzle / Postgres in their
  own integration layer.
- Frameworks are catalogs of "we satisfy this control via X"; they are
  NOT auditable evidence on their own. The companion `Docs/COMPLIANCE/`
  runbooks remain the operator-facing trail; this package is the
  programmatic registry.
