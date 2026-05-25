# Audit-Chain Verification Failure Runbook

> Audience: on-call SRE + security lead. This runbook governs the
> response when the nightly audit-chain verification cron alerts.
> The audit hash-chain is the cryptographic backbone of Borjie's
> tamper-evident audit log. A verification failure is a P0 event.

## Background

Every audit-relevant row (sovereign approvals, kernel actions,
killswitch flips, payments-ledger entries, RTBF erasures) is written
with a hash-chain link:

```
row_hash = HMAC-SHA-256(SESSION_HASH_SECRET, prev_row_hash || canonical(row))
```

The nightly cron `auditVerifyCron`
(`packages/ai-copilot/src/security/audit-hash-chain.ts`) walks a
random p=0.01 sample of recent rows and recomputes the chain. A
mismatch implies one of:

1. **Tamper** — a DB write modified row contents post-commit
2. **Secret rotation gap** — `SESSION_HASH_SECRET` flipped without
   the `SESSION_HASH_SECRET_PREV` overlap window
3. **Bug** — canonicalization changed without a chain re-derivation

## Detection

The cron emits structured logs with `event=audit_chain_mismatch` and
fires a Sentry event tagged `severity=critical, surface=audit`. The
on-call alert routes to the security channel.

```bash
# Pull recent verification cron logs
kubectl logs -l job-name=audit-verify-cron --since=24h
```

Sample alert payload:

```json
{
  "event": "audit_chain_mismatch",
  "table": "sovereign_action_ledger",
  "row_id": "act_01HX2K8...",
  "expected_hash": "9a3f...",
  "actual_hash": "7b21...",
  "window": "2026-05-17T00:00:00Z..2026-05-18T00:00:00Z",
  "sample_size": 1247,
  "mismatch_count": 1
}
```

## Step 1 — Quarantine

Block further writes to the affected tenant **immediately**. This is
the most aggressive step and must be the FIRST step. Tamper that
keeps writing is exponentially harder to forensic.

Flip the killswitch:

```bash
# Via HQ tool (preferred):
# "Set platform killswitch to paused. Reason: audit-chain mismatch detected on
#  sovereign_action_ledger for tenant <tid>. Investigation pending."
```

Or SQL emergency path (see `Docs/RUNBOOKS/killswitch.md`).

If the mismatch is scoped to a single tenant, prefer a tenant-level
write-revoke over a platform-wide pause:

```sql
UPDATE tenants
   SET write_revoked = TRUE,
       write_revoke_reason = 'AUDIT_CHAIN_MISMATCH:incident_2026-05-18-01',
       updated_at = NOW()
 WHERE id = '<tenantId>';
```

## Step 2 — Forensic snapshot

Capture the database state immediately. Do this BEFORE any further
queries that might disturb timestamps.

```bash
# Schema-only first (small, fast)
pg_dump --schema-only "$DATABASE_URL" > /var/forensic/schema-$(date +%s).sql

# Affected tables + audit chain
pg_dump --data-only --table sovereign_action_ledger \
                    --table kernel_action_audit \
                    --table platform_killswitch_audit \
                    --table field_encryption_audit \
                    "$DATABASE_URL" > /var/forensic/audit-tables-$(date +%s).sql

# Encrypt + upload to forensic bucket
gpg --encrypt --recipient security@borjie.com \
    /var/forensic/*.sql
aws s3 cp /var/forensic/ s3://borjie-forensic-$(date +%Y)/ --recursive
```

Also snapshot the chain state from process memory if the gateway is
still up:

```bash
curl -fsS "$API_BASE_URL/api/v1/internal/audit-chain/snapshot" \
  -H "X-Internal-Key: $INTERNAL_API_KEY" \
  > /var/forensic/chain-state.json
```

## Step 3 — Notification chain

In order:

1. **Security lead** — page immediately.
2. **DPO (Data Protection Officer)** — under TZ PDPA 2022 Art. 27,
   a personal-data breach must be notified to the regulator within
   72 hours of awareness. The clock starts NOW.
3. **Tenant ops** — for the affected tenant(s), prepare a
   communications draft (do NOT send yet — coordinate with legal).
4. **CTO** — for any cross-tenant or platform-wide event.

Notification template lives at `Docs/COMPLIANCE/GDPR_ARTICLE_30.md`
under the "Breach notification" section.

## Step 4 — Remediation — find the tamper window

Walk the chain backward from the mismatch to find the last
verified-good row. This is the entry point.

```typescript
// In a one-off node script:
import { verifyRandomSample } from "@borjie/ai-copilot/security/audit-hash-chain";
const result = await verifyRandomSample({
  table: "sovereign_action_ledger",
  windowStart: new Date("2026-05-15T00:00:00Z"),
  windowEnd: new Date("2026-05-18T00:00:00Z"),
  sampleRate: 1.0,    // FULL walk, not 0.01
  abortOnFirstMismatch: false,
});
console.log("mismatches:", result.mismatches);
console.log("first_bad_row_id:", result.firstBadRowId);
console.log("last_good_row_id:", result.lastGoodRowId);
```

The window between `lastGoodRowId` and `firstBadRowId` is the
tamper window. Cross-reference:

- Database access logs in the same window
- Sovereign actions executed in the same window
- KEK rotation events (in case a rotation was the actual cause)
- Application deploys in the same window

## Step 5 — Triage

Determine cause:

| Cause | Recovery |
|---|---|
| Bona-fide tamper | Engage legal + security; preserve evidence; do not fix data |
| Bad rotation overlap | Set `SESSION_HASH_SECRET_PREV`, re-verify, rotate properly |
| Canonicalization bug | Identify the schema change, re-derive chain forward from the change point |
| Cron false-positive | Investigate the verifier itself; do NOT silence the alert |

## Step 6 — Resume

Only after Steps 1-5 are complete and the cause is understood:

1. Document the incident in `Docs/PHASES_FINDINGS/`.
2. Add a regression test that would have caught this earlier.
3. Flip the killswitch back to `off` per its runbook.
4. Lift the tenant write-revoke if scoped.
5. Run a full-sample verification (`sampleRate: 1.0`) on a 7-day
   window to confirm no other compromised rows.
6. Schedule a post-incident review within 5 business days.

## What NOT to do

- Do NOT delete the mismatched rows. They are evidence.
- Do NOT rotate `SESSION_HASH_SECRET` during the investigation —
  you lose the ability to re-verify.
- Do NOT silence the verifier alert. If false-positives are
  excessive, raise sample rate to lower variance, never disable.
- Do NOT communicate externally before legal review.

## Related

- `Docs/RUNBOOKS/killswitch.md`
- `Docs/RUNBOOKS/incident-response.md`
- `Docs/RUNBOOKS/encryption-at-rest-key-rotation.md`
- `Docs/COMPLIANCE/SOC2_CONTROLS.md` (CC4.1, CC7.2, CC7.3)
- `packages/ai-copilot/src/security/audit-hash-chain.ts`
