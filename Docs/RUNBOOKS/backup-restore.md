# Backup + Restore

**Scope**: daily Postgres dumps, monthly archives, Redis snapshotting,
and the quarterly restore drill that proves the archive actually works.

Scripts: `scripts/backup.sh` (producer) and `scripts/restore.sh`
(consumer).

---

## 1. Backup cadence

Source of truth: `scripts/backup.sh:1-18`.

| Item                  | Value                                                               |
| --------------------- | ------------------------------------------------------------------- |
| Daily dump            | `pg_dump --format=custom --no-owner --no-privileges --compress=0`   |
| Compression           | `gzip -c` post-dump                                                 |
| Encryption            | AES-256-CBC via `openssl enc -pbkdf2 -iter 200000 -salt -pass env:` |
| Key env var           | `BACKUP_ENCRYPTION_KEY` (raw or hex, 32 bytes; never on disk)       |
| Daily object key      | `<prefix>/daily/<YYYY-MM-DD>/postgres-<ISO-TS>.dump.gz.enc`         |
| Monthly archive       | Copy of the dump on day `01` under `<prefix>/monthly/<YYYY-MM>/...` |
| Daily retention       | 30 days rolling (older objects pruned by the script)                |
| Monthly retention     | Kept indefinitely (no pruning)                                      |
| Target storage        | S3 (or S3-compatible via `AWS_ENDPOINT_URL_S3` for R2/B2)           |
| Server-side encryption | `--sse AES256` on every upload (belt + braces over client-side enc) |
| Test mode             | `BORJIE_TEST_MODE=true` short-circuits the S3 leg for CI        |

Retention logic lives at `scripts/backup.sh:90-99` — iterates
`<prefix>/daily/`, parses the date segment, deletes anything older than
30 days. Monthly archives are outside this loop so the 1st-of-month
copy survives.

### Redis snapshot inclusion

`scripts/backup.sh:67-74`: when `REDIS_URL` is set and `redis-cli` is
on PATH, the script issues `redis-cli SAVE` to trigger a server-side
RDB snapshot. The script does NOT pull the `dump.rdb` file back —
capturing it from the server requires SSH to the node, which is out of
scope for the scripted path. Rely on the Redis node's own durable
storage (EBS snapshot on the managed instance, or `appendonly yes` +
persistent volume on the k8s chart at `k8s/templates/redis.yaml`).

### Required env

From `scripts/backup.sh:9-15`:

| Var                                      | Required  | Purpose                                 |
| ---------------------------------------- | --------- | --------------------------------------- |
| `DATABASE_URL`                           | yes       | Postgres connection string              |
| `BACKUP_ENCRYPTION_KEY`                  | yes       | 32-byte AES key (hex or raw)            |
| `BACKUP_BUCKET`                          | yes (prod) | `s3://bucket-name`                      |
| `BACKUP_PREFIX`                          | no        | Default `borjie`                    |
| `REDIS_URL`                              | no        | Skipped when unset                      |
| `AWS_ENDPOINT_URL_S3`                    | no        | Route to R2 / B2                        |
| `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` | yes (prod) | S3 upload credentials                  |

---

## 2. Invocation

Run under cron (or the equivalent k8s CronJob) once per day in UTC.
Schedule window SHOULD avoid the Tanzania month-end payments freeze
(`Docs/RUNBOOK.md:385-389`).

```bash
# Example daily cron line (02:00 UTC):
0 2 * * *  \
  DATABASE_URL=$DATABASE_URL \
  REDIS_URL=$REDIS_URL \
  BACKUP_BUCKET=s3://borjie-backups \
  BACKUP_ENCRYPTION_KEY=$(aws secretsmanager get-secret-value \
    --secret-id borjie/production/backup-key \
    --query SecretString --output text) \
  /opt/borjie/scripts/backup.sh
```

Exit codes: `0` success, `1` error, `2` precondition failed
(`scripts/backup.sh:17`).

Structured success line at `scripts/backup.sh:103`:
`backup: ok bytes=<size> key=<daily-key>`. Pipe to CloudWatch or your
log shipper and alarm on absence (no success line in 25 h ⇒ page).

---

## 3. Restore

Interactive script at `scripts/restore.sh` — destructive, double-confirm,
and refuses to run unless `BORJIE_ALLOW_RESTORE=true`
(`scripts/restore.sh:18-20`).

```bash
BORJIE_ALLOW_RESTORE=true \
  DATABASE_URL=postgres://... \
  BACKUP_ENCRYPTION_KEY=$(...) \
  BACKUP_BUCKET=s3://borjie-backups \
  scripts/restore.sh --key borjie/daily/2026-04-19/postgres-20260419T080000Z.dump.gz.enc
```

Flow (`scripts/restore.sh`):

1. Validate guard env (line 18).
2. Require either `--key` (S3) or `--from-local` (disk) at line 35.
3. Download to a temp dir whose `trap` deletes on exit (lines 39-40).
4. Prompt for `RESTORE` (line 61) — first confirmation.
5. Prompt for the key-suffix match (lines 64-70) — second confirmation.
6. Decrypt (`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000`, line 73).
7. `gunzip` + `pg_restore --clean --if-exists --no-owner --no-privileges`
   (lines 76-80).

After a restore, re-run `scripts/migrate-prod.sh` so any migrations
applied AFTER the snapshot replay (`Docs/OPERATIONS.md:103-105`).

Exit codes: `0` success, `1` error, `3` refused (guard unset)
(`scripts/restore.sh:13`).

---

## 4. Quarterly restore drill (mandatory)

Running a restore in anger is the wrong time to discover the backup is
unreadable. Schedule a drill once per quarter against a disposable
environment:

1. Pick the most recent daily key AND the newest monthly archive.
2. Provision a scratch Postgres (Aurora clone, Docker, or a scratch RDS
   replica from the latest snapshot is fastest).
3. Restore both keys to the scratch database using the script above.
4. Run `scripts/smoke-test.sh` against an API pointed at the scratch DB
   — confirm green.
5. Run `pnpm -F @borjie/database db:migrate` against the scratch DB
   (via `scripts/migrate-prod.sh`) to confirm post-snapshot migrations
   still apply clean.
6. Record the drill in `Docs/OPERATIONS.md` (retention + compliance
   audit evidence) with: date, backup key, operator, outcome.
7. Tear down the scratch DB.

A failed drill is a P1 — the backup itself is broken (bad key,
corruption, missing SSE). Stop issuing new dumps with the same key
material, rotate `BACKUP_ENCRYPTION_KEY`, and verify subsequent dumps
decrypt before rotating back to a daily cadence.

---

## 5. Key rotation

`BACKUP_ENCRYPTION_KEY` should rotate on the standard secret-rotation
cadence (see `Docs/SECURITY.md` for policy). Rotation is NOT
retroactive — historical dumps remain readable only with the key they
were encrypted with, so archive the old key alongside the old
ciphertext until monthly-archive retention expires.

Practical approach:

1. Generate the new key: `openssl rand -hex 32`.
2. Store it alongside the old one (e.g. both versions in Secrets
   Manager, with `Current` and `Previous` aliases).
3. Flip `BACKUP_ENCRYPTION_KEY` in the cron env to `Current`.
4. For restore, code reads whichever alias matches the dump date.

---

## Cross-links

- Incident response (including "backup verified" as a migration
  precondition): [`./incident-response.md`](./incident-response.md)
- Production migration cadence (re-run after restore): [`./migration-production.md`](./migration-production.md)
- Operations master: `Docs/OPERATIONS.md:95-106`
