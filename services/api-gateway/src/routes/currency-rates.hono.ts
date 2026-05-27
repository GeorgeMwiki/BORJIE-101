/**
 * /api/v1/currency-rates — latest FX rates.
 *
 * Routes:
 *   GET  /        list current currency rates (filter base, quote, since)
 *
 * Reads from `currency_rates` (one row per ISO-4217 code). The
 * `rateToUsd` column expresses "1 unit of <code> = rateToUsd USD". A
 * derived `quoteRate` is returned when both `base` and `quote` are
 * supplied:
 *
 *   quoteRate = rate(base) / rate(quote)
 *             = "1 unit of base = quoteRate units of quote"
 *
 * Not tenant-scoped: FX rates are platform-global (no tenant_id column).
 * Auth still required so anonymous callers can't scrape the feed.
 */

import { Hono } from 'hono';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { currencyRates } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const QuerySchema = z.object({
  base: z.string().length(3).optional(),
  quote: z.string().length(3).optional(),
  since: z.string().datetime().optional(),
});

interface CurrencyRateRow {
  readonly code: string;
  readonly rateToUsd: number;
  readonly asOf: Date | string;
  readonly source: string | null;
}

interface CurrencyRateResponseRow extends CurrencyRateRow {
  readonly quoteRate?: number;
  readonly quoteCode?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/', async (c: any) => {
  const db = c.get('db');
  const rawQuery = {
    base: c.req.query('base')?.toUpperCase(),
    quote: c.req.query('quote')?.toUpperCase(),
    since: c.req.query('since'),
  };
  const parsed = QuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        },
      },
      400,
    );
  }
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conds: any[] = [];
  if (parsed.data.base) {
    conds.push(eq(currencyRates.code, parsed.data.base));
  }
  if (parsed.data.since) {
    conds.push(gte(currencyRates.asOf, new Date(parsed.data.since)));
  }

  const rows: CurrencyRateRow[] = await (conds.length > 0
    ? db.select().from(currencyRates).where(and(...conds))
    : db.select().from(currencyRates));

  // When `quote` is supplied, attempt to compute the derived rate.
  // Skip derivation if the quote row is missing — caller can request
  // both codes separately to fall back gracefully.
  let quoteRow: CurrencyRateRow | undefined;
  if (parsed.data.quote) {
    const quoteResult: CurrencyRateRow[] = await db
      .select()
      .from(currencyRates)
      .where(eq(currencyRates.code, parsed.data.quote))
      .limit(1);
    quoteRow = quoteResult[0];
  }

  const enriched: CurrencyRateResponseRow[] = rows.map((row) => {
    if (parsed.data.quote && quoteRow && quoteRow.rateToUsd !== 0) {
      return {
        ...row,
        quoteRate: row.rateToUsd / quoteRow.rateToUsd,
        quoteCode: parsed.data.quote,
      };
    }
    return row;
  });

  return c.json({ success: true as const, data: enriched }, 200);
});

export const currencyRatesRouter = app;
export default app;
