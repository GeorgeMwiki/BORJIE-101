import { describe, expect, it } from 'vitest';
import { pollX } from '../ingest/poller.js';
import { normaliseTweet } from '../ingest/normalizer.js';
import {
  hashUsername,
  redactFreeText,
  redactTweetText,
} from '../redact/pii-redactor.js';
import { createInMemoryXPostsRepository } from '../repositories/x-posts-repository.js';
import type { ClockPort, FetcherPort } from '../types.js';

const clock: ClockPort = Object.freeze({
  nowIso: () => '2026-05-26T10:00:00.000Z',
});

/**
 * pollX calls timeline + mentions back to back. We return different
 * payloads based on which path is in the URL.
 */
function makeFetcher(
  timeline: ReadonlyArray<Record<string, unknown>>,
  mentions: ReadonlyArray<Record<string, unknown>>,
): FetcherPort {
  return Object.freeze({
    fetch: async (url: string) => {
      const isMentions = url.includes('/mentions');
      const items = isMentions ? mentions : timeline;
      return {
        status: 200,
        headers: {},
        text: async () => JSON.stringify({ data: items, meta: {} }),
      };
    },
  });
}

describe('pollX', () => {
  it('normalises tweets + mentions and de-dups by id', async () => {
    const tweet = {
      id: 't1',
      text: 'NIDA 12345678-1234-1234 cc @mwikila',
      created_at: '2026-05-25T10:00:00Z',
      public_metrics: { like_count: 10, retweet_count: 2 },
    };
    const mention = { ...tweet }; // same id - should de-dup
    const fetcher = makeFetcher([tweet], [mention]);
    const out = await pollX({
      tenantId: 'tenant-a',
      account: 'borjie',
      userId: '12345',
      accessToken: 'tok',
      timelineCursor: null,
      mentionsCursor: null,
      salt: 'salt-1',
      fetcher,
      clock,
      auditHash: () => 'hash-1',
    });
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]?.text).not.toContain('NIDA 12345678');
    expect(out.posts[0]?.text).not.toContain('@mwikila');
    expect(out.posts[0]?.metrics['like_count']).toBe(10);
  });
});

describe('normaliseTweet', () => {
  it('maps referenced_tweets[0].type to reply/retweet/quote', () => {
    const reply = normaliseTweet({
      tenantId: 'tenant-a',
      account: 'borjie',
      raw: {
        id: 't1',
        referenced_tweets: [{ type: 'replied_to', id: 't0' }],
      },
      redactedText: null,
      ingestedAt: '2026-05-26T10:00:00.000Z',
      auditHash: 'h',
    });
    expect(reply.kind).toBe('reply');

    const rt = normaliseTweet({
      tenantId: 'tenant-a',
      account: 'borjie',
      raw: { id: 't2', referenced_tweets: [{ type: 'retweeted', id: 't0' }] },
      redactedText: null,
      ingestedAt: '2026-05-26T10:00:00.000Z',
      auditHash: 'h',
    });
    expect(rt.kind).toBe('retweet');
  });

  it('throws on missing id', () => {
    expect(() =>
      normaliseTweet({
        tenantId: 'tenant-a',
        account: 'borjie',
        raw: {},
        redactedText: null,
        ingestedAt: '2026-05-26T10:00:00.000Z',
        auditHash: 'h',
      }),
    ).toThrow();
  });
});

describe('X redactor', () => {
  it('redacts NIDA + phone + email', () => {
    const r = redactFreeText(
      'NIDA 12345678-1234-1234, call +255 712 345 678, info@borjie.ai',
    );
    expect(r).not.toContain('+255');
    expect(r).not.toContain('info@borjie.ai');
  });

  it('hashes handles deterministically per salt', () => {
    expect(hashUsername('s', 'mwikila')).toBe(hashUsername('s', 'mwikila'));
    expect(hashUsername('s', 'mwikila')).not.toBe(
      hashUsername('s2', 'mwikila'),
    );
  });

  it('redactTweetText replaces @-mentions with hashes', () => {
    const out = redactTweetText({ text: 'hi @mwikila', salt: 's' });
    expect(out).toMatch(/@h_[a-f0-9]{16}/);
    expect(out).not.toContain('@mwikila');
  });
});

describe('x repo idempotency', () => {
  it('returns inserted=false on duplicate (tenant, account, post_id)', async () => {
    const repo = createInMemoryXPostsRepository();
    const post = {
      tenantId: 'tenant-a',
      account: 'borjie',
      postId: 't1',
      kind: 'tweet' as const,
      text: null,
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
