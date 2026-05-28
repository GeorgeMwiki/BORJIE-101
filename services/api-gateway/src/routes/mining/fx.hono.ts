/**
 * /api/v1/mining/fx — live FX rates for the Treasury panel.
 *
 * Two endpoints:
 *   GET /latest   most recent rate per known pair (TZS_USD, XAU_USD_AM,
 *                 XAU_USD_PM). Returns 200 with a list; empty when the
 *                 fx-feed cron has not yet written anything.
 *   GET /history  last N rows for a specific pair (default 60).
 *
 * Reads from `fx_rates` (treasury.schema). The fx-feed-cron worker
 * appends a row every 5 minutes; this router is the read path.
 *
 * RLS: `fx_rates` is tenant-agnostic (mirrors LBMA / BoT global
 * benchmarks) so the database middleware merely opens the session;
 * no `app.current_tenant_id` binding is required for these reads.
 */

import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-fx');

const KNOWN_PAIRS = ['TZS_USD', 'XAU_USD_AM', 'XAU_USD_PM'] as const;
type KnownPair = (typeof KNOWN_PAIRS)[number];

interface FxRow {
  readonly id: string;
  readonly ts: string;
  readonly pair: string;
  readonly rate: string;
  readonly source: string;
}

const fx = new Hono();

fx.use('*', authMiddleware);
fx.use('*', databaseMiddleware);

fx.get('/latest', async (c) => {
  const db = c.get('db') as
    | { execute(q: unknown): Promise<{ rows: ReadonlyArray<FxRow> }> }
    | undefined;
  if (!db) {
    return c.json({ rates: [], degraded: true }, 200);
  }
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (pair) id, ts::text AS ts, pair, rate::text AS rate, source
      FROM fx_rates
      WHERE pair = ANY(${sql.raw(`ARRAY[${KNOWN_PAIRS.map((p) => `'${p}'`).join(',')}]`)}::text[])
      ORDER BY pair, ts DESC
    `);
    const rates = (result.rows ?? []).map((r) => ({
      pair: r.pair,
      rate: Number(r.rate),
      source: r.source,
      ts: r.ts,
    }));
    return c.json({ rates, degraded: false }, 200);
  } catch (err) {
    moduleLogger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'fx /latest query failed',
    );
    return c.json({ rates: [], degraded: true }, 200);
  }
});

fx.get('/history', async (c: Context) => {
  const pairRaw = c.req.query('pair') ?? 'TZS_USD';
  const limitRaw = c.req.query('limit') ?? '60';
  const limit = Math.min(Math.max(Number(limitRaw) || 60, 1), 500);
  const allowedPair: KnownPair | null = KNOWN_PAIRS.includes(pairRaw as KnownPair)
    ? (pairRaw as KnownPair)
    : null;
  if (!allowedPair) {
    return c.json({ error: 'unknown_pair', allowed: KNOWN_PAIRS }, 400);
  }
  const db = c.get('db') as
    | { execute(q: unknown): Promise<{ rows: ReadonlyArray<FxRow> }> }
    | undefined;
  if (!db) {
    return c.json({ pair: allowedPair, points: [], degraded: true }, 200);
  }
  try {
    const result = await db.execute(sql`
      SELECT id, ts::text AS ts, pair, rate::text AS rate, source
      FROM fx_rates
      WHERE pair = ${allowedPair}
      ORDER BY ts DESC
      LIMIT ${limit}
    `);
    const points = (result.rows ?? [])
      .map((r) => ({ ts: r.ts, rate: Number(r.rate), source: r.source }))
      .reverse();
    return c.json({ pair: allowedPair, points, degraded: false }, 200);
  } catch (err) {
    moduleLogger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'fx /history query failed',
    );
    return c.json({ pair: allowedPair, points: [], degraded: true }, 200);
  }
});

export { fx as miningFxRouter };
export default fx;
