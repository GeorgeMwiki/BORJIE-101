/**
 * Ranker tests — covers the formula spec:
 *   score = log(1 + freq) * exp(-(now - lastSeen) / halfLife)
 *         * (0.5 + 0.5 * successRate)
 *
 * All tests pin `now` so the formula stays deterministic across CI runs.
 */
import { describe, expect, it } from 'vitest';
import {
  confirmationRate,
  rankActions,
  recencyWeight,
  scoreAction,
} from '../ranker.js';
import type { UserActionTrackerRow } from '../types.js';

const NOW = Date.parse('2026-05-21T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function row(
  id: string,
  overrides: Partial<UserActionTrackerRow> = {},
): UserActionTrackerRow {
  return {
    id,
    label: `Label ${id}`,
    frequency: 5,
    lastSeenIso: new Date(NOW - DAY).toISOString(),
    successCount: 4,
    cancelCount: 1,
    ...overrides,
  };
}

describe('recencyWeight', () => {
  it('returns 1 for an action seen just now', () => {
    expect(recencyWeight(NOW, NOW)).toBeCloseTo(1, 5);
  });

  it('returns ~0.5 after one half-life', () => {
    expect(recencyWeight(NOW - WEEK, NOW)).toBeCloseTo(0.5, 3);
  });

  it('returns ~0.25 after two half-lives', () => {
    expect(recencyWeight(NOW - 2 * WEEK, NOW)).toBeCloseTo(0.25, 3);
  });

  it('clamps future timestamps to 1', () => {
    expect(recencyWeight(NOW + DAY, NOW)).toBe(1);
  });
});

describe('confirmationRate', () => {
  it('returns 0.5 (neutral) when no outcomes recorded', () => {
    expect(confirmationRate(0, 0)).toBe(0.5);
  });

  it('returns 1 when all outcomes are successes', () => {
    expect(confirmationRate(10, 0)).toBe(1);
  });

  it('returns 0 when all outcomes are cancels', () => {
    expect(confirmationRate(0, 10)).toBe(0);
  });

  it('clamps negative counts to zero', () => {
    expect(confirmationRate(-5, -3)).toBe(0.5);
  });
});

describe('scoreAction', () => {
  it('rewards high frequency, recent, high-confirmation actions', () => {
    const hot = row('hot', {
      frequency: 50,
      lastSeenIso: new Date(NOW - HOUR).toISOString(),
      successCount: 49,
      cancelCount: 1,
    });
    const cold = row('cold', {
      frequency: 1,
      lastSeenIso: new Date(NOW - 4 * WEEK).toISOString(),
      successCount: 0,
      cancelCount: 1,
    });
    expect(scoreAction(hot, NOW)).toBeGreaterThan(scoreAction(cold, NOW) * 10);
  });

  it('returns 0 for zero-frequency rows', () => {
    expect(scoreAction(row('zero', { frequency: 0 }), NOW)).toBe(0);
  });

  it('returns 0 for invalid timestamps', () => {
    expect(scoreAction(row('bad', { lastSeenIso: 'not-a-date' }), NOW)).toBe(
      0,
    );
  });
});

describe('rankActions', () => {
  it('ranks high-freq + recent + high-confirm action first', () => {
    const rows: UserActionTrackerRow[] = [
      row('a', {
        frequency: 2,
        lastSeenIso: new Date(NOW - 3 * WEEK).toISOString(),
        successCount: 1,
        cancelCount: 1,
      }),
      row('b', {
        frequency: 30,
        lastSeenIso: new Date(NOW - HOUR).toISOString(),
        successCount: 28,
        cancelCount: 2,
      }),
      row('c', {
        frequency: 5,
        lastSeenIso: new Date(NOW - DAY).toISOString(),
        successCount: 3,
        cancelCount: 2,
      }),
    ];
    const ranked = rankActions(rows, { now: NOW });
    expect(ranked[0]?.id).toBe('b');
  });

  it('decays stale actions below fresh ones with similar frequency', () => {
    const fresh = row('fresh', {
      frequency: 10,
      lastSeenIso: new Date(NOW - HOUR).toISOString(),
    });
    const stale = row('stale', {
      frequency: 10,
      lastSeenIso: new Date(NOW - 6 * WEEK).toISOString(),
    });
    const ranked = rankActions([stale, fresh], { now: NOW });
    expect(ranked[0]?.id).toBe('fresh');
    expect(ranked[1]?.id).toBe('stale');
  });

  it('pushes cancelled-heavy actions below confirmed ones', () => {
    const cancelled = row('cancelled', {
      frequency: 20,
      lastSeenIso: new Date(NOW - DAY).toISOString(),
      successCount: 1,
      cancelCount: 19,
    });
    const confirmed = row('confirmed', {
      frequency: 15,
      lastSeenIso: new Date(NOW - DAY).toISOString(),
      successCount: 14,
      cancelCount: 1,
    });
    const ranked = rankActions([cancelled, confirmed], { now: NOW });
    expect(ranked[0]?.id).toBe('confirmed');
  });

  it('forces pinned IDs to the front in the supplied order', () => {
    const rows: UserActionTrackerRow[] = [
      row('a', { frequency: 100 }),
      row('b', { frequency: 50 }),
      row('c', { frequency: 10 }),
    ];
    const ranked = rankActions(rows, {
      now: NOW,
      pinnedIds: ['c', 'b'],
    });
    expect(ranked.map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('drops pinned IDs that are not present in the input', () => {
    const rows: UserActionTrackerRow[] = [row('a'), row('b')];
    const ranked = rankActions(rows, {
      now: NOW,
      pinnedIds: ['missing', 'a'],
    });
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('respects the topN cap', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(`a${i}`, { frequency: 10 + i }),
    );
    expect(rankActions(rows, { now: NOW, topN: 3 })).toHaveLength(3);
  });

  it('returns an empty list when given no rows', () => {
    expect(rankActions([], { now: NOW })).toEqual([]);
  });

  it('normalises confidence to [0, 1] with the top entry at 1', () => {
    const rows: UserActionTrackerRow[] = [
      row('top', { frequency: 100 }),
      row('mid', { frequency: 10 }),
      row('low', { frequency: 2 }),
    ];
    const ranked = rankActions(rows, { now: NOW });
    expect(ranked[0]?.confidence).toBeCloseTo(1, 5);
    expect(ranked[1]?.confidence).toBeLessThan(1);
    expect(ranked[1]?.confidence).toBeGreaterThan(0);
  });

  it('gives pinned items confidence 1 regardless of score', () => {
    const rows: UserActionTrackerRow[] = [
      row('hot', { frequency: 1000 }),
      row('cold', { frequency: 1 }),
    ];
    const ranked = rankActions(rows, {
      now: NOW,
      pinnedIds: ['cold'],
    });
    expect(ranked[0]?.id).toBe('cold');
    expect(ranked[0]?.confidence).toBe(1);
  });

  it('deduplicates rows that share an ID (first-write-wins)', () => {
    const rows: UserActionTrackerRow[] = [
      row('dup', { frequency: 10, label: 'first' }),
      row('dup', { frequency: 99, label: 'second' }),
    ];
    const ranked = rankActions(rows, { now: NOW });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.label).toBe('first');
  });
});
