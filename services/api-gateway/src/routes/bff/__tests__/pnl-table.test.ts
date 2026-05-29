/**
 * R-FUTURE-3 — PnlTable BFF helper tests.
 *
 * Covers the pure functions exported from `pnl-table.hono.ts`. The
 * route handler itself is exercised in the integration suite once the
 * test DB is provisioned with seed sales/costs rows; the pure helpers
 * lock the contract today.
 */

import { describe, expect, it } from 'vitest';
import {
  bucketCategory,
  composePnlRows,
  monthBounds,
  toTzsM,
} from '../pnl-table.hono';

describe('bucketCategory', () => {
  it('buckets COGS categories', () => {
    expect(bucketCategory('royalty')).toBe('cogs');
    expect(bucketCategory('inspection')).toBe('cogs');
    expect(bucketCategory('processing')).toBe('cogs');
  });

  it('buckets OPEX categories', () => {
    expect(bucketCategory('wages')).toBe('opex');
    expect(bucketCategory('fuel')).toBe('opex');
    expect(bucketCategory('admin')).toBe('opex');
  });

  it('falls back to other for unknown categories', () => {
    expect(bucketCategory('debt')).toBe('other');
    expect(bucketCategory('something-new')).toBe('other');
  });
});

describe('toTzsM', () => {
  it('converts TZS to millions rounded to 1dp', () => {
    expect(toTzsM(12_345_678, false)).toBe(12.3);
  });

  it('flips sign for costs so EBITDA arithmetic is additive', () => {
    expect(toTzsM(5_000_000, true)).toBe(-5.0);
  });

  it('handles zero', () => {
    expect(toTzsM(0, false)).toBe(0);
  });
});

describe('monthBounds', () => {
  it('returns first instant of month + first instant of next month', () => {
    const { periodStart, periodEnd } = monthBounds('2026-05');
    expect(periodStart.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('wraps year boundary correctly', () => {
    const { periodStart, periodEnd } = monthBounds('2026-12');
    expect(periodStart.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('composePnlRows', () => {
  it('returns empty array for an empty tenant', () => {
    expect(composePnlRows([], [])).toEqual([]);
  });

  it('composes a revenue row from summed sales', () => {
    const rows = composePnlRows(
      [{ net_tzs: '12500000' }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      group: 'revenue',
      tzsM: 12.5,
    });
  });

  it('composes per-category cost rows with correct bucket + sign', () => {
    const rows = composePnlRows(
      [],
      [
        { category: 'royalty', amount_tzs: '2000000' },
        { category: 'wages', amount_tzs: '5500000' },
        { category: 'debt', amount_tzs: '1000000' },
      ],
    );
    const royalty = rows.find((r) => r.label === 'Royalty');
    const wages = rows.find((r) => r.label === 'Wages');
    const debt = rows.find((r) => r.label === 'Debt');
    expect(royalty?.group).toBe('cogs');
    expect(royalty?.tzsM).toBe(-2.0);
    expect(wages?.group).toBe('opex');
    expect(wages?.tzsM).toBe(-5.5);
    expect(debt?.group).toBe('other');
    expect(debt?.tzsM).toBe(-1.0);
  });

  it('skips malformed numeric rows defensively', () => {
    const rows = composePnlRows(
      [{ net_tzs: 'not-a-number' }],
      [{ category: 'royalty', amount_tzs: 'bad' }],
    );
    expect(rows).toEqual([]);
  });
});
