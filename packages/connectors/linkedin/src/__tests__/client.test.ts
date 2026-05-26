import { describe, expect, it } from 'vitest';
import { listPosts } from '../client/linkedin-client.js';
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

describe('LinkedIn listPosts', () => {
  it('sends Bearer + LinkedIn-Version + Restli headers', async () => {
    let seenAuth = '';
    let seenVersion = '';
    let seenRestli = '';
    const fetcher = makeFetcher((_url, headers) => {
      seenAuth = headers['authorization'] ?? '';
      seenVersion = headers['linkedin-version'] ?? '';
      seenRestli = headers['x-restli-protocol-version'] ?? '';
      return {
        status: 200,
        body: JSON.stringify({
          elements: [{ id: 'urn:li:share:1', commentary: 'hi' }],
          paging: { count: 1, start: 0, total: 5 },
        }),
      };
    });
    const out = await listPosts({
      accessToken: 'tok',
      authorUrn: 'urn:li:organization:1',
      count: 1,
      fetcher,
    });
    expect(seenAuth).toBe('Bearer tok');
    expect(seenVersion).toMatch(/\d{6}/);
    expect(seenRestli).toBe('2.0.0');
    expect(out.items).toHaveLength(1);
    // returned == count => more rows likely.
    expect(out.nextStart).toBe(1);
  });

  it('returns nextStart=null when fewer items than count', async () => {
    const fetcher = makeFetcher(() => ({
      status: 200,
      body: JSON.stringify({
        elements: [{ id: 'p1' }],
        paging: { count: 10, start: 0, total: 1 },
      }),
    }));
    const out = await listPosts({
      accessToken: 'tok',
      authorUrn: 'urn:li:organization:1',
      count: 10,
      fetcher,
    });
    expect(out.nextStart).toBeNull();
  });

  it('throws on non-200', async () => {
    const fetcher = makeFetcher(() => ({ status: 403, body: '' }));
    await expect(
      listPosts({
        accessToken: 'tok',
        authorUrn: 'urn:li:organization:1',
        fetcher,
      }),
    ).rejects.toThrow();
  });
});
