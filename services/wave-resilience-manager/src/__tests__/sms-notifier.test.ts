import { describe, it, expect } from 'vitest';
import {
  createSmsNotifier,
  resolveTwilioCreds,
} from '../notification/sms-notifier.js';
import type { ResilienceLogger } from '../types.js';

function silentLogger(): ResilienceLogger & {
  readonly warns: ReadonlyArray<{
    readonly obj: Record<string, unknown>;
    readonly msg?: string;
  }>;
} {
  const warns: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  return {
    warns,
    info() {},
    warn(obj, msg) {
      warns.push({ obj, ...(msg !== undefined ? { msg } : {}) });
    },
    error() {},
  };
}

function fakeFetch(opts: {
  readonly ok?: boolean;
  readonly status?: number;
  readonly throws?: Error;
}): {
  readonly fn: typeof fetch;
  readonly calls: ReadonlyArray<{ readonly url: string; readonly init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (opts.throws) throw opts.throws;
    const ok = opts.ok ?? true;
    const status = opts.status ?? (ok ? 201 : 400);
    return new Response(ok ? '{}' : 'err', { status });
  };
  return { fn, calls };
}

describe('resolveTwilioCreds', () => {
  it('returns null when any credential is missing', () => {
    expect(
      resolveTwilioCreds({
        accountSid: null,
        authToken: 'a',
        fromNumber: '+1',
        operatorNumber: '+2',
      }),
    ).toBeNull();
    expect(
      resolveTwilioCreds({
        accountSid: 'AC',
        authToken: null,
        fromNumber: '+1',
        operatorNumber: '+2',
      }),
    ).toBeNull();
    expect(
      resolveTwilioCreds({
        accountSid: 'AC',
        authToken: 'a',
        fromNumber: null,
        operatorNumber: '+2',
      }),
    ).toBeNull();
    expect(
      resolveTwilioCreds({
        accountSid: 'AC',
        authToken: 'a',
        fromNumber: '+1',
        operatorNumber: null,
      }),
    ).toBeNull();
  });
  it('returns resolved creds when all four are present', () => {
    const r = resolveTwilioCreds({
      accountSid: 'AC',
      authToken: 'tok',
      fromNumber: '+1',
      operatorNumber: '+2',
    });
    expect(r).not.toBeNull();
    expect(r?.accountSid).toBe('AC');
  });
});

describe('createSmsNotifier — Twilio HTTP call shape', () => {
  it('POSTs form-encoded body to the Twilio Messages endpoint', async () => {
    const { fn, calls } = fakeFetch({ ok: true, status: 201 });
    const notifier = createSmsNotifier({
      twilio: {
        accountSid: 'AC123',
        authToken: 'secret',
        fromNumber: '+15550001111',
        operatorNumber: '+15550002222',
      },
      fetchImpl: fn,
    });
    const delivered = await notifier.notifyUnrecoverable({
      wave_id: 'W',
      attempts: 3,
      reason: 'max_attempts_reached',
    });
    expect(delivered).toBe(true);
    expect(calls.length).toBe(1);

    const call = calls[0];
    expect(call?.url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
    );
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Basic auth = base64(accountSid:authToken).
    const expected = `Basic ${Buffer.from('AC123:secret', 'utf8').toString('base64')}`;
    expect(headers['Authorization']).toBe(expected);

    const body = String(call?.init?.body);
    expect(body).toContain('To=%2B15550002222');
    expect(body).toContain('From=%2B15550001111');
    expect(body).toContain('Body=%5BBorjie%5D');
    expect(body).toContain('Wave+W+unrecoverable');
  });

  it('graceful degrade when twilio creds are missing — never throws', async () => {
    const logger = silentLogger();
    const notifier = createSmsNotifier({
      twilio: {
        accountSid: null,
        authToken: null,
        fromNumber: null,
        operatorNumber: null,
      },
      logger,
    });
    const delivered = await notifier.notifyUnrecoverable({
      wave_id: 'W',
      attempts: 3,
      reason: 'max_attempts_reached',
    });
    expect(delivered).toBe(false);
    expect(logger.warns.length).toBe(1);
    expect(logger.warns[0]?.msg).toMatch(/twilio creds missing/i);
  });

  it('graceful degrade when Twilio returns non-OK — never throws', async () => {
    const { fn } = fakeFetch({ ok: false, status: 401 });
    const logger = silentLogger();
    const notifier = createSmsNotifier({
      twilio: {
        accountSid: 'AC',
        authToken: 'tok',
        fromNumber: '+1',
        operatorNumber: '+2',
      },
      logger,
      fetchImpl: fn,
    });
    const delivered = await notifier.notifyUnrecoverable({
      wave_id: 'W',
      attempts: 3,
      reason: 'max_attempts_reached',
    });
    expect(delivered).toBe(false);
    expect(logger.warns.length).toBeGreaterThanOrEqual(1);
  });

  it('graceful degrade when fetch throws — never propagates', async () => {
    const { fn } = fakeFetch({ throws: new Error('ENETDOWN') });
    const logger = silentLogger();
    const notifier = createSmsNotifier({
      twilio: {
        accountSid: 'AC',
        authToken: 'tok',
        fromNumber: '+1',
        operatorNumber: '+2',
      },
      logger,
      fetchImpl: fn,
    });
    const delivered = await notifier.notifyUnrecoverable({
      wave_id: 'W',
      attempts: 3,
      reason: 'max_attempts_reached',
    });
    expect(delivered).toBe(false);
    expect(logger.warns.length).toBe(1);
  });
});
