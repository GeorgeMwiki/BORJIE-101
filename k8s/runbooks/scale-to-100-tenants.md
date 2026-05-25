# Runbook — Scale to 100 Tenants

## When to use

You're at, or projected to hit, 100 tenants on the SaaS instance (or
on a single sovereign-cloud deployment). The defaults in `values.yaml`
are tuned for ~10 tenants — past 50 you need to revisit sizing.

> **This is a scaffolding runbook.** Replace every assumption with a
> real load-test datapoint before relying on the numbers below.

## Capacity model (rough)

Assumption per tenant (steady state):

| Resource | Per tenant | At 100 tenants |
|----------|-----------|----------------|
| Postgres connections (pooled) | 5 | 500 |
| Redis ops / sec | 50 | 5,000 |
| `api-gateway` RPS (p95) | 2 | 200 |
| `payments-ledger` RPS (p95) | 0.3 | 30 |
| Storage (Postgres) | 2 GiB | 200 GiB |
| Storage (object — receipts, signatures) | 1 GiB | 100 GiB |

These are first-order estimates. **Run a load test** before trusting them.

## Phase 1 — Database (the hardest scaling axis)

### 1.a Connection pooling

The defaults assume direct connections. At 500 connections you must
front Postgres with PgBouncer.

- Deploy PgBouncer as a separate Deployment in front of the StatefulSet.
- Move every app's `DATABASE_URL` to point at the PgBouncer service.
- Use transaction pooling mode (most BORJIE workloads are short
  transactions).

### 1.b Read replicas

Reports + heavy dashboards should hit a read replica:

- Promote `k8s/ha/postgres-statefulset.yaml` from baseline to streaming
  replication (Patroni or pg_auto_failover).
- Set `DATABASE_URL_READ` to the replica's PgBouncer.
- Audit which services already accept `DATABASE_URL_READ` (`reports`
  always; `api-gateway` for query-only routes).

### 1.c Per-tenant partitioning

For tables that grow with tenant count (e.g. `audit_log`, `events`),
add monthly partitioning. The migration framework already supports
this — see `services/payments-ledger/db/migrations/` for the pattern.

### 1.d Storage class

Default storage class is whatever the cluster gives — usually a single
SSD-backed PVC. At 100 tenants:

- Switch to a higher-IOPS class (gp3 / pd-ssd / nvme-local).
- Bump `postgres.statefulSet.storage.size` to 500Gi to leave headroom.
- Confirm snapshots run nightly — see `monitoring/` for the verifier.

## Phase 2 — Stateless workloads (easy)

### 2.a Bump HPA ceilings

In `values-prod.yaml` override:

```yaml
apps:
  customerApp:
    autoscaling:
      minReplicas: 5
      maxReplicas: 60        # was 30
services:
  apiGateway:
    autoscaling:
      minReplicas: 6         # was 3
      maxReplicas: 100       # was 50
  paymentsLedger:
    autoscaling:
      minReplicas: 4         # was 2
      maxReplicas: 30        # was 15
```

### 2.b KEDA scalers

For the 3 scale-to-zero portals, bump `maxReplicaCount` proportionally.
`customer-app` doesn't scale to zero, so the HPA above is sufficient.

### 2.c Cluster autoscaler

Confirm the cluster autoscaler is configured with a maximum that can
accommodate the new pod count. Rule of thumb: 4 pods/node for our
average resource requests.

```
100 frontends + 50 services + 30 misc = 180 pods
180 / 4 = 45 nodes minimum
```

Set the cluster autoscaler max to 60 nodes for headroom.

## Phase 3 — Cache + queue (Redis)

### 3.a Single replica is no longer enough

Promote `k8s/ha/redis-sentinel-statefulset.yaml` from baseline to
Sentinel-managed HA (3 replicas + Sentinel).

### 3.b Tune maxmemory

```yaml
redis:
  resources:
    requests: { cpu: 500m, memory: 2Gi }
    limits:   { cpu: "2",  memory: 8Gi }
```

Re-tune `maxmemory-policy: allkeys-lru` is fine for caches; if Redis
is now load-bearing for queues (Inngest, outbox), use `noeviction`
and accept the OOM risk in exchange for not losing queue entries.

## Phase 4 — Observability

At 100 tenants, "tail latency" stops being detectable by hand. You need:

- Prometheus + Grafana (or VictoriaMetrics / Mimir) for metrics.
- OpenTelemetry collector + Tempo / Jaeger for traces.
- Loki for logs.
- PagerDuty (or equivalent) for paging on:
  - p99 `api-gateway` >3 s for 5 min
  - any 5xx from `payments-ledger`
  - Postgres connection pool >80% for 10 min
  - Redis memory >90% for 10 min

## Phase 5 — Cost

At 100 tenants the bill becomes interesting. Two things help:

- Spot / preemptible nodes for everything *except* Postgres,
  Redis-Sentinel, and `payments-ledger`.
- Reserved instances on the always-warm nodes (typically 30% savings).

## Validation

Before declaring scaled, run the synthetic load suite:

```bash
# 100 simulated tenants, 10 RPS each, 5 min sustained:
pnpm --filter @borjie/load-test run 100tenants
```

Pass criteria:

- p95 `api-gateway` <500 ms
- p99 `api-gateway` <2 s
- Zero 5xx from `payments-ledger`
- Postgres CPU <70% on primary
- Redis memory <70%

## TODOs before this runbook is real

- [ ] Wire PgBouncer manifests into `k8s/ha/`.
- [ ] Confirm Patroni / pg_auto_failover choice and add HA manifests.
- [ ] Write the `pnpm --filter @borjie/load-test` runner if absent.
- [ ] Update tenant-count assumptions after the first real production
      load — these are educated guesses.
