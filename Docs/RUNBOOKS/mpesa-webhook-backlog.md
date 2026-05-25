# Runbook: MpesaWebhookBacklog

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `MpesaWebhookBacklog`                                        |
| Severity         | page                                                         |
| Team             | payments                                                     |
| Source PromQL    | `max(mpesa_webhook_queue_depth) > 100`                       |
| Window           | 5m                                                           |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.payments`) |

## Symptoms

- PagerDuty page: `MpesaWebhookBacklog`.
- Tenants reporting "I paid but the app says unpaid".
- `mpesa_webhook_queue_depth` Grafana panel sustained > 100.
- Reconciliation job (`scripts/reconcile-mpesa.ts`) running long or failing.

## Suspect causes

- Consumer crash-loop (`mpesa-webhook-consumer` pod CrashLoopBackOff).
- DB lock on `payments` table preventing INSERT (see `DBConnectionsExhausted`).
- Safaricom retry storm (their gateway re-sends if our 200 OK is slow).
- Bad migration touching `payments` schema currently in flight.
- Consumer handler hung on an external HTTP call (idempotency check service).

## Diagnostics

```sh
# 1. Queue depth + processing rate.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=mpesa_webhook_queue_depth'
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=rate(mpesa_webhook_processed_total[5m])'

# 2. Consumer pod status.
kubectl -n borjie get pods -l app=mpesa-webhook-consumer
kubectl -n borjie logs deploy/mpesa-webhook-consumer --since=15m | tail -100

# 3. Are we acking quickly enough? (Safaricom retry threshold is ~30s)
kubectl -n borjie logs deploy/mpesa-webhook-consumer --since=15m \
  | rg 'handled in [0-9]+ms' | awk '{print $NF}' | sort -n | tail -20

# 4. DB lock check on payments table.
psql "$DATABASE_URL" -c "
  SELECT pid, mode, granted, query
  FROM pg_locks l JOIN pg_stat_activity a USING (pid)
  WHERE relation::regclass::text = 'payments';
"

# 5. Dead-letter queue depth.
redis-cli -u "$REDIS_URL" XLEN mpesa:webhook:dlq
```

## Immediate mitigation

1. Scale up the consumer if CPU bound:
   ```sh
   kubectl -n borjie scale deployment/mpesa-webhook-consumer --replicas=6
   ```
2. If pod is crash-looping, roll back the last consumer deploy:
   ```sh
   kubectl -n borjie rollout undo deployment/mpesa-webhook-consumer
   ```
3. If the handler hangs on an external call, open the circuit breaker
   so we 200-OK Safaricom immediately and process async:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/breakers/mpesa-idem/open" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```
4. Drain backlog manually if Safaricom is healthy:
   ```sh
   kubectl -n borjie exec deploy/mpesa-webhook-consumer -- \
     node scripts/replay-mpesa-queue.mjs --max 500
   ```

## Permanent fix

- Move the heavy idempotency check off the synchronous path; ack within 50ms.
- Add HPA on `mpesa-webhook-consumer` keyed to `mpesa_webhook_queue_depth`.
- Persist the queue in Postgres (outbox pattern) so a Redis flap can't lose
  messages already 200-OKed to Safaricom.
- Add an SLO alert at depth=50 (warn) feeding a Slack ticket before the
  page-level alert fires at 100.

## Escalation contact

1. Payments on-call (`payments-primary`).
2. Payments lead (`#payments-ops`).
3. After 15 minutes with active customer impact: engineering lead + finance.
