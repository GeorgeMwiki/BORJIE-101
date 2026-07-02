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
import { safeHttpFetch } from '@borjie/enterprise-hardening';
import { createRemindersDispatchWorker } from '../reminders-dispatch.worker.js';
import { isWithinQuietHours } from '../reminders-quiet-hours.js';

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

  it('dispatches email in the project-default locale (en) when no localeForOwner resolver is wired', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-loc-default',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Renewal due',
        body: 'PML renews in 7 days',
        channel: 'email',
        payload: {},
        idempotency_key: 'idem-loc-default',
      },
    ]);
    const localeSpyEmail = {
      name: 'in-memory',
      configured: true,
      send: vi.fn(async () => ({
        status: 'sent' as const,
        provider: 'in-memory',
        providerRef: 'mem-loc-1',
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: localeSpyEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      // No localeForOwner → honest-degrade to the default locale.
      enabled: true,
    });
    await w.tickOnce();
    expect(localeSpyEmail.send).toHaveBeenCalledOnce();
    expect(localeSpyEmail.send.mock.calls[0][0].locale).toBe('en');
  });

  it('dispatches email + SMS in the recipient locale resolved by localeForOwner (sw owner → sw)', async () => {
    const dbEmail = makeStubDb([
      {
        id: 'reminder-loc-sw',
        tenant_id: 't-1',
        owner_id: 'u-sw',
        title: 'Ukumbusho',
        body: 'Leseni inaisha',
        channel: 'email',
        payload: {},
        idempotency_key: 'idem-loc-sw-email',
      },
    ]);
    const swEmail = {
      name: 'in-memory',
      configured: true,
      send: vi.fn(async () => ({
        status: 'sent' as const,
        provider: 'in-memory',
        providerRef: 'mem-sw-1',
      })),
    };
    const wEmail = createRemindersDispatchWorker({
      db: dbEmail,
      logger: stubLogger,
      emailProvider: swEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      localeForOwner: async () => 'sw',
      enabled: true,
    });
    await wEmail.tickOnce();
    expect(swEmail.send).toHaveBeenCalledOnce();
    expect(swEmail.send.mock.calls[0][0].locale).toBe('sw');

    const dbSms = makeStubDb([
      {
        id: 'reminder-loc-sw-sms',
        tenant_id: 't-1',
        owner_id: 'u-sw',
        title: 'Ukumbusho',
        body: 'Leseni inaisha',
        channel: 'sms',
        payload: {},
        idempotency_key: 'idem-loc-sw-sms',
      },
    ]);
    const swSms = {
      name: 'sms-ok',
      configured: true,
      send: vi.fn(async () => ({
        status: 'sent' as const,
        provider: 'sms-ok',
        providerRef: 'sms-sw-1',
      })),
    };
    const wSms = createRemindersDispatchWorker({
      db: dbSms,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: swSms,
      phoneForOwner: async () => '+255700000000',
      localeForOwner: async () => 'sw',
      enabled: true,
    });
    await wSms.tickOnce();
    expect(swSms.send).toHaveBeenCalledOnce();
    expect(swSms.send.mock.calls[0][0].locale).toBe('sw');
  });

  it('falls back to the default locale (en) when localeForOwner faults or returns null', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-loc-null',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Renewal due',
        body: 'PML renews in 7 days',
        channel: 'email',
        payload: {},
        idempotency_key: 'idem-loc-null',
      },
    ]);
    const nullLocaleEmail = {
      name: 'in-memory',
      configured: true,
      send: vi.fn(async () => ({
        status: 'sent' as const,
        provider: 'in-memory',
        providerRef: 'mem-null-1',
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: nullLocaleEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      localeForOwner: async () => {
        throw new Error('resolver boom');
      },
      enabled: true,
    });
    await w.tickOnce();
    expect(nullLocaleEmail.send).toHaveBeenCalledOnce();
    expect(nullLocaleEmail.send.mock.calls[0][0].locale).toBe('en');
  });

  it('renders the __localized sw title/body when the recipient locale is sw (single-language body)', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-bag-sw',
        tenant_id: 't-1',
        owner_id: 'u-sw',
        // Columns hold the EN default (worker fallback); the bag carries both.
        title: 'Renewal due',
        body: 'PML renews in 7 days',
        channel: 'email',
        payload: {
          source: 'md-commitment',
          __localized: {
            en: { title: 'Renewal due', body: 'PML renews in 7 days' },
            sw: { title: 'Upyaji unahitajika', body: 'PML inaisha baada ya siku 7' },
          },
        },
        idempotency_key: 'idem-bag-sw',
      },
    ]);
    const bagEmail = {
      name: 'in-memory',
      configured: true,
      send: vi.fn(async () => ({
        status: 'sent' as const,
        provider: 'in-memory',
        providerRef: 'mem-bag-1',
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: bagEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      localeForOwner: async () => 'sw',
      enabled: true,
    });
    await w.tickOnce();
    expect(bagEmail.send).toHaveBeenCalledOnce();
    const sent = bagEmail.send.mock.calls[0][0];
    expect(sent.locale).toBe('sw');
    expect(sent.payload.title).toBe('Upyaji unahitajika');
    expect(sent.payload.body).toBe('PML inaisha baada ya siku 7');
    // The EN default copy must NOT leak into the SW dispatch.
    expect(sent.payload.body).not.toContain('renews');
  });

  it('falls back to the row title/body columns when the __localized bag lacks the resolved locale', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-bag-missing-sw',
        tenant_id: 't-1',
        owner_id: 'u-sw',
        title: 'Renewal due',
        body: 'PML renews in 7 days',
        channel: 'email',
        payload: {
          source: 'md-commitment',
          // Only an en entry — no sw. A sw owner falls back to the en columns
          // (a clean single language), never a half-translated mix.
          __localized: {
            en: { title: 'Renewal due', body: 'PML renews in 7 days' },
          },
        },
        idempotency_key: 'idem-bag-missing-sw',
      },
    ]);
    const fbEmail = {
      name: 'in-memory',
      configured: true,
      send: vi.fn(async () => ({
        status: 'sent' as const,
        provider: 'in-memory',
        providerRef: 'mem-fb-1',
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: fbEmail,
      smsProvider: stubSmsProvider,
      emailForOwner: async () => 'owner@example.com',
      localeForOwner: async () => 'sw',
      enabled: true,
    });
    await w.tickOnce();
    expect(fbEmail.send).toHaveBeenCalledOnce();
    const sent = fbEmail.send.mock.calls[0][0];
    expect(sent.locale).toBe('sw');
    expect(sent.payload.title).toBe('Renewal due');
    expect(sent.payload.body).toBe('PML renews in 7 days');
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
    expect(res).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      deferred: 0,
      reRemindNudged: 0,
      escalated: 0,
    });
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

describe('reminders-dispatch — quiet hours (SMS only)', () => {
  // Africa/Dar_es_Salaam is UTC+3 with no DST, so these are stable.
  const at = (iso: string) => new Date(iso);

  it('isWithinQuietHours handles same-day, midnight-wrapping, and empty windows', () => {
    // 22:00Z → 01:00 in Dar → inside a 21→7 wrapping window.
    expect(isWithinQuietHours(at('2024-01-01T22:00:00Z'), 'Africa/Dar_es_Salaam', 21, 7)).toBe(true);
    // 09:00Z → 12:00 in Dar → outside 21→7.
    expect(isWithinQuietHours(at('2024-01-01T09:00:00Z'), 'Africa/Dar_es_Salaam', 21, 7)).toBe(false);
    // Same-day window 9→17: 12:00 in Dar is inside.
    expect(isWithinQuietHours(at('2024-01-01T09:00:00Z'), 'Africa/Dar_es_Salaam', 9, 17)).toBe(true);
    // Empty window (start === end) → never quiet.
    expect(isWithinQuietHours(at('2024-01-01T22:00:00Z'), 'Africa/Dar_es_Salaam', 0, 0)).toBe(false);
  });

  function smsRow(id: string) {
    return {
      id,
      tenant_id: 't-1',
      owner_id: 'u-1',
      title: 'Rent due',
      body: 'Rent is due',
      channel: 'sms',
      payload: {},
      idempotency_key: `idem-${id}`,
      attempt_count: 0,
    };
  }

  const okSms = () => ({
    name: 'sms',
    configured: true,
    send: vi.fn(async () => ({ status: 'sent' as const, provider: 'sms', providerRef: 'x' })),
  });

  it('DEFERS an SMS in the owner quiet window (re-queues, does not send)', async () => {
    const db = makeStubDb([smsRow('q1')]);
    const smsSpy = okSms();
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: smsSpy,
      phoneForOwner: async () => '+255700000000',
      timezoneForOwner: async () => 'Africa/Dar_es_Salaam',
      quietHours: { startHour: 21, endHour: 7 },
      now: () => at('2024-01-01T22:00:00Z'), // 01:00 in Dar → quiet
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.deferred).toBe(1);
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(0);
    expect(smsSpy.send).not.toHaveBeenCalled(); // deferred BEFORE sending
    // Re-queued (status='scheduled' + new trigger_at), not failed, no attempt consumed.
    expect(db.calls.some((c) => c.sql.includes("SET status = 'scheduled'"))).toBe(true);
    expect(db.calls.some((c) => c.sql.includes("status = 'failed'"))).toBe(false);
  });

  it('SENDS an SMS outside quiet hours (no deferral)', async () => {
    const db = makeStubDb([smsRow('q2')]);
    const smsSpy = okSms();
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: smsSpy,
      phoneForOwner: async () => '+255700000000',
      timezoneForOwner: async () => 'Africa/Dar_es_Salaam',
      quietHours: { startHour: 21, endHour: 7 },
      now: () => at('2024-01-01T09:00:00Z'), // 12:00 in Dar → awake
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.deferred).toBe(0);
    expect(res.sent).toBe(1);
    expect(smsSpy.send).toHaveBeenCalledOnce();
  });
});

describe('reminders-dispatch — whatsapp channel', () => {
  it('dispatches a whatsapp row via the SMS provider with channel="whatsapp"', async () => {
    const db = makeStubDb([
      {
        id: 'reminder-wa',
        tenant_id: 't-1',
        owner_id: 'u-1',
        title: 'Renewal due',
        body: 'PML renews in 7 days',
        channel: 'whatsapp',
        payload: {},
        idempotency_key: 'idem-wa',
        attempt_count: 0,
      },
    ]);
    const waSms = {
      name: 'sms',
      configured: true,
      send: vi.fn(async () => ({
        status: 'sent' as const,
        provider: 'sms',
        providerRef: 'wa-1',
      })),
    };
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: waSms,
      phoneForOwner: async () => '+255700000000',
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(waSms.send).toHaveBeenCalledOnce();
    expect(waSms.send.mock.calls[0][0].channel).toBe('whatsapp');
  });
});

// A sweep-aware stub: the FIRST 'sent'-claim sweep query returns the seeded
// unacknowledged rows; the delivery claim ('scheduled') returns nothing. This
// lets the no-reminder-slips sweep be exercised in isolation.
function makeSweepStubDb(unackedRows: ReadonlyArray<Record<string, unknown>>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let sweepReturned = false;
  return {
    calls,
    execute: vi.fn(async (q: unknown) => {
      const sqlObj = q as {
        strings?: ReadonlyArray<string>;
        queryChunks?: ReadonlyArray<{ value?: string }>;
        values?: unknown[];
      };
      const text =
        sqlObj?.strings?.join(' ') ??
        sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
        '';
      calls.push({ sql: text, values: sqlObj?.values ?? [] });
      // The sweep claim selects status = 'sent'; the delivery claim selects
      // status = 'scheduled'. Only the sweep claim yields rows here.
      if (
        text.includes('UPDATE reminders') &&
        text.includes('RETURNING') &&
        text.includes("status = 'sent'") &&
        !sweepReturned
      ) {
        sweepReturned = true;
        return { rows: unackedRows };
      }
      return { rows: [] };
    }),
  };
}

describe('reminders-dispatch — no-reminder-slips sweep (re-remind + escalate)', () => {
  function sentUnackedRow(
    id: string,
    payload: Record<string, unknown> = {},
  ) {
    return {
      id,
      tenant_id: 't-1',
      owner_id: 'u-1',
      title: 'Royalty filing due',
      body: 'File the monthly royalty return',
      channel: 'email',
      payload,
      idempotency_key: `idem-${id}`,
      attempt_count: 0,
    };
  }

  it('does NOT sweep when reRemindAfterMs is unset (dormant by default)', async () => {
    const db = makeSweepStubDb([sentUnackedRow('s0')]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.reRemindNudged).toBe(0);
    expect(res.escalated).toBe(0);
    // No sweep claim was issued (no 'sent'-status claim query).
    expect(
      db.calls.some(
        (c) => c.sql.includes('RETURNING') && c.sql.includes("status = 'sent'"),
      ),
    ).toBe(false);
  });

  it('RE-FIRES a sent-but-unacknowledged row (second nudge, bumps counter)', async () => {
    const db = makeSweepStubDb([sentUnackedRow('s1')]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      reRemindAfterMs: 60_000,
      maxNudges: 2,
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.reRemindNudged).toBe(1);
    expect(res.escalated).toBe(0);
    // Re-queued for immediate re-delivery (status back to 'scheduled').
    const requeue = db.calls.find(
      (c) =>
        c.sql.includes("SET status = 'scheduled'") &&
        c.sql.includes('dispatched_at = NULL'),
    );
    expect(requeue).toBeDefined();
    // No escalation cockpit-mark (would set status = 'acknowledged').
    expect(
      db.calls.some((c) => c.sql.includes("SET status = 'acknowledged'")),
    ).toBe(false);
  });

  it('ESCALATES once the nudge cap is reached (terminal, no further re-fire)', async () => {
    // Payload already at the cap → escalate instead of re-firing.
    const db = makeSweepStubDb([
      sentUnackedRow('s2', { __reminderNudges: 2 }),
    ]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      reRemindAfterMs: 60_000,
      maxNudges: 2,
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.escalated).toBe(1);
    expect(res.reRemindNudged).toBe(0);
    // Escalation lands the row terminally (status = 'acknowledged').
    expect(
      db.calls.some((c) => c.sql.includes("SET status = 'acknowledged'")),
    ).toBe(true);
    // It is NOT re-fired again.
    expect(
      db.calls.some(
        (c) =>
          c.sql.includes("SET status = 'scheduled'") &&
          c.sql.includes('dispatched_at = NULL'),
      ),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// SSRF-via-redirect: the Slack webhook POST must route through
// safeHttpFetch, which re-screens EVERY redirect hop. A 3xx Location to an
// internal host must be BLOCKED (not followed); a legit target still
// delivers. We inject the REAL safeHttpFetch (with a scripted low-level
// fetchImpl) as the worker's `safeFetch`, so this proves the SUT delegates
// to the redirect-rescreen policy — not a stub.
// ─────────────────────────────────────────────────────────────────────

/** A low-level fetch that 302-redirects the first hop to `redirectTo`. */
function redirectingFetchImpl(redirectTo: string): typeof fetch {
  let hop = 0;
  return (async (_url: string) => {
    hop += 1;
    if (hop === 1) {
      return {
        status: 302,
        ok: false,
        headers: new Headers({ location: redirectTo }),
        text: async () => '',
        json: async () => ({}),
      } as unknown as Response;
    }
    // Any second hop (should never be reached for an internal target) 200s.
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => 'ok',
      json: async () => ({ ok: true }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** A low-level fetch that returns a plain 200 (legit delivery). */
function okFetchImpl(): typeof fetch {
  return (async () =>
    ({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => 'ok',
      json: async () => ({ ok: true }),
    }) as unknown as Response) as unknown as typeof fetch;
}

/** Bind the real safeHttpFetch to a scripted fetchImpl for the worker. */
function safeFetchWith(fetchImpl: typeof fetch) {
  return (
    url: string,
    init: {
      readonly method: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
    },
  ) => safeHttpFetch(url, { ...init, fetchImpl });
}

function slackRow(id: string): Record<string, unknown> {
  return {
    id,
    tenant_id: 't-1',
    owner_id: 'u-1',
    title: 'Standup',
    body: 'Shift handover',
    channel: 'slack',
    payload: {},
    idempotency_key: `idem-${id}`,
    attempt_count: 0,
  };
}

describe('reminders-dispatch — Slack webhook SSRF-via-redirect', () => {
  it('BLOCKS a Slack webhook that 302-redirects to an internal host (non-retryable)', async () => {
    const db = makeStubDb([slackRow('ssrf-redirect')]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      // A legit public host on the FIRST hop that then 302s to the cloud
      // metadata endpoint. The old code (assertUrlSafe initial URL, then raw
      // fetch redirect:follow) would follow the redirect; safeHttpFetch
      // re-screens the Location and blocks it.
      slackWebhookForTenant: () => 'https://hooks.slack.example/services/T/B/x',
      safeFetch: safeFetchWith(
        redirectingFetchImpl('http://169.254.169.254/latest/meta-data/'),
      ),
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.claimed).toBe(1);
    expect(res.sent).toBe(0);
    // Blocked → terminal failure, NOT retried (no re-queue to 'scheduled').
    expect(res.failed).toBe(1);
    expect(res.retried).toBe(0);
    // Terminal 'failed' write happened; no retry re-queue to 'scheduled'.
    expect(db.calls.some((c) => c.sql.includes("SET status = 'failed'"))).toBe(
      true,
    );
    expect(
      db.calls.some((c) => c.sql.includes("SET status = 'scheduled'")),
    ).toBe(false);
  });

  it('DELIVERS a Slack webhook that reaches a legit target (200)', async () => {
    const db = makeStubDb([slackRow('legit')]);
    const w = createRemindersDispatchWorker({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: stubSmsProvider,
      slackWebhookForTenant: () => 'https://hooks.slack.example/services/T/B/x',
      safeFetch: safeFetchWith(okFetchImpl()),
      enabled: true,
    });
    const res = await w.tickOnce();
    expect(res.claimed).toBe(1);
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
  });
});
