import { describe, expect, it } from 'vitest';
import { createSlackWebClient } from '../client/slack-web.js';
import { createSlackPoller } from '../ingest/poller.js';
import { createSlackNormaliser } from '../ingest/normalizer.js';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import {
  createInMemorySlackMessagesRepository,
} from '../repositories/messages.js';
import {
  SLACK_HISTORY_OK_PAYLOAD,
  buildFetcherResponse,
  createCannedFetcher,
} from './fixtures/slack-fixtures.js';
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

function buildPoller(responses: ReadonlyArray<ReturnType<typeof buildFetcherResponse>>) {
  const { fetcher, calls } = createCannedFetcher(responses);
  const client = createSlackWebClient({ fetcher });
  const hasher = det();
  const normaliser = createSlackNormaliser({
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
  });
  const poller = createSlackPoller({
    client,
    normaliser,
    hasher,
    maxRetries: 1,
    baseBackoffMs: 1,
  });
  return { poller, calls };
}

describe('Slack poller — cursor-based incremental ingest', () => {
  it('ingests messages on first run + dedups idempotent on second run', async () => {
    const { poller } = buildPoller([
      buildFetcherResponse(SLACK_HISTORY_OK_PAYLOAD),
      buildFetcherResponse(SLACK_HISTORY_OK_PAYLOAD),
    ]);
    const repo = createInMemorySlackMessagesRepository();
    const baseReq = {
      tenantId: 'tenant-001',
      workspaceId: 'T01TEAM',
      channelId: 'C01OPS',
      cursor: null,
      maxItems: 200,
      accessToken: 'xoxb-test',
    };

    const first = await poller.poll(baseReq);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') throw new Error('unreachable');
    for (const m of first.messages) await repo.put(m);
    expect((await repo.listByTenant('tenant-001')).length).toBe(2);

    // Re-run with same cursor — same provider rows arrive; dedup by SQL
    // unique key means only the first wins.
    const second = await poller.poll(baseReq);
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

  it('honours 429 retry-after by surfacing rate-limited to the caller', async () => {
    const { poller } = buildPoller([
      buildFetcherResponse({}, { status: 429, headers: { 'retry-after': '3' } }),
    ]);
    const result = await poller.poll({
      tenantId: 'tenant-001',
      workspaceId: 'T01TEAM',
      channelId: 'C01OPS',
      cursor: null,
      maxItems: 200,
      accessToken: 'xoxb-test',
    });
    expect(result.kind).toBe('rate-limited');
    if (result.kind === 'rate-limited') {
      expect(result.retryAfterMs).toBe(3000);
    }
  });

  it('retries upstream-error and eventually succeeds within maxRetries', async () => {
    const { poller, calls } = buildPoller([
      buildFetcherResponse({ ok: false, error: 'upstream' }, { status: 503 }),
      buildFetcherResponse(SLACK_HISTORY_OK_PAYLOAD),
    ]);

    const result = await poller.poll({
      tenantId: 'tenant-001',
      workspaceId: 'T01TEAM',
      channelId: 'C01OPS',
      cursor: null,
      maxItems: 200,
      accessToken: 'xoxb-test',
    });

    expect(result.kind).toBe('ok');
    expect(calls.length).toBe(2);
  });
});
