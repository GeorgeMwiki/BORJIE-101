# 10 — Audit Trail & Evidence (Tanzania)

**Document version:** 1.0
**Date:** 2026-05-22
**Owner:** CCO
**Jurisdiction:** Tanzania
**Source files (canonical, path:line):**
- `packages/database/src/schemas/audit-events.schema.ts` (120 lines) — unified audit event table
- `packages/database/src/schemas/sovereign-action-ledger.schema.ts` (98 lines) — immutable record of consequential agent actions
- `packages/database/src/schemas/cross-tenant-denials.schema.ts` (52 lines) — RLS denial telemetry
- `packages/database/src/schemas/ai-audit-chain.schema.ts` — AI-specific chain entries
- `packages/database/src/schemas/kernel-action-audit.schema.ts` — kernel tool-call audit
- `packages/database/src/schemas/field-encryption-audit.schema.ts` — field-level decryption access log
- `packages/database/src/schemas/sovereign-approvals.schema.ts` — four-eyes approval records
- `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines) — HMAC chain implementation
- `services/api-gateway/src/composition/audit-sink-drizzle-adapter.ts` — write path
- `services/api-gateway/src/composition/audit-trail-repository.ts` — read path
- `services/api-gateway/src/composition/audit-verify-cron.ts` — `verifyRandomSample` 24-h cron
- `services/api-gateway/src/composition/sovereign-ledger-verify-cron.ts` — sovereign-ledger verification cron
- `services/api-gateway/src/routes/audit-trail.router.ts` + `admin-audit.router.ts` + `autonomous-actions-audit.router.ts` — read APIs
**Aligned to:** OCSF (Open Cybersecurity Schema Framework) 1.2; PDPA s.31 (record-keeping); FIU AML record-keeping (5+ years); BoT supervisory expectation of complete, tamper-evident records.

---

## 1. Design principles

The Borjie audit trail is built on four properties:

1. **Append-only:** Every event is an insert; updates and deletes are blocked at the database trigger + RLS level.
2. **Tamper-evident:** Every row contains a hash of its content + the previous row's hash, forming an HMAC chain (HMAC-SHA-256, key in `AUDIT_HASH_SECRET`).
3. **Verifiable on read and on schedule:** Tail (last 5 events) verified on every read of an audit-relevant entity; full chain verified on access of any flagged session; random-sample verification runs every 24 h via cron.
4. **Comprehensive:** All security events, financial events, model decisions, agent actions, admin operations and consent / privacy events are written to the unified audit log.

## 2. Schema

The unified audit table records each event with the following structure (drizzle schema at `packages/database/src/schemas/audit-events.schema.ts`, 120 lines):

```typescript
interface UnifiedAuditEvent {
  id: string;
  module: 'auth' | 'payments' | 'lease' | 'maintenance' | 'communication' | 'ai' | 'admin' | 'gdpr';
  event_type: string;
  timestamp: string; // ISO 8601 UTC
  tenant_id: string;
  actor: {
    user_id?: string;
    role?: string;
    type?: 'USER' | 'AI' | 'SYSTEM';
    ip?: string;
  };
  subject: { // who or what the event is about
    type: 'tenant' | 'property' | 'lease' | 'payment' | 'document' | 'model';
    id: string;
  };
  payload: unknown; // structured per event_type; PII tagged
  prev_hash: string;
  row_hash: string;
  source_table: string;
}
```

## 3. Event categories

| Category | Examples | Module |
|---|---|---|
| Authentication | login, logout, MFA challenge, password reset, JWT issued | `auth` |
| Authorization | role grant / revoke, RLS policy hit, kill-switch toggled | `auth` |
| Data access | DSAR fetch, admin query, export, document download | `gdpr` |
| Data modification | tenant create / update, lease change, property change | per module |
| Payments | rent received, refund issued, disbursement to owner, M-Pesa STK initiated, callback received, reconciliation match / break | `payments` |
| Lease lifecycle | signed, renewed, terminated, eviction notice issued | `lease` |
| Maintenance | request opened, assigned to vendor, completed, escalated | `maintenance` |
| Communication | message sent, voice call initiated / completed, transcript saved | `communication` |
| AI / agent | tool call, policy decision, intent verification, kill-switch trigger, model output, debate vote, judge eval | `ai` |
| Privacy | consent grant / withdraw, DSAR receipt / fulfilment, RTBF execution | `gdpr` |
| Model governance | promotion, validation report attached, retire, kill-switch | `ai` |
| Security | anomaly detected, IP block, MFA force, key rotation, encryption-key access | `auth` |
| Admin / config | feature-flag change, kill-switch toggle, tenant onboarded, vendor secret rotated | `admin` |

## 4. Hash-chain integrity

The hash-chain implementation lives in `packages/ai-copilot/src/security/audit-hash-chain.ts` (651 lines). Highlights:

- **Read path:** `verifyTail` runs a 5-row HMAC re-computation on every read of an audit-relevant entity; if a break is detected, the read returns `tampered: true` and an audit event is emitted to page the security team. Wired through `services/api-gateway/src/composition/audit-trail-repository.ts`.
- **Cron path:** `verifyRandomSample` runs every 24 h via `services/api-gateway/src/composition/audit-verify-cron.ts`; picks N random sessions / event chains; verifies each end-to-end. Slow tampering is therefore caught within a sampling cycle.
- **Sovereign-ledger path:** `services/api-gateway/src/composition/sovereign-ledger-verify-cron.ts` independently verifies the sovereign-action ledger (`packages/database/src/schemas/sovereign-action-ledger.schema.ts`) on the same cadence.
- **API path:** `POST /api/audit-trail/verify-chain` (route `services/api-gateway/src/routes/audit-trail.router.ts`) allows on-demand full verification of a specific chain by an authorised compliance user. Admin variant at `admin-audit.router.ts`.
- **Cross-tenant denials:** every RLS denial is recorded to `packages/database/src/schemas/cross-tenant-denials.schema.ts` (52 lines) and is itself part of the audit chain.

### 4.1 Threat model

| Threat | Mitigation |
|---|---|
| Insider with service-role key forges a row | HMAC requires `AUDIT_HASH_SECRET`, stored in separate KMS-wrapped env; service-role key alone cannot forge a valid chain |
| Reorder events | `event_index` included in HMAC — any reorder breaks chain |
| Delete events | Database trigger blocks `DELETE`; RLS denies; `FORCE RLS` on table |
| Tamper with payload | Payload included in HMAC; any change breaks chain |
| Replay attack from backup | Restore procedure includes chain-verification step before promotion |

## 5. Retention

| Record type | Retention | Statutory basis |
|---|---|---|
| Audit events (general) | 7 years | Tax Administration Act; PDPA accountability principle |
| Payment events | 7 years | Tax + AML record-keeping |
| Tenant-identity verification records | 7 years from end of business relationship | AML Regulations regulation 29 |
| Voice transcripts | 2 years (default); 7 years if material to dispute | Operational + dispute resolution |
| Consent records | Lifetime of relationship + 5 years | PDPA accountability |
| Model decisions affecting tenant materially | 10 years | SR 11-7 model documentation retention |
| Security incident records | 10 years | BoT supervisory expectation |

## 6. Sample audit packet (example examiner request)

If PDPC requests an audit packet for tenant T-12345 covering 2026:

1. Pull all events from `audit_events` where `tenant_id = 'T-12345' AND timestamp BETWEEN '2026-01-01' AND '2026-12-31'`.
2. Verify chain integrity over selected range; attach verification report.
3. Redact PII of unrelated tenants (none should appear given tenant_id scoping, but verified).
4. Bundle as ZIP with: events JSON, chain-verification report, consent record export, DSAR history, communication log.
5. Encrypted delivery to PDPC contact; access logged as `audit.regulator_packet.delivered`.

## 7. Access controls

- Read access to audit log: DPO, CCO, MLRO, CISO, designated regulator-liaison.
- Read access scoped per tenant for property-mgr / owner via RLS (they see only their own data).
- Service accounts can only **insert**; explicit deny on `update` / `delete` at DB layer.
- All access logged as a meta-event (`audit.access`).

## 8. Cross-references

- DSAR endpoints (read of own data) → doc 03 §7
- Incident-response evidence preservation → doc 07 §6.2
- Backup & recovery of audit chain → doc 08 §3.1 (RPO = 0)
- Model decision logging → doc 05

> TODO: insert sample chain-verification report screenshot; insert sample regulator-packet manifest.

## 9. Audit dashboards

| Dashboard | URL placeholder |
|---|---|
| Grafana — audit-events volume per module | `https://grafana.borjie.com/d/audit-events/audit-events-volume` |
| Grafana — chain-integrity verification cron success | `https://grafana.borjie.com/d/audit-chain/audit-chain-integrity` |
| Grafana — sovereign-ledger verification cron | `https://grafana.borjie.com/d/sovereign-ledger/sovereign-ledger-integrity` |
| Grafana — RLS denials | `https://grafana.borjie.com/d/rls-denials/rls-denial-rate` |
| Grafana — field-encryption-audit access | `https://grafana.borjie.com/d/field-encryption/field-encryption-audit` |

---

## Appendix A — Board Sign-Off

| Role | Name | Date | Signature URL |
|---|---|---|---|
| CCO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/cco/regulator-pack-tz-10-v1.0` |
| CISO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/ciso/regulator-pack-tz-10-v1.0` |
| DPO | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/dpo/regulator-pack-tz-10-v1.0` |
| Board Audit Committee Chair | _TODO — appoint_ | _yyyy-mm-dd_ | `https://docs.borjie.com/signoffs/bac/regulator-pack-tz-10-v1.0` |

## Appendix B — Version History

| Version | Date | Change | Approver |
|---|---|---|---|
| 1.0.0 | 2026-05-22 | Initial scaffold | CCO |
| 1.1.0 | 2026-05-22 | Real schema + route + cron path:line refs + dashboards (Wave-12) | CCO |

## Appendix C — Review Cadence

- **Annual** — full review of retention table + access controls; board sign-off
- **Quarterly** — CCO + CISO review chain-verification cron results + random-sample reports
- **Out-of-cycle** — any chain tamper detection, regulator request for evidence, or material change to audit schema
