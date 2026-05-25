# Postgres HA — Patroni + etcd + HAProxy

3-node Postgres cluster with automatic failover, managed by [Patroni](https://patroni.readthedocs.io/).
Closes audit finding **A3** (Postgres SPOF) from `.audit/deep-audit-2026-05-20.md`.

## Architecture

```
                       ┌──────────────┐
            ┌──────────│   HAProxy    │  port 5432 (writes)  /  5433 (read replicas)
            │          └──────┬───────┘
            │  Patroni REST   │ TCP check on /master, /replica
            │                 ▼
   ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
   │ postgres-      │ │ postgres-      │ │ postgres-      │
   │ primary        │ │ replica-1      │ │ replica-2      │
   │ (Patroni)      │ │ (Patroni)      │ │ (Patroni)      │
   └────────┬───────┘ └────────┬───────┘ └────────┬───────┘
            │                  │                  │
            └──────────────────┼──────────────────┘
                               │ DCS (leader election)
                       ┌───────┴────────┐
                       │ etcd 3-node    │  raft consensus
                       │ etcd-{1,2,3}   │
                       └────────────────┘

WAL archive → S3 (env: WAL_S3_BUCKET / WAL_S3_PREFIX, KMS via WAL_ENCRYPTION_KEY)
```

## Targets

- **RTO:** ≤30s automatic failover (Patroni TTL=30s, loop_wait=10s).
- **RPO:** ≤5s with synchronous_commit=on + at least one synchronous standby.
- **Read scale-out:** HAProxy publishes `:5433` to round-robin read-only replicas.

## Files

| File | Purpose |
|---|---|
| `patroni.yml.tpl` | Patroni node config (rendered per-node via env vars in compose) |
| `haproxy.cfg` | HAProxy front-end: primary on 5432, replicas on 5433 |
| `etcd-bootstrap.env` | etcd 3-node cluster bootstrap config (initial cluster state) |
| `pg_hba.conf` | Replication + app auth (mounted into each Patroni node) |
| `entrypoint.sh` | Renders `patroni.yml` from env and execs `patroni` |

## How to deploy

See `docker-compose.ha.yml` at repo root for the opt-in HA stack and
`Docs/RUNBOOK.md § High Availability Setup` for the failover playbook.

## Image pins

| Component | Image | Notes |
|---|---|---|
| Patroni | `ghcr.io/zalando/spilo-16:3.2-p2` | Bundles Patroni 3.2 + Postgres 16 + wal-g |
| etcd | `quay.io/coreos/etcd:v3.5.12` | DCS for Patroni leader election |
| HAProxy | `haproxy:2.9-alpine` | Routes writes to current primary |

## What ops still needs to do

1. Provision an S3 bucket with object-lock + KMS for WAL archive (env: `WAL_S3_BUCKET`).
2. Generate `PATRONI_REPLICATION_PASSWORD` and `PATRONI_SUPERUSER_PASSWORD` (≥32 bytes each).
3. Decide on synchronous vs asynchronous replication (default here: synchronous_mode=on, one sync standby).
4. Validate failover manually before cutover: `docker compose -f docker-compose.ha.yml stop postgres-primary` and watch `curl :8008/master` on each node.
5. Wire `scripts/backup.sh` to point at `haproxy:5432` (or directly at a replica for offload).
