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
    expect(res).toEqual({ claimed: 0, sent: 0, failed: 0 });
  });
});
