/**
 * Tests for the mining licence-expiry-alert cron (Slice A3).
 *
 * The cron is exercised end-to-end against an in-memory DbLike fake so each
 * window (60/30/7/1) fires only when a licence's expiry_date matches. We mock
 * the system clock with `options.now` so the suite is deterministic
 * regardless of when CI runs.
 *
 * Note: `withServiceRoleContext` detects the absence of `.transaction` on the
 * fake db and runs the callback directly against the stub (the stub enforces
 * no RLS), so these tests assert the SQL the cron issues without a real pool.
 */

import { describe, it, expect } from 'vitest';
import pino from 'pino';
import {
  classifyExpiryWindow,
  buildIdempotencyKey,
  createLicenceExpiryAlertCron,
  DEFAULT_LICENCE_EXPIRY_WINDOWS_DAYS,
  LICENCE_EXPIRY_CHANNEL,
  LICENCE_EXPIRY_TEMPLATE_KEY,
  fetchExpiringLicences,
  type LicenceExpiryAlertCronOptions,
} from '../licence-expiry-alert-cron';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('classifyExpiryWindow', () => {
  const now = new Date('2026-05-22T00:00:00Z');

  it.each([
    [60, 60],
    [30, 30],
    [7, 7],
    [1, 1],
  ])('matches exactly-%i-day window', (days, expected) => {
    const expiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    expect(
      classifyExpiryWindow(expiry, now, [...DEFAULT_LICENCE_EXPIRY_WINDOWS_DAYS]),
    ).toBe(expected);
  });

  it('returns null when not in any window', () => {
    const expiry = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    expect(classifyExpiryWindow(expiry, now, [60, 30, 7, 1])).toBeNull();
  });

  it('returns null for expiry dates already well past', () => {
    const expiry = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    expect(classifyExpiryWindow(expiry, now, [60, 30, 7, 1])).toBeNull();
  });

  it('buckets to calendar-days regardless of intra-day time', () => {
    const expiry = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000,
    );
    expect(classifyExpiryWindow(expiry, now, [60, 30, 7, 1])).toBe(30);
  });
});

describe('buildIdempotencyKey', () => {
  const exp = new Date('2026-07-15T00:00:00.000Z');
  it('produces a stable shape — same inputs same key', () => {
    const a = buildIdempotencyKey('lic_001', 30, exp);
    const b = buildIdempotencyKey('lic_001', 30, exp);
    expect(a).toBe(b);
    expect(a).toBe('licence-expiry::lic_001::30d::2026-07-15');
  });

  it('distinguishes licences', () => {
    expect(buildIdempotencyKey('lic_001', 30, exp)).not.toBe(
      buildIdempotencyKey('lic_002', 30, exp),
    );
  });

  it('distinguishes windows for the same licence', () => {
    expect(buildIdempotencyKey('lic_001', 30, exp)).not.toBe(
      buildIdempotencyKey('lic_001', 7, exp),
    );
  });

  it('re-alerts after renewal — a new expiry_date mints a fresh key', () => {
    const renewed = new Date('2027-07-15T00:00:00.000Z');
    expect(buildIdempotencyKey('lic_001', 30, exp)).not.toBe(
      buildIdempotencyKey('lic_001', 30, renewed),
    );
  });
});

// ---------------------------------------------------------------------------
// In-memory DbLike fake
// ---------------------------------------------------------------------------

interface QueryFake {
  pattern: RegExp;
  rows: Record<string, unknown>[] | ((sqlText: string) => Record<string, unknown>[]);
}

function sqlToText(query: unknown): string {
  const q = query as { queryChunks?: ReadonlyArray<unknown> };
  if (Array.isArray(q.queryChunks)) {
    return q.queryChunks
      .map((c) => {
        if (typeof c === 'string') return c;
        const cc = c as { value?: unknown; chunks?: ReadonlyArray<unknown> };
        if (Array.isArray(cc.value)) return cc.value.join('');
        if (Array.isArray(cc.chunks)) return sqlToText(c);
        return '?';
      })
      .join('');
  }
  return (
    (query as { sql?: string })?.sql ??
    (query as { strings?: string[] })?.strings?.join('?') ??
    String(query)
  );
}

function buildFakeDb(queries: QueryFake[]): {
  db: LicenceExpiryAlertCronOptions['db'];
  executedSql: string[];
} {
  const executedSql: string[] = [];
  const db = {
    async execute(query: unknown) {
      const text = sqlToText(query);
      executedSql.push(text);
      for (const q of queries) {
        if (q.pattern.test(text)) {
          const rows = typeof q.rows === 'function' ? q.rows(text) : q.rows;
          return { rows };
        }
      }
      return { rows: [] };
    },
  };
  // The fake intentionally has no `.transaction`, so withServiceRoleContext
  // runs the callback directly against it (its own documented test-double path).
  return { db: db as unknown as LicenceExpiryAlertCronOptions['db'], executedSql };
}

const now = new Date('2026-05-22T00:00:00Z');
const logger = pino({ level: 'silent' });

function licenceRow(
  overrides: Partial<{
    id: string;
    expiry_date: string;
    holder_email: string | null;
    tenant_email: string | null;
    holder_user_id: string | null;
    status: string;
  }> = {},
): Record<string, unknown> {
  return {
    id: 'lic_test_001',
    tenant_id: 'tnt_test',
    company_id: 'co_1',
    kind: 'PL',
    number: 'PL-001',
    mineral: 'gold',
    status: 'active',
    expiry_date: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    holder_user_id: 'usr_owner_1',
    holder_email: 'owner@example.com',
    tenant_email: 'tenant@example.com',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fetchExpiringLicences — recipient resolution
// ---------------------------------------------------------------------------

describe('fetchExpiringLicences', () => {
  it('resolves recipient from the holder email when present', async () => {
    const { db } = buildFakeDb([
      { pattern: /FROM licences l/, rows: [licenceRow()] },
    ]);
    const rows = await fetchExpiringLicences(db, now, [60, 30, 7, 1]);
    expect(rows).toHaveLength(1);
    expect(rows[0].recipientEmail).toBe('owner@example.com');
    expect(rows[0].windowDays).toBe(30);
  });

  it('falls back to the tenant primary email when holder has none', async () => {
    const { db } = buildFakeDb([
      {
        pattern: /FROM licences l/,
        rows: [licenceRow({ holder_email: null })],
      },
    ]);
    const rows = await fetchExpiringLicences(db, now, [60, 30, 7, 1]);
    expect(rows[0].recipientEmail).toBe('tenant@example.com');
  });

  it('drops licences outside any window', async () => {
    const { db } = buildFakeDb([
      {
        pattern: /FROM licences l/,
        rows: [
          licenceRow({
            id: 'lic_45',
            expiry_date: new Date(
              now.getTime() + 45 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          }),
        ],
      },
    ]);
    const rows = await fetchExpiringLicences(db, now, [60, 30, 7, 1]);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end tick
// ---------------------------------------------------------------------------

describe('createLicenceExpiryAlertCron — tickOnce', () => {
  it('enqueues exactly one pending row when one licence is inside a window', async () => {
    const { db, executedSql } = buildFakeDb([
      { pattern: /FROM licences l/, rows: [licenceRow()] },
      // isAlreadySent — no rows so we enqueue.
      { pattern: /FROM notification_dispatch_log/, rows: [] },
    ]);
    const cron = createLicenceExpiryAlertCron({
      db,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.byWindow).toEqual({ 30: 1 });

    const insert = executedSql.find((s) =>
      /INSERT INTO notification_dispatch_log/.test(s),
    );
    expect(insert).toBeDefined();
    expect(insert).toMatch(/ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/);
    // Channel + template are baked into the static SQL via params, but the
    // constants are asserted independently so a rename can't drift silently.
    expect(LICENCE_EXPIRY_CHANNEL).toBe('email');
    expect(LICENCE_EXPIRY_TEMPLATE_KEY).toBe('licence.expiry_warning');
  });

  it('skips licences already enqueued for that (licence, window)', async () => {
    const { db, executedSql } = buildFakeDb([
      { pattern: /FROM licences l/, rows: [licenceRow()] },
      // isAlreadySent — a row exists, so the licence is skipped.
      { pattern: /FROM notification_dispatch_log/, rows: [{ '?column?': 1 }] },
    ]);
    const cron = createLicenceExpiryAlertCron({
      db,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(result.skippedAlreadySent).toBe(1);
    expect(
      executedSql.some((s) => /INSERT INTO notification_dispatch_log/.test(s)),
    ).toBe(false);
  });

  it('marks failure when no recipient email can be resolved', async () => {
    const { db, executedSql } = buildFakeDb([
      {
        pattern: /FROM licences l/,
        rows: [licenceRow({ holder_email: null, tenant_email: null })],
      },
      { pattern: /FROM notification_dispatch_log/, rows: [] },
    ]);
    const cron = createLicenceExpiryAlertCron({
      db,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(1);
    expect(result.enqueued).toBe(0);
    expect(result.failed).toBe(1);
    expect(
      executedSql.some((s) => /INSERT INTO notification_dispatch_log/.test(s)),
    ).toBe(false);
  });

  it('classifies multiple licences across windows in a single tick', async () => {
    const { db } = buildFakeDb([
      {
        pattern: /FROM licences l/,
        rows: [
          licenceRow({ id: 'l_60', expiry_date: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString() }),
          licenceRow({ id: 'l_30', expiry_date: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() }),
          licenceRow({ id: 'l_7',  expiry_date: new Date(now.getTime() +  7 * 24 * 60 * 60 * 1000).toISOString() }),
          licenceRow({ id: 'l_1',  expiry_date: new Date(now.getTime() +  1 * 24 * 60 * 60 * 1000).toISOString() }),
          licenceRow({ id: 'l_45', expiry_date: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString() }), // unmatched
        ],
      },
      { pattern: /FROM notification_dispatch_log/, rows: [] },
    ]);
    const cron = createLicenceExpiryAlertCron({
      db,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(4);
    expect(result.enqueued).toBe(4);
    expect(result.byWindow).toEqual({ 1: 1, 7: 1, 30: 1, 60: 1 });
  });

  it('handles an empty licence scan gracefully', async () => {
    const { db } = buildFakeDb([{ pattern: /FROM licences l/, rows: [] }]);
    const cron = createLicenceExpiryAlertCron({
      db,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(0);
    expect(result.enqueued).toBe(0);
  });

  it('does not throw out of tickOnce on a DB failure', async () => {
    const db = {
      async execute() {
        throw new Error('simulated DB failure');
      },
    } as unknown as LicenceExpiryAlertCronOptions['db'];
    const cron = createLicenceExpiryAlertCron({
      db,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(0);
    expect(result.enqueued).toBe(0);
  });
});

describe('start/stop lifecycle', () => {
  it('is a no-op when disabled', () => {
    const { db } = buildFakeDb([]);
    const cron = createLicenceExpiryAlertCron({ db, logger, enabled: false });
    expect(() => cron.start()).not.toThrow();
    expect(() => cron.stop()).not.toThrow();
  });

  it('is idempotent on double-start + double-stop', () => {
    const { db } = buildFakeDb([{ pattern: /FROM licences l/, rows: [] }]);
    const cron = createLicenceExpiryAlertCron({
      db,
      logger,
      enabled: true,
      intervalMs: 60_000,
    });
    cron.start();
    cron.start(); // no throw
    cron.stop();
    cron.stop(); // no throw
  });
});
