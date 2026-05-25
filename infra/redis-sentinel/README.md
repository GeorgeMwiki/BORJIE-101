# Redis Sentinel — 3-node HA

3 Sentinel nodes + 1 primary + 2 replicas. Closes audit Architecture finding #7
("Redis (single)" SPOF) from `.audit/deep-audit-2026-05-20.md`.

## Architecture

```
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ sentinel-1 │ │ sentinel-2 │ │ sentinel-3 │   gossip, quorum=2/3
   └──────┬─────┘ └──────┬─────┘ └──────┬─────┘
          │              │              │
          └──────────────┼──────────────┘
                         │ monitors
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       ┌─────────┐  ┌─────────┐  ┌─────────┐
       │ redis-  │  │ redis-  │  │ redis-  │
       │ primary │  │replica-1│  │replica-2│
       └─────────┘  └─────────┘  └─────────┘
       (writes)     (read-only)  (read-only)
```

## Failover behaviour

- **Quorum:** 2 of 3 Sentinels must agree the primary is `subjectively-down`
  before failover starts (`sentinel monitor mymaster <ip> <port> 2`).
- **Down-after-milliseconds:** 5000 (5s without PONG → SDOWN).
- **Failover-timeout:** 10s before a Sentinel will retry election.
- **RTO budget:** ≈15–25s (5s SDOWN detection + 10s election + replica promote).
- **RPO:** asynchronous replication — accept ≤1s of writes lost on primary loss.
  For exactly-once payment paths, use Postgres outbox, not Redis.

## Client connection

Applications discover the current primary via Sentinel, not by direct address.
Set `REDIS_SENTINEL_HOSTS` (env, comma-separated) + `REDIS_SENTINEL_NAME`
(default `borjie-master`) and use a Sentinel-aware client
(`ioredis`'s `{ sentinels, name }` option; `node-redis` v4
`createClient({ url, ...{ socket: { reconnectStrategy } }, ...sentinel })`).

When `REDIS_SENTINEL_HOSTS` is unset, app code MUST fall back to single-instance
`REDIS_URL` so dev/single-server compose keeps working unchanged.

## Files

| File | Purpose |
|---|---|
| `sentinel.conf.tpl` | Sentinel config template (envsubst-rendered per node) |
| `redis-primary.conf` | Primary node Redis config |
| `redis-replica.conf.tpl` | Replica node config template (REPLICAOF env-injected) |
| `entrypoint-sentinel.sh` | Renders sentinel.conf and execs redis-sentinel |
| `entrypoint-replica.sh` | Renders replica config and execs redis-server |

## Image pin

`redis:7.2-alpine` — both `redis-server` and `redis-sentinel` ship in this image
(invoked by mode).

## What ops still needs to do

1. Generate `REDIS_PASSWORD` ≥32 bytes; reuse for `masterauth` + `requirepass`.
2. Update every app that reads `REDIS_URL` to support `REDIS_SENTINEL_HOSTS`
   (see `packages/cache` if it exists, or `services/api-gateway/src/lib/redis.ts`).
3. Decide whether per-tenant rate-limit (`per-tenant-rate-budget.ts`) follows the
   Sentinel topology or runs against a dedicated Redis (recommended at scale).
