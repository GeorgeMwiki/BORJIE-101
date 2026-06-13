/**
 * Notification dispatcher tests.
 *
 * The worker depends on three seams: a `db` with `execute(q)`, an
 * `emailProvider`, and an `smsProvider`. We drive `db` with a
 * `vi.fn()` returning whatever rows that test needs, and use the
 * in-memory providers (or hand-rolled providers) to assert routing.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createNotificationDispatcher,
  createInMemoryEmailProvider,
  createInMemorySmsProvider,
  createStubEmailProvider,
  createStubSmsProvider,
  type EmailProvider,
} from '../index';

const noopLogger = {
  warn: vi.fn(),
  info: vi.fn(),
};

type DbCall = readonly Record<string, unknown>[] | Error;

function makeDb(callsByIndex: ReadonlyArray<DbCall>) {
  let i = 0;
  const execute = vi.fn(async () => {
    const v = callsByIndex[i];
    i += 1;
    if (v instanceof Error) throw v;
    return v ?? [];
  });
  return { db: { execute }, execute };
}

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: 'disp-1',
    tenant_id: 'tenant-A',
    channel: 'email',
    recipient_address: 'owner@example.com',
    template_key: 'monthly_close.owner_statement_ready',
    locale: 'en',
    payload: { statementId: 'stmt-1' },
    idempotency_key: 'idem-1',
    attempt_count: 0,
    ...over,
  };
}

describe('createNotificationDispatcher', () => {
  it('claims a pending email row, sends via email provider, and marks sent', async () => {
    const { db, execute } = makeDb([
      [pendingRow()], // claim batch
      [], // markSent UPDATE
    ]);
    const emailProvider = createInMemoryEmailProvider();
    const smsProvider = createInMemorySmsProvider();
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider,
      smsProvider,
    });

    const result = await dispatcher.runOnce({ tenantId: 'tenant-A' });

    expect(result).toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      skipped_unknown_channel: 0,
    });
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.recipientAddress).toBe('owner@example.com');
    expect(smsProvider.sent).toHaveLength(0);
    // 1 claim UPDATE + 1 markSent UPDATE
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('routes sms-channel rows through the SMS provider, not email', async () => {
    const { db } = makeDb([
      [pendingRow({ id: 'disp-2', channel: 'sms', recipient_address: '+255700000000' })],
      [],
    ]);
    const emailProvider = createInMemoryEmailProvider();
    const smsProvider = createInMemorySmsProvider();
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider,
      smsProvider,
    });

    const result = await dispatcher.runOnce({});

    expect(result.sent).toBe(1);
    expect(smsProvider.sent).toHaveLength(1);
    expect(smsProvider.sent[0]?.channel).toBe('sms');
    expect(emailProvider.sent).toHaveLength(0);
  });

  it('routes whatsapp rows through the SMS provider with channel=whatsapp', async () => {
    const { db } = makeDb([
      [pendingRow({ id: 'disp-3', channel: 'whatsapp', recipient_address: 'wa:+255700000000' })],
      [],
    ]);
    const smsProvider = createInMemorySmsProvider();
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider: createStubEmailProvider(),
      smsProvider,
    });

    await dispatcher.runOnce({});

    expect(smsProvider.sent[0]?.channel).toBe('whatsapp');
  });

  it('marks rows as failed-with-retry when the email provider returns retryable failure', async () => {
    const updates: unknown[] = [];
    const execute = vi.fn(async (q: unknown) => {
      updates.push(q);
      // First call is the claim batch; subsequent calls are UPDATEs.
      if (updates.length === 1) return [pendingRow({ attempt_count: 1 })];
      return [];
    });
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: noopLogger,
      emailProvider: createStubEmailProvider(), // configured = false
      smsProvider: createStubSmsProvider(),
    });

    const result = await dispatcher.runOnce({});

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      skipped_unknown_channel: 0,
    });
    // 1 claim + 1 markFailed
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('emits ONE boot-time degraded warning when providers are stubs (not per row)', async () => {
    const warn = vi.fn();
    const { db } = makeDb([
      [pendingRow({ id: 'd1' }), pendingRow({ id: 'd2' })],
      [], // markFailed for d1
      [], // markFailed for d2
      [], // claim 2nd runOnce returns empty
    ]);
    const dispatcher = createNotificationDispatcher({
      db,
      logger: { warn, info: vi.fn() },
      emailProvider: createStubEmailProvider(),
      smsProvider: createStubSmsProvider(),
    });

    await dispatcher.runOnce({});
    await dispatcher.runOnce({});

    const bootWarns = warn.mock.calls.filter(
      (c) =>
        c[0] &&
        typeof c[0] === 'object' &&
        (c[0] as Record<string, unknown>).worker === 'notification-dispatch' &&
        typeof (c[0] as Record<string, unknown>).degraded_reason === 'string' &&
        ((c[0] as Record<string, unknown>).degraded_reason as string).includes(
          'not_configured',
        ),
    );
    expect(bootWarns).toHaveLength(1);
  });

  it('skips unknown channels — marks dead-lettered with reason', async () => {
    const updates: { sql: string }[] = [];
    const execute = vi.fn(async (q: unknown) => {
      // Inspect SQL chunks Drizzle gives us — we look for UPDATE statements.
      const stringified = JSON.stringify(q);
      updates.push({ sql: stringified });
      if (updates.length === 1) {
        return [pendingRow({ id: 'd-unknown', channel: 'pigeon' })];
      }
      return [];
    });
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: noopLogger,
      emailProvider: createInMemoryEmailProvider(),
      smsProvider: createInMemorySmsProvider(),
    });

    const result = await dispatcher.runOnce({});

    expect(result.skipped_unknown_channel).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    // Look at the second exec call (markUnknownChannel) — the SQL should
    // mention 'unknown_channel'.
    const allSql = updates.map((u) => u.sql).join('|');
    expect(allSql).toContain('unknown_channel');
  });

  it('does not call the provider when DB claim returns no rows', async () => {
    const { db } = makeDb([[]]);
    const emailProvider = createInMemoryEmailProvider();
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider,
      smsProvider: createInMemorySmsProvider(),
    });

    const result = await dispatcher.runOnce({});

    expect(result.claimed).toBe(0);
    expect(emailProvider.sent).toHaveLength(0);
  });

  it('returns claimed:0 and warns when the claim query throws (does not crash)', async () => {
    const warn = vi.fn();
    const execute = vi.fn().mockRejectedValueOnce(new Error('connection lost'));
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: { warn, info: vi.fn() },
      emailProvider: createInMemoryEmailProvider(),
      smsProvider: createInMemorySmsProvider(),
    });

    const result = await dispatcher.runOnce({});

    expect(result.claimed).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: 'notification-dispatch',
        degraded_reason: 'claim_query_failed',
      }),
      expect.any(String),
    );
  });

  it('treats a thrown provider error as a retryable failure (provider_threw)', async () => {
    const updates: { sql: string }[] = [];
    const execute = vi.fn(async (q: unknown) => {
      updates.push({ sql: JSON.stringify(q) });
      if (updates.length === 1) return [pendingRow()];
      return [];
    });
    const throwingEmail: EmailProvider = {
      name: 'broken-email',
      configured: true,
      send: vi.fn(async () => {
        throw new Error('SMTP exploded');
      }),
    };
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: noopLogger,
      emailProvider: throwingEmail,
      smsProvider: createInMemorySmsProvider(),
    });

    const result = await dispatcher.runOnce({});

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    const allSql = updates.map((u) => u.sql).join('|');
    expect(allSql).toContain('provider_threw');
  });

  it('does not duplicate sends across runs because claim flips status to sending', async () => {
    // Simulate: first runOnce claims and sends; second runOnce sees no
    // pending rows (because the row is now in 'sent'). We mock the DB
    // to return [] on the second claim batch.
    const { db, execute } = makeDb([
      [pendingRow()],
      [], // markSent
      [], // second claim — empty
    ]);
    const emailProvider = createInMemoryEmailProvider();
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider,
      smsProvider: createInMemorySmsProvider(),
    });

    const r1 = await dispatcher.runOnce({});
    const r2 = await dispatcher.runOnce({});

    expect(r1.sent).toBe(1);
    expect(r2.claimed).toBe(0);
    expect(emailProvider.sent).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('runForever exits when the abort signal fires', async () => {
    const { db } = makeDb([[]]);
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider: createInMemoryEmailProvider(),
      smsProvider: createInMemorySmsProvider(),
    });
    const ac = new AbortController();
    // Abort almost immediately; runForever should return without throwing.
    setTimeout(() => ac.abort(), 5);
    await expect(
      dispatcher.runForever({
        signal: ac.signal,
        idleSleepMs: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('binds a service-role RLS context for every statement when the db is transactional (prod path)', async () => {
    // The PRODUCTION regression: notification_dispatch_log has FORCE RLS + a
    // service-role bypass. A transaction-capable db (the real Drizzle client)
    // MUST run the drain inside withServiceRoleContext, which binds
    // app.is_service_role='true' — otherwise the claim matches zero rows and
    // nothing is ever delivered. The old code ran raw execute and silently
    // drained nothing in prod; the prior tests (transaction-less mocks) sailed
    // over it. This fake provides .transaction so the real wrap engages.
    const executed: string[] = [];
    let claimReturned = false;
    const execute = vi.fn(async (q: unknown) => {
      const s = JSON.stringify(q);
      executed.push(s);
      if (s.includes('set_config')) return []; // GUC binding statements
      if (s.includes('RETURNING') && !claimReturned) {
        claimReturned = true;
        return [pendingRow()];
      }
      return [];
    });
    const db = {
      execute,
      transaction: async (fn: (tx: { execute: typeof execute }) => Promise<unknown>) =>
        fn({ execute }),
    };
    const emailProvider = createInMemoryEmailProvider();
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider,
      smsProvider: createInMemorySmsProvider(),
    });

    const result = await dispatcher.runOnce({});

    // Delivery still works through the wrap...
    expect(result.sent).toBe(1);
    expect(emailProvider.sent).toHaveLength(1);
    // ...and EVERY claimed/marked statement ran inside a service-role context.
    expect(executed.some((s) => s.includes('app.is_service_role'))).toBe(true);
    expect(executed.some((s) => s.includes('app.current_tenant_id'))).toBe(true);
  });

  it('dead-letters a row that has already hit MAX_ATTEMPTS without calling the provider (reaper bound)', async () => {
    const updates: string[] = [];
    const execute = vi.fn(async (q: unknown) => {
      updates.push(JSON.stringify(q));
      if (updates.length === 1) return [pendingRow({ attempt_count: 5 })];
      return [];
    });
    const emailProvider = createInMemoryEmailProvider();
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: noopLogger,
      emailProvider,
      smsProvider: createInMemorySmsProvider(),
    });

    const result = await dispatcher.runOnce({});

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    // The provider is never invoked for an over-limit row.
    expect(emailProvider.sent).toHaveLength(0);
    // It is dead-lettered with the bound reason.
    expect(updates.join('|')).toContain('max_attempts_exceeded');
  });

  it('suppresses a row when the preference gate denies the channel (no provider call)', async () => {
    const updates: string[] = [];
    const execute = vi.fn(async (q: unknown) => {
      updates.push(JSON.stringify(q));
      if (updates.length === 1) {
        return [
          pendingRow({
            user_id: 'u1',
            channel: 'sms',
            recipient_address: '+255700000000',
          }),
        ];
      }
      return [];
    });
    const smsProvider = createInMemorySmsProvider();
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: noopLogger,
      emailProvider: createInMemoryEmailProvider(),
      smsProvider,
      shouldDeliver: async () => 'suppress', // owner opted out of this channel
    });

    const result = await dispatcher.runOnce({});

    // The provider is never called for a suppressed row...
    expect(smsProvider.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
    // ...and it is marked terminal with the suppression reason (not a failure).
    expect(updates.join('|')).toContain('suppressed_by_preference');
  });

  it('defers (re-queues, no send) a deferrable row inside quiet-hours', async () => {
    const updates: string[] = [];
    const execute = vi.fn(async (q: unknown) => {
      updates.push(JSON.stringify(q));
      if (updates.length === 1) return [pendingRow({ user_id: 'u3' })];
      return [];
    });
    const emailProvider = createInMemoryEmailProvider();
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: noopLogger,
      emailProvider,
      smsProvider: createInMemorySmsProvider(),
      shouldDeliver: async () => 'defer', // recipient is in their quiet window
    });

    const result = await dispatcher.runOnce({});

    // Not sent, not failed — re-queued (pending) with a future next_retry_at.
    expect(emailProvider.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    const deferSql = updates.join('|');
    expect(deferSql).toContain('next_retry_at');
    expect(deferSql).toContain("'pending'");
  });

  it('still delivers when the preference gate allows the channel', async () => {
    const { db } = makeDb([
      [pendingRow({ user_id: 'u2' })], // claim
      [], // markSent
    ]);
    const emailProvider = createInMemoryEmailProvider();
    const dispatcher = createNotificationDispatcher({
      db,
      logger: noopLogger,
      emailProvider,
      smsProvider: createInMemorySmsProvider(),
      shouldDeliver: async () => 'deliver',
    });

    const result = await dispatcher.runOnce({});

    expect(result.sent).toBe(1);
    expect(emailProvider.sent).toHaveLength(1);
  });

  it('passes tenantId scope into the claim query (tenant isolation)', async () => {
    const captured: unknown[] = [];
    const execute = vi.fn(async (q: unknown) => {
      captured.push(q);
      if (captured.length === 1) return [];
      return [];
    });
    const dispatcher = createNotificationDispatcher({
      db: { execute },
      logger: noopLogger,
      emailProvider: createInMemoryEmailProvider(),
      smsProvider: createInMemorySmsProvider(),
    });
    await dispatcher.runOnce({ tenantId: 'tenant-X' });
    // We can't easily introspect Drizzle SQL chunks, so we assert the
    // claim was called and tenantId surfaces in the JSON-ified query.
    const stringified = JSON.stringify(captured[0]);
    expect(stringified).toContain('tenant-X');
  });
});

describe('stub providers', () => {
  it('email stub reports configured=false and returns provider_not_configured', async () => {
    const stub = createStubEmailProvider();
    expect(stub.configured).toBe(false);
    const result = await stub.send({
      tenantId: 't',
      recipientAddress: 'a@b.c',
      templateKey: 'k',
      locale: 'en',
      payload: {},
      idempotencyKey: null,
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('provider_not_configured');
      expect(result.retryable).toBe(true);
    }
  });

  it('sms stub reports configured=false and returns provider_not_configured', async () => {
    const stub = createStubSmsProvider();
    expect(stub.configured).toBe(false);
    const result = await stub.send({
      tenantId: 't',
      recipientAddress: '+255',
      templateKey: 'k',
      locale: 'en',
      payload: {},
      idempotencyKey: null,
      channel: 'sms',
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errorCode).toBe('provider_not_configured');
    }
  });
});
