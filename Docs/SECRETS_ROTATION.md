# Secrets Rotation Runbook

**Scope.** This runbook covers HMAC-root and signing-key rotation for BORJIE:
`AUDIT_HMAC_KEY`, `WEBHOOK_SIGNING_KEY`, `JWT_PEPPER`, `GEPG_SIGNING_KEY`,
`SESSION_SIGNING_KEY`, `SESSION_HASH_SECRET` (audit hash chain root, consumed by
`packages/ai-copilot/src/security/audit-hash-chain.ts`), plus any future
symmetric secret used by the platform.

> **`SESSION_HASH_SECRET` is required on deploy.** Without it the audit hash
> chain silently falls back to unkeyed SHA-256, which is forge-able by anyone
> with database write access. The gateway `validateEnv()` enforces presence in
> production (`NODE_ENV=production`). Rotate via the dual-key procedure below:
> set `SESSION_HASH_SECRET_PREV=<old>` and `SESSION_HASH_SECRET=<new>` for the
> 24h soak, then drop `_PREV`.

It does **not** cover asymmetric key pairs (TLS / mTLS / RSA-signed JWTs) —
those follow a cert-manager controlled rotation handled separately.

**Why a runbook?** Persisted signatures (audit-chain rows, webhook ledgers,
revoked-JWT denylists) outlive any single key. Rotating with no overlap
either invalidates them (data unavailable) or trusts them under a key that
was never used to sign them (silent integrity loss). The procedure below
keeps **both** keys live for a 24-hour soak window, during which
`verifyWithRotation` accepts either signature.

---

## 1. Roles and pre-requisites

| Role | Responsibility |
|---|---|
| Rotation Operator (RO) | Runs the script + applies the secret-store changes |
| On-call SRE | Watches dashboards / alerts during soak |
| Audit reviewer | Confirms `key_role` audit fields after retire |

Pre-requisites before starting:

- [ ] No active incident (P1/P2). Pause rotation if one fires mid-procedure.
- [ ] Two RO sessions with `kubectl` access to the cluster (one primary, one
      cross-check). **Never** run rotation single-handed.
- [ ] `gh` CLI authenticated against the BORJIE GitHub org (for repo
      secrets used by Actions).
- [ ] Grafana dashboards open: `agent-spans`, `overview`,
      `audit-verify-failures`.
- [ ] Slack channel `#sre-rotation` open and pinged.

---

## 2. Code surface that must understand rotation

The four-phase procedure ONLY works if every consumer of the rotating key
uses the dual-key `verifyWithRotation` helper from
`@borjie/observability`:

```ts
import { verifyWithEnvRotation } from '@borjie/observability';

const role = verifyWithEnvRotation('AUDIT_HMAC_KEY', payload, signature);
if (role === null) {
  throw new Error('audit row signature failed both current AND previous keys');
}
// Optional: emit a metric — non-zero role==='previous' rate is the
// signal that the rotation soak window has not yet expired.
metrics.audit_verify_role_total.add(1, { role });
```

Before starting a rotation, the RO runs:

```bash
rg --files-with-matches "process\\.env\\.AUDIT_HMAC_KEY" | grep -v dist
```

Every match must call `verifyWithRotation` / `verifyWithEnvRotation`. If any
file still calls a bare `createHmac` / `verify` against the env var, fix it
first — rotation cannot start until coverage is 100%.

---

## 3. Phase 1 — Pre-stage (T-30 minutes)

**Goal.** Generate the new key and stage it alongside the current one in
every secret store, but do not yet trigger a restart.

```bash
node scripts/rotate-keys.mjs --name=AUDIT_HMAC_KEY --out=rotation-2026-05-14.json
chmod 600 rotation-2026-05-14.json
```

The script:
- generates a 32-byte base64url secret,
- prints the `kubectl` / `gh secret set` commands for each phase,
- writes a tracking manifest with `soakEndsAt` / `retireAfter` timestamps.

The RO then:

1. Reads the **current** `AUDIT_HMAC_KEY` value out of the live secret store
   (e.g. `kubectl get secret borjie-secrets -o jsonpath='{.data.AUDIT_HMAC_KEY}' | base64 -d`).
   This value becomes `AUDIT_HMAC_KEY_PREV`.
2. Applies the staged change:
   ```bash
   kubectl create secret generic borjie-secrets \
     --dry-run=client -o yaml \
     --from-literal=AUDIT_HMAC_KEY_PREV="<old value>" \
     --from-literal=AUDIT_HMAC_KEY="<new value>" \
     | kubectl apply -n borjie -f -
   ```
3. Mirrors to GitHub Actions secrets:
   ```bash
   gh secret set AUDIT_HMAC_KEY_PREV --body "<old value>"
   gh secret set AUDIT_HMAC_KEY --body "<new value>"
   ```

**Checkpoint.** The cluster Secret resource now contains both env vars, but
running pods still hold the old environment in memory. Verification:
```bash
kubectl get secret borjie-secrets -o json | jq '.data | keys'
# expect: ["AUDIT_HMAC_KEY", "AUDIT_HMAC_KEY_PREV", ...]
```

If anything in the above fails — abort. Roll back by removing the
`_PREV` entry. No code paths have changed yet.

---

## 4. Phase 2 — Cut-over (T+0)

**Goal.** Roll the deployment so every pod sees both env vars. New
signatures are written with the new key. Reads accept either.

```bash
kubectl rollout restart deployment -n borjie
kubectl rollout status   deployment -n borjie --timeout=10m
```

**Watch during rollout (10–15 minutes):**
- `audit_verify_failures_total{reason="signature_mismatch"}` — must stay 0.
- `webhook_signature_failures_total` — must stay 0.
- `agent.call.errors_total{reason="auth"}` — must stay flat.
- `jwt_verify_failures_total` — must stay 0.

A non-zero rate on any of these signals a botched stage. **Stop and roll
back** by re-applying the previous Secret (single key, old value).

**Smoke test.** After all pods report `Ready`, hit any signed endpoint
twice — once with a fresh signature, once with a 24h-old signature read
from the audit log. Both must succeed; the metric
`audit_verify_role_total` should show traffic on **both** `current` and
`previous`.

---

## 5. Phase 3 — Soak (T+0 to T+24h)

**Goal.** Let live traffic re-sign with the new key while old signatures
age out of the verification window.

Soak duration: **24 hours** (matches our longest webhook replay window —
GePG retries up to 24h). For keys signing data with longer lifetimes
(audit chain, retained ledgers), the soak window is the lifetime of the
oldest verifiable record (typically 90 days for audit-chain).

**During soak, do not:**
- redeploy with a different code rev (the new env var schema must stay)
- remove `_PREV` (premature retire breaks reads)
- start another rotation on the same key (rotations do not stack)

**During soak, do:**
- monitor `audit_verify_role_total{role="previous"}` — this rate should
  decline monotonically as old signatures age out.
- check `#sre-rotation` Slack at the start, midpoint, and end of soak.

If `role="previous"` is still non-zero at T+24h, **extend the soak** —
something is signing with the old key (a stuck cron job, a forgotten
pod). Do not retire until the rate is 0.

---

## 6. Phase 4 — Retire (T+24h, after soak signal is clean)

**Goal.** Remove the previous key so the rotation completes.

```bash
kubectl create secret generic borjie-secrets \
  --dry-run=client -o yaml \
  --from-literal=AUDIT_HMAC_KEY="<new value>" \
  | kubectl apply -n borjie -f -

gh secret delete AUDIT_HMAC_KEY_PREV
```

Restart deployments so the env no longer contains `_PREV`:
```bash
kubectl rollout restart deployment -n borjie
kubectl rollout status   deployment -n borjie --timeout=10m
```

After retire:
- `resolveSecretPair('AUDIT_HMAC_KEY').rotating` returns `false`.
- `verifyWithRotation` only validates against the current key.
- Any signature still made with the old key will now fail — verify your
  monitoring is sensitive enough to alert if this happens.

Mark the manifest:
```bash
jq '.retiredAt = now | todate' rotation-2026-05-14.json > tmp && mv tmp rotation-2026-05-14.json
```

File the manifest in the audit log / SECRETS_ROTATION_HISTORY index.

---

## 7. Emergency rotation (compromised key)

If a key may be compromised, the procedure compresses:

1. **Pre-stage immediately** with phase-1 commands (no scheduling).
2. **Cut-over immediately** (no announcement window).
3. **Skip soak.** Old signatures are now suspect, so accepting them is a
   non-starter. Instead, force re-issuance of all live tokens / sessions:
   ```bash
   kubectl exec -n borjie deploy/api-gateway -- \
     node scripts/invalidate-sessions.mjs
   ```
4. **Retire** as soon as the rolling restart completes.

Document the incident in `Docs/RUNBOOKS/incident-response.md` and file a
post-mortem within 48h.

---

## 8. Audit trail

Every rotation produces three permanent artefacts:

1. `rotation-<date>.json` — the script's output, including phase
   timestamps. Stored in the SRE artefact bucket with retention >= 7
   years (matches the audit-chain retention).
2. A `SECRETS_ROTATION` audit event written by the operator's session,
   recording: env-var-name, generatedAt, soakEndsAt, retiredAt, operator.
3. The deployment-rollout history (`kubectl rollout history`) showing the
   restart that picked up the new key.

A compliance review at end of quarter cross-references all three.

---

## 9. References

- Code: `packages/observability/src/security/secrets-derivation.ts`
- Tests: `packages/observability/src/security/__tests__/secrets-derivation.test.ts`
- Script: `scripts/rotate-keys.mjs`
- Related: `Docs/RUNBOOKS/incident-response.md`, `Docs/RUNBOOKS/migration-production.md`
- Pattern source: LITFIN `Docs/SECRETS-ROTATION.md` (4-phase pre-stage /
  cut-over / soak / retire), backported in parity Wave K.
