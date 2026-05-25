# Runbook: BackupRestoreDrillFailure

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `BackupRestoreDrillFailure`                                  |
| Severity         | ticket                                                       |
| Team             | sre                                                          |
| Source PromQL    | `(time() - backup_restore_drill_last_success_timestamp_seconds) > 604800 or backup_restore_drill_last_status == 0` |
| Window           | 0m (fire on first miss)                                      |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.dr`) |

## Symptoms

- Slack ticket: `BackupRestoreDrillFailure`.
- Either the weekly drill cron returned failure status, or it hasn't run
  successfully in > 7 days.
- DR posture is unverified — we cannot prove our backups are restorable.

## Suspect causes

- Drill cron stopped scheduling (cron-supervisor issue, see
  `Docs/RUNBOOKS/cron-supervisor-debug.md`).
- The drill job itself errored: bad credentials, S3 access denied,
  encryption key rotated and not propagated to the drill runner.
- The dump exists but `pg_restore` fails — schema drift between dump and
  current restore target.
- Restore target shard ran out of disk.
- Backup file is corrupted (rare, but exactly what the drill exists to
  catch).

## Diagnostics

```sh
# 1. When did the drill last succeed?
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=backup_restore_drill_last_success_timestamp_seconds'

# 2. What did the most recent attempt do?
kubectl -n borjie get jobs -l app=backup-restore-drill \
  --sort-by=.metadata.creationTimestamp | tail -5
LATEST=$(kubectl -n borjie get jobs -l app=backup-restore-drill \
  --sort-by=.metadata.creationTimestamp -o name | tail -1)
kubectl -n borjie logs $LATEST --tail=500

# 3. Are recent backups even being produced?
aws s3 ls "s3://$BACKUP_BUCKET/daily/" --recursive | tail -10

# 4. Can we read + decrypt a recent backup manually?
scripts/restore.sh --dry-run --date $(date -u -v-1d +%Y-%m-%d)

# 5. Is the restore target shard healthy?
psql "$DR_DRILL_DATABASE_URL" -c "SELECT version(), pg_database_size(current_database());"
```

## Immediate mitigation

There is no real-time customer impact — this is a posture alert. Fix within
24 hours; do not silence.

1. Re-run the drill manually:
   ```sh
   kubectl -n borjie create job --from=cronjob/backup-restore-drill \
     backup-restore-drill-manual-$(date +%s)
   kubectl -n borjie logs -f job/backup-restore-drill-manual-<ts>
   ```
2. If the manual run fails on decryption, rotate `BACKUP_ENCRYPTION_KEY`
   into the drill secret:
   ```sh
   kubectl -n borjie set env cronjob/backup-restore-drill \
     BACKUP_ENCRYPTION_KEY=$(kubectl get secret backup-keys -o jsonpath='{.data.current}' | base64 -d)
   ```
3. If `pg_restore` fails on schema drift, restore to a freshly initialized
   target instead of the persistent drill DB:
   ```sh
   scripts/restore.sh --target-fresh --date $(date -u -v-1d +%Y-%m-%d)
   ```

## Permanent fix

- Add a CI step that runs the drill against the latest dump on every
  schema migration PR.
- Move the drill secret into a sealed secret so manual key updates can't
  be forgotten.
- Expand the drill to assert a known canary row exists in the restored DB
  (catches silent corruption).
- Document the last-known-good drill output in
  `Docs/RUNBOOKS/backup-restore.md` for comparison.

## Escalation contact

1. SRE on-call (`sre-primary`).
2. Data platform lead (`#data-platform`).
3. DPO + CTO if no successful drill in > 14 days — that is a compliance
   finding under our DR policy.
