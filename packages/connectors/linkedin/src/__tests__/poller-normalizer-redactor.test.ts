import { describe, expect, it } from 'vitest';
import { pollLinkedIn } from '../ingest/poller.js';
import { normalisePost } from '../ingest/normalizer.js';
import {
  hashUrn,
  redactCaption,
  redactFreeText,
} from '../redact/pii-redactor.js';
import { createInMemoryLinkedInPostsRepository } from '../repositories/linkedin-posts-repository.js';
import type { ClockPort, FetcherPort } from '../types.js';

const clock: ClockPort = Object.freeze({
  nowIso: () => '2026-05-26T10:00:00.000Z',
});

function makeListPostsFetcher(
  items: ReadonlyArray<Record<string, unknown>>,
  paging: { start: number; count: number; total: number } | undefined = undefined,
): FetcherPort {
  return Object.freeze({
    fetch: async () => ({
      status: 200,
      headers: {},
      text: async () =>
        JSON.stringify({
          elements: items,
          paging: paging ?? { start: 0, count: items.length, total: items.length },
        }),
    }),
  });
}

describe('pollLinkedIn', () => {
  it('normalises posts and applies redaction to commentary', async () => {
    const fetcher = makeListPostsFetcher([
      {
        id: 'urn:li:share:7001',
        commentary:
          'Email info@borjie.ai, mention urn:li:person:abc123 in the post',
        content: { article: { source: 'https://x.test' } },
        publishedAt: 1716192000000,
      },
    ]);
    const out = await pollLinkedIn({
      tenantId: 'tenant-a',
      account: 'urn:li:organization:1234567',
      authorUrn: 'urn:li:organization:1234567',
      accessToken: 'tok',
      start: 0,
      salt: 'salt-1',
      fetcher,
      clock,
      auditHash: () => 'h-1',
    });
    expect(out.posts).toHaveLength(1);
    expect(out.posts[0]?.kind).toBe('article');
    expect(out.posts[0]?.caption).not.toContain('info@borjie.ai');
    expect(out.posts[0]?.caption).not.toContain('urn:li:person:abc123');
  });
});

describe('normalisePost', () => {
  it('maps content shapes to canonical kinds', () => {
    const video = normalisePost({
      tenantId: 'tenant-a',
      account: 'urn:li:organization:1',
      raw: { id: 'p1', content: { video: { url: 'x' } } },
      redactedCaption: null,
      ingestedAt: '2026-05-26T10:00:00.000Z',
      auditHash: 'h',
    });
    expect(video.kind).toBe('video');

    const share = normalisePost({
      tenantId: 'tenant-a',
      account: 'urn:li:organization:1',
      raw: { id: 'p2', content: {} },
      redactedCaption: null,
      ingestedAt: '2026-05-26T10:00:00.000Z',
      auditHash: 'h',
    });
    expect(share.kind).toBe('share');
  });

  it('throws on missing id', () => {
    expect(() =>
      normalisePost({
        tenantId: 'tenant-a',
        account: 'urn:li:organization:1',
        raw: {},
        redactedCaption: null,
        ingestedAt: '2026-05-26T10:00:00.000Z',
        auditHash: 'h',
      }),
    ).toThrow();
  });
});

describe('LinkedIn redactor', () => {
  it('redacts NIDA + phone + email', () => {
    const r = redactFreeText(
      'NIDA 12345678-1234-1234, call +255 712 345 678, info@borjie.ai',
    );
    expect(r).not.toContain('+255');
    expect(r).not.toContain('info@borjie.ai');
  });

  it('hashes member URN id deterministically per salt', () => {
    expect(hashUrn('s', 'abc123')).toBe(hashUrn('s', 'abc123'));
    expect(hashUrn('s', 'abc123')).not.toBe(hashUrn('s2', 'abc123'));
  });

  it('redactCaption substitutes person URNs with hashes', () => {
    const out = redactCaption({
      caption: 'shout-out urn:li:person:abc123 for the help',
      salt: 's',
    });
    expect(out).toMatch(/urn:li:person:h_[a-f0-9]{16}/);
    expect(out).not.toContain('urn:li:person:abc123');
  });
});

describe('linkedin repo idempotency', () => {
  it('returns inserted=false on duplicate (tenant, account, post_id)', async () => {
    const repo = createInMemoryLinkedInPostsRepository();
    const post = {
      tenantId: 'tenant-a',
      account: 'urn:li:organization:1',
      postId: 'urn:li:share:7001',
      kind: 'share' as const,
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
