import { describe, expect, it } from 'vitest';
import { pollTikTok } from '../ingest/poller.js';
import { normaliseVideo } from '../ingest/normalizer.js';
import {
  hashUsername,
  redactCaption,
  redactFreeText,
} from '../redact/pii-redactor.js';
import { createInMemoryTikTokPostsRepository } from '../repositories/tiktok-posts-repository.js';
import type { ClockPort, FetcherPort } from '../types.js';

const clock: ClockPort = Object.freeze({
  nowIso: () => '2026-05-26T10:00:00.000Z',
});

function makeListVideosFetcher(
  items: ReadonlyArray<Record<string, unknown>>,
  nextCursor: string | null = null,
): FetcherPort {
  return Object.freeze({
    fetch: async () => ({
      status: 200,
      headers: {},
      text: async () =>
        JSON.stringify({
          data: {
            list: items,
            page_info: nextCursor !== null ? { next_cursor: nextCursor } : {},
          },
        }),
    }),
  });
}

describe('pollTikTok', () => {
  it('normalises items and applies redaction to captions', async () => {
    const fetcher = makeListVideosFetcher([
      {
        video_id: 'v1',
        video_type: 'video',
        embed_url: 'https://cdn/v1.mp4',
        video_description:
          'Hi @tiktok_user, ring +255 712 345 678 or info@borjie.ai',
        create_time: 1716192000,
        play_count: 1000,
        like_count: 42,
        comment_count: 5,
      },
    ]);
    const out = await pollTikTok({
      tenantId: 'tenant-a',
      account: 'tk-1',
      advertiserId: 'adv-1',
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
    expect(out.posts[0]?.caption).not.toContain('@tiktok_user');
    expect(out.posts[0]?.metrics['like_count']).toBe(42);
  });
});

describe('normaliseVideo', () => {
  it('maps video_type to kind', () => {
    const post = normaliseVideo({
      tenantId: 'tenant-a',
      account: 'tk-1',
      raw: { video_id: 'v1', video_type: 'live_replay' },
      redactedCaption: 'hello',
      ingestedAt: '2026-05-26T10:00:00.000Z',
      auditHash: 'h',
    });
    expect(post.kind).toBe('live_replay');
  });

  it('throws on missing id', () => {
    expect(() =>
      normaliseVideo({
        tenantId: 'tenant-a',
        account: 'tk-1',
        raw: { video_type: 'video' },
        redactedCaption: null,
        ingestedAt: '2026-05-26T10:00:00.000Z',
        auditHash: 'h',
      }),
    ).toThrow();
  });
});

describe('TikTok redactor', () => {
  it('redacts NIDA, phone, email', () => {
    const r = redactFreeText(
      'NIDA 12345678-1234-1234, call +255 712 345 678, info@borjie.ai',
    );
    expect(r).not.toContain('+255');
    expect(r).not.toContain('info@borjie.ai');
  });

  it('hashes usernames deterministically per salt', () => {
    const a = hashUsername('salt-1', 'tiktoker');
    const b = hashUsername('salt-1', 'tiktoker');
    const c = hashUsername('salt-2', 'tiktoker');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('redactCaption substitutes @-mentions with hashes', () => {
    const out = redactCaption({ caption: 'shout-out @creator', salt: 's' });
    expect(out).toMatch(/@h_[a-f0-9]{16}/);
    expect(out).not.toContain('@creator');
  });
});

describe('tiktok repo idempotency', () => {
  it('returns inserted=false on duplicate (tenant, account, post_id)', async () => {
    const repo = createInMemoryTikTokPostsRepository();
    const post = {
      tenantId: 'tenant-a',
      account: 'tk-1',
      postId: 'v1',
      kind: 'video' as const,
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
