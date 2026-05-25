# outbox-processor

Long-running supervisor that drains the transactional outbox by calling
`EventBus.processOutbox()` on a fixed cadence.

## Status

**Scaffolded — refuses to start without a shared durable store (audit DA3).**

The default `EventBus` in `@borjie/observability` uses an in-memory
`MemoryOutboxStore`. A separately-deployed processor therefore drains its OWN
in-memory store, not the api-gateway's. Running this container without a
shared `IOutboxStore` is dishonest: it appears to remove the api-gateway
in-process drainer SPOF, but actually drains a private memory store that the
gateway never writes to.

The entrypoint (`src/index.ts`) calls `assertSharedOutboxStoreConfigured` at
boot. If `OUTBOX_STORE_TYPE` is not `redis` or `postgres`, the process exits
with code 1 and logs a single-line actionable error:

```
[outbox-processor] outbox-processor requires a shared durable IOutboxStore.
Set OUTBOX_STORE_TYPE=redis|postgres. Set replicas:0 in compose until a
store is wired. (received: <unset>)
```

Until a `PostgresOutboxStore` or `RedisOutboxStore` lands and is wired via
`getEventBus({ outboxStore })` in BOTH api-gateway and this file, the
production compose ships this container with `replicas: 0`. The in-process
drainer inside `api-gateway` remains the canonical path. See
`Docs/DEPLOYMENT.md` § "Background Workers & Event Buses".

## Activation checklist

1. Implement `PostgresOutboxStore` (or Redis-backed) satisfying `IOutboxStore`
   (interface in `packages/observability/src/event-bus.ts`).
2. Wire it via `getEventBus({ outboxStore })` in BOTH api-gateway and
   `services/outbox-processor/src/index.ts`.
3. Set `OUTBOX_STORE_TYPE=postgres` (or `redis`) in `.env.production`.
4. Flip `replicas: 0` -> `replicas: 1` in `docker-compose.production.yml`.
5. Remove or gate the in-process drainer (`startOutboxWorker()` in
   api-gateway) so events aren't drained twice.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OUTBOX_STORE_TYPE` | unset (boot fails) | `redis` or `postgres`. Boot guard for DA3. |
| `OUTBOX_PROCESSOR_INTERVAL_MS` | `5000` | How often to call `processOutbox()`. |
| `OUTBOX_PROCESSOR_BATCH_SIZE` | `50` | Max events per drain call. |

## Build + run

```bash
pnpm --filter @borjie/outbox-processor build
OUTBOX_STORE_TYPE=postgres node services/outbox-processor/dist/index.js
```

## Container

`docker/Dockerfile.outbox-processor` reuses the same multi-stage layout as
`services/consolidation-worker/Dockerfile`.
