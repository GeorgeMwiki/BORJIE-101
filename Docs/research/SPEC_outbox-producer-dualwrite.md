# Design Spec — Durable Outbox Producer (single-tx dual-write on the money path)

**Lane:** `outbox-producer-dualwrite` (money-path durability)
**Gap IDs:** `RSS-01` (BLOCKER, [CONFIRMED]) — primary; companion-flagged `RSS-02` (drainer leader election) and `EXEC-saga`.
**Branch:** `integration/parity-final`
**Date:** 2026-06-08
**Author:** lane spec pass (file-level, grounded against the actual repo + the BossNyumba reference port).
**Status:** SPEC ONLY — no code written, no migration applied, no commit.

---

## 0. One-line problem

`LedgerService` posts the immutable double-entry ledger durably (single `db.transaction` inside `DrizzleLedgerRepository.postJournalAtomic`), but it then publishes its domain events through `InMemoryEventPublisher` — a per-process JS array — **after** the transaction has already committed. Two distinct losses follow:

1. **In-memory loss:** events live only in `outbox: OutboxEntry[]` (`event-publisher.ts:94`). A crash, restart, or rollout drops every un-relayed event. The `IOutboxRepository` Drizzle impl that would persist them **does not exist** (interface declared at `event-publisher.ts:62-87`, zero implementers).
2. **Post-commit window loss (the deeper bug):** even with a durable publisher, the two `this.eventPublisher.publish(...)` calls fire at `ledger.service.ts:546` and `:565`, which is **after** `postJournalAtomic` returned at `:495`. A crash in that window leaves the ledger durable but no event ever emitted — the exact failure the outbox pattern exists to kill ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)).

The fix: write the `event_outbox` rows **inside the same `db.transaction` as the ledger entries + balance CAS**, so delivery is at-least-once and crash-safe, and the table the durable rows land in is the one a relay drains.

---

## 1. What already exists (verified, do not rebuild)

| Artefact | Location | State |
|---|---|---|
| `event_outbox` table (DDL) | `packages/database/src/migrations/0305_create_missing_schema_tables.sql:975-1011` | EXISTS. `id TEXT PK`, `tenant_id` (nullable), `event_type`, `aggregate_type`, `aggregate_id`, `payload jsonb`, `metadata jsonb`, `sequence_number int NOT NULL`, `status outbox_status DEFAULT 'pending'`, `priority`, `retry_count`, `max_retries`, `last_error`, `next_retry_at`, `created_at`, `published_at`, lock cols. |
| `event_outbox` RLS | `0305:3694-3704` | RLS **ENABLE + FORCE**, policy `event_outbox_tenant_isolation FOR ALL`, `anon` revoked. Tenant predicate already enforced. |
| Drizzle schema | `packages/database/src/schemas/outbox.schema.ts:39-105` | `eventOutbox` pgTable + `EventOutboxRecord`/`NewEventOutboxRecord` types. Re-exported by `@borjie/database` barrel (`schemas/index.ts:102` → `src/index.ts:21`). |
| Producer interface | `services/payments-ledger/src/events/event-publisher.ts:34-87` | `IEventPublisher` + `IOutboxRepository` (`addToOutbox`/`getUnpublished`/`markPublished`/`recordFailure`/`cleanup`) — **declared, never implemented**. |
| Producer impl in use | `event-publisher.ts:92-158` (`InMemoryEventPublisher`) — wired at `server.ts:316`. | THE GAP. |
| The single ledger tx | `services/payments-ledger/src/repositories/drizzle-ledger-entry.repository.ts:320-502` (`postJournalAtomic`) | EXISTS. Owns `db.transaction`, binds RLS GUC `app.current_tenant_id` + legacy `app.tenant_id` transaction-locally (`:360-365`), does idempotency pre-check + balance CAS + hash-chain + insert + idempotency-row, all atomic. **This is where the outbox write must join.** |
| Existing durable-store pattern to mirror | `services/payments-ledger/src/providers/webhook-dedupe-store.ts` (`DbWebhookDedupeStore`) | The canonical in-package pattern: module-internal `pgTable`, tx-local GUC bind, `isUniqueViolation` (23505), fail-loud-in-prod factory. |
| Reference port (BN) | `Cursor Projects/BOSSNYUMBA101/services/payments-ledger/src/{events/event-publisher.ts,events/event-publisher-factory.ts,repositories/drizzle-outbox.repository.ts,__tests__/outbox-cocommit.test.ts}` | A working `DurableEventPublisher` + `DrizzleOutboxRepository` + factory + co-commit test. **Architecture differs** — see §3. |

### 1.1 Consumer side — scope boundary (read carefully)

The prompt states "the existing poller drains it." That is only **half**-true today and the spec must be honest about it:

- `services/outbox-processor/src/index.ts` (the standalone poller) and the api-gateway in-process drainer (`services/api-gateway/src/index.ts:3385-3392` → `workers/outbox-worker.ts`) both call `EventBus.processOutbox()` from `@borjie/observability` (`packages/observability/src/event-bus.ts:250-289`).
- That `EventBus` drains its **own `IOutboxStore`**, which defaults to `MemoryOutboxStore` (`event-bus.ts:66-157, 171`). **Nothing drains the Postgres `event_outbox` table.** The `outbox-processor` even refuses to start unless `OUTBOX_STORE_TYPE=redis|postgres` (`index.ts:104-115`) — and no `PostgresOutboxStore` exists.

**Therefore:** this lane (the *producer*) makes the money-path events durable and crash-safe — they will be in `event_outbox` with `status='pending'` and survive any crash. But a **relay that drains `event_outbox` → subscribers** is a required companion to actually *deliver* them. This spec ships the producer **and a thin Postgres-backed relay** (`DrizzleOutboxRepository.getUnpublished`/`markPublished` already give us the read/ack surface) wired into the existing `outbox-worker.ts` runner shape, so the table does not silently fill forever. If the orchestrator prefers to keep the relay in a separate lane, the producer alone still satisfies RSS-01's *durability* guarantee (no loss on crash); only *delivery latency* depends on the relay. The spec scopes both but marks the relay section **[COMPANION]** so it can be split.

---

## 2. SOTA grounding (2026)

- **Same-transaction write is the whole point.** Business state change and the outbox row MUST commit in one local ACID transaction; a separate connection re-introduces the dual-write race ([milanjovanovic.tech](https://www.milanjovanovic.tech/blog/implementing-the-outbox-pattern), [singhajit.com](https://singhajit.com/transactional-outbox-pattern/)).
- **At-least-once, never exactly-once at the broker.** The mature stance is at-least-once delivery + idempotent consumers; do not chase exactly-once ([medium/nustianrwp](https://medium.com/@nustianrwp/the-transactional-outbox-pattern-a-rigorous-examination-for-distributed-systems-engineers-9c189836f470)).
- **Each row carries a stable `message_id` (UUID) for consumer idempotency, an `aggregate_id` for ordering/partitioning, and an index on `(status, created_at)`** ([digitalapplied.com](https://www.digitalapplied.com/blog/background-job-queue-patterns-2026-engineering-reference)). Borjie's `event_outbox` already has `id` (UUID), `aggregate_id`, and `event_outbox_status_created_idx` (`0305:1004`). ✔
- **Producer-side idempotency:** a `LedgerService` post is itself idempotent (durability defect #2, `journal_idempotency`). When a retried post replays as `idempotentReplay`, it must **not** emit a second set of outbox rows for the same journal — otherwise the relay double-delivers. We close this with a producer-side natural dedup key (see §4.3) so re-emitting the same `(journalId, eventType, aggregateId)` is a no-op (`ON CONFLICT DO NOTHING`).
- **Cleanup/archival of published rows** to bound table growth ([james-carr.org](https://james-carr.org/posts/2026-01-15-transactional-outbox-pattern/)). Covered by `cleanup(olderThan)`.

---

## 3. The Borjie-specific design decision (where the tx boundary lives)

This is the single most important difference from the BN port and the crux of the spec.

**BN architecture:** the *service* (`LedgerService`) owns a `transactionRunner.transaction(tx => …)`, threads `tx` into both `ledgerRepository.createEntries(entries, tx)` **and** `eventPublisher.enqueueToOutbox(events, tx)`. The repo methods take an optional `tx`.

**Borjie architecture (today):** the *repository* owns the transaction. `DrizzleLedgerRepository.postJournalAtomic` opens `db.transaction(async tx => …)` internally (`drizzle-ledger-entry.repository.ts:341`); the service never sees a `tx` handle. `createEntries` does **not** take a `tx` (`ledger.repository.ts:108`). Inverting this to the BN shape would mean moving the transaction boundary up into the service and rewriting `postJournalAtomic` — a large, risky change to the money-math core. **We will NOT do that** (hard rail: do not change the money math).

**Chosen design — co-commit the outbox INSIDE `postJournalAtomic`, by passing the events into the atomic post as data, not by threading a tx out.**

Concretely: extend the `AtomicJournalPost` input with an optional **already-serialised** `outboxRows: NewOutboxRow[]` payload. `postJournalAtomic` inserts those rows on its existing `txDb` as **step 6**, in the same transaction, after the entries and the idempotency row. The service builds the events (it already does, at `ledger.service.ts:546-583`) **before** the atomic call and hands them in; it no longer publishes them after commit. The repo, which already binds the RLS GUC for `accounts`/`ledger_entries`/`journal_idempotency`, writes `event_outbox` under the same bound `app.current_tenant_id` — RLS is satisfied for free, with zero new GUC plumbing.

This keeps the money math byte-for-byte unchanged (the balance CAS, hash-chain, sequence logic are untouched) and adds exactly one INSERT to the existing tx. The InMemory repo gets the symmetric treatment so dev/test exercises the same code path.

Why not a callback `enqueue(tx)` threaded through `postJournalAtomic`? Because the publisher would then need the concrete Drizzle `tx` type, coupling `payments-ledger/events` to `@borjie/database`'s tx internals (the repo already deliberately duck-types `tx` as `unknown`, `:338-341`). Passing pre-serialised rows keeps the publisher tx-agnostic and the repo the sole owner of the tx — matching the existing Borjie layering.

### 3.1 Sequencing & event ordering

`event_outbox.sequence_number` is `NOT NULL` and has no unique constraint. Mirror BN's race-free assignment: compute it **inside the INSERT** as `(SELECT COALESCE(MAX(sequence_number),0) FROM event_outbox) + rownum` (BN `drizzle-outbox.repository.ts:89`). For the money path the relay also orders by `created_at` (`event_outbox_status_created_idx`), so a rare MAX tie is benign. **Do not** add a separate SELECT-MAX-then-INSERT (read-then-write race).

---

## 4. Files to change (exact)

### 4.1 `services/payments-ledger/src/events/event-publisher.ts` — add the durable producer

- **Keep** `IEventPublisher`, `IOutboxRepository`, `OutboxEntry`, `InMemoryEventPublisher`, `createEvent` (no signature break).
- **Add** a pure helper `toOutboxEntry(event: PaymentDomainEvent): OutboxEntry` (port BN `event-publisher.ts:295-306`): `{ id: uuidv4(), aggregateType, aggregateId, eventType, payload: JSON.stringify(event), tenantId, createdAt: new Date(), retryCount: 0 }`. The `id` is the stable consumer-idempotency `message_id`.
- **Add** `class DurableEventPublisher implements IEventPublisher` (port BN `:223-289`), constructor `(private readonly outbox: IOutboxRepository)`. `publish`/`publishBatch` call `outbox.addToOutbox([...])` then `notifyHandlers` (in-process subscribers still fire; a throwing handler is isolated — the durable row is the delivery source of truth).
- **Add to `IEventPublisher`** an OPTIONAL `serializeForTx?(events: PaymentDomainEvent[]): NewOutboxRow[]` and OPTIONAL `notifySubscribers?(events: PaymentDomainEvent[]): Promise<void>`. Rationale: the Borjie co-commit is "serialise rows → hand to `postJournalAtomic` → notify after commit", not "enqueue on a tx". `DurableEventPublisher.serializeForTx` returns `events.map(e => toNewOutboxRow(toOutboxEntry(e)))`; `InMemoryEventPublisher.serializeForTx` returns the same shape and `InMemoryEventPublisher` keeps a `commitRows(rows)` test hook that pushes to its array (so dev/test mirrors prod). Optional so no existing consumer of `IEventPublisher` (statement/disbursement/reconciliation/payment-orchestration services) breaks.
- File stays < 800 lines (currently 189 + ~120 ported ≈ 310). No `console` (uses the existing `logger`).

### 4.2 `services/payments-ledger/src/repositories/drizzle-outbox.repository.ts` — NEW (port BN, retarget table)

- `class DrizzleOutboxRepository implements IOutboxRepository`, constructor `(private readonly db: DatabaseClient)`.
- Import `{ eventOutbox, type EventOutboxRecord }` from `@borjie/database` (confirmed exported). Do **not** redeclare the table locally — unlike `ledger_entries`/`journal_idempotency` (which were archived from the canonical schema), `event_outbox` IS canonical in `@borjie/database`, so import it.
- `addToOutbox(entries: OutboxEntry[], tx?: unknown)`: when `tx` present, use it as the writer; else `this.db`. Map each entry → `NewEventOutboxRecord` with `payload = JSON.parse(e.payload)` (defensive `{ raw }` fallback), `sequenceNumber = sql\`(SELECT COALESCE(MAX(${eventOutbox.sequenceNumber}),0) FROM ${eventOutbox}) + ${idx+1}\``, `status` defaulting to `'pending'`, `tenantId: e.tenantId ? String(e.tenantId) : null`. Port BN `:57-99`. **Add** `.onConflictDoNothing({ target: outboxDedupeKey })` once the producer dedup index lands (§4.3) so a replayed post is a no-op.
- `getUnpublished(limit)`: `SELECT … WHERE published_at IS NULL ORDER BY sequence_number LIMIT clamp(1,1000,limit)`. (Relay read surface.)
- `markPublished(id)` / `recordFailure(id,error)` / `cleanup(olderThan)`: port BN `:111-140` verbatim.
- Tenant note: `getUnpublished`/`markPublished` run on the top-level pool for the relay (cross-tenant drain). They must run under a **BYPASSRLS service role OR a relay that binds the GUC per row's tenant**. Because `event_outbox` is FORCE-RLS, a plain app-role `SELECT … WHERE published_at IS NULL` returns **only the current GUC tenant's rows** (or nothing if unset). The relay (§5) therefore drains **per tenant** by binding `app.current_tenant_id` in a tx, OR runs under the migration/relay service role with `BYPASSRLS`. Spec mandates the **per-tenant tx-bound** drain for the in-process relay (no new privileged role); see §5. The *producer* path needs none of this — it writes inside `postJournalAtomic`'s already-bound tx.

### 4.3 `packages/database/src/migrations/0313_event_outbox_producer_dedup.sql` — NEW (append-only; next number is 0313, current max is 0312)

The single schema change. `event_outbox` has **no** producer-idempotency guard today — a retried/replayed journal post could emit duplicate rows. Add a partial unique index that makes re-emit a no-op:

```sql
-- Migration 0313 — event_outbox producer-side idempotency (RSS-01).
-- WHY: the durable producer co-commits outbox rows inside the ledger tx.
-- A LedgerService idempotent-replay (durability defect #2) re-runs the
-- post and would re-enqueue the SAME journal's events. A partial UNIQUE
-- on the natural producer key lets addToOutbox use ON CONFLICT DO NOTHING
-- so exactly one row per (tenant, aggregate, event_type, aggregate_id,
-- journal) survives. Append-only; never edits a shipped file.
-- Money-path rows set metadata->>'journalId'; the index keys on it so
-- non-ledger producers (nullable journalId) are unaffected (partial WHERE).
CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_producer_dedupe_uniq
  ON event_outbox (
    COALESCE(tenant_id, ''),
    aggregate_type,
    aggregate_id,
    event_type,
    (metadata->>'journalId')
  )
  WHERE metadata->>'journalId' IS NOT NULL;
```

- **RLS:** no change to RLS — `event_outbox` already has ENABLE + FORCE + `event_outbox_tenant_isolation` (0305:3694-3704). The migration only adds an index. (The CLAUDE.md "RLS+FORCE on every tenant-scoped table" rail is already satisfied for this table; we do not weaken it.)
- **Canonical GUC:** unchanged — `app.current_tenant_id` remains the binding the producer tx already sets.
- **Backfill hazard:** none. `CREATE UNIQUE INDEX … IF NOT EXISTS` on a table that is empty/low-volume at ship time; if non-empty, the index build is `O(n log n)` but the dedupe key is unique by construction for existing rows (each prior journal emitted at most one set). Use `CREATE UNIQUE INDEX CONCURRENTLY` in a follow-up if the live table is already large — but the migration runner applies in a transaction, so ship the plain form and gate behind the migration-safety CI; if the live `event_outbox` is non-trivial, split the `CONCURRENTLY` build into a separate non-transactional migration step. (Live table is currently empty — no producer writes it yet — so plain form is safe.)
- **Drizzle schema parity:** add the matching index to `outbox.schema.ts` `eventOutbox` table builder so `drizzle-kit` does not detect drift, AND so `.onConflictDoNothing({ target: … })` has a typed target. Mirror the SQL exactly.

### 4.4 `services/payments-ledger/src/events/event-publisher-factory.ts` — NEW (port BN)

`createEventPublisher({ db, isProduction, logger })` (port BN `event-publisher-factory.ts` verbatim, retarget imports to `@borjie/*`):
1. `db` present → `new DurableEventPublisher(new DrizzleOutboxRepository(db))`.
2. else `isProduction` → **throw** (in-memory publisher in prod = the P0 we are fixing; refuse to start — matches `factory.ts:104-116` fail-loud discipline).
3. else (dev/test) → `new InMemoryEventPublisher()`.

### 4.5 `services/payments-ledger/src/repositories/ledger.repository.ts` — extend the atomic contract

- Add to `AtomicJournalPost` (`:73-85`): `readonly outboxRows?: ReadonlyArray<NewOutboxRow>;` where `NewOutboxRow` is the minimal serialisable shape `{ id; tenantId; eventType; aggregateType; aggregateId; payload: unknown; metadata: Record<string,unknown> }` (declared in this file or a tiny `outbox-row.ts`). Optional → no break to existing callers/tests.
- `InMemoryLedgerRepository.postJournalAtomic` (`:305-420`): after the entry inserts + idempotency persist (step 4, `:399`), if `post.outboxRows?.length`, push them onto a new `this.committedOutboxRows: NewOutboxRow[]` **inside the same snapshot/rollback guard** (so a `faultBetweenBalanceAndEntries` or sequence collision rolls the outbox rows back too — proving co-commit in-memory). Add `getCommittedOutboxRows()` test hook + include `committedOutboxRows` in the snapshot/restore set (`:331-333`, `:411-413`).

### 4.6 `services/payments-ledger/src/repositories/drizzle-ledger-entry.repository.ts` — co-commit step

Inside `postJournalAtomic`'s `db.transaction` callback, **after step 5 (idempotency row insert, `:455-461`)**, add **step 6**:

```ts
// 6 — co-commit the producer's domain events to event_outbox in the SAME
// tx (RSS-01). RLS GUC app.current_tenant_id is already bound (step C1),
// so these rows land under the tenant predicate with no extra plumbing.
// Sequence number assigned race-free inside the INSERT. ON CONFLICT DO
// NOTHING makes an idempotent-replay re-emit a no-op.
if (post.outboxRows && post.outboxRows.length > 0) {
  await txDb
    .insert(eventOutbox)
    .values(post.outboxRows.map((r, idx) => ({
      id: r.id,
      tenantId: r.tenantId,
      eventType: r.eventType,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      payload: r.payload,
      metadata: r.metadata,
      sequenceNumber: sql<number>`(SELECT COALESCE(MAX(${eventOutbox.sequenceNumber}),0) FROM ${eventOutbox}) + ${idx + 1}`,
    })))
    .onConflictDoNothing();
}
```

- Import `eventOutbox` from `@borjie/database`. Money math (`:387-452`) is **untouched** — this is purely additive and after all financial writes, but still inside the atomic boundary, so it commits/rolls back with them.
- Failure mode: an outbox INSERT error rolls the WHOLE tx back → the post surfaces as a hard error (not `stale`) → the existing CAS retry loop in the service does **not** swallow it (it only retries `StaleAccountVersionError`). This is correct: if we cannot durably record the event, we must not silently commit the money. (Operators get a loud Pino error; the post is retried by the upstream caller's idempotency key, not double-posted.)

### 4.7 `services/payments-ledger/src/services/ledger.service.ts` — build rows before the post, drop post-commit publish

- In `postJournalEntryAttempt`, **before** the `postJournalAtomic` call (`:495`), build the two event objects it currently builds at `:546-583` (the `ACCOUNT_BALANCE_UPDATED` per touched account + the one `LEDGER_ENTRIES_CREATED`). Stamp each event's `metadata.journalId = journalId` so the dedupe index (§4.3) keys correctly.
- Convert them to `NewOutboxRow[]` via `this.eventPublisher.serializeForTx?.(events) ?? []` and pass as `outboxRows` in the `omitUndefined({ … })` atomic-post arg (`:496-502`).
- **Remove** the two post-commit `await this.eventPublisher.publish(...)` calls (`:546-561`, `:565-583`). **Replace** with a single post-commit `await this.eventPublisher.notifySubscribers?.(events)` (in-process subscribers still fire, AFTER the tx committed — a rolled-back post notifies nobody).
- **Idempotent-replay path** (`loadExistingJournalResult`, `:273-342`): emits **no** outbox rows (the original post already enqueued them; the dedupe index is the backstop if a row is somehow rebuilt). Leave it publish-free — this is the correct behaviour (no double-enqueue on replay).
- `LedgerServiceDeps.eventPublisher` stays `IEventPublisher`; the new methods are optional, so the in-memory test path and all other services are source-compatible. The money math in this file (balance fold, CAS build, currency checks) is **unchanged**.

### 4.8 `services/payments-ledger/src/server.ts` — swap the wiring

- Line 316: replace `const eventPublisher = new InMemoryEventPublisher();` with
  `const eventPublisher = createEventPublisher({ db: repos.db, isProduction: process.env.NODE_ENV === 'production', logger: { warn: (o,m)=>logger.warn(o,m), info: (o,m)=>logger.info(o,m) } });`
- `repos.db` is the SAME shared Drizzle client the repositories use (`factory.ts:68, 183`) — so the outbox write co-commits on the same pool/connection family as the ledger write. No second client.
- Import `createEventPublisher` from `./events/event-publisher-factory`; drop the now-unused `InMemoryEventPublisher` import if no longer referenced (the factory imports it). All five services (`paymentOrchestration`, `ledger`, `reconciliation`, `statementGeneration`, `disbursement`) keep receiving `eventPublisher` — they now share the durable one for free (their `publish` calls persist to `event_outbox` too; only `LedgerService` gets the co-commit path, the others keep post-op `publish` which is still durable, just not co-committed — acceptable, they are not the money-immutability core; flag `EXEC-saga` for their co-commit).

### 4.9 [COMPANION] `services/payments-ledger/src/workers/outbox-relay.ts` — NEW (drain `event_outbox`)

A thin Postgres relay so the durable rows actually deliver (closes the §1.1 gap). Mirrors `outbox-worker.ts` lifecycle but drains `DrizzleOutboxRepository`:
- `startOutboxRelay(outboxRepo, publisher, { db, logger, intervalMs=5000, batchSize=50, enabled })`. Each tick: enumerate distinct `tenant_id`s with `published_at IS NULL` (one `SELECT DISTINCT` under a relay tx that binds each tenant's GUC, OR a service-role read), then for each pending row: `publisher.notifySubscribers([deserialize(row.payload)])`; on success `markPublished(row.id)`; on throw `recordFailure(row.id, err)`. At-least-once: a crash between `notify` and `markPublished` re-delivers — consumers MUST be idempotent (they are: webhook dedupe + `journal_idempotency` + the per-row `message_id`).
- Leader election: wrap the tick in the cluster advisory lock (`RSS-06`/`RSS-02`) so only one replica drains. If `withClusterLock` is not yet available, gate behind `OUTBOX_RELAY_ENABLED` single-replica for now and flag `RSS-02`.
- Wire in `server.ts` after the publisher, `enabled: NODE_ENV !== 'test' && OUTBOX_RELAY_DISABLED !== 'true' && repos.db != null`.

> If the orchestrator splits the relay into its own lane, ship §4.1–4.8 alone: the producer is durable and crash-safe; only delivery latency waits on the relay.

---

## 5. RLS / tenancy invariants (hard rail)

- **Producer:** writes `event_outbox` inside `postJournalAtomic`'s tx, where `app.current_tenant_id` is already bound transaction-locally (`drizzle-ledger-entry.repository.ts:360-365`). FORCE-RLS `event_outbox_tenant_isolation` is satisfied; no new GUC code. RLS is never weakened or double-filtered.
- **Relay reads** are cross-tenant. The in-process relay binds `app.current_tenant_id` per tenant inside its own tx (mirroring `DbWebhookDedupeStore.claim`/`exists` `:171-176, :216-221`) and drains tenant-by-tenant — no privileged role, no RLS bypass. (Alternative: a dedicated `BYPASSRLS` relay role; **not** chosen to avoid widening the privilege surface.)
- Canonical GUC is `app.current_tenant_id` (legacy `app.tenant_id` mirrored as the repo already does). Never disable RLS.

---

## 6. Test plan (the no-loss-on-crash proof is mandatory)

New file `services/payments-ledger/src/__tests__/outbox-cocommit.test.ts` (port + adapt BN's `outbox-cocommit.test.ts` to Borjie's repo-owns-tx shape):

1. **Co-commit (in-memory):** `DurableEventPublisher` over a fake `IOutboxRepository`; `InMemoryLedgerRepository` with `outboxRows` plumbed. Post a balanced journal → assert `getCommittedOutboxRows()` contains `LEDGER_ENTRIES_CREATED` + 2× `ACCOUNT_BALANCE_UPDATED`, each with `metadata.journalId` set.
2. **No-loss / no-leak on crash (THE proof):** reuse the existing `setFaultBetweenBalanceAndEntries` hook (`ledger.repository.ts:286-289`). Inject a fault → `postJournalEntry` rejects → assert **zero** committed outbox rows AND zero ledger entries AND balance unchanged (the rows were staged in the same snapshot and rolled back). This proves outbox and money roll back together — the exact RSS-01 failure.
3. **Idempotent-replay emits no duplicate:** post with `idempotencyKey` k; assert N outbox rows. Replay same k → `idempotentReplay=true`, assert outbox row count **unchanged** (no second enqueue; dedupe index is the prod backstop).
4. **Post-commit notify still fires:** subscribe a handler; successful post → handler saw `LEDGER_ENTRIES_CREATED`. A rolled-back post → handler saw nothing.
5. **Money math regression:** run the FULL existing `ledger-durability.test.ts` (627 lines, all H1/H2/H3 + defect #1/#2/#3 cases) unchanged → must stay green, proving the dual-write did not perturb balances, hash-chain, sequence, or idempotency.
6. **Drizzle repo unit (DB-backed, gated):** under a real Postgres (the `migration-apply` CI image), `addToOutbox` then `getUnpublished` returns the rows ordered by `sequence_number`; `markPublished` flips `published_at`; a second `addToOutbox` with the same `(tenant, aggregate, event_type, aggregate_id, journalId)` is a no-op (dedupe index). RLS: a read under tenant-B GUC does NOT see tenant-A rows.
7. **Factory:** `createEventPublisher({db:null,isProduction:true})` throws; `{db:null,isProduction:false}` → `InMemoryEventPublisher`; `{db:<client>}` → `DurableEventPublisher`.

Target ≥ 80% on the new/changed lines. No `console`. Vitest config already present (`services/payments-ledger/vitest.config.ts`).

---

## 7. Reversibility & rollout

- **Migration 0313** is index-only and `IF NOT EXISTS` → forward-safe; a manual `DROP INDEX IF EXISTS event_outbox_producer_dedupe_uniq;` fully reverts the schema delta (migrations are append-only — we never edit 0305).
- **Code rollout is feature-flagged by construction:** the durable producer activates only when `repos.db` is present (DATABASE_URL set). With it unset (dev/test) the in-memory path runs the same code shape. To roll back the *producer* without a deploy, the relay can be disabled (`OUTBOX_RELAY_DISABLED=true`) — rows still accrue durably, just undelivered, no data loss.
- **No money-math change** → no balance/hash-chain/sequence risk; the existing 627-line durability suite is the regression net.
- **Forward-only, idempotent emit:** `ON CONFLICT DO NOTHING` + the per-row `message_id` mean a redeploy mid-relay cannot double-enqueue (producer) or, combined with idempotent consumers, double-process (delivery).
- **Order of operations:** (1) ship 0313 + schema parity; (2) ship producer (§4.1–4.8) — events now durable; (3) ship relay (§4.9) — events now delivered. Each step is independently safe; step 2 without step 3 = durable-but-queued (acceptable, monitor `event_outbox` pending lag).

---

## 8. Risks

1. **Relay is a true dependency for delivery** — the producer alone makes events durable but not delivered; if §4.9 is split out, `event_outbox` grows until the relay ships (mitigate: `cleanup` + a pending-lag alert; the table is bounded by relay cadence).
2. **FORCE-RLS on `event_outbox` makes the cross-tenant relay read non-trivial** — per-tenant GUC-bound drain adds a `SELECT DISTINCT tenant_id` per tick; under many tenants this is N tx/tick (mitigate: batch by tenant, or accept a `BYPASSRLS` relay role as a follow-up if lag grows).
3. **`sequence_number` MAX-subquery contention** on a hot global outbox — acceptable for money-path volume; the relay also orders by `created_at`. If contention bites, switch to a per-tenant sequence or a `BIGSERIAL` (separate migration).
4. **Other four services** (`payment-orchestration`, `disbursement`, `reconciliation`, `statement-generation`) get the durable publisher but keep post-op `publish` (not co-committed) — a crash between their DB write and `publish` can still drop THEIR events. Out of scope for the money-immutability core; flagged as `EXEC-saga` follow-up.
5. **Live `event_outbox` non-empty at index build** — if the table already holds rows when 0313 applies, the plain (non-`CONCURRENTLY`) unique build briefly locks it; mitigate by confirming the table is empty (it is — no producer writes it today) or splitting to a `CONCURRENTLY` step.

---

## 9. Hard-rail compliance checklist

- [x] Money path stays through `LedgerService.post` → `postJournalAtomic`; balance/hash-chain/sequence math **unchanged** (additive step 6 only).
- [x] RLS FORCE never weakened; producer writes under the already-bound `app.current_tenant_id`; relay binds GUC per tenant, no bypass role added.
- [x] Append-only migration (0313, next free number; 0305 untouched).
- [x] No `console` in services — Pino `logger` only.
- [x] At-least-once + idempotent consumers (webhook dedupe + `journal_idempotency` + per-row `message_id`); no exactly-once claim.
- [x] No `process.env` reads added outside bootstrap that aren't already the pattern (`server.ts` is the composition root; factory takes `isProduction` as an arg).
- [x] Multi-currency untouched (events carry `Money.toData()` as today; no hard-coded currency).
- [x] Supabase-JWT auth untouched; no Clerk.

**Sources:** [microservices.io — Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html) · [milanjovanovic.tech — Implementing the Outbox Pattern](https://www.milanjovanovic.tech/blog/implementing-the-outbox-pattern) · [singhajit.com — Transactional Outbox Pattern](https://singhajit.com/transactional-outbox-pattern/) · [digitalapplied.com — Background Jobs & Queues 2026 Reference](https://www.digitalapplied.com/blog/background-job-queue-patterns-2026-engineering-reference) · [james-carr.org — Reliable Event Publishing (2026)](https://james-carr.org/posts/2026-01-15-transactional-outbox-pattern/) · [medium/nustianrwp — A Rigorous Examination](https://medium.com/@nustianrwp/the-transactional-outbox-pattern-a-rigorous-examination-for-distributed-systems-engineers-9c189836f470)
