# Runbook: BrainEventLagHigh

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `BrainEventLagHigh`                                          |
| Severity         | page                                                         |
| Team             | brain                                                        |
| Source PromQL    | `max by (consumer_group) (brain_event_consumer_lag_seconds) > 300` |
| Window           | 5m                                                           |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.brain`) |

## Symptoms

- PagerDuty page: `BrainEventLagHigh consumer_group=<name>`.
- The brain reasons on stale state: SLA timers fire late, briefings miss
  recent tenant events, intervention suggestions reference outdated data.
- Grafana panel "Brain consumer lag" climbing in steps (rebalance) or
  ramping (slow handler).

## Suspect causes

- Slow handler (LLM call > 30s, p99 budget exceeded).
- Partition rebalance stuck after pod restart.
- Single hot partition with poison-message replay loop.
- Downstream Postgres write contention (see `DBConnectionsExhausted`).
- Recently deployed handler with a new external dependency that times out.

## Diagnostics

```sh
# 1. Per-partition lag (find the hot one).
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=brain_event_consumer_lag_seconds'

# 2. Handler latency.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=histogram_quantile(0.95, rate(brain_event_handler_duration_ms_bucket[5m])) by (handler)'

# 3. Consumer pod state.
kubectl -n borjie get pods -l app=brain-consumer
kubectl -n borjie logs deploy/brain-consumer --since=15m | tail -100

# 4. Poison-message check (same offset repeated).
kubectl -n borjie logs deploy/brain-consumer --since=15m \
  | rg 'offset=[0-9]+' -o | sort | uniq -c | sort -rn | head

# 5. Recent deploy?
kubectl -n borjie rollout history deployment/brain-consumer | tail -5
```

## Immediate mitigation

1. If a recent deploy correlates, roll back:
   ```sh
   kubectl -n borjie rollout undo deployment/brain-consumer
   ```
2. If poison message confirmed, skip the offset:
   ```sh
   kubectl -n borjie exec deploy/brain-consumer -- \
     node scripts/skip-offset.mjs --topic brain.events --partition <p> --offset <o>
   ```
3. Temporarily scale handlers to drain backlog:
   ```sh
   kubectl -n borjie scale deployment/brain-consumer --replicas=8
   ```
4. If downstream LLM is slow, switch the brain to "fast model" mode:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/brain/mode" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"mode":"fast","reason":"lag mitigation"}'
   ```

## Permanent fix

- Cap handler latency with a context-deadline; emit failures to a DLQ instead
  of blocking the partition.
- Add poison-pill detection: same offset retried > N times auto-routes to DLQ.
- Add HPA on `brain-consumer` keyed to `brain_event_consumer_lag_seconds`.
- Add a daily replay job for DLQ contents so poison messages are surfaced
  in code review, not at 3am.

## Escalation contact

1. Brain on-call (`brain-primary`).
2. Brain platform lead (`#brain-platform`).
3. After 30 minutes: engineering lead.
