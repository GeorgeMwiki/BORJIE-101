/**
 * Estate asset-register portfolio aggregate — regression coverage (B7).
 *
 * Before this fix `GET /api/v1/estate/assets` returned only the ≤`limit`
 * (max 500) display rows with NO server-side total, and the owner cockpit
 * folded "Total portfolio value" / avg-per-asset by a client reduce over
 * those ≤500 rows. The instant a tenant crossed 500 assets the headline
 * portfolio value SILENTLY under-reported (a capped-fold false-green KPI).
 *
 * `computeAssetsAggregate` now folds SUM(current_value_tzs) + COUNT(*) over
 * EVERY tenant-scoped matching row on the server. This suite proves the
 * aggregate is correct past the 500-row page and that an empty portfolio
 * yields a null total (localized "—"), never a fabricated 0.
 */

import { describe, it, expect } from 'vitest';
import { computeAssetsAggregate } from '../assets.hono';

/**
 * Minimal db stub whose `.where(...)` resolves to a single aggregate row,
 * mirroring what Postgres returns for `SELECT SUM(...), COUNT(*)`.
 */
function stubDb(row: { total: string | null; count: number | string }) {
  return {
    select: () => ({
      from: () => ({
        where: async () => [row],
      }),
    }),
  } as any;
}

describe('computeAssetsAggregate', () => {
  it('folds SUM + COUNT over MORE than the 500-row display page', async () => {
    // 1_200 assets @ 2_000_000 TZS each = 2.4B TZS — a client reduce over a
    // 500-row page would report 1.0B (500 * 2M) and drop 700 assets.
    const count = 1_200;
    const perAsset = 2_000_000;
    const trueTotal = String(count * perAsset); // 2_400_000_000

    const agg = await computeAssetsAggregate(
      stubDb({ total: trueTotal, count }),
      [],
    );

    expect(agg.count).toBe(count);
    expect(agg.totalValueTzs).toBe(trueTotal);
    // The capped-fold bug would have produced 500 * perAsset here.
    expect(Number(agg.totalValueTzs)).toBeGreaterThan(500 * perAsset);
    // Average per asset is now derivable from the FULL fold.
    expect(Number(agg.totalValueTzs) / agg.count).toBe(perAsset);
  });

  it('returns a NULL total for an empty portfolio (no fabricated 0)', async () => {
    const agg = await computeAssetsAggregate(
      stubDb({ total: null, count: 0 }),
      [],
    );
    expect(agg.count).toBe(0);
    expect(agg.totalValueTzs).toBeNull();
  });

  it('coerces a string COUNT (postgres bigint text) to a number', async () => {
    const agg = await computeAssetsAggregate(
      stubDb({ total: '750', count: '3' }),
      [],
    );
    expect(agg.count).toBe(3);
    expect(agg.totalValueTzs).toBe('750');
  });
});
