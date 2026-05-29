# PCCB / PDPA pre-launch audit — 2026-05-29

**Audience:** PCCB (Tanzania Personal Data Protection Commission)
liaison, on-call DPO, launch reviewer.
**Auditor:** Mr. Mwikila (SEC-1) — Borjie pre-launch S-5.
**Statute referenced:** Personal Data Protection Act 2022 (PDPA),
sections 23 (DSR), 39 (cross-border transfer), 51 (breach notify).
**Companion docs:** `Docs/SECURITY/SECURITY_AUDIT_2026-05-29.md` §5
and `Docs/SECURITY/THREAT_MODEL_2026.md` §7.

---

## 1. Articles covered

| PDPA section | Article topic | Borjie surface | Status |
|--------------|---------------|----------------|--------|
| s.5 | Lawful processing | Consent capture on sign-up + per-feature; consent ledger in `audit_chain` with `action='consent_grant'` / `consent_withdraw` | GREEN |
| s.6 | Purpose limitation | Each PII field tagged with purpose in `packages/database/src/encryption/audit.ts`; data minimised in `intelligence_corpus_chunks` | GREEN |
| s.11 | Sensitive data | Mining-licence holder NIDA, biometric, location all encrypted via field-encryption port | GREEN |
| s.20 | Data accuracy | Owner can self-update via `apps/owner-web/src/app/(routes)/account/` | GREEN |
| s.23 | DSR right-to-erasure | `POST /api/v1/gdpr/delete-request` exists (`services/api-gateway/src/routes/gdpr.router.ts`); PCCB-specific `POST /api/v1/me/erase` being shipped by #194 — verify after land | GREEN-pending-#194 |
| s.27 | DSR right-to-access | `GET /api/v1/gdpr/data-export` exists | GREEN |
| s.39 | Cross-border transfer | Supabase project hosts data in `eu-central-1` (Frankfurt). PCCB requires recipient-country adequacy paperwork OR EAC residency. **GAP — see §3.** | FLAGGED |
| s.51 | Breach notify (72h clock) | Runbook stub `Docs/SECURITY/RUNBOOK_BREACH_NOTIFY.md` (to be shipped with #194); incident-detection wired via cross-org denial recorder + Sentry alerts | GREEN-pending-runbook |

---

## 2. PII redaction contract

Pinned by `services/api-gateway/src/__tests__/pccb-pii-redaction.test.ts`
(6 properties × Tanzania-specific identifiers):

- NIDA national-id
- M-Pesa MSISDN (`mpesaNumber`, `mpesaPhone`)
- Driver licence
- Generic email / phone
- GPS coordinates (sensitive in artisanal mining when paired with
  identity)
- Credentials (password, accessToken, refreshToken, apiKey,
  authorization)
- Nested-object walking (audit-event payloads are tree-shaped)
- Immutability (input not mutated)

If a future commit shortens `DEFAULT_PII_FIELDS` in
`packages/observability/src/pii-redactor.ts`, this test fails loudly.

---

## 3. Cross-border transfer gap (s.39) — three-phase remediation

### Current state
- Supabase project region: **eu-central-1 (Frankfurt, Germany)**.
- PCCB requires either:
  - (a) EAC primary residency (`af-south-1` is the nearest available
    AWS region; not yet covered by Supabase managed PG), OR
  - (b) recipient-country adequacy decision + binding-corporate-rules
    contract per PDPA s.39(2).

### Phase 1 (immediate, pre-launch) — s.39(2) adequacy paperwork
- Borjie obtains a **cross-border transfer authorisation** from PCCB
  citing the EU's GDPR adequacy regime (the EU is on the PCCB
  whitelist for adequacy per PDPC Guideline 4/2025).
- Data Transfer Impact Assessment (DTIA) filed with PCCB:
  - Purpose: SaaS platform operations.
  - Recipient: Supabase Inc. (US-headquartered, EU-hosted).
  - Data categories: identifiers, location, financial.
  - Safeguards: Supabase platform AES-256-at-rest, TLS 1.3 in
    transit, Borjie application-layer field encryption, audit-chained
    access.
- DPO signs the Standard Contractual Clauses (SCC) with Supabase
  (Supabase publishes SCCs at <https://supabase.com/legal/dpa>).

### Phase 2 (Q3 2026) — EAC residency
- Migrate to **AWS af-south-1 (Cape Town)** with a self-hosted
  Postgres + pgvector cluster (Docker Compose template already in
  `docker-compose.production.yml`) OR switch to Supabase regional
  expansion once af-south-1 / nairobi becomes available (Supabase
  roadmap signal as of 2026-Q1).
- Replication architecture (already designed in
  `docker-compose.ha.yml`): primary in af-south-1, async read replica
  in EU for analytics only (no PII columns).

### Phase 3 (Q4 2026) — regulator primary
- Flip the application's `DATABASE_URL` to point at the af-south-1
  primary; EU instance becomes read-only-non-PII secondary.
- PCCB notification: regional migration complete; no further
  cross-border transfer of PII.
- Remove SCC dependency.

### Owner
- Compliance track: #194 (DSR endpoint + DPO sign-off).
- Deploy track: #200 (region pinning + replication).

---

## 4. Right-to-erasure (s.23) verification

### Current endpoints
- `POST /api/v1/gdpr/delete-request` (Wave 9) — tenant admin lodges
  request; `POST /api/v1/gdpr/delete-request/:id/execute` runs
  pseudonymization inside a transaction.
- `GET /api/v1/gdpr/delete-request/:id` — status.
- `GET /api/v1/gdpr/data-export` — DSAR data dump.

### #194 deliverables (post-land verification owed)
- `POST /api/v1/me/erase` — self-service version of the above,
  callable by any authenticated user; PCCB-mandated per PDPA s.23(1).
- Confirmation email + 30-day grace period.
- Audit-chain entry per erase with `action='pii_erase'`.

### Verification checklist (run when #194 ships)
- [ ] Endpoint returns 202 with grace-period timestamp.
- [ ] Erase cascades to: users, audit_chain, decision_traces,
      cross_tenant_denials, sales, ledger entries (anonymised, NOT
      deleted — financial records have a 7-year retention duty under
      Tanzania Companies Act 2002 s.155).
- [ ] Audit-chain entry created with `action='pii_erase'` and
      `actor_user_id = self`.
- [ ] Owner / tenant admin can NOT erase another user's PII without
      that user's confirmation (consent-on-behalf is illegal under
      PDPA).
- [ ] Backup retention: erased rows MUST drop from the next nightly
      backup (Supabase WAL replay aware).

---

## 5. Audit trail on PII access

- Every PII field read / write flows through the field-encryption port
  and emits a `field_encryption_audit` row (see
  `packages/database/src/encryption/audit.ts`).
- Cross-reference: `Docs/SECURITY/TENANT_LEAK_SCAN_2026_05_26.md` ¶
  audit-chain-global findings ensure the audit log is itself tenant-
  scoped.

---

## 6. Pre-launch sign-off

| Requirement | Status | Notes |
|-------------|--------|-------|
| PII redaction in logs | GREEN | 6 contract tests in `services/api-gateway/src/__tests__/pccb-pii-redaction.test.ts` |
| PII encryption at rest | GREEN | Supabase AES-256 + application-layer field encryption |
| PII encryption in transit | GREEN | TLS 1.3, HSTS preload |
| DSR right-to-access | GREEN | `/gdpr/data-export` |
| DSR right-to-erasure | GREEN-pending-#194 | Existing `/gdpr/delete-request`; self-service `/me/erase` from #194 |
| Cross-border transfer | FLAGGED | Phase-1 SCC paperwork required before launch — owner #194 + #200 |
| Breach notify (72h) | GREEN-pending-runbook | Runbook stub being shipped with #194 |
| Consent ledger | GREEN | Audit-chain entries on grant / withdraw |
| Data residency long-term | ROADMAPPED | Phase 2 (Q3) + Phase 3 (Q4) |

**Recommendation:** GREEN-with-mitigations. Ship to launch after #194
lands and Phase-1 SCC paperwork is filed with PCCB.
