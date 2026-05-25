# @borjie/consolidation-worker

Closes LITFIN parity gap A from `.planning/parity-litfin/02-memory-learning.md`:
the consolidation cycle now has a production scheduler.

## What it does

A long-running worker that, on each tick:

1. Pulls `kernel_cot_reservoir` rows from the last 24h with
   `consolidated_at IS NULL`.
2. Groups them by `(tenant_id, user_id)`.
3. Calls an injected `ConsolidatorPort` to derive consolidated facts
   from each group. The default stub emits one fact per 5 turns with
   key `recent-topic`. Production swaps in the Haiku-backed
   `runConsolidationCycle` consolidator from
   `@borjie/central-intelligence`.
4. Writes each fact via `createSemanticMemoryService.upsertFact` with
   `source: 'consolidated'`.
5. Marks the consumed reservoir rows with `consolidated_at = NOW()`.

Hard DB failures degrade to a no-op for that tick. The worker is never
allowed to crash on a tick error — the next tick retries.

## Run

```
DATABASE_URL=postgres://...                       \
CONSOLIDATION_INTERVAL_MS=3600000                  \
  pnpm -C services/consolidation-worker dev
```

`SIGTERM` / `SIGINT` cleanly stops the loop and exits with code 0.

## Test

```
pnpm -C services/consolidation-worker test
```
