import { describe, expect, it } from 'vitest';
import { listMentions, listTweets } from '../client/x-client.js';
import type { FetcherPort } from '../types.js';

function makeFetcher(
  responder: (url: string, headers: Readonly<Record<string, string>>) => {
    status: number;
    body: string;
  },
): FetcherPort {
  return Object.freeze({
    fetch: async (url, init) => {
      const { status, body } = responder(url, init.headers);
      return {
        status,
        headers: {},
        text: async () => body,
      };
    },
  });
}

describe('listTweets', () => {
  it('sends a Bearer token + requested tweet fields', async () => {
    let seenAuth = '';
    const fetcher = makeFetcher((_url, headers) => {
      seenAuth = headers['authorization'] ?? '';
      return {
        status: 200,
        body: JSON.stringify({
          data: [{ id: 't1', text: 'hi' }],
          meta: { next_token: 'next-1' },
        }),
      };
    });
    const out = await listTweets({
      accessToken: 'tok-abc',
      userId: '12345',
      fetcher,
    });
    expect(seenAuth).toBe('Bearer tok-abc');
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBe('next-1');
  });

  it('throws on non-200 status', async () => {
    const fetcher = makeFetcher(() => ({ status: 500, body: '' }));
    await expect(
      listTweets({
        accessToken: 'tok',
        userId: '12345',
        fetcher,
      }),
    ).rejects.toThrow();
  });
});

describe('listMentions', () => {
  it('returns items + meta.next_token', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        data: [{ id: 'm1', text: 'hey' }],
        meta: { next_token: 'mnext' },
      }),
    }));
    const out = await listMentions({
      accessToken: 'tok',
      userId: '12345',
      fetcher,
    });
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBe('mnext');
  });
});
