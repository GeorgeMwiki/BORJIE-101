import { describe, expect, it } from 'vitest';
import { pollInstagram } from '../ingest/poller.js';
import { normaliseMedia } from '../ingest/normalizer.js';
import {
  hashUsername,
  redactCaption,
  redactFreeText,
} from '../redact/pii-redactor.js';
import { createInMemoryInstagramPostsRepository } from '../repositories/instagram-posts-repository.js';
import type { ClockPort, FetcherPort } from '../types.js';

const clock: ClockPort = Object.freeze({
  nowIso: () => '2026-05-26T10:00:00.000Z',
});

function makeListMediaFetcher(
  items: ReadonlyArray<Record<string, unknown>>,
  nextCursor: string | null = null,
): FetcherPort {
  return Object.freeze({
    fetch: async () => ({
      status: 200,
      headers: {},
      text: async () =>
        JSON.stringify({
          data: items,
          paging: nextCursor !== null ? { cursors: { after: nextCursor } } : {},
        }),
    }),
  });
}

describe('pollInstagram', () => {
  it('normalises items and applies redaction to captions', async () => {
    const fetcher = makeListMediaFetcher(
      [
        {
          id: 'p1',
          media_type: 'IMAGE',
          media_url: 'https://cdn/m1.jpg',
          caption: 'Call us at +255 712 345 678 — email info@borjie.ai',
          timestamp: '2026-05-20T08:00:00Z',
          like_count: 12,
          comments_count: 3,
        },
      ],
    );
    const out = await pollInstagram({
      tenantId: 'tenant-a',
      account: 'ig-bus-1',
      accessToken: 'tok',
      cursor: null,
      salt: 'salt-1',
      fetcher,
      clock,
      auditHash: () => 'hash-1',
    });
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]?.caption).not.toContain('+255');
    expect(out.posts[0]?.caption).not.toContain('info@borjie.ai');
    expect(out.posts[0]?.metrics['likes']).toBe(12);
  });
});

describe('normaliseMedia', () => {
  it('maps media_type to the canonical kind', () => {
    const post = normaliseMedia({
      tenantId: 'tenant-a',
      account: 'ig-bus-1',
      raw: { id: 'p1', media_type: 'CAROUSEL_ALBUM' },
      redactedCaption: 'hello',
      ingestedAt: '2026-05-26T10:00:00.000Z',
      auditHash: 'h',
    });
    expect(post.kind).toBe('carousel_album');
    expect(post.caption).toBe('hello');
  });

  it('throws on missing id', () => {
    expect(() =>
      normaliseMedia({
        tenantId: 'tenant-a',
        account: 'ig-bus-1',
        raw: { media_type: 'IMAGE' },
        redactedCaption: null,
        ingestedAt: '2026-05-26T10:00:00.000Z',
        auditHash: 'h',
      }),
    ).toThrow();
  });
});

describe('redactor', () => {
  it('redacts NIDA, phone, and email patterns', () => {
    const redacted = redactFreeText(
      'NIDA 12345678-1234-1234, call +255 712 345 678, info@borjie.ai',
    );
    expect(redacted).not.toContain('12345678');
    expect(redacted).not.toContain('+255 712 345 678');
    expect(redacted).not.toContain('info@borjie.ai');
  });

  it('hashes usernames deterministically with a per-tenant salt', () => {
    const a = hashUsername('salt-1', 'john_doe');
    const b = hashUsername('salt-1', 'john_doe');
    const c = hashUsername('salt-2', 'john_doe');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('redactCaption replaces @-mentions with hashed handles', () => {
    const out = redactCaption({
      caption: 'thanks @borjie_team for the help',
      salt: 's',
    });
    expect(out).toMatch(/@h_[a-f0-9]{16}/);
    expect(out).not.toContain('@borjie_team');
  });
});

describe('repository idempotency', () => {
  it('returns inserted=false on duplicate (tenant, account, post_id)', async () => {
    const repo = createInMemoryInstagramPostsRepository();
    const post = {
      tenantId: 'tenant-a',
      account: 'ig-1',
      postId: 'p1',
      kind: 'image' as const,
      caption: null,
      mediaUrls: [],
      metrics: {},
      postedAt: null,
      raw: {},
      ingestedAt: '2026-05-26T10:00:00Z',
      auditHash: 'h',
    } as const;
    const a = await repo.upsert(post);
    const b = await repo.upsert(post);
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
  });
});
