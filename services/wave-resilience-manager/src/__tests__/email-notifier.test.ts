import { describe, it, expect } from 'vitest';
import { createEmailNotifier } from '../notification/email-notifier.js';
import type { ResilienceLogger } from '../types.js';

function silentLogger(): ResilienceLogger & {
  readonly warns: ReadonlyArray<{
    readonly obj: Record<string, unknown>;
    readonly msg?: string;
  }>;
  readonly infos: ReadonlyArray<{
    readonly obj: Record<string, unknown>;
    readonly msg?: string;
  }>;
} {
  const warns: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  const infos: Array<{ obj: Record<string, unknown>; msg?: string }> = [];
  return {
    warns,
    infos,
    info(obj, msg) {
      infos.push({ obj, ...(msg !== undefined ? { msg } : {}) });
    },
    warn(obj, msg) {
      warns.push({ obj, ...(msg !== undefined ? { msg } : {}) });
    },
    error() {},
  };
}

interface FakeFetchOptions {
  readonly ok?: boolean;
  readonly status?: number;
  readonly throws?: Error;
  readonly responseBody?: string;
}

function fakeFetch(opts: FakeFetchOptions): {
  readonly fn: typeof fetch;
  readonly calls: ReadonlyArray<{
    readonly url: string;
    readonly init: RequestInit | undefined;
  }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (opts.throws) throw opts.throws;
    const ok = opts.ok ?? true;
    const status = opts.status ?? (ok ? 200 : 400);
    return new Response(opts.responseBody ?? (ok ? '{"id":"em_1"}' : 'err'), {
      status,
    });
  };
  return { fn, calls };
}

describe('createEmailNotifier — Resend HTTP call shape', () => {
  it('POSTs JSON to the Resend emails endpoint with Bearer auth', async () => {
    const { fn, calls } = fakeFetch({ ok: true });
    const notifier = createEmailNotifier({
      apiKey: 're_secret',
      to: 'ops@borjie.co.tz',
      fetchImpl: fn,
    });
    const delivered = await notifier.notifyUnrecoverable({
      wave_id: 'W42',
      attempts: 3,
      reason: 'max_attempts_reached',
    });
    expect(delivered).toBe(true);
    expect(calls.length).toBe(1);

    const call = calls[0];
    expect(call?.url).toBe('https://api.resend.com/emails');
    expect(call?.init?.method).toBe('POST');

    const headers = call?.init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer re_secret');
    expect(headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(String(call?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body['from']).toBe('notifications@borjie.co.tz');
    expect(body['to']).toBe('ops@borjie.co.tz');
    expect(body['subject']).toBe(
      '[Borjie] Wave W42 unrecoverable after 3 attempts',
    );
    expect(typeof body['text']).toBe('string');
    expect(String(body['text'])).toContain('Wave W42 unrecoverable');
    expect(String(body['text'])).toContain('max_attempts_reached');
  });

  it('honours a custom from-address when supplied (test override)', async () => {
    const { fn, calls } = fakeFetch({ ok: true });
    const notifier = createEmailNotifier({
      apiKey: 're_secret',
      to: 'ops@borjie.co.tz',
      from: 'custom@borjie.co.tz',
      fetchImpl: fn,
    });
    await notifier.notifyUnrecoverable({
      wave_id: 'W1',
      attempts: 1,
      reason: 'r',
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(body['from']).toBe('custom@borjie.co.tz');
  });

  it('graceful degrade when Resend returns non-OK — never throws', async () => {
    const { fn } = fakeFetch({
      ok: false,
      status: 422,
      responseBody: '{"name":"validation_error"}',
    });
    const logger = silentLogger();
    const notifier = createEmailNotifier({
      apiKey: 're_secret',
      to: 'ops@borjie.co.tz',
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
    expect(logger.warns[0]?.obj['channel']).toBe('email');
    expect(logger.warns[0]?.obj['status']).toBe(422);
  });

  it('graceful degrade when fetch throws — never propagates', async () => {
    const { fn } = fakeFetch({ throws: new Error('ENETDOWN') });
    const logger = silentLogger();
    const notifier = createEmailNotifier({
      apiKey: 're_secret',
      to: 'ops@borjie.co.tz',
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
    expect(logger.warns[0]?.obj['channel']).toBe('email');
  });

  it('logs an info line on successful delivery', async () => {
    const { fn } = fakeFetch({ ok: true });
    const logger = silentLogger();
    const notifier = createEmailNotifier({
      apiKey: 're_secret',
      to: 'ops@borjie.co.tz',
      logger,
      fetchImpl: fn,
    });
    const delivered = await notifier.notifyUnrecoverable({
      wave_id: 'W',
      attempts: 3,
      reason: 'max_attempts_reached',
    });
    expect(delivered).toBe(true);
    expect(logger.infos.length).toBe(1);
    expect(logger.infos[0]?.obj['channel']).toBe('email');
    expect(logger.infos[0]?.obj['to']).toBe('ops@borjie.co.tz');
  });
});
