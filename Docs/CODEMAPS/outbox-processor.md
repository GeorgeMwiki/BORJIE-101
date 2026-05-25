# Outbox Processor Codemap

**Last Updated:** 2026-05-22
**Module:** `services/outbox-processor/`
**Public entry:** `services/outbox-processor/src/index.ts`
**Tier scope:** platform spine (event-bus drainer)

## Purpose

The standalone supervisor that periodically calls
`EventBus.processOutbox()` so domain events written transactionally
to the outbox table get published even if the api-gateway's
in-process drainer is degraded. Refuses to start unless wired to a
shared, durable store (`OUTBOX_STORE_TYPE=redis|postgres`) — the
audit DA3 fix prevents the "drainer of its own in-memory store"
honesty bug from recurring.

## Entry points

- `src/index.ts` — entrypoint + supervisor loop.
- `src/__tests__/` — tests around store wiring + cadence.

## Internal structure

- `index.ts` — boot, env validation (exits 1 if
  `OUTBOX_STORE_TYPE` ∉ {redis, postgres}), supervisor loop.
- Reuses `@borjie/observability` `EventBus` + outbox store.

## Dependencies

- Upstream: `@borjie/observability` (`EventBus`, store interfaces),
  `@borjie/config` (`loadEnv`).
- Downstream: subscribers reachable through the event bus
  (analytics, graph-sync, notifications triggers).

## Common workflows

- **Boot** → reads `OUTBOX_STORE_TYPE`; fatal if unset/memory.
- **Drain** → fixed-interval call to `eventBus.processOutbox()`.
- **Crash-loop honesty** → on misconfig the operator gets an
  actionable error.

## Anti-patterns to avoid

- Never set `OUTBOX_STORE_TYPE=memory` in production — fatal exit.
- Never run two replicas without distributed-lock coordination.
- Never bypass the env check.
- Never silently swallow drain errors — surface to ops.

## Related codemaps

- [observability.md](./observability.md) — EventBus + outbox
- [api-gateway.md](./api-gateway.md) — in-process drainer sibling
- [database.md](./database.md) — outbox table
