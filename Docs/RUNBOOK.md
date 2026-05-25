# BORJIE — Incident Runbook

How to triage, mitigate, and roll back common production incidents.

---

## Standard operational procedures

### Run migrations locally

The migration runner is a plain `tsx` script — no Drizzle CLI required.

```bash
# Requires DATABASE_URL exported (or will fall back to
# postgresql://localhost:5432/borjie in dev)
pnpm -F @borjie/database exec tsx src/run-migrations.ts

# Equivalent via the workspace script:
pnpm -F @borjie/database db:migrate
```

The runner creates `drizzle.__drizzle_migrations`, sorts every `*.sql`
under `packages/database/src/migrations/` lexically, and skips files
whose `hash` (= filename without `.sql`) is already recorded. 40
migrations apply clean as of 2026-04-18.

### Seed demo-org fixture data

Org seeds are gated behind an explicit acknowledgement env var so a dev
running `pnpm db:seed` against a prod URL can't inadvertently write
fake rows.

```bash
export DATABASE_URL=postgresql://...
export SEED_ORG_SEEDS=true
pnpm -F @borjie/database db:seed -- --org=demo
# or all known fixtures:
pnpm -F @borjie/database db:seed -- --org=all
```

Fixtures live in `packages/database/src/seeds/`
(`demo-org-seed.ts`, `demo-districts.json`, `sample-tenants.ts`). New org
seeds register in the `ORG_SEEDS` map in `run-seed.ts`.

### Inspect live gateway health endpoints

Both paths return the same payload. `/health` is the legacy path;
`/healthz` matches Kubernetes convention and is what the ALB health
check hits.

```bash
curl -sS http://localhost:4000/health | jq .
curl -sS http://localhost:4000/healthz | jq .
# {
#   "status": "ok",
#   "version": "dev",
#   "service": "api-gateway",
#   "timestamp": "...",
#   "upstreams": {}
# }
```

Smoke-test the composition root at boot time by reading the logs:

- `service-registry: live (Postgres-backed domain services wired)` means
  `DATABASE_URL` resolved and the 10 live endpoints will return real data.
- `service-registry: degraded (DATABASE_URL unset — pure-DB endpoints
  will 503)` means the gateway is intentionally in degraded mode. Auth,
  legacy routes, and external-creds routes (payments, brain) still work;
  pure-DB features (marketplace, waitlist, gamification, migration,
  negotiations) return 503 with a clear reason.

### Rotate `API_KEY_REGISTRY`

The registry replaces the legacy `API_KEYS` env var. Each entry binds a
SHA-256 hash to a concrete `{tenantId, role, scopes, serviceName}` —
callers can no longer forge `X-Tenant-ID` to escalate to SUPER_ADMIN
(see C-1 in `Docs/analysis/SECURITY_REVIEW_WAVES_1-3.md`).

```bash
# 1. Generate a new key and its SHA-256 hash
NEW_KEY=$(openssl rand -hex 32)
HASH=$(printf "%s" "$NEW_KEY" | openssl dgst -sha256 -hex | awk '{print $2}')

# 2. Compose the registry entry
# Format: <hash>:<tenantId>:<role>:<space-separated scopes>:<serviceName>
# Example: abc...:trc:ESTATE_MANAGER:read_property read_lease:estate-mgr-integration
ENTRY="${HASH}:trc:ESTATE_MANAGER:read_property read_lease:estate-mgr-integration"

# 3. Append to the existing registry (comma-separated) in Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id borjie/production/api-key-registry \
  --query SecretString --output text > /tmp/registry.old

echo "$(cat /tmp/registry.old),${ENTRY}" > /tmp/registry.new
aws secretsmanager put-secret-value \
  --secret-id borjie/production/api-key-registry \
  --secret-string "$(cat /tmp/registry.new)"
shred -u /tmp/registry.old /tmp/registry.new

# 4. Force task restart so ECS re-reads the secret
aws ecs update-service \
  --cluster borjie-production \
  --service borjie-production-api-gateway \
  --force-new-deployment

# 5. Hand NEW_KEY (the plaintext) to the caller out-of-band. BORJIE
#    only ever stores the hash.
```

**Revoke a key**: remove its entry from the registry, restart the
service. Old key immediately stops resolving; `resolveApiKey` returns
`null` once the cache reloads at next boot.

**Do not** leave `API_KEYS` set in production unless you are migrating
off legacy — the code logs a CRITICAL deprecation warning when it falls
through to the legacy path.

### Handle 503 on a specific endpoint (service not wired)

Some endpoints intentionally degrade to 503 when their backing service
hasn't been wired in the composition root yet (this is expected during
pilot rollout).

**Diagnose**

```bash
# The router that threw will include a clear reason in the body, e.g.:
curl -i http://localhost:4000/api/v1/occupancy-timeline/...
# HTTP/1.1 503 Service Unavailable
# { "error": "OccupancyTimelineService unavailable — repo not yet wired" }
```

Cross-check `services/api-gateway/src/composition/service-registry.ts`.
Any field left at `null` in `buildServices()` is deliberately degraded.
As of wave-5 the null fields are:

- `occupancyTimeline` — waiting on `PostgresOccupancyTimelineRepository`
- `stationMasterRouter` — waiting on `PostgresStationMasterCoverageRepository`

**Mitigate** (if a pilot tenant needs one of these now):

1. Check the sibling "Production Readiness Matrix" in
   `Docs/analysis/DELTA_AND_ROADMAP.md` to confirm it's pending.
2. If urgent, wire the postgres repo (see existing
   `PostgresMarketplaceListingRepository` for the pattern) and register
   it in `buildServices()`.
3. Redeploy; the router picks up the real service with no router change.

**Close-out**: once the registry returns non-null for that field, the
router starts returning real data automatically. No feature-flag toggle.

---

## Semgrep + CodeQL custom rules

Two static-analysis layers run on every PR and every Monday:

- **Semgrep** (`.github/workflows/semgrep.yml`) — runs the curated `auto`
  ruleset plus our 8 BORJIE-specific rules in
  `.semgrep/borjie-rules.yml`.
- **CodeQL** (`.github/workflows/codeql.yml`) — runs GitHub's
  `security-extended` suite plus custom queries under
  `.github/codeql/queries/` (registered via `qlpack.yml`).

### Custom Semgrep rules (8)

| ID | Severity | Category | What it catches |
| --- | --- | --- | --- |
| `missing-tenant-id-arg` | WARNING | security | Repo lookups omitting `tenantId` (cross-tenant leak) |
| `raw-error-response` | ERROR | maintainability | `c.json({ error })` outside `error-response.ts` |
| `prototype-pollution-spread` | WARNING | security | `{ ...req.body }` without `Object.create(null)` base |
| `unbounded-find-many` | WARNING | performance | `findMany(_, 1000+)` Wave-5 BFF anti-pattern |
| `console-statement-in-production-path` | WARNING | best-practice | `console.*` outside dev/test/scripts |
| `as-any-cast` | WARNING | best-practice | New `as any` casts (existing ones baselined) |
| `missing-await-on-promise` | WARNING | correctness | Unawaited async-fn call with no `.catch`/return |
| `pii-in-log` | ERROR | security | `logger.*({password\|secret\|token\|...})` without redact |

### Running locally

```bash
# Semgrep — full repo
pip install semgrep
semgrep --config=.semgrep/borjie-rules.yml packages/ services/ apps/

# Semgrep — verify rules fire on the synthetic positives
semgrep --config=.semgrep/borjie-rules.yml .semgrep/tests/fixtures/positive-examples.ts
# Expected: 8 findings, one per rule.

# Semgrep — verify NO false positives on negatives
semgrep --config=.semgrep/borjie-rules.yml .semgrep/tests/fixtures/negative-examples.ts
# Expected: 0 findings.

# CodeQL custom queries — requires the `codeql` CLI
codeql database create cql-db --language=javascript --source-root=.
codeql database analyze cql-db .github/codeql/queries \
  --format=sarifv2.1.0 --output=codeql-results.sarif
```

### Triaging a finding

1. Open the GitHub Security tab → Code scanning. Each Semgrep/CodeQL alert
   links to the offending line.
2. If it's a true positive — fix and push. Re-run is automatic on PR.
3. If it's a legitimate exception (e.g. platform-admin search bypassing
   `tenantId` on purpose), suppress with an inline comment that includes
   a reason:

   ```ts
   // nosemgrep: missing-tenant-id-arg reason: platform-admin global view
   const all = await customerRepo.findMany(filters);
   ```

   For CodeQL, add the path/file to `paths-ignore` in
   `.github/codeql/queries/missing-tenant-id.ql` or annotate via the
   "Dismiss" flow in the Security tab.

### Adding a new rule

1. Edit `.semgrep/borjie-rules.yml` — every rule needs `id`, `message`,
   `severity`, `languages`, and at least one `pattern`.
2. Add a synthetic positive case to
   `.semgrep/tests/fixtures/positive-examples.ts` and a negative case to
   `negative-examples.ts`.
3. Verify locally with the commands above.
4. PR the rule. CI's Semgrep job will run it against the whole monorepo.

---

## On-call expectations

- Primary on-call carries pager 24/7 on a 1-week rotation.
- Secondary is backup + weekend escalation.
- **Target**: acknowledge within 10 minutes, initial mitigation within 30.

Contacts (placeholders — replace in the private on-call sheet):

- **Platform eng lead**: TBD
- **Payments SME**: TBD
- **AI / doc-intel SME**: TBD

---

## Incident: OCR provider down

**Symptoms**

- `document-intelligence` `/healthz` returns `{ status: "degraded" }`
- CloudWatch alarm `OCRFailureRate > 5%` firing
- User-facing: document upload spinner never resolves

**Diagnose**

1. Check which provider is configured: `echo $OCR_PROVIDER`.
2. Hit the provider status page:
   - Textract: https://health.aws.amazon.com/
   - Google Vision: https://status.cloud.google.com/
3. Tail the service logs:
   ```bash
   aws logs tail /ecs/borjie-production-document-intelligence --follow
   ```
   Look for `ocr_provider_error` structured log lines.

**Mitigate**

- **Short-term**: failover to the other provider.
  ```bash
  aws ecs update-service \
    --cluster borjie-production \
    --service borjie-production-document-intelligence \
    --force-new-deployment
  # After updating OCR_PROVIDER in the task definition.
  ```
- **Emergency**: set `OCR_PROVIDER=mock` to unblock the UI while you
  investigate. Documents processed during this window will need
  re-extraction — tag them with `ocr_needs_reprocess=true`.

**Close-out**

- File a post-mortem if the mitigation took > 1 hour.
- Re-queue any documents stuck with `ocr_status = 'pending'` via
  `pnpm cli:document-intel reprocess --since=<timestamp>`.

---

## Incident: GePG webhook signature failure

**Symptoms**

- `webhooks` service logs `gepg_signature_invalid` for real traffic
- Finance reports missing control-number reconciliations
- CloudWatch alarm `GePGWebhookRejectionRate > 1%` firing

**Diagnose**

1. Check if a GePG key rotation happened recently — they publish rotations
   with 48h lead time but operators sometimes miss the memo.
   ```bash
   aws secretsmanager describe-secret \
     --secret-id borjie/production/gepg-signing-key \
     --query 'LastChangedDate'
   ```
2. Compare the `GEPG_MODE` env var against the URL the webhook came from.
   Sandbox callbacks to the prod URL or vice versa will fail signing.
3. Pull the raw payload (redacted) from the dead-letter queue:
   ```bash
   aws sqs receive-message \
     --queue-url https://sqs.eu-west-1.amazonaws.com/<acct>/gepg-dlq
   ```

**Mitigate**

- If a rotation was missed: update the secret and force a webhook service
  restart (see DEPLOYMENT §3).
- If a single batch failed: replay from the DLQ using
  `pnpm cli:webhooks replay --queue=gepg --max=50`. Replay is idempotent
  because every control-number reconciliation goes through the
  idempotency key in Redis.

**Close-out**

- Confirm `reports/financial-reconciliation` balances for the affected day.
- Update the GePG rotation calendar (`Docs/ops/gepg-rotation.md`).

---

## Incident: Notifications DLQ full

**Symptoms**

- BullMQ dashboard shows `notifications:failed` queue > 1 000 entries
- Customer complaints about missing rent reminders / receipts
- CloudWatch alarm `NotificationsDLQDepth` firing

**Diagnose**

1. Inspect the first 5 DLQ jobs:
   ```bash
   pnpm cli:notifications inspect-dlq --limit=5
   ```
   Common causes:
   - Resend 429s → hit rate limit
   - Twilio 400s → malformed phone number
   - Missing per-tenant sender identity

**Mitigate**

- **Rate-limit hit**: pause the worker for 10 min, then replay in batches
  of 100 every 60 s:
  ```bash
  pnpm cli:notifications replay-dlq --rate=100/minute
  ```
- **Malformed recipients**: bulk-resolve via
  `pnpm cli:notifications drop-invalid-dlq` — only drops jobs whose
  payload fails validation. Prompts for confirmation.
- **Sender not verified**: verify in Resend / Twilio console, then
  replay.

**Close-out**

- Zero the alarm counter with a `cloudwatch set-alarm-state OK`.
- Run `pnpm cli:notifications coverage --since=<incident-start>` to
  confirm no customer is still missing messages.

---

## Incident: SLA worker stuck / not firing

**Symptoms**

- `scheduler` `/healthz` shows `sla-worker.lastSuccessAt` > 30 min stale
- Overdue cases not auto-escalating
- CloudWatch alarm `SchedulerWorkerStale` firing

**Diagnose**

1. Inspect scheduler logs for the worker ID:
   ```bash
   aws logs tail /ecs/borjie-production-scheduler --follow \
     --filter-pattern '"workerId":"sla-worker"'
   ```
2. Check the inFlight list in `/healthz` — a worker with no tick progress
   but present in `inFlight` means its handler is hung (usually a blocking
   DB query).

**Mitigate**

- **Hung handler**: restart the scheduler service.
  ```bash
  aws ecs update-service \
    --cluster borjie-production \
    --service borjie-production-scheduler \
    --force-new-deployment
  ```
  Because the service is pinned to desired_count=1, the new task waits
  for the old one to drain (up to 30 s per the shutdown handler) — no
  risk of double-firing.
- **Downstream timeout**: check the case repo's Postgres pool — look for
  idle-in-transaction queries:
  ```sql
  SELECT pid, state, query_start, query
  FROM pg_stat_activity
  WHERE state = 'idle in transaction'
  ORDER BY query_start;
  ```
  Kill offenders with `SELECT pg_terminate_backend(<pid>);`.

**Close-out**

- Backfill any missed escalations by manually invoking the worker:
  ```bash
  curl -X POST https://scheduler.internal.borjie.io/admin/run/sla-worker
  ```
  (admin endpoint added in a follow-up wave — until then, restart is the
  recovery path and the next scheduled tick picks up the backlog).

---

## Rollback procedure

All services run on ECS Fargate with rolling deploys. Rollback = redeploy
a previous task-definition revision.

```bash
# 1. List recent revisions
aws ecs list-task-definitions \
  --family-prefix borjie-production-api-gateway \
  --sort DESC --max-items 5

# 2. Point the service at the known-good revision
aws ecs update-service \
  --cluster borjie-production \
  --service borjie-production-api-gateway \
  --task-definition borjie-production-api-gateway:<revision>

# 3. Monitor the deploy
aws ecs wait services-stable \
  --cluster borjie-production \
  --services borjie-production-api-gateway
```

**DB migrations** are forward-only. If a migration broke production,
roll back the application to a compatible revision first, then write a
compensating migration. Do not run `DROP`-style rollbacks against a live
database without a backup verified in the last hour.

---

## Escalation matrix

| Severity | Examples                                                        | Response                                           |
| -------- | --------------------------------------------------------------- | -------------------------------------------------- |
| SEV-1    | API gateway down, payments not processing, data loss            | Page primary, page secondary immediately           |
| SEV-2    | One tenant's reports broken, OCR degraded, notifications behind | Page primary                                       |
| SEV-3    | Scheduler worker stale (non-blocking), dashboard numbers stale  | Ticket, address within business hours              |
| SEV-4    | Cosmetic / flakiness                                            | Backlog                                            |

---

## Change freezes

- **Tanzania month-end (25th–1st)**: payments-related changes gated on
  SRE approval — rent cycle is sensitive.
- **EOY / EOF**: no deploys between 22 Dec and 2 Jan without exec sign-off.

---

## Quarterly Backup Restore Drill Schedule

We exercise the full backup-restore path once per calendar quarter. A
drill is the only credible test of the disaster-recovery posture; a
quarter with no successful drill is treated as a P1 operational gap.

Detailed mechanics live in [`./RUNBOOKS/backup-restore.md`](./RUNBOOKS/backup-restore.md).
The schedule below is the calendar; deviation requires written exec
sign-off, recorded in the drill log.

### 2026 schedule

| Quarter | Planned date | Owner | Region exercised | Expected output |
|---|---|---|---|---|
| Q1 2026 | 2026-02-18 (Wed) | DB Ops | eu-west-1 (primary) | `restore.sh` writes to `borjie-restore-test` DB, `scripts/uat-walkthrough.sh` passes against it, RTO < 60 min recorded, RPO < 15 min recorded. |
| Q2 2026 | 2026-05-20 (Wed) | DB Ops | af-south-1 (secondary) | Same outputs as Q1, plus cross-region restore proves DR-region failover assumptions in [`./RUNBOOKS/dr-region-failover.md`](./RUNBOOKS/dr-region-failover.md). |
| Q3 2026 | 2026-08-19 (Wed) | DB Ops | eu-west-1 (primary) | Same as Q1, plus randomly-selected tenant `audit_events` row count matches pre-restore by SHA-256 of canonical export. |
| Q4 2026 | 2026-11-18 (Wed) | DB Ops | af-south-1 (secondary) | Same as Q2; this drill must succeed before EOY change freeze (22 Dec). |

### Drill log

Update the row below after every drill. If a drill is missed or fails,
file a P1 incident and run a remediation drill within 14 days.

| Quarter | Status | Actual date | Recorded RTO | Recorded RPO | Lessons / linked post-mortem |
|---|---|---|---|---|---|
| Q1 2026 | TBD | TBD | TBD | TBD | TBD |
| Q2 2026 | TBD | TBD | TBD | TBD | TBD |
| Q3 2026 | TBD | TBD | TBD | TBD | TBD |
| Q4 2026 | TBD | TBD | TBD | TBD | TBD |

**Last successful drill**: TBD — no drill yet recorded against the new schedule.

### Pre-drill checklist

Owner runs through this 24 h before the planned date:

1. Confirm latest encrypted snapshot exists in `s3://borjie-backups`
   (yesterday's date, size > 0, decryption key in 1Password).
2. Spin up the `borjie-restore-test` namespace / cluster (cost ~$5 for
   the drill window).
3. Notify `#status-ops` 24 h ahead so anyone reading metrics knows the
   spike of restore-side load is expected.
4. Page primary on-call passively (shadow ack); do NOT page them as a
   real incident — the drill must not trigger SLO error-budget burn.

### Post-drill obligations

1. Record actual RTO / RPO in the table above.
2. If RTO > 60 min or RPO > 15 min, open an action item against the
   responsible service in JIRA (label `dr-drill`).
3. If anything new surfaced, copy the lessons block into
   `Docs/POSTMORTEMS/` even if there was no customer impact — drills are
   one of our cheapest sources of learning.

---

## pgvector — mandatory in production

The platform depends on `pgvector` for AI semantic memory, knowledge-base
retrieval, skill_registry similarity, and document embeddings. Production
deployments MUST have the extension enabled at the server level BEFORE
applying migrations — bare `CREATE EXTENSION vector` in 0125 / 0133 will
fail with "extension control file not found" if the server lacks the
shared library, and the migration chain will abort.

Per-provider enablement procedure:

| Provider     | Procedure                                                                            |
| ------------ | ------------------------------------------------------------------------------------ |
| Supabase     | Built-in. Enable via Dashboard → Database → Extensions → `vector` (or run `CREATE EXTENSION vector;` once). |
| AWS RDS      | Postgres 15.2+. Add `vector` to `rds.allowed_extensions` in the parameter group; reboot; then `CREATE EXTENSION vector;`. |
| Neon         | One-click in the Extensions panel of the Neon Console.                               |
| Render       | Use the `postgres:15-pgvector` image variant when provisioning.                      |
| Self-host    | `apt-get install postgresql-15-pgvector` (Debian/Ubuntu) OR build from https://github.com/pgvector/pgvector. |
| CI (GitHub)  | The `.github/workflows/migration-apply-fresh.yml` workflow uses the official `pgvector/pgvector:pg16` Docker image. |

Migration 0178 (`pgvector_guard`) wraps the extension install in a
fault-tolerant DO/EXCEPTION block so DEVELOPMENT and CI environments
without pgvector can still run the migration chain — but the affected AI
features will fall back to TEXT-stored embeddings with no vector ANN
search. The fail-soft is a development convenience ONLY; production must
have pgvector enabled.

Verify after deploy:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname='vector';
-- expected: vector | 0.7.x (or later)
```

