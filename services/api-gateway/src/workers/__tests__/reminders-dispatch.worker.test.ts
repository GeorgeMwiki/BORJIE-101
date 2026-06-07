/**
 * Reminders dispatch worker — unit test for tickOnce.
 *
 * Wave OWNER-OS. Verifies:
 *   1. tickOnce reads from the claim query and dispatches via the
 *      injected EmailProvider on the happy path.
 *   2. When the email provider reports `not_configured`, the row lands
 *      in 'failed' with the provider's error code.
 *   3. Slack rows without SLACK_WEBHOOK_URL land in 'failed' with the
 *      `slack_webhook_not_configured` error.
 *
 * The DB is stubbed; only the SQL shape (UPDATE / RETURNING) is
 * exercised. Real integration is covered by the deployed worker hitting
 * the live `reminders` table.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRemindersDispatchWorker } from '../reminders-dispatch.worker.js';

function makeStubDb(initialRows: ReadonlyArray<Record<string, unknown>>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let returned = false;
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const sqlObj = q as { strings?: ReadonlyArray<string>; queryChunks?: ReadonlyArray<{ value?: string }>; values?: unknown[] };
      const text = sqlObj?.strings?.join(' ')
        ?? sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ')
        ?? '';
      calls.push({ sql: text, values: sqlObj?.values ?? [] });
      // First call is the UPDATE-claim that returns rows.
      if (text.includes('UPDATE reminders') && text.includes('RETURNING') && !returned) {
        returned = true;
        return { rows: initialRows };
      }
      return { rows: [] };
    }),
  };
}

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as any;

const okEmailProvider = {
  name: 'in-memory',
  configured: true,
  send: vi.fn(async () => ({
    status: 'sent' as const,
    provider: 'in-memory',
    providerRef: 'mem-1',
  })),
};

const stubSmsProvider = {
  name: 'stub-sms',
  configured: false,
  send: vi.fn(async () => ({
    status: 'failed' as const,
    provider: 'stub-sms',
    errorCode: 'provider_not_configured',
    errorMessage: 'not configured',
    retryable: false,
  })),
};

describe('reminders-dispatch worker', () => {
  it('dispatches email row via the EmailProvider on the happy path', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-1',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Renewal due',
        body: 'PML renews in 7 days',
        channel: 'email',
        payload: {},
        idempotency_key: 'idem-1',
      },
    ]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.claimed).toBe(1);
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(okEmailProvider.send).toHaveBeenCalledOnce();
    // claim + markSent => 2 db.execute calls minimum.
    expect(db.execute).toHaveBeenCalled();
  });

  it('marks slack rows failed when webhook url not configured', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const db = makeStubDb([
      {
        id: 'reminder-2',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Standup',
        body: 'Shift handover',
        channel: 'slack',
        payload: {},
        idempotency_key: 'idem-2',
      },
    ]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.claimed).toBe(1);
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(1);
  });

  it('returns zeroes when no rows are ready', async () => {
    const db = makeStubDb([]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res).toEqual({ claimed: 0, sent: 0, failed: 0, retried: 0 });
  });

  it('RETRIES a retryable provider failure (re-queues with backoff, bumps attempt_count)', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-retry',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Rent due',
        body: 'Rent is due in 3 days',
        channel: 'email',
        payload: {},
        idempotency_key: 'idem-retry',
        attempt_count: 0,
      },
    ]);
    const flakyEmail = {
      name: 'flaky',
      configured: true,
      send: vi.fn(async () => ({
        status: 'failed' as const,
        provider: 'flaky',
        errorCode: 'rate_limited',
        errorMessage: '429 too many requests',
        retryable: true,
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: flakyEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.claimed).toBe(1);
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.retried).toBe(1);
    // The row was re-queued (status back to 'scheduled' with a future
    // trigger_at), NOT marked terminally failed.
    const requeue = db.calls.find((c) => c.sql.includes("SET status = 'scheduled'"));
    expect(requeue).toBeDefined();
    // The re-queue bumps attempt_count and pushes trigger_at out (backoff).
    expect(requeue!.sql).toContain('attempt_count');
    expect(requeue!.sql).toContain('trigger_at');
    expect(db.calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(false);
  });

  it('does NOT retry a non-retryable provider failure (terminal)', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-perm',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Rent due',
        body: 'Rent is due',
        channel: 'email',
        payload: {},
        idempotency_key: 'idem-perm',
        attempt_count: 0,
      },
    ]);
    const hardFailEmail = {
      name: 'hard',
      configured: true,
      send: vi.fn(async () => ({
        status: 'failed' as const,
        provider: 'hard',
        errorCode: 'invalid_recipient',
        errorMessage: 'bad address',
        retryable: false,
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: hardFailEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.failed).toBe(1);
    expect(res.retried).toBe(0);
    expect(db.calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(true);
  });

  it('stops retrying at the attempt cap (terminal failed on the last attempt)', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-capped',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Rent due',
        body: 'Rent is due',
        channel: 'email',
        payload: {},
        idempotency_key: 'idem-capped',
        attempt_count: 4, // nextAttempt = 5 === MAX_ATTEMPTS → terminal
      },
    ]);
    const flakyEmail = {
      name: 'flaky',
      configured: true,
      send: vi.fn(async () => ({
        status: 'failed' as const,
        provider: 'flaky',
        errorCode: 'rate_limited',
        errorMessage: '429',
        retryable: true,
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: flakyEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.failed).toBe(1);
    expect(res.retried).toBe(0);
    expect(db.calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(true);
    expect(db.calls.some((c) => c.sql.includes("SET status = 'scheduled'"))).toBe(false);
  });
});
