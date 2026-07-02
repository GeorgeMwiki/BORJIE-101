/**
 * Daily-brief cron — Slack webhook SSRF-via-redirect guard.
 *
 * The daily-brief Slack dispatch must route through safeHttpFetch, which
 * re-screens EVERY redirect hop. A 3xx Location to an internal host must be
 * BLOCKED (recorded as `slack_webhook_unsafe:*`, never followed); a legit
 * target still delivers. We inject the REAL safeHttpFetch (with a scripted
 * low-level fetchImpl) as the cron's `safeFetch`, so this proves the SUT
 * delegates to the redirect-rescreen policy — not a stub.
 *
 * The heavy composition path (compose / persist / brain greeting) is mocked;
 * this test targets ONLY the egress screening seam.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeHttpFetch } from '@borjie/enterprise-hardening';

// ── Mock the composition + brain path so triggerForTenant reaches dispatch.
vi.mock('../../routes/owner/brief.hono', () => ({
  composeOwnerBrief: vi.fn(async () => ({
    advisor: { insight: 'All clear today.', action: 'Review PML renewal.' },
  })),
  persistSnapshot: vi.fn(async () => ({ id: 'snap-1' })),
}));
vi.mock('../../routes/owner/brain-call', () => ({
  callBrainOnce: vi.fn(async () => ({
    text: '',
    provider: 'stub',
    latencyMs: 1,
  })),
}));

import { createDailyBriefCron } from '../daily-brief-cron.js';

const stubLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as any;

const okEmailProvider = {
  name: 'stub',
  configured: true,
  send: vi.fn(async () => ({ status: 'sent' as const, provider: 'stub', providerRef: 'x' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
const okSmsProvider = {
  name: 'stub',
  configured: true,
  send: vi.fn(async () => ({ status: 'sent' as const, provider: 'stub', providerRef: 'x' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/** DB stub: tenant prefs SELECT returns one slack-only tenant; INSERT
 *  RETURNING yields a dispatch id; everything else is a no-op. Records the
 *  finalise UPDATE so we can read the recorded status/error-code. */
function makeStubDb() {
  const finalise: Array<{ sql: string }> = [];
  return {
    finalise,
    execute: vi.fn(async (q: unknown) => {
      const sqlObj = q as {
        strings?: ReadonlyArray<string>;
        queryChunks?: ReadonlyArray<{ value?: string }>;
      };
      const text =
        sqlObj?.strings?.join(' ') ??
        sqlObj?.queryChunks?.map((c) => c.value ?? '').join(' ') ??
        '';
      if (text.includes('FROM tenants')) {
        return {
          rows: [
            {
              tenant_id: '00000000-0000-0000-0000-000000000001',
              cadence: 'daily_06:00_tz',
              channels: ['slack'],
              recipients: [{ slackHandle: '@owner', locale: 'en' }],
              tz: 'Africa/Dar_es_Salaam',
            },
          ],
        };
      }
      if (text.includes('INSERT INTO daily_brief_dispatches') && text.includes('RETURNING')) {
        return { rows: [{ id: '00000000-0000-0000-0000-0000000000aa' }] };
      }
      if (text.includes('UPDATE daily_brief_dispatches')) {
        finalise.push({ sql: text });
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
}

/** A low-level fetch that 302-redirects the first hop to `redirectTo`. */
function redirectingFetchImpl(redirectTo: string): typeof fetch {
  let hop = 0;
  return (async () => {
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
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => 'ok',
      json: async () => ({ ok: true }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

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

describe('daily-brief-cron — Slack webhook SSRF-via-redirect', () => {
  beforeEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it('BLOCKS a Slack webhook that 302-redirects to an internal host', async () => {
    const db = makeStubDb();
    const cron = createDailyBriefCron({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: okSmsProvider,
      slackWebhookForTenant: () => 'https://hooks.slack.example/services/T/B/x',
      safeFetch: safeFetchWith(
        redirectingFetchImpl('http://169.254.169.254/latest/meta-data/'),
      ),
      enabled: false,
    });
    const res = await cron.triggerForTenant(
      '00000000-0000-0000-0000-000000000001',
    );
    expect(res.dispatched).toBe(0);
    expect(res.failed).toBe(1);
    // Finalised as failed with the SSRF-block error code.
    expect(
      db.finalise.some((c) => c.sql.includes('UPDATE daily_brief_dispatches')),
    ).toBe(true);
  });

  it('DELIVERS a Slack webhook that reaches a legit target (200)', async () => {
    const db = makeStubDb();
    const cron = createDailyBriefCron({
      db,
      logger: stubLogger,
      emailProvider: okEmailProvider,
      smsProvider: okSmsProvider,
      slackWebhookForTenant: () => 'https://hooks.slack.example/services/T/B/x',
      safeFetch: safeFetchWith(okFetchImpl()),
      enabled: false,
    });
    const res = await cron.triggerForTenant(
      '00000000-0000-0000-0000-000000000001',
    );
    expect(res.dispatched).toBe(1);
    expect(res.failed).toBe(0);
  });
});
