# Rollback Runbook — the three layers + the decision tree

**Audience:** platform operator / founder on call.
**Scope:** how to safely undo a bad production change at the right layer.
**Principle:** the founder decides **WHEN** to roll back; this runbook is the
**HOW** — one decision tree, one command per layer, a verify step after each.

> **Operator-run.** Nothing here mutates a live environment on its own. Every
> command is a deliberate action you issue. The destructive layer (migration /
> data rollback) is double-gated by design — see each layer below.

**Companion files**

| File | Role |
|------|------|
| [`.github/workflows/cd-production.yml`](../.github/workflows/cd-production.yml) | Layer A — blue/green deploy + automatic + manual rollback |
| [`scripts/rollback-migration.mjs`](../scripts/rollback-migration.mjs) | Layer B — scripted schema rollback over the down-registry |
| [`packages/database/src/migrations/down/_registry.json`](../packages/database/src/migrations/down/_registry.json) | Layer B — the down-migration registry it consumes |
| [`.github/workflows/backup-restore-drill.yml`](../.github/workflows/backup-restore-drill.yml) | Layer C — the weekly-drilled encrypted backup restore |
| [`scripts/deploy/DEPLOY_SEQUENCE.md`](../scripts/deploy/DEPLOY_SEQUENCE.md) · [`scripts/deploy/CANARY_RUNBOOK.md`](../scripts/deploy/CANARY_RUNBOOK.md) | The forward deploy + flag-canary path (rollback is the reverse) |

---

## The three rollback layers

Rollback is **layered**. Always reach for the **least-destructive layer that
fixes the failure**. Layers are independent — you can do A without B, but B and
C are strictly ordered (you cannot data-restore a schema that the app no longer
expects, and you should not schema-rollback before the app that depends on the
new schema is already off it).

| Layer | What it undoes | Destructive? | Reversible? | Typical time |
|-------|----------------|--------------|-------------|--------------|
| **A — app / deploy rollback** | the running code (a bad build, a regression, a broken flag) | No (config/image only) | Yes — roll forward again | seconds–minutes |
| **B — migration rollback** | a schema change (a table/column/policy a migration added) | **Often yes** (`dataLoss:true`) | Re-apply the up-migration | minutes |
| **C — data rollback** | the data itself (corruption, bad backfill, accidental mass-delete) | **Yes** (restores a point-in-time, loses writes since) | No — last resort | tens of minutes–hours |

---

## Decision tree — which layer for which failure

```
START: production is unhealthy after a change.
│
├─ Is the schema unchanged since the last-known-good deploy?
│   (no new migration applied — only code / flags / image changed)
│        │
│        └─ YES → LAYER A (app/deploy rollback). Done. ───────────────► verify §A
│
├─ Did a MIGRATION just go out AND is it the cause?
│   (the app is failing because of, or right after, a schema change)
│        │
│        ├─ First, take the app OFF the new schema:
│        │     • If a feature flag fronts the new schema → turn the flag OFF
│        │       and roll the pods (CANARY_RUNBOOK rollback — no redeploy).
│        │     • Else → LAYER A: redeploy the previous image (which expects the
│        │       OLD schema). The schema is forward-compatible if the migration
│        │       was additive — most are — so the old app keeps running.
│        │
│        └─ Is the schema change ITSELF wrong (must be reversed)?
│                 │
│                 └─ YES → LAYER B (scripted migration rollback). ─────► verify §B
│                          Mind `dataLoss` — the script blocks it unless
│                          you pass --force on purpose.
│
└─ Is the DATA corrupted / a destructive write happened?
   (a bad backfill, an errant mass UPDATE/DELETE, logical corruption)
         │
         └─ YES → LAYER C (restore from encrypted backup). ───────────► verify §C
                  This is the last resort: it loses every write since the
                  restore point. Prefer A or B if they fix it.
```

**Rule of thumb:** A is almost always the right first move. Reach for B only
when the *schema* is wrong. Reach for C only when the *data* is wrong and A/B
cannot recover it.

---

## Layer A — app / deploy rollback (blue/green re-point)

**When:** the code or a flag is the problem; the schema is fine.
**Destructive:** no. Fully reversible — you can roll forward again.

### Pre-conditions
- The previous image/task-definition is still available (it is — ECR keeps
  `:<sha>` and `:latest`; ECS keeps prior task definitions).
- You know the last-known-good version/sha (check the CD Production run summary).

### Path 1 — a flag is the cause (fastest)
The five LP-30 seams and every `BORJIE_*` canary flag are **fail-safe with the
flag off**. Per [`CANARY_RUNBOOK.md`](../scripts/deploy/CANARY_RUNBOOK.md):

```sh
# Unset (or =0) the offending flag in the deploy platform / IaC, then:
#   roll the pods — NO redeploy.
```

### Path 2 — the image/build is the cause (blue/green re-point)
`cd-production.yml` already has an automatic rollback job: if `health-checks`
fail after a deploy, it re-points the ECS service to the **previous task
definition**. To trigger a rollback **manually**:

```sh
gh workflow run cd-production.yml -f version="<last-good-version>" -f rollback=true
```

…or do the ECS re-point directly (what the workflow's `rollback` job runs):

```sh
PREV_TASK=$(aws ecs describe-services \
  --cluster borjie-production-cluster \
  --services borjie-production-api \
  --query 'services[0].deployments[1].taskDefinition' --output text)

aws ecs update-service \
  --cluster borjie-production-cluster \
  --service borjie-production-api \
  --task-definition "$PREV_TASK" --region eu-west-1
```

### Verify §A
```sh
curl -sf "$PRODUCTION_API_URL/health"   # 200
curl -sf "$PRODUCTION_API_URL/ready"    # 200
```
Error rate + p95 latency back to baseline. If a flag was the cause, confirm the
flag now reads its safe default in the running pods.

---

## Layer B — migration rollback (scripted, over the down-registry)

**When:** a migration's schema change is itself wrong and must be reversed.
**Destructive:** often — many down scripts drop a table (`dataLoss:true`). The
script is **double-gated** so you can never reverse a destructive migration by
accident.

> **Order:** get the app OFF the new schema FIRST (Layer A path 2, or the
> feature flag) so nothing is mid-write against the table you are about to drop.

### The tool: `scripts/rollback-migration.mjs`
It reads the **applied set** from the production runner's `_migrations` tracking
table (the same table [`scripts/migrate-prod.ts`](../scripts/migrate-prod.ts)
writes), reverses the **last N applied migrations** (newest first) by running
the matching `down/` script from
[`_registry.json`](../packages/database/src/migrations/down/_registry.json), and
deletes the `_migrations` row for each reversed version inside the same
transaction.

**Safety model (fail-safe by construction):**
- **DRY-RUN by default.** Prints the exact down SQL it *would* run + the
  `dataLoss` flag per step. Mutates nothing. You must pass `--apply` to execute.
- **`dataLoss:true` is blocked** unless you *also* pass `--force` (`--apply`
  alone is not enough for a destructive down).
- **Verifies the down file exists** on disk before it would run a step; a
  missing file aborts the whole plan (no partial rollback).
- **Honest-degrade on gaps:** if an applied migration has **no** registry entry,
  the step is reported as a `GAP` and the plan **stops at the first gap** — it
  never guesses a reverse.
- **Strictly last-applied-first**, each step in its own transaction; a failure
  rolls that step back and aborts the rest.

### Pre-conditions
- `DATABASE_URL` points at the target DB (the admin/owner role — it must be able
  to `DROP`).
- The app is already off the schema you are reversing (Layer A done).
- You have **looked at the dry-run** and the `reverses:` description matches your
  intent.

### Exact commands
```sh
# 1) ALWAYS dry-run first. Default reverses the single newest applied migration.
node scripts/rollback-migration.mjs

# Reverse the last N (e.g. a 3-migration release):
node scripts/rollback-migration.mjs --count=3

# Machine-readable plan (for a change ticket / CI gate):
node scripts/rollback-migration.mjs --json --count=3

# 2) Execute. Non-destructive (no dataLoss step) — --apply is enough:
node scripts/rollback-migration.mjs --apply

# 3) Execute a destructive (dataLoss:true) down — must be deliberate:
node scripts/rollback-migration.mjs --apply --force
```

> If the dry-run shows a `GAP`, the migration has no documented down. **Do not
> force around it.** Either add the missing mapping + `down/` script and re-run,
> or reverse that one migration by hand (then `DELETE FROM _migrations WHERE
> version = '<version>'`).

### Verify §B
```sh
# Schema drift detector — proves the ledger matches the live schema.
DATABASE_URL=… pnpm verify:migrations

# Spot-check the object is gone (or restored to its prior shape):
psql "$DATABASE_URL" -c "SELECT to_regclass('public.<table>');"   # NULL if dropped

# Ledger no longer lists the reversed version:
psql "$DATABASE_URL" -c "SELECT version FROM _migrations ORDER BY version DESC LIMIT 5;"
```
Re-apply later with the normal forward runner (`make db-migrate` /
`scripts/migrate-prod.ts`) once the fix is ready — migrations are immutable, so
the same up-file re-applies cleanly.

---

## Layer C — data rollback (encrypted backup restore)

**When:** the data is corrupted and A/B cannot recover it. **Last resort.**
**Destructive:** yes — restoring a point-in-time backup loses every write made
since that backup.

This layer is **drilled weekly** by
[`backup-restore-drill.yml`](../.github/workflows/backup-restore-drill.yml): it
pulls the latest daily encrypted dump from S3, decrypts (AES-256-CBC + PBKDF2),
`pg_restore`s into an ephemeral Postgres, and smoke-tests core multi-tenant
tables. **Because the drill is green, the restore path you run here is the exact
path that was just proven.**

### Pre-conditions
- You have decided the blast radius justifies losing writes since the restore
  point (founder call).
- `BACKUP_ENCRYPTION_KEY` and the backup-bucket access are available.
- A restore **target** is chosen: usually a fresh database you cut over to, **not**
  an in-place clobber of the live DB (keep the corrupted DB for forensics).

### Exact commands (mirrors the drill, run against a restore target)
```sh
# 1) Pick the dump (latest daily, or a specific point-in-time object).
REMOTE=$(aws s3api list-objects-v2 --bucket "$BACKUP_BUCKET" \
  --prefix "$BACKUP_PREFIX/daily/" \
  --query 'reverse(sort_by(Contents, &LastModified))[0].Key' --output text)

# 2) Download + decrypt + decompress.
aws s3 cp "s3://$BACKUP_BUCKET/$REMOTE" backup.enc
openssl enc -d -aes-256-cbc -pbkdf2 -in backup.enc -out backup.gz \
  -pass "env:BACKUP_ENCRYPTION_KEY"
gunzip -c backup.gz > restored.dump

# 3) Restore into the RESTORE TARGET (never the corrupted live DB in place).
psql "$RESTORE_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$RESTORE_DB_URL" --verbose restored.dump

# 4) (founder step) Cut the app over to the restored DB — connection-string
#    repoint via IaC, then roll the pods.
```

You can also dry-run the whole thing in CI without touching prod:

```sh
gh workflow run backup-restore-drill.yml          # latest daily
gh workflow run backup-restore-drill.yml -f s3_uri="s3://…/<specific-dump>"
```

### Verify §C
- The drill smoke-test passes (row counts on `tenants`, `users` ≥ minimums).
- `pnpm verify:migrations` against the restored DB → no drift.
- App `/health` + `/ready` green after the cutover; sample a few tenant reads to
  confirm isolation (RLS is FORCE-enabled and unaffected by a restore).

---

## After ANY rollback

- [ ] `/health` + `/ready` green; error rate + p95 latency at baseline.
- [ ] Note the incident: which layer, which version/migration/dump, why.
- [ ] If you reversed a migration (Layer B), file the **forward fix** so the
      same up-file (immutable) can re-apply cleanly later.
- [ ] If you restored data (Layer C), keep the corrupted DB for forensics before
      decommissioning it.

---

## Down-registry coverage audit (recent migrations)

The Layer-B script can only reverse a migration that has a `down/` script **and**
a `_registry.json` mapping. Coverage today (verified):

- **Total `down/` scripts on disk:** 83.
- **Registered mappings in `_registry.json`:** 48.
- **Unregistered `down/` files (gaps):** 35 — these have a down script on disk
  but no registry entry, so the script reports them as a `GAP` rather than
  guessing. (No registry entry points at a *missing* file — every mapping
  resolves.)

**Recent migrations 0336–0343:**

| Migration | `down/` file present | In `_registry.json` | `dataLoss` | Status |
|-----------|:---:|:---:|:---:|---|
| 0336 rls_org_identity_geo_closure | yes | **no** | — | **GAP** — down script exists, unregistered |
| 0337 enabled_jurisdictions | yes | **no** | — | **GAP** — down script exists, unregistered |
| 0338 relax_country_check_constraints | yes | **no** | — | **GAP** — down script exists, unregistered |
| 0339 md_commitment_timeline | yes | yes | true | OK |
| 0340 owner_governance_preferences | yes | yes | true | OK |
| 0341 org_loop_runs | yes | yes | true | OK |
| 0342 service_role_bypass_spine_tables | yes | yes | false | OK |
| 0343 oauth_state_nonces | yes | yes | true | OK |

> **Action to close the 0336/0337/0338 gap (and the other 32):** add a mapping
> in `_registry.json` for each `down/` file that lacks one. Until then, the
> rollback script honestly refuses to auto-reverse them and tells you which
> step is a gap — it never runs an undocumented reverse.
