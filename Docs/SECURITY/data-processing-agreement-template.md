# Data Processing Agreement (DPA) + Standard Contractual Clauses (SCC) — template

**Audience:** Borjie DPO, legal counsel, PCCB liaison, regulator
reviewer for the first three commercial mining tenants.
**Status:** TEMPLATE — fill the bracketed slots before counter-signing.
**Companion docs:**
[`Docs/SECURITY/DATA_RESIDENCY_PHASE_1.md`](./DATA_RESIDENCY_PHASE_1.md)
(Phase-1 posture),
[`Docs/SECURITY/PCCB_PDPA_AUDIT_2026-05-29.md`](./PCCB_PDPA_AUDIT_2026-05-29.md)
§3 (three-phase remediation plan),
[`Docs/SECURITY/SECURITY_AUDIT_2026-05-29.md`](./SECURITY_AUDIT_2026-05-29.md)
§5 (S-5 PCCB/PDPA scope).
**Statutes:** Personal Data Protection Act 2022 (PDPA — Tanzania),
PCCB Data Protection Commission Guideline 4/2025, EU Standard
Contractual Clauses (Commission Implementing Decision (EU)
2021/914).

This template is the Borjie-side counterpart to Supabase's published
DPA at <https://supabase.com/legal/dpa>. The two together form the
binding-corporate-rules contract that satisfies PDPA s.39(2) for
cross-border transfer to the EU.

> Where the template references "[Borjie Limited]" / "[Mining Co.]" /
> "[country]" replace with the actual corporate entity at sign time.

---

## 1. Parties

- **Controller:** [Mining Co.], a [country]-incorporated company,
  acting as data controller for the personal data of its workforce,
  cooperative members, and counterparties.
- **Processor:** Borjie Limited, a Tanzania-incorporated company,
  acting as data processor on the Controller's behalf for the purpose
  of operating the Borjie SaaS platform.
- **Sub-processor:** Supabase, Inc., a Delaware corporation operating
  managed Postgres at AWS eu-central-1 (Frankfurt, Germany).

---

## 2. Subject matter, duration, nature, and purpose of processing

| Field | Value |
|-------|-------|
| Subject matter | SaaS platform for mining-estate operations: licences, royalty, workforce, treasury, compliance, marketplace, holdings, subsidiaries, ancillary businesses, family office, succession, asset register. |
| Duration | For the term of the Controller's Borjie subscription + 30-day post-termination grace period; thereafter retention limited to the legal minimum (Tanzania Companies Act 2002 s.155 — 7 years for financial records). |
| Nature | Storage, retrieval, computation (aggregations, AI inference), transmission, logging, audit, backup. |
| Purpose | (a) Operate the SaaS; (b) provide the AI co-pilot and decision-support functions; (c) comply with regulator filing duties; (d) provide aggregate analytics across Controller's own tenant. |

---

## 3. Categories of data subjects

- The Controller's directors, owners, beneficial owners, and shareholders.
- The Controller's workforce (full-time, part-time, cooperative members,
  contractors).
- The Controller's counterparties (buyers, suppliers, brokers, regulators,
  banks, insurers).
- Visitors to the Controller's mining sites whose images are captured by
  on-site CCTV / mobile camera streams piped into Borjie.

---

## 4. Categories of personal data

- Identifiers: full name, NIDA (national-ID number), Tanzania Revenue
  Authority (TIN), driver licence number, mining-licence holder number.
- Contact: phone (incl. M-Pesa MSISDN), email, postal address, physical
  site address.
- Financial: bank account (anonymised post-settlement), M-Pesa /
  mobile-money references, sale prices, royalty payments.
- Biometric (s.11 PDPA): fingerprint / face templates used for clock-in
  attendance (workforce-mobile WebAuthn flow).
- Location: GPS coordinates of workers during shift hours; per-site
  geofence events.
- Communications: chat transcripts between the Controller's users and
  Borjie's AI co-pilot; voice transcripts (Swahili STT).
- Inferred attributes: AI co-pilot predictions, recommendations, risk
  scores; cited evidence chains.

---

## 5. Cross-border transfer

### 5.1 Recipient country + region
- Country: Germany (EU member state).
- Region: AWS eu-central-1 (Frankfurt).
- Sub-processor: Supabase, Inc. (Delaware).

### 5.2 Legal basis
- PDPA s.39(2)(a) — recipient country is on the PCCB Guideline 4/2025
  adequacy whitelist (European Union).
- PDPA s.39(2)(b) — this DPA + Supabase's SCC together form a binding
  processor agreement compliant with EU Commission Implementing
  Decision (EU) 2021/914.

### 5.3 Adequacy decision evidence
- EU GDPR + adequacy reciprocity decisions vis-à-vis several African
  jurisdictions.
- PCCB Guideline 4/2025 §7.2 (whitelist of equivalent jurisdictions).
- Supabase published DPA at <https://supabase.com/legal/dpa>.

### 5.4 Phase-2 + Phase-3 commitment
- Phase 2 (Q3 2026 target): migrate primary Postgres to AWS af-south-1
  (Cape Town) — EAC-proximate, lower latency for the user base, and
  brings the data inside the African continent. EU instance becomes a
  read-only analytics secondary excluding PII columns.
- Phase 3 (Q4 2026 target): notify PCCB of primary-region change; the
  SCC dependency drops to "analytics-only / no PII" scope.

---

## 6. Technical and organisational measures (PDPA s.34)

### 6.1 Access control
- TLS 1.3 in transit (Supabase + gateway helmet config). HSTS preload
  with `max-age=31536000; includeSubDomains; preload`.
- AES-256 at rest (Supabase managed default + Borjie envelope encryption
  for sensitive PII columns).
- Per-tenant Row-Level Security FORCE-enabled on every PII table; GUC
  `app.current_tenant_id` bound by api-gateway middleware before any
  query executes.
- Per-tenant API keys; HS256 / ES256 / RS256 JWTs with pinned `alg`
  arrays; 15-minute session TTL; rotating refresh tokens.

### 6.2 Encryption
- Application-layer field encryption via envelope encryption with KMS
  master key for sensitive PII columns (`packages/database/src/
  encryption/`).
- Per-field encryption audit (`field_encryption_audit` table) records
  every read / write.

### 6.3 Authentication
- Supabase Auth (canonical) with HS256 JWTs; MFA opt-in for owners and
  admins; rate-limit 5 attempts/IP/10 min with 15-min lockout on the
  public-auth router.

### 6.4 Logging + monitoring
- Structured logging via Pino with PII redaction (
  `packages/observability/src/pii-redactor.ts`); redacted keys cover
  every PDPA-relevant identifier.
- OpenTelemetry traces on every gateway request; Sentry for error
  triage; cross-org denial recorder for tenant-isolation alerts.
- Append-only hash-chained audit (`ai_audit_chain`); recorder uses
  `chainHash(prev, payload)` and writes both `prev_hash` and
  `entry_hash`; trigger refuses UPDATE / DELETE.

### 6.5 Pseudonymisation
- DSR right-to-erasure pseudonymises rather than deletes where
  financial-record retention duties apply (Tanzania Companies Act 2002
  s.155).

### 6.6 Backup + recovery
- Supabase nightly snapshots + WAL replay.
- Documented RTO ≤ 4 h, RPO ≤ 1 h for the SaaS gateway.

### 6.7 Tenant isolation
- Seven-layer defence in depth (DB RLS, Drizzle middleware, Hono
  middleware, audit chain guard, storage prefix, Pino tenant scrubber,
  brain-tool guard).
- 16 adversarial regression tests pinning every layer
  (`services/api-gateway/src/__tests__/cross-tenant-isolation.test.ts`).

### 6.8 Incident response
- 72-hour PCCB breach notification per PDPA s.51; full operational
  runbook at `Docs/SECURITY/RUNBOOK_BREACH_NOTIFY.md` (shipped
  2026-05-29).
- On-call rotation; security@borjie.co.tz mailbox; PCCB liaison
  contact.

### 6.9 Sub-processor management
- Sub-processors listed at `apps/marketing/src/app/legal/subprocessors/
  page.tsx`.
- Change-of-sub-processor notification: 30-day advance notice to the
  Controller via in-app banner + email; Controller may object and
  terminate without penalty if it does not accept the new sub-processor.

---

## 7. Standard Contractual Clauses (SCC) — Module 2 (Controller → Processor)

This DPA incorporates by reference the EU Standard Contractual Clauses
(Commission Implementing Decision (EU) 2021/914), Module 2 (Controller
to Processor), available at
<https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj>.

The following SCC slots are populated:

- **Annex I.A — list of parties:** §1 above.
- **Annex I.B — description of transfer:** §2 + §4 above.
- **Annex I.C — competent supervisory authority:** Personal Data
  Protection Commission (PCCB), Tanzania — `complaints@pdpc.go.tz`.
- **Annex II — technical and organisational measures:** §6 above.
- **Annex III — list of sub-processors:** Supabase, Inc. (§1.3
  above); current full list at
  <https://borjie.co.tz/legal/subprocessors>.

---

## 8. Liability

The Controller acknowledges that the Processor's aggregate liability
is capped at the prior 12 months of subscription fees paid, EXCEPT
where uncapped under PDPA s.49 (criminal sanctions) or for breach of
the data-subject-rights obligations in §10 below.

---

## 9. Term + termination

This DPA is co-terminous with the Borjie subscription agreement. On
termination:

- The Processor returns or deletes the Controller's data within 30
  days (subject to retention duties in §2 above).
- Cryptographic destruction of KMS keys is the default; a Controller
  may request key escrow at termination, billable.

---

## 10. Data-subject rights (PDPA s.27–s.31)

The Processor will assist the Controller in responding to data-subject
requests within 30 days of receipt, including:

- **Right of access (s.27):** `GET /api/v1/gdpr/data-export` (current);
  per-data-subject self-service via #194's
  `POST /api/v1/me/data-export`.
- **Right of correction (s.28):** owner can self-update via owner-web
  Settings → Profile.
- **Right to erasure (s.23):** `POST /api/v1/gdpr/erase` (current);
  per-data-subject self-service via #194's
  `POST /api/v1/me/erase`. Erasure cascades to users, audit_chain,
  decision_traces, cross_tenant_denials, ledger entries (anonymised,
  NOT deleted — financial retention duty).
- **Right to portability (s.30):** JSON export from
  `GET /api/v1/gdpr/data-export`; CSV on request.
- **Right to object (s.31):** opt-out switches in Settings → Privacy
  for AI co-pilot inference + marketing communications.

---

## Appendix A — Record of Processing Activities (RoPA) entry

To be added to the central Borjie RoPA register at processor-internal
location `services/api-gateway/src/composition/ropa.ts` (file
intentionally not in the public repo; lives only on operator
machines and the regulator portal):

| Field | Value |
|-------|-------|
| Processing activity name | Borjie SaaS — primary tenant Postgres |
| Controller | [Mining Co.] |
| Processor | Borjie Limited |
| Sub-processor | Supabase, Inc. (AWS eu-central-1) |
| Subject categories | §3 above |
| Data categories | §4 above |
| Purposes | §2 above |
| Lawful basis (PDPA s.5) | Contract + Legitimate Interest + Legal Obligation |
| Sensitive-data basis (PDPA s.11) | Explicit consent (biometric clock-in) + Legal Obligation (financial / mining-licence reporting) |
| Cross-border transfer | EU adequacy (PCCB Guideline 4/2025) + SCC Module 2 |
| Retention | Subscription term + 7 years (financial); subscription term + 30 days (other) |
| Security measures | §6 above |

---

## Appendix B — Cross-border-transfer authorisation request to PCCB

Borjie submits this request to the Personal Data Protection Commission
(PCCB) of Tanzania:

> **Date:** [filing date]
> **Filer:** Borjie Limited, [Tanzania incorporation no.],
> [registered address].
> **Re:** Cross-border transfer authorisation under PDPA s.39 +
> PCCB Guideline 4/2025.
>
> Borjie Limited operates the Borjie SaaS platform on behalf of
> mining-estate operators in Tanzania. The platform's primary data
> store is managed Postgres at Supabase, Inc., hosted in AWS
> eu-central-1 (Frankfurt, Germany).
>
> The European Union is on the Commission's adequacy whitelist per
> Guideline 4/2025 §7.2.
>
> Borjie has entered into a Data Processing Agreement with Supabase
> incorporating the EU Standard Contractual Clauses (Commission
> Implementing Decision (EU) 2021/914) Module 2 (Controller to
> Processor). Copy attached as Annex I.
>
> The technical + organisational measures protecting the data are
> documented in Annex II (PDPA s.34 controls).
>
> Borjie commits to migrating the primary Postgres to AWS af-south-1
> (Cape Town) in Q3 2026 (Phase 2) and to notifying the Commission of
> the regional change (Phase 3, Q4 2026). At that point cross-border
> transfer of PII to the EU ceases; only non-PII analytics data is
> retained in the EU read replica.
>
> Borjie respectfully requests the Commission's authorisation to
> proceed with cross-border transfer to the EU under the legal basis
> set out in PDPA s.39(2)(a) + (b).
>
> **Signed:**
> Mr. Mwikila, Chief Security Officer + DPO, Borjie Limited.

---

## Appendix C — Counter-party fill-in slots

| Slot | Fill-in value |
|------|----------------|
| Controller corporate name | _______________________________________ |
| Controller incorporation country | _______________________________________ |
| Controller registered office | _______________________________________ |
| Controller DPO email | _______________________________________ |
| SCC effective date | _______________________________________ |
| First-tenant go-live date | _______________________________________ |
| Phase-2 migration committed-by date | _______________________________________ |
| PCCB authorisation receipt | _______________________________________ |
| DTIA filing receipt | _______________________________________ |

---

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Borjie DPO | ____________________ | ____________________ | __________ |
| Controller DPO | ____________________ | ____________________ | __________ |
| Supabase counter-signature (via Supabase DPA portal) | n/a — accepted via portal | n/a | __________ |

End of DPA + SCC template.
