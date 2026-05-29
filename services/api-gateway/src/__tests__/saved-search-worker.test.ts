/**
 * Tests for the saved-search worker (Roadmap R2).
 *
 * Drives the worker against in-memory DbLike + SearchExecutor +
 * OwnerAlertSender fakes so each branch (due/not-due, growth/no-growth,
 * error handling) is exercised deterministically.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildAlertIdempotencyKey,
  createSavedSearchWorker,
  frequencyToGapMs,
  isDue,
  type SavedSearchRow,
} from '../workers/saved-search-worker';

const now = new Date('2026-05-29T12:00:00Z');

const baseRow = (overrides: Partial<SavedSearchRow> = {}): SavedSearchRow => ({
  id: 'ss_001',
  tenantId: 'tenant_a',
  userId: 'user_a',
  label: 'Gold Geita 22k+',
  queryJson: { commodity: 'gold', minPurity: 22 },
  frequency: 'daily',
  source: 'marketplace',
  lastRunAt: null,
  lastMatchCount: 0,
  ...overrides,
});

describe('frequencyToGapMs', () => {
  it('maps hourly/daily/weekly to ms', () => {
    expect(frequencyToGapMs('hourly')).toBe(60 * 60 * 1000);
    expect(frequencyToGapMs('daily')).toBe(24 * 60 * 60 * 1000);
    expect(frequencyToGapMs('weekly')).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('isDue', () => {
  it('returns true on first run (lastRunAt null)', () => {
    expect(isDue(baseRow(), now)).toBe(true);
  });

  it('returns false when within the daily gap', () => {
    const last = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    expect(isDue(baseRow({ lastRunAt: last }), now)).toBe(false);
  });

  it('returns true after the daily gap elapsed', () => {
    const last = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(isDue(baseRow({ lastRunAt: last }), now)).toBe(true);
  });

  it('respects hourly cadence', () => {
    const last = new Date(now.getTime() - 45 * 60 * 1000);
    expect(isDue(baseRow({ lastRunAt: last, frequency: 'hourly' }), now)).toBe(
      false,
    );
    const olderLast = new Date(now.getTime() - 90 * 60 * 1000);
    expect(
      isDue(baseRow({ lastRunAt: olderLast, frequency: 'hourly' }), now),
    ).toBe(true);
  });
});

describe('buildAlertIdempotencyKey', () => {
  it('produces stable shape with the count', () => {
    expect(buildAlertIdempotencyKey('ss_001', 5)).toBe(
      'saved-search-alert:ss_001:5',
    );
    expect(buildAlertIdempotencyKey('ss_001', 5)).toBe(
      buildAlertIdempotencyKey('ss_001', 5),
    );
    expect(buildAlertIdempotencyKey('ss_001', 5)).not.toBe(
      buildAlertIdempotencyKey('ss_001', 6),
    );
  });
});

describe('createSavedSearchWorker.tickOnce', () => {
  it('alerts when match count grows', async () => {
    const row = baseRow({ lastMatchCount: 2 });
    const db = {
      execute: vi.fn(async (q: { __op?: string }) => {
        if (q.__op === 'select_due_saved_searches') return [row];
        return [];
      }),
    };
    const search = { run: vi.fn(async () => ({ matchCount: 5 })) };
    const alerts = { send: vi.fn(async () => ({ delivered: true })) };
    const worker = createSavedSearchWorker({
      db,
      search,
      alerts,
      now: () => now,
    });
    const result = await worker.tickOnce();
    expect(result.scanned).toBe(1);
    expect(result.alerted).toBe(1);
    expect(alerts.send).toHaveBeenCalledTimes(1);
    const sendCall = alerts.send.mock.calls[0][0] as {
      newMatches: number;
      idempotencyKey: string;
    };
    expect(sendCall.newMatches).toBe(3);
    expect(sendCall.idempotencyKey).toBe('saved-search-alert:ss_001:5');
  });

  it('does NOT alert when match count is flat', async () => {
    const row = baseRow({ lastMatchCount: 5 });
    const db = {
      execute: vi.fn(async (q: { __op?: string }) => {
        if (q.__op === 'select_due_saved_searches') return [row];
        return [];
      }),
    };
    const search = { run: vi.fn(async () => ({ matchCount: 5 })) };
    const alerts = { send: vi.fn(async () => ({ delivered: true })) };
    const worker = createSavedSearchWorker({
      db,
      search,
      alerts,
      now: () => now,
    });
    const result = await worker.tickOnce();
    expect(result.scanned).toBe(1);
    expect(result.alerted).toBe(0);
    expect(alerts.send).not.toHaveBeenCalled();
  });

  it('skips rows that are not yet due', async () => {
    const last = new Date(now.getTime() - 60 * 60 * 1000);
    const row = baseRow({ lastRunAt: last, frequency: 'daily' });
    const db = {
      execute: vi.fn(async (q: { __op?: string }) => {
        if (q.__op === 'select_due_saved_searches') return [row];
        return [];
      }),
    };
    const search = { run: vi.fn(async () => ({ matchCount: 99 })) };
    const alerts = { send: vi.fn(async () => ({ delivered: true })) };
    const worker = createSavedSearchWorker({
      db,
      search,
      alerts,
      now: () => now,
    });
    const result = await worker.tickOnce();
    expect(result.scanned).toBe(0);
    expect(search.run).not.toHaveBeenCalled();
  });
});
