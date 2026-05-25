# Runbook: APIErrorRateHigh

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `APIErrorRateHigh`                                           |
| Severity         | page                                                         |
| Team             | sre                                                          |
| Source PromQL    | `sum(rate(gateway_http_requests_total{status=~"5.."}[10m])) / sum(rate(gateway_http_requests_total[10m])) > 0.01` |
| Window           | 10m                                                          |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.api`) |

## Symptoms

- PagerDuty page: `APIErrorRateHigh`.
- Gateway dashboard "5xx rate" panel above 1% sustained ≥ 10m.
- Synthetics red, customer reports "tenant portal won't load".
- Error log volume on `gateway` deployment spikes.

## Suspect causes

- Bad deploy (most common) — regression in the last 30 minutes.
- DB pool saturation cascading 500s (cross-check `DBConnectionsExhausted`).
- Upstream provider 5xx (M-Pesa, Twilio, OpenAI) propagated as 500 instead
  of mapped 502/503.
- Redis eviction storm dropping cached auth tokens, causing crash-loop on
  `/api/v1/auth/refresh`.
- Container OOMKill burst (cross-check `PodOOMKillBurst`).

## Diagnostics

```sh
# 1. What's the actual error rate and which route?
curl -s "$PROM_URL/api/v1/query" \
  --data-urlencode 'query=topk(5, sum by (route,status) (rate(gateway_http_requests_total{status=~"5.."}[10m])))'

# 2. What deployed recently?
kubectl -n borjie rollout history deployment/gateway | tail -5
gh run list --workflow=deploy.yml --limit 5

# 3. Tail logs for the noisiest route.
kubectl -n borjie logs deploy/gateway --since=15m | rg ' (500|502|503|504) ' | head -50

# 4. Smoke + deep health.
scripts/smoke-test.sh production
curl -sf "$PROD_URL/api/v1/health/deep" -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# 5. Cross-check Postgres + Redis.
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_stat_activity WHERE state='idle in transaction';"
redis-cli -u "$REDIS_URL" INFO clients
```

## Immediate mitigation

1. If a deploy landed in the last 30m, **roll back**:
   ```sh
   kubectl -n borjie rollout undo deployment/gateway
   ```
2. If a single tenant is dominant in 5xx logs, **rate-limit them**:
   ```sh
   kubectl -n borjie exec deploy/gateway -- \
     node scripts/rate-limit-tenant.mjs --tenant <id> --rps 10
   ```
3. If pool exhausted, restart the connection pooler:
   ```sh
   kubectl -n borjie rollout restart deployment/pgbouncer
   ```
4. If upstream provider is down, flip its breaker:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/breakers/<provider>/open" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

## Permanent fix

- Add a targeted unit/integration test for the regression class before
  re-deploying the rolled-back artifact.
- Convert upstream 5xx into mapped 5xx/4xx via the gateway's `circuit`
  middleware so they don't pollute SLO metrics.
- Tighten Helm `resources.requests.cpu` and pod `readinessProbe` so a
  cold pod cannot serve traffic.
- File an SLO burn-rate review in `Docs/KPIS_AND_SLOS.md`.

## Escalation contact

1. Primary on-call (PagerDuty schedule `sre-primary`).
2. Secondary: `#status-ops` Slack channel.
3. After 30 minutes: engineering lead on Signal, then CTO.
