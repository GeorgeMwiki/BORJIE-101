/**
 * Tests for session-replay search + filter utilities. Pure-function
 * coverage; the React components delegate every filtering decision to
 * these helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  applyFacets,
  filterSessions,
  searchAndFilter,
  sessionDurationMs,
  DEFAULT_FACET_STATE,
  type RecentSessionLike,
} from '../search-filter-utils';

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function session(over: Partial<RecentSessionLike> = {}): RecentSessionLike {
  return {
    sessionId: 'sess-abc',
    userId: 'user@example.com',
    surface: 'admin-portal',
    firstCapturedAt: iso(NOW - 3 * MIN),
    lastCapturedAt: iso(NOW - MIN),
    chunkCount: 4,
    errorEventCount: 0,
    ...over,
  };
}

describe('filterSessions', () => {
  it('returns the list unchanged when the query is empty', () => {
    const list = [session(), session({ sessionId: 'sess-2' })];
    expect(filterSessions(list, '')).toBe(list);
    expect(filterSessions(list, '   ')).toBe(list);
  });

  it('matches against sessionId (case-insensitive substring)', () => {
    const list = [
      session({ sessionId: 'sess-alpha-1' }),
      session({ sessionId: 'sess-beta-2' }),
    ];
    expect(filterSessions(list, 'BETA')).toEqual([list[1]]);
  });

  it('matches against userId', () => {
    const list = [
      session({ userId: 'alice@example.com' }),
      session({ userId: 'bob@example.com' }),
    ];
    expect(filterSessions(list, 'alice')).toEqual([list[0]]);
  });

  it('matches against surface', () => {
    const list = [
      session({ surface: 'admin-portal' }),
      session({ surface: 'owner-portal' }),
    ];
    expect(filterSessions(list, 'owner')).toEqual([list[1]]);
  });

  it('matches against tenantName when present', () => {
    const list = [
      session({ tenantName: 'Acme Estates' }),
      session({ tenantName: 'Globex Realty' }),
    ];
    expect(filterSessions(list, 'globex')).toEqual([list[1]]);
  });

  it('returns empty list when nothing matches', () => {
    const list = [session({ sessionId: 'sess-x' })];
    expect(filterSessions(list, 'no-match')).toEqual([]);
  });

  it('survives an empty input list', () => {
    expect(filterSessions([], 'anything')).toEqual([]);
  });
});

describe('applyFacets — date', () => {
  it('returns the input unchanged when every facet is "all"', () => {
    const list = [session(), session({ sessionId: 'sess-2' })];
    expect(applyFacets(list, DEFAULT_FACET_STATE, NOW)).toBe(list);
  });

  it('keeps only sessions ≤ 1h old when date=1h', () => {
    const list = [
      session({ sessionId: 'fresh', lastCapturedAt: iso(NOW - 30 * MIN) }),
      session({ sessionId: 'old', lastCapturedAt: iso(NOW - 2 * HOUR) }),
    ];
    const out = applyFacets(
      list,
      { ...DEFAULT_FACET_STATE, date: '1h' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['fresh']);
  });

  it('keeps only sessions ≤ 7d old when date=7d', () => {
    const list = [
      session({ sessionId: 'recent', lastCapturedAt: iso(NOW - 3 * DAY) }),
      session({ sessionId: 'ancient', lastCapturedAt: iso(NOW - 14 * DAY) }),
    ];
    const out = applyFacets(
      list,
      { ...DEFAULT_FACET_STATE, date: '7d' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['recent']);
  });
});

describe('applyFacets — errors', () => {
  it('keeps only sessions with at least one error event when errors=with-errors', () => {
    const list = [
      session({ sessionId: 'clean', errorEventCount: 0 }),
      session({ sessionId: 'broken', errorEventCount: 3 }),
    ];
    const out = applyFacets(
      list,
      { ...DEFAULT_FACET_STATE, errors: 'with-errors' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['broken']);
  });

  it('keeps only error-free sessions when errors=no-errors', () => {
    const list = [
      session({ sessionId: 'clean', errorEventCount: 0 }),
      session({ sessionId: 'broken', errorEventCount: 3 }),
    ];
    const out = applyFacets(
      list,
      { ...DEFAULT_FACET_STATE, errors: 'no-errors' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['clean']);
  });
});

describe('applyFacets — duration', () => {
  it('buckets sessions by duration<1m', () => {
    const list = [
      session({
        sessionId: 'micro',
        firstCapturedAt: iso(NOW - 30_000),
        lastCapturedAt: iso(NOW),
      }),
      session({
        sessionId: 'long',
        firstCapturedAt: iso(NOW - 10 * MIN),
        lastCapturedAt: iso(NOW),
      }),
    ];
    const out = applyFacets(
      list,
      { ...DEFAULT_FACET_STATE, duration: 'under-1m' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['micro']);
  });

  it('buckets sessions by duration 1-5m', () => {
    const list = [
      session({
        sessionId: 'micro',
        firstCapturedAt: iso(NOW - 30_000),
        lastCapturedAt: iso(NOW),
      }),
      session({
        sessionId: 'mid',
        firstCapturedAt: iso(NOW - 3 * MIN),
        lastCapturedAt: iso(NOW),
      }),
      session({
        sessionId: 'long',
        firstCapturedAt: iso(NOW - 10 * MIN),
        lastCapturedAt: iso(NOW),
      }),
    ];
    const out = applyFacets(
      list,
      { ...DEFAULT_FACET_STATE, duration: '1-5m' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['mid']);
  });

  it('buckets sessions by duration >5m', () => {
    const list = [
      session({
        sessionId: 'mid',
        firstCapturedAt: iso(NOW - 3 * MIN),
        lastCapturedAt: iso(NOW),
      }),
      session({
        sessionId: 'long',
        firstCapturedAt: iso(NOW - 10 * MIN),
        lastCapturedAt: iso(NOW),
      }),
    ];
    const out = applyFacets(
      list,
      { ...DEFAULT_FACET_STATE, duration: 'over-5m' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['long']);
  });
});

describe('searchAndFilter', () => {
  it('composes free-text + facets', () => {
    const list = [
      session({
        sessionId: 'sess-alpha',
        errorEventCount: 2,
        firstCapturedAt: iso(NOW - 10 * MIN),
        lastCapturedAt: iso(NOW),
      }),
      session({
        sessionId: 'sess-beta',
        errorEventCount: 0,
        firstCapturedAt: iso(NOW - 10 * MIN),
        lastCapturedAt: iso(NOW),
      }),
      session({
        sessionId: 'other-alpha',
        errorEventCount: 5,
        firstCapturedAt: iso(NOW - 10 * MIN),
        lastCapturedAt: iso(NOW),
      }),
    ];
    const out = searchAndFilter(
      list,
      'sess',
      { ...DEFAULT_FACET_STATE, errors: 'with-errors' },
      NOW,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['sess-alpha']);
  });
});

describe('sessionDurationMs', () => {
  it('returns the (last − first) delta in ms', () => {
    const s = session({
      firstCapturedAt: iso(NOW - 4 * MIN),
      lastCapturedAt: iso(NOW),
    });
    expect(sessionDurationMs(s)).toBe(4 * MIN);
  });

  it('returns 0 when first > last', () => {
    const s = session({
      firstCapturedAt: iso(NOW),
      lastCapturedAt: iso(NOW - MIN),
    });
    expect(sessionDurationMs(s)).toBe(0);
  });

  it('returns 0 when timestamps are malformed', () => {
    const s = session({
      firstCapturedAt: 'not-a-date',
      lastCapturedAt: 'also-not',
    });
    expect(sessionDurationMs(s)).toBe(0);
  });
});
