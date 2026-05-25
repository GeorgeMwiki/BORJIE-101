# Encryption-at-Rest Key Rotation Runbook

> Companion to the Phase D1 field-level encryption ship. Governs KEK
> rotation, per-tenant DEK derivation, re-encryption batches, and
> audit-trail validation. Compliance: SOC 2 CC6.1, TZ PDPA Art. 28,
> GDPR Art. 32(1)(a).

## Key hierarchy

```
ENCRYPTION_MASTER_KEY (KEK — operator secret, env var, 32-byte base64)
     │
     ├── HKDF-SHA-256(KEK, "tenant:" || tenantId, salt=keyVersion) → DEK_tenant
     │       │
     │       └── AES-GCM-256(DEK_tenant) → ciphertext columns
     │               (pii.email_enc, pii.phone_enc, pii.id_number_enc, …)
     │
     └── KEK_PREVIOUS (rotation overlap slot, set during transition)
```

The KEK never touches the database. DEKs are derived in-process per
tenant. Rotating the KEK is a re-encryption job, not a re-key job.

## Configuration

```bash
# Current encryption key (env, never DB)
ENCRYPTION_MASTER_KEY=<32-byte base64 from `openssl rand -base64 32`>

# Previous KEK during rotation overlap window. Set ONLY while rotation
# is in progress; clear after the re-encryption batch completes.
ENCRYPTION_MASTER_KEY_PREVIOUS=<prior 32-byte base64>

# Monotonically incremented. Read by HKDF as salt input. Bump on every rotation.
ENCRYPTION_KEY_VERSION=2
```

## Rotation procedure

### 1. Pre-flight

- [ ] Verify backup-restore runbook is up-to-date and a recent
      backup exists.
- [ ] Confirm `field_encryption_audit` table is empty of unresolved
      `verification_failed` rows.
- [ ] Notify the on-call channel. Rotation can take 30 min – 6 h
      depending on row count.
- [ ] Schedule outside customer peak hours (avoid month-end close).

### 2. Generate the new KEK

```bash
openssl rand -base64 32 > /tmp/new_kek
chmod 600 /tmp/new_kek
```

Store in the secret manager (1Password, Vault, AWS Secrets Manager,
…). Never commit. Never log.

### 3. Deploy overlap configuration

Set both keys in env:

```bash
ENCRYPTION_MASTER_KEY=<new>
ENCRYPTION_MASTER_KEY_PREVIOUS=<old>
ENCRYPTION_KEY_VERSION=<bump>
```

Deploy a rolling restart of api-gateway + every service that reads
encrypted columns. In overlap mode, encryption uses the NEW key, but
decryption tries new-then-old. Live traffic continues uninterrupted.

### 4. Re-encryption batch

Run the re-encryption job — re-encrypts every existing PII column
under the new KEK:

```bash
# Dry-run first (counts rows, no writes)
pnpm -C scripts ts-node encrypt-existing-rows.mjs --dry-run

# Live run
pnpm -C scripts ts-node encrypt-existing-rows.mjs \
  --batch-size 500 \
  --target-version $ENCRYPTION_KEY_VERSION
```

The job:

1. Iterates `pii.*` tables in deterministic order.
2. For each row: decrypts with OLD DEK, re-encrypts with NEW DEK.
3. Writes a row to `field_encryption_audit` per (table, row, column) tuple.
4. Updates the row's `enc_key_version` to the new version.
5. Tolerates failures: a single bad row does not stop the batch.

> **Note:** The `encrypt-existing-rows.mjs` script is the design we
> commit to. If a wave hasn't shipped it yet, run a manual SQL
> equivalent driven by the encryption helper exposed in
> `packages/ai-copilot/src/security/field-encryption.ts`.

### 5. Verify

```sql
-- Every row should be at the new version
SELECT enc_key_version, COUNT(*)
  FROM pii.email_enc
 GROUP BY enc_key_version;

-- Audit-trail: every encryption should be logged
SELECT operation, COUNT(*)
  FROM field_encryption_audit
 WHERE batch_id = '<rotation-batch-id>'
 GROUP BY operation;

-- Decryption sanity check on a sample
SELECT decrypt_email(email_enc, tenant_id) IS NOT NULL AS ok
  FROM pii.email_enc
 ORDER BY random()
 LIMIT 100;
```

All sample rows must return `ok=true`.

### 6. Retire the old KEK

After verification:

```bash
# Remove the overlap key
unset ENCRYPTION_MASTER_KEY_PREVIOUS
```

Deploy a final rolling restart. Decryption now only uses the new key.

### 7. Destroy the old KEK material

Per SOC 2 CC6.7, retired key material is purged. Document destruction
in the secret manager's audit log.

## Audit-trail validation

The `field_encryption_audit` table is the immutable record. Every
encrypt / decrypt / rotation operation appends one row:

```sql
SELECT * FROM field_encryption_audit
 WHERE created_at > NOW() - INTERVAL '7 days'
   AND operation IN ('rotate', 'verification_failed')
 ORDER BY created_at DESC;
```

A non-zero `verification_failed` count indicates either a partial
rotation (re-run the batch) or, far worse, tamper. Investigate via
the audit-chain-verification runbook.

## Rollback procedure

A rotation can be rolled back BEFORE step 6 (KEK retirement):

1. Set `ENCRYPTION_MASTER_KEY` back to the old value.
2. Keep `ENCRYPTION_MASTER_KEY_PREVIOUS` as the NEW key (inverted overlap).
3. Re-run the batch with `--target-version=<old>` to re-encrypt back.

After step 6 the rollback is irrecoverable from KEK material alone —
restore from backup.

## Common failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| `decrypt` returns null for fresh data | KEK env var unset | Set env, restart |
| `decrypt` returns null for old data | `ENCRYPTION_MASTER_KEY_PREVIOUS` cleared too soon | Set it back, replay batch |
| `field_encryption_audit` shows tamper rows | Out-of-band column edits | Halt; engage security |
| Batch job aborts mid-table | Network blip | Re-run; idempotent on `enc_key_version` |

## Related

- `packages/ai-copilot/src/security/field-encryption.ts` — encrypt / decrypt
- `packages/ai-copilot/src/security/pii-scrubber.ts` — pre-store sanitization
- `Docs/RUNBOOKS/audit-chain-verification.md`
- `Docs/SECRETS_ROTATION.md`
- `Docs/COMPLIANCE/SOC2_CONTROLS.md` (CC6.1, CC6.6, CC6.7)
