/**
 * Drizzle-backed transactional outbox repository (RSS-01).
 *
 * Persists domain events to the `event_outbox` table (migration 0305) so
 * the durable publisher's writes survive restarts and a relay/worker can
 * deliver them at-least-once. Implements the `IOutboxRepository` contract
 * declared alongside the publisher.
 *
 * Scope boundary (read carefully):
 *   - The MONEY PATH does NOT go through `addToOutbox`. `LedgerService`
 *     co-commits its `event_outbox` rows INSIDE `postJournalAtomic`'s own
 *     `db.transaction` (the rows are passed in as `NewOutboxRow[]` data,
 *     inserted on the repo's already-bound `txDb`). That is the crash-safe,
 *     same-tx write — see `drizzle-ledger-entry.repository.ts` step 6.
 *   - `addToOutbox` here serves the OTHER services (statement /
 *     disbursement / reconciliation / payment-orchestration) which call
 *     `DurableEventPublisher.publish` directly. Those writes are durable
 *     but written on the top-level client (a separate tx from their
 *     business write) — acceptable, they are not the money-immutability
 *     core (flagged `EXEC-saga` for a follow-up co-commit).
 *   - `getUnpublished` / `markPublished` / `recordFailure` / `cleanup`
 *     are the relay read/ack surface.
 *
 * Notes:
 *   - `event_outbox.sequence_number` is NOT NULL and globally ordered. We
 *     assign it per row as `coalesce(max(sequence_number),0)+offset`
 *     computed INSIDE each INSERT (a correlated subquery in the values
 *     expression), not a separate SELECT-MAX-then-INSERT — so there is no
 *     read-then-write race window. There is no unique constraint on it, so
 *     a rare tie under extreme concurrency just yields equal ordering; the
 *     relay also orders by `sequence_number` then `created_at`.
 *   - `status` defaults to 'pending'; the relay flips it to 'published'
 *     via `markPublished`. `recordFailure` bumps retry tracking.
 *   - `tenant_id` may be null (platform-level events are not tenant
 *     scoped); the column is nullable in the schema.
 *   - `onConflictDoNothing()` (on the `id` primary key) makes a re-emit of
 *     the same `message_id` a no-op — a defensive backstop against a
 *     publisher retry double-writing the same row.
 */
import { and, eq, isNull, lt, sql, type SQL } from 'drizzle-orm';
import {
  eventOutbox,
  type DatabaseClient,
  type EventOutboxRecord,
} from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import type {
  IOutboxRepository,
  OutboxEntry,
} from '../events/event-publisher';

function rowToEntry(row: EventOutboxRecord): OutboxEntry {
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload:
      typeof row.payload === 'string'
        ? row.payload
        : JSON.stringify(row.payload),
    tenantId: (row.tenantId ?? '') as TenantId,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt ?? undefined,
    retryCount: row.retryCount,
    lastError: row.lastError ?? undefined,
  };
}

export class DrizzleOutboxRepository implements IOutboxRepository {
  constructor(private readonly db: DatabaseClient) {}

  async addToOutbox(entries: OutboxEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const values = entries.map((e, idx) => {
      const payloadJson = (() => {
        try {
          return JSON.parse(e.payload) as unknown;
        } catch {
          // Defensive: store the raw string under a wrapper if it is not
          // valid JSON (should never happen — the publisher serialises it).
          return { raw: e.payload };
        }
      })();
      return {
        id: e.id,
        tenantId: e.tenantId ? String(e.tenantId) : null,
        eventType: e.eventType,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload: payloadJson,
        // Assign the sequence number INSIDE the INSERT via a correlated
        // subquery (no SELECT-MAX-then-INSERT race). Each row in the batch
        // gets a distinct, increasing value (+1, +2, …). Drizzle accepts a
        // `SQL` expression for a column even though the inferred-insert
        // type narrows `sequenceNumber` to `number`, so we widen that one
        // field to `SQL<number>` here.
        sequenceNumber: sql<number>`(SELECT COALESCE(MAX(${eventOutbox.sequenceNumber}), 0) FROM ${eventOutbox}) + ${idx + 1}`,
        retryCount: e.retryCount,
        lastError: e.lastError ?? null,
        createdAt: e.createdAt,
      } satisfies Omit<typeof eventOutbox.$inferInsert, 'sequenceNumber'> & {
        sequenceNumber: SQL<number>;
      };
    });

    await this.db.insert(eventOutbox).values(values).onConflictDoNothing();
  }

  async getUnpublished(limit: number): Promise<OutboxEntry[]> {
    const rows = await this.db
      .select()
      .from(eventOutbox)
      .where(isNull(eventOutbox.publishedAt))
      .orderBy(eventOutbox.sequenceNumber)
      .limit(Math.max(1, Math.min(1000, Math.floor(limit))));
    return rows.map(rowToEntry);
  }

  async markPublished(id: string): Promise<void> {
    await this.db
      .update(eventOutbox)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(eventOutbox.id, id));
  }

  async recordFailure(id: string, error: string): Promise<void> {
    await this.db
      .update(eventOutbox)
      .set({
        status: 'failed',
        lastError: error,
        retryCount: sql`${eventOutbox.retryCount} + 1`,
      })
      .where(eq(eventOutbox.id, id));
  }

  async cleanup(olderThan: Date): Promise<number> {
    const deleted = await this.db
      .delete(eventOutbox)
      .where(
        and(
          eq(eventOutbox.status, 'published'),
          lt(eventOutbox.createdAt, olderThan),
        ),
      )
      .returning({ id: eventOutbox.id });
    return deleted.length;
  }
}
