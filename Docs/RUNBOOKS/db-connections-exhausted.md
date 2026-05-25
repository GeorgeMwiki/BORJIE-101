# Runbook: DBConnectionsExhausted

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `DBConnectionsExhausted`                                     |
| Severity         | page                                                         |
| Team             | sre                                                          |
| Source PromQL    | `sum(pg_stat_activity_count) by (datname) / sum(pg_settings_max_connections) by (datname) > 0.90` |
| Window           | 5m                                                           |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.database`) |

## Symptoms

- PagerDuty page: `DBConnectionsExhausted`.
- `gateway` 5xx rate may rise (see `APIErrorRateHigh`).
- App logs: `remaining connection slots are reserved`, `sorry, too many clients`.
- Slow `INSERT`/`UPDATE` followed by `pq: connection refused`.

## Suspect causes

- Connection leak in a recently shipped service (missing `defer client.release()`).
- A long-running `idle in transaction` from an interactive psql or a stuck handler.
- pgbouncer mis-sized after a deploy (`default_pool_size` too high).
- Migration in flight holding an `AccessExclusiveLock`.
- Runaway analytics job opening unbounded read connections.

## Diagnostics

```sh
# 1. Confirm utilization per database.
psql "$DATABASE_URL" -c "
  SELECT datname, count(*) AS active,
         (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max
  FROM pg_stat_activity
  GROUP BY datname ORDER BY active DESC;
"

# 2. Identify idle-in-tx hogs (the usual culprit).
psql "$DATABASE_URL" -c "
  SELECT pid, usename, application_name, state, query_start,
         now() - query_start AS age, left(query, 120) AS q
  FROM pg_stat_activity
  WHERE state = 'idle in transaction' AND now() - query_start > interval '1 minute'
  ORDER BY age DESC LIMIT 20;
"

# 3. Identify long-running queries.
psql "$DATABASE_URL" -c "
  SELECT pid, now() - query_start AS age, left(query, 120) AS q
  FROM pg_stat_activity
  WHERE state = 'active' AND now() - query_start > interval '30 seconds'
  ORDER BY age DESC;
"

# 4. Check pgbouncer pool stats.
psql "postgresql://$PGB_USER:$PGB_PASSWORD@$PGB_HOST:6432/pgbouncer" -c "SHOW POOLS;"
```

## Immediate mitigation

1. Terminate offending `idle in transaction` PIDs (only after capturing the
   `query` column for postmortem):
   ```sh
   psql "$DATABASE_URL" -c "SELECT pg_terminate_backend(<pid>);"
   ```
2. Restart pgbouncer to drain all pool entries:
   ```sh
   kubectl -n borjie rollout restart deployment/pgbouncer
   ```
3. If a single deployment is the leaker, restart it:
   ```sh
   kubectl -n borjie rollout restart deployment/<service>
   ```
4. Temporarily raise `max_connections` only if mitigation 1–3 are exhausted
   AND there is a customer-visible outage:
   ```sh
   # via Helm values bump + restart Postgres (NOT for managed RDS — open a ticket)
   ```

## Permanent fix

- Audit the offending service for missing release/rollback paths
  (`pg.Pool` clients must always `release()`; `BEGIN` must always end).
- Add an integration test that runs the handler under `pgmock` and asserts
  the pool count returns to baseline.
- Set a Prometheus rule on per-service `pg_pool_used` to catch leaks earlier.
- Tune pgbouncer `server_idle_timeout` and `query_wait_timeout`.

## Escalation contact

1. SRE on-call (`sre-primary`).
2. DBA / data-platform team (`#data-platform`).
3. After 30 minutes: engineering lead.
