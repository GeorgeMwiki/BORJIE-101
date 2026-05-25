/**
 * Tests for the Wave-15 lease-expiry-alert cron.
 *
 * The supervisor is exercised end-to-end against an in-memory DbLike fake
 * so each window (60/30/7/1) fires only when a lease's end_date matches.
 *
 * We mock the system clock with `options.now` so the test is deterministic
 * regardless of when CI runs the suite.
 */

import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import {
  classifyExpiryWindow,
  buildIdempotencyKey,
  selectChannel,
  createLeaseExpiryAlertCron,
  DEFAULT_EXPIRY_WINDOWS_DAYS,
  type ExpiringLeaseRow,
  type NotificationSender,
} from '../workers/lease-expiry-alert-cron';

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
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    expect(classifyExpiryWindow(endDate, now, [...DEFAULT_EXPIRY_WINDOWS_DAYS])).toBe(expected);
  });

  it('returns null when not in any window', () => {
    const endDate = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    expect(classifyExpiryWindow(endDate, now, [60, 30, 7, 1])).toBeNull();
  });

  it('returns null for end dates already past', () => {
    const endDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    expect(classifyExpiryWindow(endDate, now, [60, 30, 7, 1])).toBeNull();
  });

  it('buckets to calendar-days regardless of intra-day time', () => {
    // end_date 6 hours after midnight on +30d still counts as 30-day.
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000);
    expect(classifyExpiryWindow(endDate, now, [60, 30, 7, 1])).toBe(30);
  });
});

describe('buildIdempotencyKey', () => {
  it('produces a stable shape — same inputs same key', () => {
    const a = buildIdempotencyKey('lease_001', 30);
    const b = buildIdempotencyKey('lease_001', 30);
    expect(a).toBe(b);
    expect(a).toBe('lease-expiry::lease_001::30d');
  });

  it('distinguishes leases', () => {
    expect(buildIdempotencyKey('lease_001', 30)).not.toBe(buildIdempotencyKey('lease_002', 30));
  });

  it('distinguishes windows for the same lease', () => {
    expect(buildIdempotencyKey('lease_001', 30)).not.toBe(buildIdempotencyKey('lease_001', 7));
  });
});

describe('selectChannel', () => {
  const baseLease: ExpiringLeaseRow = {
    id: 'l',
    tenantId: 't',
    leaseNumber: 'LN',
    propertyId: 'p',
    unitId: 'u',
    customerId: 'c',
    endDate: new Date(),
    rentAmount: 0,
    rentCurrency: 'TZS',
    customerEmail: null,
    customerPhone: null,
    customerFirstName: null,
    customerLastName: null,
    windowDays: 30,
  };

  it('prefers whatsapp when phone present', () => {
    expect(selectChannel({ ...baseLease, customerPhone: '+255' }, ['whatsapp', 'sms', 'email', 'in_app'])).toBe(
      'whatsapp',
    );
  });

  it('falls back to email when no phone', () => {
    expect(selectChannel({ ...baseLease, customerEmail: 'x@y' }, ['whatsapp', 'sms', 'email', 'in_app'])).toBe(
      'email',
    );
  });

  it('falls back to in_app when no contact info', () => {
    expect(selectChannel(baseLease, ['whatsapp', 'sms', 'email', 'in_app'])).toBe('in_app');
  });

  it('respects custom priority', () => {
    expect(selectChannel({ ...baseLease, customerEmail: 'x@y', customerPhone: '+255' }, ['email', 'sms', 'whatsapp', 'in_app'])).toBe(
      'email',
    );
  });
});

// ---------------------------------------------------------------------------
// End-to-end tick — fake DB + fake sender
// ---------------------------------------------------------------------------

interface QueryFake {
  /** Match a query by SQL substring; returns rows. */
  pattern: RegExp;
  rows: Record<string, unknown>[] | ((sqlText: string) => Record<string, unknown>[]);
}

function sqlToText(query: unknown): string {
  // Drizzle's `sql\`...\`` returns an SQL object with a `queryChunks` array
  // of mixed strings + Param objects. For test pattern-matching all we
  // need is the static text, so we join the StringChunk values and let
  // the params drop out (they'd serialise as `?` placeholders anyway).
  const q = query as { queryChunks?: ReadonlyArray<unknown> };
  if (Array.isArray(q.queryChunks)) {
    return q.queryChunks
      .map((c) => {
        if (typeof c === 'string') return c;
        const cc = c as { value?: unknown; chunks?: ReadonlyArray<unknown> };
        // StringChunk has a `value` (string[]) we can join.
        if (Array.isArray(cc.value)) return cc.value.join('');
        // Nested SQL objects — recurse via toString fallback below.
        if (Array.isArray(cc.chunks)) return sqlToText(c);
        return '?'; // Param placeholder
      })
      .join('');
  }
  // Fallbacks for postgres.js tag or raw strings.
  return (
    (query as { sql?: string })?.sql ??
    (query as { strings?: string[] })?.strings?.join('?') ??
    String(query)
  );
}

function buildFakeDb(queries: QueryFake[]): {
  db: { execute(query: unknown): Promise<{ rows: Record<string, unknown>[] }> };
  executedSql: string[];
} {
  const executedSql: string[] = [];
  return {
    executedSql,
    db: {
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
    },
  };
}

describe('createLeaseExpiryAlertCron — tickOnce', () => {
  const now = new Date('2026-05-22T00:00:00Z');
  const logger = pino({ level: 'silent' });

  function leaseRow(overrides: Partial<{
    id: string;
    end_date: string;
    customer_email: string | null;
    customer_phone: string | null;
  }> = {}) {
    return {
      id: 'lease_test_001',
      tenant_id: 'tnt_test',
      lease_number: 'LN-001',
      property_id: 'prop_1',
      unit_id: 'unit_1',
      customer_id: 'cust_1',
      end_date: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      rent_amount: 500_000_00,
      rent_currency: 'TZS',
      customer_email: 'lessee@example.com',
      customer_phone: '+255700000000',
      customer_first_name: 'Test',
      customer_last_name: 'User',
      ...overrides,
    };
  }

  it('dispatches exactly one notification when one lease falls inside a window', async () => {
    const { db, executedSql } = buildFakeDb([
      {
        // Lease scan query
        pattern: /FROM leases l/,
        rows: [leaseRow()],
      },
      {
        // isAlreadySent — returns no rows so we dispatch
        pattern: /FROM notification_dispatch_log/,
        rows: [],
      },
      // INSERT + UPDATE queries silently return empty rows
    ]);
    const sendCalls: unknown[] = [];
    const sender: NotificationSender = {
      async send(args) {
        sendCalls.push(args);
        return { delivered: true, providerMessageId: 'msg-1' };
      },
    };
    const cron = createLeaseExpiryAlertCron({
      db,
      sender,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(0);
    expect(sendCalls).toHaveLength(1);
    expect((sendCalls[0] as { window: number }).window).toBe(30);
    // Sanity: the SQL executor saw the scan, the alreadySent check,
    // the INSERT, and the UPDATE.
    expect(executedSql.some((s) => /FROM leases l/.test(s))).toBe(true);
    expect(executedSql.some((s) => /INSERT INTO notification_dispatch_log/.test(s))).toBe(true);
    expect(executedSql.some((s) => /UPDATE notification_dispatch_log/.test(s))).toBe(true);
  });

  it('skips leases already sent for that (lease, window)', async () => {
    const { db } = buildFakeDb([
      {
        pattern: /FROM leases l/,
        rows: [leaseRow()],
      },
      {
        // isAlreadySent — returns a row so the lease is skipped
        pattern: /FROM notification_dispatch_log/,
        rows: [{ '?column?': 1 }],
      },
    ]);
    const sender: NotificationSender = {
      async send() {
        throw new Error('sender should not be called for already-sent lease');
      },
    };
    const cron = createLeaseExpiryAlertCron({
      db,
      sender,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(result.skippedAlreadySent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('marks failure when sender returns delivered=false', async () => {
    const { db } = buildFakeDb([
      { pattern: /FROM leases l/, rows: [leaseRow()] },
      { pattern: /FROM notification_dispatch_log/, rows: [] },
    ]);
    const sender: NotificationSender = {
      async send() {
        return { delivered: false, error: 'provider down' };
      },
    };
    const cron = createLeaseExpiryAlertCron({
      db,
      sender,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.dispatched).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('classifies multiple leases across windows in a single tick', async () => {
    const { db } = buildFakeDb([
      {
        pattern: /FROM leases l/,
        rows: [
          leaseRow({ id: 'l_60', end_date: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString() }),
          leaseRow({ id: 'l_30', end_date: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() }),
          leaseRow({ id: 'l_7',  end_date: new Date(now.getTime() +  7 * 24 * 60 * 60 * 1000).toISOString() }),
          leaseRow({ id: 'l_1',  end_date: new Date(now.getTime() +  1 * 24 * 60 * 60 * 1000).toISOString() }),
          leaseRow({ id: 'l_45', end_date: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString() }), // unmatched
        ],
      },
      { pattern: /FROM notification_dispatch_log/, rows: [] },
    ]);
    const sentWindows: number[] = [];
    const sender: NotificationSender = {
      async send(args) {
        sentWindows.push(args.window);
        return { delivered: true, providerMessageId: `m-${args.lease.id}` };
      },
    };
    const cron = createLeaseExpiryAlertCron({
      db,
      sender,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    // 4 of 5 leases match a window — the 45-day one drops out.
    expect(result.scanned).toBe(4);
    expect(result.dispatched).toBe(4);
    expect(sentWindows.sort((a, b) => a - b)).toEqual([1, 7, 30, 60]);
    expect(result.byWindow).toEqual({ 1: 1, 7: 1, 30: 1, 60: 1 });
  });

  it('handles empty lease scan gracefully', async () => {
    const { db } = buildFakeDb([{ pattern: /FROM leases l/, rows: [] }]);
    const sender: NotificationSender = {
      async send() {
        throw new Error('sender should not be called');
      },
    };
    const cron = createLeaseExpiryAlertCron({
      db,
      sender,
      logger,
      enabled: true,
      now: () => now,
    });
    const result = await cron.tickOnce();
    expect(result.scanned).toBe(0);
    expect(result.dispatched).toBe(0);
  });
});

describe('start/stop lifecycle', () => {
  const logger = pino({ level: 'silent' });

  it('is no-op when disabled', () => {
    const { db } = buildFakeDb([]);
    const sender: NotificationSender = {
      async send() {
        return { delivered: true };
      },
    };
    const cron = createLeaseExpiryAlertCron({
      db,
      sender,
      logger,
      enabled: false,
    });
    expect(() => cron.start()).not.toThrow();
    expect(() => cron.stop()).not.toThrow();
  });

  it('is idempotent on double-start + double-stop', () => {
    const { db } = buildFakeDb([{ pattern: /FROM leases l/, rows: [] }]);
    const sender: NotificationSender = {
      async send() {
        return { delivered: true };
      },
    };
    const cron = createLeaseExpiryAlertCron({
      db,
      sender,
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
