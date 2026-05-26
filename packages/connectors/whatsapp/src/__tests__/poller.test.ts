import { describe, it, expect } from 'vitest';
import { pollWhatsappReconciliation } from '../ingest/poller.js';
import type { Fetcher, ConnectorLogger } from '../types.js';

const noopLogger: ConnectorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeFetcher(responses: ReadonlyArray<Response>): Fetcher {
  let i = 0;
  return async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i += 1;
    if (!r) throw new Error('no fetcher response queued');
    return r;
  };
}

describe('pollWhatsappReconciliation', () => {
  it('returns ok with normalised rows on 200', async () => {
    const fetcher = makeFetcher([
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'wamid.A',
              from: '+255700000001',
              to: 'pn_42',
              timestamp: '2026-05-26T09:55:00.000Z',
              type: 'text',
              text: { body: 'hello' },
            },
          ],
        }),
        { status: 200 },
      ),
    ]);
    const result = await pollWhatsappReconciliation(
      {
        tenantId: 'tenant_a',
        wabaId: 'waba_1',
        phoneNumberId: 'pn_42',
        accessToken: 'tok',
        since: null,
        maxItems: 100,
      },
      {
        fetcher,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => 'uuid-1',
      },
    );
    expect(result.outcome).toBe('ok');
    expect(result.rows.length).toBe(1);
    const first = result.rows[0]!;
    expect(first.kind).toBe('text');
    expect((first.raw as { meta: { recovered_via: string } }).meta.recovered_via).toBe(
      'reconciliation',
    );
  });

  it('maps 429 to rate-limited and reads Retry-After', async () => {
    const fetcher = makeFetcher([
      new Response('rate limit', {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
    ]);
    const result = await pollWhatsappReconciliation(
      {
        tenantId: 'tenant_a',
        wabaId: 'waba_1',
        phoneNumberId: 'pn_42',
        accessToken: 'tok',
        since: '2026-05-26T09:00:00.000Z',
        maxItems: 100,
      },
      {
        fetcher,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => 'uuid',
      },
    );
    expect(result.outcome).toBe('rate-limited');
    expect(result.retryAfterMs).toBe(30000);
  });

  it('maps 401 to auth-failed', async () => {
    const fetcher = makeFetcher([new Response('forbidden', { status: 401 })]);
    const result = await pollWhatsappReconciliation(
      {
        tenantId: 'tenant_a',
        wabaId: 'waba_1',
        phoneNumberId: 'pn_42',
        accessToken: 'tok',
        since: null,
        maxItems: 100,
      },
      {
        fetcher,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => 'uuid',
      },
    );
    expect(result.outcome).toBe('auth-failed');
  });
});
