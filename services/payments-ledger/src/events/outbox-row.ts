/**
 * Outbox row — the minimal, already-serialised shape the durable producer
 * hands into `postJournalAtomic` for co-commit (RSS-01).
 *
 * The Borjie ledger lets the REPOSITORY own the `db.transaction`
 * (`DrizzleLedgerRepository.postJournalAtomic`), not the service. To
 * co-commit the `event_outbox` rows in that SAME transaction WITHOUT
 * coupling `events/` to `@borjie/database`'s concrete Drizzle `tx`
 * internals, the service serialises its domain events into this plain,
 * tx-agnostic shape BEFORE the atomic post and passes them in as data.
 * The repository inserts them on its already-open `txDb`.
 *
 * Field parity with `event_outbox` (migration 0305 /
 * `outbox.schema.ts`): `id` is the stable consumer-idempotency
 * `message_id`; `payload` is the deserialised event object (jsonb);
 * `metadata` carries `journalId` for the money path so a relay/consumer
 * can correlate, and for producer-side dedup intent.
 */
export interface NewOutboxRow {
  /** Stable message_id (UUID) for consumer idempotency. */
  readonly id: string;
  /** Nullable — platform-level events are not tenant scoped. */
  readonly tenantId: string | null;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** The full domain event, deserialised (stored as jsonb). */
  readonly payload: unknown;
  /** Event metadata; money-path rows stamp `journalId`. */
  readonly metadata: Record<string, unknown>;
}
