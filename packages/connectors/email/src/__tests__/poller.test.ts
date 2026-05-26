import { describe, expect, it } from 'vitest';
import { createGmailClient } from '../client/gmail.js';
import { createOutlookGraphClient } from '../client/outlook-graph.js';
import { createEmailNormaliser } from '../ingest/normalizer.js';
import { createEmailPoller } from '../ingest/poller.js';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import { createInMemoryEmailMessagesRepository } from '../repositories/messages.js';
import {
  GMAIL_GET_OK_PAYLOAD,
  GMAIL_LIST_OK_PAYLOAD,
  OUTLOOK_LIST_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/email-fixtures.js';
import type { Hasher } from '../types.js';

function det(): Hasher {
  return async (input) => {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (h * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `t-${h.toString(16).padStart(8, '0')}`;
  };
}

describe('Email poller', () => {
  it('ingests Gmail list + get and dedups on second run', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse(GMAIL_LIST_OK_PAYLOAD),
      buildFetcherResponse(GMAIL_GET_OK_PAYLOAD),
      buildFetcherResponse({ ...GMAIL_GET_OK_PAYLOAD, id: '18a2' }),
      buildFetcherResponse(GMAIL_LIST_OK_PAYLOAD),
      buildFetcherResponse(GMAIL_GET_OK_PAYLOAD),
      buildFetcherResponse({ ...GMAIL_GET_OK_PAYLOAD, id: '18a2' }),
    ]);
    const hasher = det();
    const poller = createEmailPoller({
      gmail: createGmailClient({ fetcher }),
      outlook: createOutlookGraphClient({ fetcher }),
      normaliser: createEmailNormaliser({
        redactor: createPiiRedactor({ hasher }),
        clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
        uuid: {
          v4: (() => {
            let n = 0;
            return () => {
              n += 1;
              return `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;
            };
          })(),
        },
      }),
      hasher,
      maxRetries: 1,
      baseBackoffMs: 1,
    });
    const repo = createInMemoryEmailMessagesRepository();

    const req = {
      tenantId: 'tenant-001',
      provider: 'gmail' as const,
      account: 'mwikila@example.com',
      cursor: null,
      maxItems: 100,
      accessToken: 'ya29-test',
      labels: ['Label_Borjie'],
    };

    const first = await poller.poll(req);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') throw new Error('unreachable');
    for (const m of first.messages) await repo.put(m);
    expect((await repo.listByTenant('tenant-001')).length).toBe(2);

    const second = await poller.poll(req);
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') throw new Error('unreachable');
    let inserted = 0;
    for (const m of second.messages) {
      const r = await repo.put(m);
      if (r.inserted) inserted += 1;
    }
    expect(inserted).toBe(0);
    expect((await repo.listByTenant('tenant-001')).length).toBe(2);
  });

  it('ingests Outlook list', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse(OUTLOOK_LIST_OK_PAYLOAD),
    ]);
    const hasher = det();
    const poller = createEmailPoller({
      gmail: createGmailClient({ fetcher }),
      outlook: createOutlookGraphClient({ fetcher }),
      normaliser: createEmailNormaliser({
        redactor: createPiiRedactor({ hasher }),
        clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
        uuid: { v4: () => '00000000-0000-0000-0000-000000000099' },
      }),
      hasher,
      maxRetries: 1,
      baseBackoffMs: 1,
    });
    const res = await poller.poll({
      tenantId: 'tenant-001',
      provider: 'outlook_mail',
      account: 'mwikila@example.com',
      cursor: null,
      maxItems: 100,
      accessToken: 'ms-test',
      labels: [],
    });
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') {
      expect(res.messages).toHaveLength(1);
      expect(res.messages[0]?.provider).toBe('outlook_mail');
    }
  });

  it('surfaces 429 from Gmail as rate-limited', async () => {
    const { fetcher } = createCannedFetcher([
      buildFetcherResponse({}, { status: 429, headers: { 'retry-after': '5' } }),
    ]);
    const hasher = det();
    const poller = createEmailPoller({
      gmail: createGmailClient({ fetcher }),
      outlook: createOutlookGraphClient({ fetcher }),
      normaliser: createEmailNormaliser({
        redactor: createPiiRedactor({ hasher }),
        clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
        uuid: { v4: () => 'u' },
      }),
      hasher,
      maxRetries: 1,
      baseBackoffMs: 1,
    });
    const res = await poller.poll({
      tenantId: 'tenant-001',
      provider: 'gmail',
      account: 'mwikila@example.com',
      cursor: null,
      maxItems: 50,
      accessToken: 'ya29',
      labels: [],
    });
    expect(res.kind).toBe('rate-limited');
    if (res.kind === 'rate-limited') {
      expect(res.retryAfterMs).toBe(5000);
    }
  });
});
