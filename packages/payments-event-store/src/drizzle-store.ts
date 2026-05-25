/**
 * Drizzle-backed EventStore. The adapter expects a minimal client
 * (the same `DBClient` shape as feature-flags-adapter) so consumers
 * can plug in pg, postgres.js, or Drizzle's `.execute`.
 *
 * Schema is established by the migration `payment_event_store.sql`
 * (see packages/database/src/migrations/). The append uses a
 * conditional INSERT with `WHERE NOT EXISTS (... version = expected+1)`
 * via a CTE so the optimistic check is server-side atomic.
 *
 * Subscriptions are intentionally NOT wired to LISTEN/NOTIFY this
 * pass — call-sites that need realtime delivery should use the
 * in-memory store wrapped in a poll loop, or wait for the next
 * iteration that introduces a proper Postgres notification handler.
 */

import type { PaymentEvent } from "./events.js";
import {
  OptimisticConcurrencyError,
  type EventEnvelope,
  type EventHandler,
  type EventStore,
  type SubscriptionFilter,
  type Unsubscribe,
} from "./types.js";

export interface DBClient {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface DrizzleEventStoreOptions {
  readonly db: DBClient;
  /** Override for custom schemas. Default: `payment_event_store`. */
  readonly tableName?: string;
}

interface EventRow {
  readonly stream_id: string;
  readonly version: number;
  readonly global_seq: number;
  readonly event_type: string;
  readonly payload: string | object;
  readonly recorded_at: Date | string;
}

export function createDrizzleEventStore(
  opts: DrizzleEventStoreOptions
): EventStore {
  const table = opts.tableName ?? "payment_event_store";

  async function readMaxVersion(streamId: string): Promise<number> {
    const rows = await opts.db.query<{ max: number | null }>(
      `SELECT COALESCE(MAX(version), 0) AS max FROM ${table} WHERE stream_id = $1`,
      [streamId]
    );
    return rows[0]?.max ?? 0;
  }

  function envelopeFromRow(row: EventRow): EventEnvelope {
    const payload =
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    return {
      streamId: row.stream_id,
      version: row.version,
      globalSeq: row.global_seq,
      event: payload as PaymentEvent,
      recordedAt:
        row.recorded_at instanceof Date
          ? row.recorded_at.toISOString()
          : String(row.recorded_at),
    };
  }

  return {
    async append(
      streamId: string,
      event: PaymentEvent,
      expectedVersion: number
    ): Promise<EventEnvelope> {
      const actual = await readMaxVersion(streamId);
      if (actual !== expectedVersion) {
        throw new OptimisticConcurrencyError(streamId, expectedVersion, actual);
      }
      const nextVersion = actual + 1;
      const rows = await opts.db.query<EventRow>(
        `INSERT INTO ${table}
            (stream_id, version, event_type, payload, recorded_at)
          SELECT $1, $2, $3, $4::jsonb, NOW()
          WHERE NOT EXISTS (
            SELECT 1 FROM ${table}
            WHERE stream_id = $1 AND version = $2
          )
          RETURNING stream_id, version, global_seq, event_type, payload, recorded_at`,
        [streamId, nextVersion, event.type, JSON.stringify(event)]
      );
      const row = rows[0];
      if (!row) {
        // Race: someone else inserted (stream_id, version) between our
        // max-read and our insert.
        const refreshed = await readMaxVersion(streamId);
        throw new OptimisticConcurrencyError(
          streamId,
          expectedVersion,
          refreshed
        );
      }
      return envelopeFromRow(row);
    },

    async read(
      streamId: string,
      fromVersion = 0
    ): Promise<readonly EventEnvelope[]> {
      const rows = await opts.db.query<EventRow>(
        `SELECT stream_id, version, global_seq, event_type, payload, recorded_at
         FROM ${table}
         WHERE stream_id = $1 AND version > $2
         ORDER BY version ASC`,
        [streamId, fromVersion]
      );
      return rows.map(envelopeFromRow);
    },

    subscribe(_filter: SubscriptionFilter, _handler: EventHandler): Unsubscribe {
      // No-op subscription. Realtime requires LISTEN/NOTIFY; that is a
      // separate package once we have a Postgres notification handler
      // wired into the bootstrap. Documented in package README.
      return () => {};
    },
  };
}
