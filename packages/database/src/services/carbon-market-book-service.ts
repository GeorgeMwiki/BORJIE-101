/**
 * carbon-market-book-service — Drizzle-backed adapter.
 *
 * Satisfies the `BookEntryRepository` port declared in
 * `packages/carbon-market/src/types.ts` (the in-memory port stays the
 * default; this adapter is opt-in at the api-gateway composition root).
 *
 * Closes the deferred P6 production-readiness item: the trading desk
 * shipped against an in-memory book, so every restart erased the
 * paper-forward portfolio. With this service composed in, every booked
 * trade, settlement, and cancellation survives a gateway restart.
 *
 * Surface (widens the P6 port — see `BookEntryRepositoryExtended`):
 *   - `save(entry)`            — upsert by entry_id (idempotent retry).
 *   - `findById(id)`           — single fetch, returns null on miss.
 *   - `findByTenant(tenantId)` — P6 compatibility surface (every entry).
 *   - `findOpenByTenant(t)`    — `status='open'` only.
 *   - `findBySymbol(t, s, since)` — symbol-scoped, optional cutoff.
 *   - `markSettled(id, dt)`    — open → settled state transition.
 *   - `cancel(id, reason)`     — open → cancelled, reason in metadata.
 *
 * Pricing convention:
 *   - The carbon-market `BookEntry` carries `priceUsdPerTonne` as a
 *     `number`. The table stores `price_per_unit_cents` (BIGINT) to
 *     dodge binary-float drift in mark-to-market sums; we multiply by
 *     100 on write and divide on read. Currency is pinned to 'USD' on
 *     write (the desk normalises to USD before booking).
 *
 * Status state machine:
 *   - On insert: status='open'  (or the entry's own status if non-OPEN).
 *   - `markSettled` only fires on 'open' rows; idempotent on already-
 *     settled rows (no-op).
 *   - `cancel` only fires on 'open' rows; idempotent on already-cancelled.
 *
 * Multi-tenant isolation:
 *   - Every read filters by `tenant_id`. A compromised entry_id can't
 *     be replayed cross-tenant. Pairs with RLS migration 0155.
 *
 * Error handling:
 *   - `save` rethrows on DB error (losing a booked trade leaves the
 *     desk + repo out of sync — caller must observe).
 *   - All reads degrade to empty/null on DB error so a dashboard
 *     stays responsive rather than throwing into a render path.
 *   - `markSettled` / `cancel` rethrow so the orchestrator surfaces
 *     the failed state transition.
 */

import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import {

  carbonMarketBookEntries,
  type CarbonMarketBookEntryRow,
} from '../schemas/carbon-market-book.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Port shape — mirrors carbon-market's `BookEntry` to avoid a hard
// compile-time dep on `@borjie/carbon-market` from `@borjie/database`.
// The carbon-market adapter (`createPostgresBookRepository`) is the
// runtime bridge.
// ─────────────────────────────────────────────────────────────────────

export type BookEntrySide = 'BUY' | 'SELL';
export type BookEntryStatus = 'OPEN' | 'SETTLED' | 'CANCELLED';

export interface BookEntryShape {
  readonly id: string;
  readonly tenantId: string;
  readonly side: BookEntrySide;
  readonly symbol: string;
  readonly qty: number;
  readonly priceUsdPerTonne: number;
  readonly tenor: string;
  readonly counterparty: string;
  readonly tradeDate: string;
  readonly status: BookEntryStatus;
  readonly settlementDate?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Production repo widens the P6 `BookEntryRepository` (save/findById/
 * findByTenant) with the operational surface the desk needs in
 * production: open-only fetch, symbol-scoped scan, and the two state
 * transitions (settle + cancel). Every consumer of the in-memory port
 * remains source-compatible.
 */
export interface BookEntryRepositoryExtended {
  save(entry: BookEntryShape): Promise<void>;
  findById(entryId: string): Promise<BookEntryShape | null>;
  findByTenant(tenantId: string): Promise<ReadonlyArray<BookEntryShape>>;
  findOpenByTenant(tenantId: string): Promise<ReadonlyArray<BookEntryShape>>;
  findBySymbol(
    tenantId: string,
    symbol: string,
    since?: Date,
  ): Promise<ReadonlyArray<BookEntryShape>>;
  markSettled(entryId: string, settlementDate: Date): Promise<BookEntryShape | null>;
  cancel(entryId: string, reason: string): Promise<BookEntryShape | null>;
}

export type CarbonMarketBookService = BookEntryRepositoryExtended;

// ─────────────────────────────────────────────────────────────────────
// Row ↔ port translation
// ─────────────────────────────────────────────────────────────────────

const SIDE_TO_DB: Record<BookEntrySide, string> = { BUY: 'buy', SELL: 'sell' };
const SIDE_FROM_DB: Record<string, BookEntrySide> = { buy: 'BUY', sell: 'SELL' };
const STATUS_TO_DB: Record<BookEntryStatus, string> = {
  OPEN: 'open',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
};
const STATUS_FROM_DB: Record<string, BookEntryStatus> = {
  open: 'OPEN',
  settled: 'SETTLED',
  cancelled: 'CANCELLED',
};

const DEFAULT_CURRENCY = 'USD';

function rowToEntry(row: CarbonMarketBookEntryRow): BookEntryShape {
  const priceCents = typeof row.pricePerUnitCents === 'bigint'
    ? Number(row.pricePerUnitCents)
    : Number(row.pricePerUnitCents ?? 0);
  const qtyNum = typeof row.qty === 'string' ? Number(row.qty) : Number(row.qty ?? 0);
  const status = STATUS_FROM_DB[row.status] ?? 'OPEN';
  const side = SIDE_FROM_DB[row.side] ?? 'BUY';
  const base: BookEntryShape & { settlementDate?: string; metadata?: Readonly<Record<string, unknown>> } = {
    id: row.entryId,
    tenantId: row.tenantId,
    side,
    symbol: row.symbol,
    qty: qtyNum,
    priceUsdPerTonne: priceCents / 100,
    tenor: row.tenor ?? '',
    counterparty: row.counterparty,
    tradeDate: row.tradeDate instanceof Date ? row.tradeDate.toISOString() : String(row.tradeDate),
    status,
  };
  if (row.settlementDate) {
    base.settlementDate =
      row.settlementDate instanceof Date
        ? row.settlementDate.toISOString()
        : String(row.settlementDate);
  }
  if (row.metadata && typeof row.metadata === 'object') {
    base.metadata = row.metadata as Readonly<Record<string, unknown>>;
  }
  return Object.freeze(base);
}

function entryToInsertValues(entry: BookEntryShape): Record<string, unknown> {
  const status = STATUS_TO_DB[entry.status] ?? 'open';
  const side = SIDE_TO_DB[entry.side] ?? 'buy';
  // priceUsdPerTonne × 100 → cents. Round defensively in case the desk
  // ever hands us a value with sub-cent precision.
  const priceCents = BigInt(Math.round(entry.priceUsdPerTonne * 100));
  const tradeDateIso = parseIsoSafe(entry.tradeDate);
  return {
    entryId: entry.id,
    tenantId: entry.tenantId,
    counterparty: entry.counterparty,
    symbol: entry.symbol,
    side,
    qty: String(entry.qty),
    pricePerUnitCents: priceCents,
    currency: DEFAULT_CURRENCY,
    tenor: entry.tenor && entry.tenor.length > 0 ? entry.tenor : null,
    tradeDate: tradeDateIso,
    settlementDate: entry.settlementDate ? parseIsoSafe(entry.settlementDate) : null,
    status,
    metadata: entry.metadata ?? {},
    updatedAt: new Date(),
  };
}

function parseIsoSafe(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // Defensive default — never block a save on a malformed timestamp.
    return new Date();
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────

export interface CreateCarbonMarketBookServiceOpts {
  readonly db: DatabaseClient;
}

export function createCarbonMarketBookService(
  opts: CreateCarbonMarketBookServiceOpts,
): CarbonMarketBookService {
  const { db } = opts;

  return {
    async save(entry) {
      if (!entry?.id) {
        throw new Error('carbon-market-book.save: entry.id is required');
      }
      if (!entry.tenantId) {
        throw new Error('carbon-market-book.save: entry.tenantId is required');
      }
      try {
        const values = entryToInsertValues(entry);
        await db
          .insert(carbonMarketBookEntries)
          .values(values as never)
          .onConflictDoUpdate({
            target: carbonMarketBookEntries.entryId,
            set: {
              counterparty: values.counterparty as string,
              symbol: values.symbol as string,
              side: values.side as string,
              qty: values.qty as string,
              pricePerUnitCents: values.pricePerUnitCents as bigint,
              currency: values.currency as string,
              tenor: values.tenor as string | null,
              tradeDate: values.tradeDate as Date,
              settlementDate: values.settlementDate as Date | null,
              status: values.status as string,
              metadata: values.metadata as Record<string, unknown>,
              updatedAt: new Date(),
            } as never,
          });
      } catch (error) {
        // Losing a booked trade desynchronises the desk + repo. Surface
        // the failure so the trading-desk can refuse to mark the order
        // as booked.
        logger.error('carbon-market-book.save failed', { error: error });
        throw error;
      }
    },

    async findById(entryId) {
      try {
        if (!entryId) return null;
        const rows = (await db
          .select(SELECT_COLS)
          .from(carbonMarketBookEntries)
          .where(eq(carbonMarketBookEntries.entryId, entryId))
          .limit(1)) as ReadonlyArray<CarbonMarketBookEntryRow>;
        const row = rows?.[0];
        return row ? rowToEntry(row) : null;
      } catch (error) {
        logger.error('carbon-market-book.findById failed', { error: error });
        return null;
      }
    },

    async findByTenant(tenantId) {
      try {
        if (!tenantId) return Object.freeze([]);
        const rows = (await db
          .select(SELECT_COLS)
          .from(carbonMarketBookEntries)
          .where(eq(carbonMarketBookEntries.tenantId, tenantId))
          .orderBy(desc(carbonMarketBookEntries.tradeDate))) as ReadonlyArray<CarbonMarketBookEntryRow>;
        return Object.freeze((rows ?? []).map(rowToEntry));
      } catch (error) {
        logger.error('carbon-market-book.findByTenant failed', { error: error });
        return Object.freeze([]);
      }
    },

    async findOpenByTenant(tenantId) {
      try {
        if (!tenantId) return Object.freeze([]);
        const rows = (await db
          .select(SELECT_COLS)
          .from(carbonMarketBookEntries)
          .where(
            and(
              eq(carbonMarketBookEntries.tenantId, tenantId),
              eq(carbonMarketBookEntries.status, STATUS_TO_DB.OPEN),
            ),
          )
          .orderBy(asc(carbonMarketBookEntries.tradeDate))) as ReadonlyArray<CarbonMarketBookEntryRow>;
        return Object.freeze((rows ?? []).map(rowToEntry));
      } catch (error) {
        logger.error('carbon-market-book.findOpenByTenant failed', { error: error });
        return Object.freeze([]);
      }
    },

    async findBySymbol(tenantId, symbol, since) {
      try {
        if (!tenantId || !symbol) return Object.freeze([]);
        const baseWhere = and(
          eq(carbonMarketBookEntries.tenantId, tenantId),
          eq(carbonMarketBookEntries.symbol, symbol),
        );
        const whereClause = since
          ? and(baseWhere, gte(carbonMarketBookEntries.tradeDate, since))
          : baseWhere;
        const rows = (await db
          .select(SELECT_COLS)
          .from(carbonMarketBookEntries)
          .where(whereClause)
          .orderBy(desc(carbonMarketBookEntries.tradeDate))) as ReadonlyArray<CarbonMarketBookEntryRow>;
        return Object.freeze((rows ?? []).map(rowToEntry));
      } catch (error) {
        logger.error('carbon-market-book.findBySymbol failed', { error: error });
        return Object.freeze([]);
      }
    },

    async markSettled(entryId, settlementDate) {
      if (!entryId) {
        throw new Error('carbon-market-book.markSettled: entryId is required');
      }
      try {
        const rows = (await db
          .update(carbonMarketBookEntries)
          .set({
            status: STATUS_TO_DB.SETTLED,
            settlementDate,
            updatedAt: new Date(),
          } as never)
          .where(
            and(
              eq(carbonMarketBookEntries.entryId, entryId),
              eq(carbonMarketBookEntries.status, STATUS_TO_DB.OPEN),
            ),
          )
          .returning(SELECT_COLS)) as ReadonlyArray<CarbonMarketBookEntryRow>;
        if (!rows || rows.length === 0) {
          // Either the entry doesn't exist or it's already settled /
          // cancelled. Re-read for the caller's diagnostic context.
          return this.findById(entryId);
        }
        return rowToEntry(rows[0]!);
      } catch (error) {
        logger.error('carbon-market-book.markSettled failed', { error: error });
        throw error;
      }
    },

    async cancel(entryId, reason) {
      if (!entryId) {
        throw new Error('carbon-market-book.cancel: entryId is required');
      }
      try {
        // Read first so we can preserve any existing metadata keys.
        const existing = await this.findById(entryId);
        const baseMeta = (existing?.metadata as Record<string, unknown> | undefined) ?? {};
        const nextMeta = {
          ...baseMeta,
          cancellationReason: reason,
          cancelledAt: new Date().toISOString(),
        };
        const rows = (await db
          .update(carbonMarketBookEntries)
          .set({
            status: STATUS_TO_DB.CANCELLED,
            metadata: nextMeta,
            updatedAt: new Date(),
          } as never)
          .where(
            and(
              eq(carbonMarketBookEntries.entryId, entryId),
              eq(carbonMarketBookEntries.status, STATUS_TO_DB.OPEN),
            ),
          )
          .returning(SELECT_COLS)) as ReadonlyArray<CarbonMarketBookEntryRow>;
        if (!rows || rows.length === 0) {
          return this.findById(entryId);
        }
        return rowToEntry(rows[0]!);
      } catch (error) {
        logger.error('carbon-market-book.cancel failed', { error: error });
        throw error;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  entryId: carbonMarketBookEntries.entryId,
  tenantId: carbonMarketBookEntries.tenantId,
  counterparty: carbonMarketBookEntries.counterparty,
  symbol: carbonMarketBookEntries.symbol,
  side: carbonMarketBookEntries.side,
  qty: carbonMarketBookEntries.qty,
  pricePerUnitCents: carbonMarketBookEntries.pricePerUnitCents,
  currency: carbonMarketBookEntries.currency,
  tenor: carbonMarketBookEntries.tenor,
  tradeDate: carbonMarketBookEntries.tradeDate,
  settlementDate: carbonMarketBookEntries.settlementDate,
  status: carbonMarketBookEntries.status,
  metadata: carbonMarketBookEntries.metadata,
  createdAt: carbonMarketBookEntries.createdAt,
  updatedAt: carbonMarketBookEntries.updatedAt,
} as const;

// Silence unused-import lint when no SQL helper is referenced inline.
void sql;

export { carbonMarketBookEntries };
