/**
 * CDC (Change Data Capture) — types (LP-20b).
 *
 * Models the events emitted by Postgres triggers on a `pg_notify`
 * channel so a transport-agnostic router can fan them out to typed
 * consumers (realtime projection tabs, sleep-pass triggers, downstream
 * reactive automation) WITHOUT the router knowing about Postgres.
 *
 * Re-skinned from LITFIN `src/core/cdc/types.ts` to Borjie's
 * money/ledger projection surface. The watched-table set is the
 * payments-ledger spine plus the licence/royalty rows whose changes
 * drive owner-cockpit projections. `validateCdcTables`/`parseCdcPayload`
 * accept an explicit allow-set so a deployment can widen the surface
 * without editing this module.
 *
 * @module @borjie/payments-event-store/cdc/types
 */

export type CdcOperation = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * Default watched tables — the money/ledger spine. A deployment MAY
 * supply its own allow-set to {@link parseCdcPayload} to widen this.
 */
export const DEFAULT_WATCHED_TABLES: ReadonlyArray<string> = [
  'ledger_entries',
  'payment_intents',
  'disbursements',
  'settlements',
  'arrears_cases',
];

export type CdcWatchedTable = string;

/**
 * Payload emitted by the `borjie_cdc_emit` Postgres trigger function.
 * Kept small (id + table + op + tenant + ts) so the 8KB pg_notify
 * limit is never close — consumers re-fetch the full row if needed.
 */
export interface CdcEvent {
  readonly table: CdcWatchedTable;
  readonly op: CdcOperation;
  readonly id: string;
  readonly tenantId: string;
  /** Postgres timestamp seconds (Unix). */
  readonly ts: number;
}

export interface CdcConsumer {
  /** Stable consumer id for tracing + dedup. */
  readonly id: string;
  /** Subset of tables this consumer cares about. Empty/absent = all. */
  readonly tables?: ReadonlyArray<CdcWatchedTable>;
  /** Subset of operations. Empty/absent = all. */
  readonly operations?: ReadonlyArray<CdcOperation>;
  /** Subset of tenants. Empty/absent = all. */
  readonly tenants?: ReadonlyArray<string>;
  /** Called with each matching event. MAY be async. */
  readonly onEvent: (e: CdcEvent) => void | Promise<void>;
}

export interface CdcStats {
  readonly received: number;
  readonly dispatched: number;
  readonly errors: number;
  readonly malformed: number;
}

export interface CdcListenerHandle {
  /** Aggregate counters (any consumer). */
  readonly stats: () => CdcStats;
  /** Stop the listener; idempotent. */
  readonly stop: () => Promise<void>;
}

/** True when an event passes a consumer's table/op/tenant filters. */
export function eventMatches(consumer: CdcConsumer, event: CdcEvent): boolean {
  if (consumer.tables && consumer.tables.length > 0) {
    if (!consumer.tables.includes(event.table)) return false;
  }
  if (consumer.operations && consumer.operations.length > 0) {
    if (!consumer.operations.includes(event.op)) return false;
  }
  if (consumer.tenants && consumer.tenants.length > 0) {
    if (!consumer.tenants.includes(event.tenantId)) return false;
  }
  return true;
}

const VALID_OPS: ReadonlyArray<string> = ['INSERT', 'UPDATE', 'DELETE'];

/**
 * Parse a raw pg_notify JSON payload into a typed {@link CdcEvent}.
 * Returns null on malformed input — the caller logs + skips rather
 * than throwing (CDC is best-effort streaming). `allowedTables`
 * gates which table names are accepted (defaults to
 * {@link DEFAULT_WATCHED_TABLES}).
 */
export function parseCdcPayload(
  payload: string,
  allowedTables: ReadonlyArray<string> = DEFAULT_WATCHED_TABLES,
): CdcEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.table !== 'string' ||
    typeof obj.op !== 'string' ||
    typeof obj.id !== 'string' ||
    typeof obj.tenant_id !== 'string' ||
    typeof obj.ts !== 'number'
  ) {
    return null;
  }
  if (!allowedTables.includes(obj.table)) return null;
  if (!VALID_OPS.includes(obj.op)) return null;
  return {
    table: obj.table,
    op: obj.op as CdcOperation,
    id: obj.id,
    tenantId: obj.tenant_id,
    ts: obj.ts,
  };
}
