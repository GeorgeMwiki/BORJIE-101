# Production Migrations — Safe Cadence

**Scope**: how to apply, verify, and (if necessary) reverse SQL schema
changes in production. Migrations are **forward-only by default**
(`Docs/OPERATIONS.md:86`). Rollbacks happen via compensating migrations
— never `DROP`.

---

## 1. Which runner applies what

Two distinct runners live in the repo. They use different audit tables
and run in different contexts.

| Runner                                   | Audit table                         | Entry point                       | Use                                    |
| ---------------------------------------- | ----------------------------------- | --------------------------------- | -------------------------------------- |
| `packages/database/src/run-migrations.ts` | `drizzle.__drizzle_migrations` (hash-keyed) | `pnpm -F @borjie/database db:migrate` | Local dev, CI, container entry scripts |
| `scripts/migrate-prod.ts` (via `scripts/migrate-prod.sh`) | `_migrations` (version + sha256 + duration + operator_env) | `scripts/migrate-prod.sh [--dry-run]` | Production apply with full audit trail |

Both read SQL files from `packages/database/src/migrations/` sorted
lexically (90 files as of 2026-04-18). Both skip anything already
recorded. Pick `migrate-prod.sh` for any production-facing run — the
`_migrations` row records duration + sha256 + operator for audit.

Path safety in the dev runner lives at
`packages/database/src/run-migrations.ts:21-39` — an allowlist
(`^[A-Za-z0-9_.-]+\.sql$`) + `resolve`/`relative` check rejects
traversal. The production runner has equivalent validation (sha256 per
file).

---

## 2. Pre-flight checks

Before running on a prod database:

1. **Dry-run on staging first**:
   ```bash
   DATABASE_URL=$STAGING_URL scripts/migrate-prod.sh --dry-run
   DATABASE_URL=$STAGING_URL scripts/migrate-prod.sh
   ```
   Confirm zero errors + app still green on staging for at least one
   full smoke-test cycle (`scripts/smoke-test.sh`).

2. **Review filenames in the pending list**. Migrations are applied in
   `localeCompare` order (`packages/database/src/run-migrations.ts:57`).
   Filenames must match the allowlist `^[A-Za-z0-9_.-]+\.sql$`.

3. **Confirm RLS preservation**. Row-level security is used on
   multi-tenant tables (first seen in `0001_initial.sql`, extended in
   `0013_maintenance_operations.sql`, `0032_document_uploads.sql`,
   `0093_webhook_rls.sql`, `0111_audit_trail_v2.sql`). Any
   `CREATE TABLE` that holds tenant data MUST:
   - `ENABLE ROW LEVEL SECURITY` at creation.
   - Ship a matching `CREATE POLICY` gated on
     `current_setting('app.current_tenant_id', true)`.
   - Grep staging for the new table: `SELECT relname FROM pg_class
     WHERE relrowsecurity = false AND relnamespace = 'public'::regnamespace`
     — new rows here indicate a missing RLS line.

4. **Verify backup freshness**. A verified backup within the last hour
   is a precondition for migrations that drop / rename columns (see
   `Docs/RUNBOOK.md:367-370`). Restore drill lives at
   [`./backup-restore.md`](./backup-restore.md).

---

## 3. Deploy models: blue/green vs in-place

Today production runs on ECS Fargate with rolling deploys. The CD
pipeline is `.github/workflows/cd-production.yml`:

- **Build** per-service Docker images (lines 70-198) tagged with
  `version`, `sha`, and `latest`.
- **Deploy** is `aws ecs update-service --force-new-deployment` against
  `borjie-production-cluster / borjie-production-api`
  (lines 259-277).
- **Health checks** hit `$PROD_URL/health` with a 5× retry (lines
  282-311).
- **Rollback** job triggers on health-check failure and reverts to the
  previous task-definition revision (lines 316-349).

Migrations run OUTSIDE this rolling deploy — the application must be
compatible with **both** the pre-migration and post-migration schema
for the duration of a rolling revision swap. This is the "expand,
migrate, contract" pattern: ship the code that reads old-and-new first,
run the migration, then ship the code that drops the old path.

### Helm pre-upgrade hook (planned)

`k8s/templates/` currently contains `deployment.yaml`, `hpa.yaml`,
`ingress.yaml`, `postgres.yaml`, `redis.yaml`, `secret.yaml`,
`service.yaml`, `servicemonitor.yaml`, `configmap.yaml`, and
`_helpers.tpl`. There is **no** `migration-job.yaml` in the current
tree.

When a sibling task lands `k8s/templates/migration-job.yaml`, wire it as
a Helm `pre-upgrade` hook so `helm upgrade` blocks until migrations
succeed. Suggested annotations:

```yaml
metadata:
  annotations:
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
```

The Job image runs `pnpm -F @borjie/database db:migrate` (or
`scripts/migrate-prod.sh`) with the same `DATABASE_URL` secret as the
API. A failed hook aborts the upgrade before any pod rolls — this is
the behaviour we want. Revisit this section once the manifest lands.

---

## 4. Apply to production

```bash
# From a jump host with production DATABASE_URL exported:
scripts/migrate-prod.sh --dry-run     # prints the plan
scripts/migrate-prod.sh               # applies + audits
```

Exit codes (see `scripts/migrate-prod.sh:6-10`): `0` applied, `1` error,
`2` already up-to-date. CI gating on exit `2` is the "no-pending" fast
path.

On success you will see one `_migrations` row per applied file with
`version`, `applied_at`, `duration_ms`, `sha256`, `operator_env`
(`scripts/migrate-prod.ts:152-157`).

---

## 5. Rollback playbook — compensating migration

**Never run `DROP` against a live database without a verified backup
taken in the last hour** (`Docs/RUNBOOK.md:367-370`). The rollback path
is always a hand-crafted counter-migration.

Steps (from `Docs/OPERATIONS.md:86-93`):

1. Identify the offending version in `_migrations` with `applied_at`
   close to the incident start.
2. **Roll the application first** to a task-definition revision
   compatible with the pre-migration schema (ECS revert procedure at
   `Docs/RUNBOOK.md:346-365`).
3. Write a compensating migration:
   ```
   packages/database/src/migrations/0099_revert_0098.sql
   ```
   File naming: `<next-version>_revert_<offending>.sql`. The file must
   only use additive or reversible operations — prefer
   `ALTER TABLE ... ADD COLUMN` / `DROP CONSTRAINT` / `CREATE INDEX
   CONCURRENTLY`. Avoid `DROP TABLE`, `DROP COLUMN`, and destructive
   `UPDATE` without a backup.
4. Apply via `scripts/migrate-prod.sh`. The forward audit row lands
   next to the offending one — both stay in `_migrations` for trail.
5. **Never** delete rows from `_migrations` — the audit trail is
   sacrosanct (`Docs/OPERATIONS.md:92`).

### Full snapshot restore

Reserved for unrecoverable corruption. Guarded by
`BORJIE_ALLOW_RESTORE=true` plus double-confirmation (typing
`RESTORE` and the key suffix). Procedure at
[`./backup-restore.md`](./backup-restore.md). After the restore, re-run
`scripts/migrate-prod.sh` so migrations applied after the snapshot
replay.

---

## 6. Change-freeze windows

Two recurring freezes (`Docs/RUNBOOK.md:385-389`):

- **Tanzania month-end (25th–1st)** — payments-related migrations
  require SRE approval; rent cycle is sensitive.
- **EOY / EOF (22 Dec – 2 Jan)** — no deploys without exec sign-off.

Coordinate with the on-call rotation before scheduling any migration
touching `payments`, `ledger`, `invoices`, or `leases` tables during
these windows.

---

## Cross-links

- Incident response if the migration caused the outage: [`./incident-response.md`](./incident-response.md)
- Backup + restore mechanics: [`./backup-restore.md`](./backup-restore.md)
- Schema drift history: `Docs/WAVE18_FINDINGS/agent-d-schema-drift.md`
