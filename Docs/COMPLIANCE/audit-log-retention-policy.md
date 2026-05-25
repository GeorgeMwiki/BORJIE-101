# Audit Log Retention Policy

_Applies to: PDPA TZ s. 27(2), DPA KE s. 39 + Tax Procedures Act, NDPA NG
s. 38(1)(b), GDPR Art. 17(3)(e) + Art. 30._

## Principle

Audit data is the **legally required immutable backbone** of data-protection
compliance — without it the controller cannot demonstrate accountability
(GDPR Art. 5(2)) or compliance with statutory bookkeeping (tax / AML).

Audit data is therefore:
1. Append-only (no UPDATE; no DELETE)
2. Hash-chained (each row references the previous hash — tamper-evident)
3. **Pseudonymised on RTBF** rather than deleted
4. Retained for the longest applicable statute window

## Per-table retention

| Table | Codebase | Retention | Statute basis |
|---|---|---|---|
| `audit_events` | `packages/database/src/schemas/audit-events.schema.ts` | **Permanent** (pseudonymised on RTBF) | PDPA s. 27(2) / DPA s. 39 / NDPA s. 38(1)(b) / GDPR Art. 17(3)(e) |
| `sovereign_action_ledger` | `packages/database/src/schemas/sovereign-action-ledger.schema.ts` | **Permanent** | Same — regulator-action immutable record |
| `kernel_actions` | central-intelligence ledger | **Permanent** (pseudonymised on RTBF) | Algorithmic-accountability evidence (GDPR Art. 22 explainability) |
| `tax_filings` | per-jurisdiction tax service | **7 years** | TZ TRA Tax Administration Act; KE Tax Procedures Act s. 23; NG FIRS s. 23 |
| `kyc_events` | identity service | 7 years from last activity | TZ POCAMLA 2006; KE POCAMLA 2009; NG CBN AML/CFT 2022 |
| `payment_transactions` | payments service | 7 years | Tax + AML obligations |
| `gepg_transactions` | GEPG router (TZ) | 7 years | TZ Public Finance Act |
| `messages` | communications service | **365 days** | Minimisation — operational only |
| `voice_turns` | voice service | **90 days** | Strict minimisation — biometric-adjacent |
| `webhook_deliveries` | agent-platform | 30 days | Operational debug only |
| `request_traces` (OTel) | observability backend | 30 days | Operational debug only |
| `application_logs` | observability backend | 30 days | Operational debug only |

## "Permanent" caveat

"Permanent" in this policy means **the lifetime of the controller as a legal
entity, plus 7 years post-dissolution**. Sovereign-ledger and audit-event rows
are pseudonymised (not deleted) on RTBF — the row count stays constant,
the PII is unrecoverable.

## Pseudonymisation procedure

On RTBF request completion (see [right-to-erasure-playbook.md](./right-to-erasure-playbook.md)):

```
UPDATE audit_events SET
  actor_email = 'pseudo:' || encode(sha256(actor_email || $tenant_salt), 'hex'),
  subject_email = 'pseudo:' || encode(sha256(subject_email || $tenant_salt), 'hex'),
  payload = jsonb_set(payload, '{actor_phone}',
    to_jsonb('pseudo:' || encode(sha256(payload->>'actor_phone' || $tenant_salt), 'hex')))
WHERE subject_id = $customer_id;
```

The per-tenant salt is rotated quarterly and stored in KMS. Pre-rotation
salts are retired (not deleted — kept under separate access control so a
court order could compel re-identification of pre-rotation rows).

## Backup retention

| Backup tier | Retention | Purpose |
|---|---|---|
| Hot backups (S3) | 30 days, daily | Operational recovery |
| Warm backups (S3 IA) | 90 days, weekly | Disaster recovery |
| Cold archives (S3 Glacier Deep) | 7 years, monthly | Tax / audit obligation |

Crypto-shredding via per-tenant DEK deletion handles RTBF in backups: the
ciphertext remains; the key is gone. Document this in privacy notice.

## Access controls

- All audit-table reads require `audit:read` scope (admin / DPO / SRE only)
- Read events themselves logged into `audit_events` (meta-audit)
- No application code path can DELETE or UPDATE audit rows except via the
  pseudonymisation flow which is permission-gated and audited

## Quarterly review

- Verify hash-chain integrity (no broken links)
- Sample 10 RTBF-pseudonymised rows; attempt to recover PII without the salt
- Confirm retention triggers fire (data older than retention window is
  appropriately pseudonymised / deleted per the table)

## Tools

- `scripts/audit-chain-verify.mjs` — walks the hash chain for tamper detection
- `scripts/retention-sweep.mjs` — finds rows past retention window
- `scripts/rtbf-verification.mjs` — sample-based pseudonymisation verification
