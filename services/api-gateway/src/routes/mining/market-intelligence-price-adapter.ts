/**
 * Real `PriceProviderPort` for `@borjie/market-intelligence`, backed by
 * the append-only `fx_rates` table.
 *
 * The `fx-feed-cron` worker writes genuine market data into `fx_rates`:
 *   - XAU_USD_PM / XAU_USD_AM  — LBMA gold fix (USD/oz)
 *   - TZS_USD                  — Bank of Tanzania spot (TZS per USD)
 *
 * So GOLD has a real, non-fabricated price + history here. Copper and
 * tanzanite have no live feed wired in this repo, so this adapter throws
 * `NoPriceFeedError` for them rather than inventing a number — the route
 * surfaces that as an honest 503 "feed unavailable" state.
 *
 * `fx_rates` is tenant-agnostic (it mirrors global LBMA / BoT
 * benchmarks), so no `app.current_tenant_id` binding is required for
 * these reads; the caller still passes `tenantId` through onto the
 * returned `CommodityPrice` so downstream tenant-scoping holds.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type {
  Commodity,
  CommodityPrice,
  CurrencyCode,
  PriceProviderPort,
} from '@borjie/market-intelligence';

/** Thrown when a commodity has no live price feed wired. */
export class NoPriceFeedError extends Error {
  public override readonly name = 'NoPriceFeedError';
  public readonly code = 'NO_PRICE_FEED';
  public readonly commodity: string;
  constructor(commodity: string) {
    super(`No live price feed wired for "${commodity}".`);
    this.commodity = commodity;
  }
}

/** Minimal structural view of the Drizzle client this adapter needs. */
export interface PriceDbLike {
  execute(query: unknown): Promise<{ rows: ReadonlyArray<FxRateRow> }>;
}

interface FxRateRow {
  readonly pair: string;
  readonly rate: string;
  readonly source: string;
  readonly ts: string;
}

interface HistoryPoint {
  asOfISO: string;
  price: number;
}

// Only gold is backed by a live feed today (LBMA via fx_rates). Map the
// commodity to its fx_rates pairs, preferring the PM fix.
const GOLD_PAIRS = ['XAU_USD_PM', 'XAU_USD_AM'] as const;

/**
 * Build a `PriceProviderPort` reading the latest gold fix from
 * `fx_rates`. `db` may be null (mock mode) — in that case every fetch
 * throws `NoPriceFeedError` so the caller renders an empty state.
 */
export function createFxRatesPriceProvider(
  db: PriceDbLike | null,
): PriceProviderPort {
  return {
    async fetchLatest(
      commodity: Commodity,
      tenantId: string,
    ): Promise<CommodityPrice> {
      if (commodity !== 'gold') {
        throw new NoPriceFeedError(commodity);
      }
      if (!db) {
        throw new NoPriceFeedError(commodity);
      }
      const latest = await fetchLatestGold(db);
      if (!latest) {
        throw new NoPriceFeedError(commodity);
      }
      const currency: CurrencyCode = 'USD';
      return {
        commodity: 'gold',
        tenantId,
        price: latest.price,
        currency,
        asOfISO: latest.asOfISO,
        source: latest.source,
        regulatoryTags: [],
      };
    },
  };
}

/**
 * Read the most recent gold fix from `fx_rates`, preferring the PM fix
 * over the AM fix. Returns null when no gold row exists yet.
 */
async function fetchLatestGold(
  db: PriceDbLike,
): Promise<{ price: number; asOfISO: string; source: string } | null> {
  for (const pair of GOLD_PAIRS) {
    const result = await db.execute(sql`
      SELECT pair, rate::text AS rate, source, ts::text AS ts
      FROM fx_rates
      WHERE pair = ${pair}
      ORDER BY ts DESC
      LIMIT 1
    `);
    const row = result.rows?.[0];
    if (row) {
      const price = Number(row.rate);
      if (Number.isFinite(price) && price > 0) {
        return { price, asOfISO: row.ts, source: row.source };
      }
    }
  }
  return null;
}

/**
 * Real gold price history (newest→oldest reversed to oldest→newest) for
 * the demand forecaster's fit window. Pulls up to `limit` rows from the
 * preferred gold pair; returns [] when none exist. Only gold is fed.
 */
export async function fetchGoldHistory(
  db: PriceDbLike | null,
  limit = 60,
): Promise<HistoryPoint[]> {
  if (!db) return [];
  const safeLimit = Math.min(Math.max(limit, 2), 500);
  // Prefer the PM fix for a consistent series; fall back to AM only if
  // the PM series is empty.
  for (const pair of GOLD_PAIRS) {
    const result = await db.execute(sql`
      SELECT rate::text AS rate, ts::text AS ts, pair, source
      FROM fx_rates
      WHERE pair = ${pair}
      ORDER BY ts DESC
      LIMIT ${safeLimit}
    `);
    const rows = result.rows ?? [];
    if (rows.length > 0) {
      return rows
        .map((r) => ({ asOfISO: r.ts, price: Number(r.rate) }))
        .filter((p) => Number.isFinite(p.price) && p.price > 0)
        .reverse();
    }
  }
  return [];
}
