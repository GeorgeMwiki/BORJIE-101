import { describe, expect, it } from 'vitest';
import { pollFacebook } from '../ingest/poller.js';
import { normalisePost } from '../ingest/normalizer.js';
import {
  hashHandle,
  redactMessage,
} from '../redact/pii-redactor.js';
import { createInMemoryFacebookPostsRepository } from '../repositories/facebook-posts-repository.js';
import type { ClockPort, FetcherPort } from '../types.js';

const clock: ClockPort = Object.freeze({
  nowIso: () => '2026-05-26T10:00:00.000Z',
});

function listFetcher(
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
          paging:
            nextCursor !== null ? { cursors: { after: nextCursor } } : {},
        }),
    }),
  });
}

describe('pollFacebook', () => {
  it('normalises posts and applies message redaction', async () => {
    const fetcher = listFetcher([
      {
        id: 'p1',
        message:
          'thanks @mwikila — text us +255 712 345 678 or email info@borjie.ai',
        created_time: '2026-05-20T08:00:00Z',
        attachments: { data: [{ type: 'photo' }] },
        reactions: { summary: { total_count: 5 } },
      },
    ]);
    const out = await pollFacebook({
      tenantId: 'tenant-a',
      account: 'page-1',
      accessToken: 'tok',
      cursor: null,
      salt: 'salt',
      fetcher,
      clock,
      auditHash: () => 'h-1',
    });
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]?.caption).not.toContain('+255 712 345 678');
    expect(out.posts[0]?.caption).not.toContain('info@borjie.ai');
    expect(out.posts[0]?.kind).toBe('photo');
    expect(out.posts[0]?.metrics['reactions']).toBe(5);
  });
});

describe('normalisePost', () => {
  it('defaults kind to status when no attachments', () => {
    const post = normalisePost({
      tenantId: 'tenant-a',
      account: 'page-1',
      raw: { id: 'p1' },
      redactedMessage: 'hello',
      ingestedAt: '2026-05-26T10:00:00Z',
      auditHash: 'h',
    });
    expect(post.kind).toBe('status');
    expect(post.caption).toBe('hello');
  });

  it('throws on missing id', () => {
    expect(() =>
      normalisePost({
        tenantId: 'tenant-a',
        account: 'page-1',
        raw: {},
        redactedMessage: null,
        ingestedAt: '2026-05-26T10:00:00Z',
        auditHash: 'h',
      }),
    ).toThrow();
  });
});

describe('redactMessage', () => {
  it('replaces @[id:name] mentions with hashed handles', () => {
    const out = redactMessage({
      message: 'hello @[123:John Doe] welcome',
      salt: 'salt',
    });
    expect(out).toMatch(/@h_[a-f0-9]{16}/);
    expect(out).not.toContain('John Doe');
  });

  it('hashes consistently with the same salt', () => {
    const a = hashHandle('s', 'john');
    const b = hashHandle('s', 'john');
    expect(a).toBe(b);
  });
});

describe('repository idempotency', () => {
  it('returns inserted=false on duplicate (tenant, account, post_id)', async () => {
    const repo = createInMemoryFacebookPostsRepository();
    const post = {
      tenantId: 'tenant-a',
      account: 'page-1',
      postId: 'p1',
      kind: 'photo' as const,
      caption: 'hi',
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
