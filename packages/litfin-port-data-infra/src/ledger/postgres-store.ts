/**
 * Postgres-backed event store.
 *
 * Schema (caller-owned migration; suggested name
 * `borjie_mining_event_store`):
 *
 *   global_seq  BIGSERIAL PRIMARY KEY
 *   stream_id   TEXT NOT NULL
 *   tenant_id   TEXT NOT NULL
 *   version     INTEGER NOT NULL CHECK (version >= 1)
 *   event_type  TEXT NOT NULL
 *   payload     JSONB NOT NULL
 *   recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   UNIQUE (stream_id, version)
 *   UNIQUE INDEX (tenant_id, stream_id, version)
 *
 * Optimistic concurrency is enforced by the UNIQUE(stream_id,
 * version) constraint plus a defensive `MAX(version)` re-read on
 * collision. Writers MUST pass the expected version they computed
 * from a prior read; mismatch throws `OptimisticConcurrencyError`.
 *
 * Subscription LISTEN/NOTIFY is best-effort: when a NOTIFY channel
 * is wired (see `attachListenNotify` helper), subscribers receive
 * envelopes asynchronously. If no listener is configured, only the
 * in-process subscribers registered against the same instance are
 * notified (those receive the envelope synchronously from `append`).
 *
 * Ported verbatim from @litfin/ledger; the event-type bindings are
 * Borjie's MiningEvent set. This append-only operational ledger is
 * adjunct to — not replacement for — `services/payments-ledger`'s
 * double-entry money path.
 */

import type {
  AppendOptions,
  EventEnvelope,
  EventHandler,
  EventStore,
  SubscriptionFilter,
  Unsubscribe,
} from "./types";
import { OptimisticConcurrencyError, TenantBoundaryViolation } from "./types";
import type { MiningEvent, MiningEventType } from "./events";

/**
 * The query surface we need from the underlying driver. Compatible
 * with `pg`, `postgres-js`, and Drizzle's `db.execute(sql)` style.
 * Returns rows as objects with snake_case column keys.
 */
export interface DBClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>>;
}

export interface PostgresEventStoreOptions {
  readonly db: DBClient;
  /** Defaults to `borjie_mining_event_store`. Override for a sharded
   *  / per-tenant table layout. Caller-controlled; never derived from
   *  user input. */
  readonly tableName?: string;
}

interface RawRow {
  readonly stream_id: string;
  readonly tenant_id: string;
  readonly version: number | string;
  readonly global_seq: number | string;
  readonly event_type: string;
  readonly payload: unknown;
  readonly recorded_at: string;
}

interface Subscription {
  readonly filter: SubscriptionFilter;
  readonly handler: EventHandler;
}

function toEnvelope(row: RawRow): EventEnvelope {
  return Object.freeze({
    streamId: row.stream_id,
    tenantId: row.tenant_id,
    version:
      typeof row.version === "string" ? parseInt(row.version, 10) : row.version,
    globalSeq:
      typeof row.global_seq === "string"
        ? parseInt(row.global_seq, 10)
        : row.global_seq,
    event: row.payload as MiningEvent,
    recordedAt: row.recorded_at,
  });
}

export function createPostgresEventStore(
  opts: PostgresEventStoreOptions,
): EventStore {
  const table = opts.tableName ?? "borjie_mining_event_store";
  // Defensive: the table name is caller-supplied configuration, never
  // user input. We still enforce a safe identifier shape to make a
  // misconfigured caller fail loudly instead of silently injecting.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(
      `Invalid tableName "${table}" — must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
    );
  }

  const subscribers = new Set<Subscription>();

  function matches(
    envelope: EventEnvelope,
    filter: SubscriptionFilter,
  ): boolean {
    if (filter.streamId && envelope.streamId !== filter.streamId) return false;
    if (filter.tenantId && envelope.tenantId !== filter.tenantId) return false;
    if (filter.eventTypes && !filter.eventTypes.includes(envelope.event.type))
      return false;
    return true;
  }

  async function fanOut(envelope: EventEnvelope): Promise<void> {
    for (const sub of subscribers) {
      if (!matches(envelope, sub.filter)) continue;
      try {
        await sub.handler(envelope);
      } catch (err) {
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.error("[litfin-port-data-infra:ledger] subscriber threw:", err);
        }
      }
    }
  }

  return {
    async append(input: AppendOptions): Promise<EventEnvelope> {
      const { streamId, tenantId, event, expectedVersion } = input;

      // Snapshot read of current state for concurrency + tenant check.
      const head = await opts.db.query<{
        max_version: number | string | null;
        tenant_id: string | null;
      }>(
        `SELECT MAX(version)::int AS max_version, MIN(tenant_id) AS tenant_id
           FROM ${table}
          WHERE stream_id = $1`,
        [streamId],
      );
      const row = head[0];
      const currentVersion = row?.max_version
        ? typeof row.max_version === "string"
          ? parseInt(row.max_version, 10)
          : row.max_version
        : 0;
      if (currentVersion !== expectedVersion) {
        throw new OptimisticConcurrencyError(
          streamId,
          expectedVersion,
          currentVersion,
        );
      }
      if (row?.tenant_id && row.tenant_id !== tenantId) {
        throw new TenantBoundaryViolation(streamId, row.tenant_id, tenantId);
      }

      const nextVersion = currentVersion + 1;

      const inserted = await opts.db.query<RawRow>(
        `INSERT INTO ${table} (stream_id, tenant_id, version, event_type, payload)
              VALUES ($1, $2, $3, $4, $5::jsonb)
              ON CONFLICT (stream_id, version) DO NOTHING
              RETURNING stream_id, tenant_id, version, global_seq, event_type, payload, recorded_at`,
        [streamId, tenantId, nextVersion, event.type, JSON.stringify(event)],
      );

      if (inserted.length === 0) {
        // Lost the race; re-read the head version and throw.
        const refresh = await opts.db.query<{ max_version: number | string }>(
          `SELECT MAX(version)::int AS max_version FROM ${table} WHERE stream_id = $1`,
          [streamId],
        );
        const actual = refresh[0]?.max_version
          ? typeof refresh[0].max_version === "string"
            ? parseInt(refresh[0].max_version, 10)
            : refresh[0].max_version
          : currentVersion;
        throw new OptimisticConcurrencyError(streamId, expectedVersion, actual);
      }

      const envelope = toEnvelope(inserted[0]);
      await fanOut(envelope);
      return envelope;
    },

    async read(streamId, queryOpts) {
      const fromVersion = queryOpts?.fromVersion ?? 0;
      const tenantId = queryOpts?.tenantId;

      const rows = tenantId
        ? await opts.db.query<RawRow>(
            `SELECT stream_id, tenant_id, version, global_seq, event_type, payload, recorded_at
               FROM ${table}
              WHERE stream_id = $1 AND tenant_id = $2 AND version > $3
              ORDER BY version ASC`,
            [streamId, tenantId, fromVersion],
          )
        : await opts.db.query<RawRow>(
            `SELECT stream_id, tenant_id, version, global_seq, event_type, payload, recorded_at
               FROM ${table}
              WHERE stream_id = $1 AND version > $2
              ORDER BY version ASC`,
            [streamId, fromVersion],
          );

      return rows.map(toEnvelope);
    },

    subscribe(filter, handler): Unsubscribe {
      const sub: Subscription = { filter, handler };
      subscribers.add(sub);
      return () => {
        subscribers.delete(sub);
      };
    },
  };
}

/**
 * Helper to type-narrow events when projecting outside the package.
 */
export function isEventType<T extends MiningEventType>(
  envelope: EventEnvelope,
  type: T,
): envelope is EventEnvelope & {
  event: Extract<MiningEvent, { type: T }>;
} {
  return envelope.event.type === type;
}
