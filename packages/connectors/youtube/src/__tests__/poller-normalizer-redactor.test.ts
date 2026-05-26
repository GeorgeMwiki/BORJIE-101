import { describe, expect, it } from 'vitest';
import { pollYouTube } from '../ingest/poller.js';
import {
  normaliseVideo,
  parseIso8601Duration,
} from '../ingest/normalizer.js';
import {
  hashChannelId,
  redactDescription,
  redactFreeText,
} from '../redact/pii-redactor.js';
import { createInMemoryYouTubeVideosRepository } from '../repositories/youtube-videos-repository.js';
import type { ClockPort, FetcherPort } from '../types.js';

const clock: ClockPort = Object.freeze({
  nowIso: () => '2026-05-26T10:00:00.000Z',
});

/**
 * pollYouTube hits search.list (returns videoIds) then videos.list.
 * Switch by URL substring.
 */
function makeFetcher(
  searchItems: ReadonlyArray<Record<string, unknown>>,
  videoItems: ReadonlyArray<Record<string, unknown>>,
): FetcherPort {
  return Object.freeze({
    fetch: async (url: string) => {
      const isVideos = url.includes('/videos');
      const body = isVideos
        ? JSON.stringify({ items: videoItems })
        : JSON.stringify({ items: searchItems });
      return {
        status: 200,
        headers: {},
        text: async () => body,
      };
    },
  });
}

describe('pollYouTube', () => {
  it('chains search.list -> videos.list and redacts descriptions', async () => {
    const channelTrigger = 'UCabcdefghijklmnopqrstuv';
    const search = [
      { id: { videoId: 'vid_001' }, snippet: {} },
    ];
    const videos = [
      {
        id: 'vid_001',
        snippet: {
          title: 'Tour at Boji',
          description: `Hi, see channel ${channelTrigger} for more — email info@borjie.ai`,
          publishedAt: '2026-05-20T08:00:00Z',
        },
        statistics: {
          viewCount: '1500',
          likeCount: '42',
          commentCount: '3',
        },
        contentDetails: { duration: 'PT4M33S' },
      },
    ];
    const fetcher = makeFetcher(search, videos);
    const out = await pollYouTube({
      tenantId: 'tenant-a',
      channelId: 'UCfoofoofoofoofoofoofoo',
      accessToken: 'tok',
      pageToken: null,
      salt: 'salt-1',
      fetcher,
      clock,
      auditHash: () => 'h-1',
    });
    expect(out.videos).toHaveLength(1);
    expect(out.videos[0]?.title).toBe('Tour at Boji');
    expect(out.videos[0]?.viewCount).toBe(1500);
    expect(out.videos[0]?.durationS).toBe(273);
    expect(out.videos[0]?.description).not.toContain('info@borjie.ai');
    expect(out.videos[0]?.description).not.toContain(channelTrigger);
  });

  it('returns empty when search.list has zero items', async () => {
    const fetcher = makeFetcher([], []);
    const out = await pollYouTube({
      tenantId: 'tenant-a',
      channelId: 'UCfoofoofoofoofoofoofoo',
      accessToken: 'tok',
      pageToken: null,
      salt: 'salt-1',
      fetcher,
      clock,
      auditHash: () => 'h',
    });
    expect(out.videos).toHaveLength(0);
  });
});

describe('parseIso8601Duration', () => {
  it('handles PT#M#S and PT#H#M#S', () => {
    expect(parseIso8601Duration('PT4M33S')).toBe(273);
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
    expect(parseIso8601Duration('PT15S')).toBe(15);
    expect(parseIso8601Duration(null)).toBeNull();
    expect(parseIso8601Duration('garbage')).toBeNull();
  });
});

describe('normaliseVideo', () => {
  it('parses statistics counts as numbers', () => {
    const v = normaliseVideo({
      tenantId: 'tenant-a',
      channelId: 'UC1',
      raw: {
        id: 'v1',
        snippet: { title: 'T', publishedAt: '2026-05-20T08:00:00Z' },
        statistics: { viewCount: '7', likeCount: '3' },
        contentDetails: { duration: 'PT1M' },
      },
      redactedDescription: 'd',
      ingestedAt: '2026-05-26T10:00:00.000Z',
      auditHash: 'h',
    });
    expect(v.viewCount).toBe(7);
    expect(v.likeCount).toBe(3);
    expect(v.durationS).toBe(60);
  });

  it('throws on missing id', () => {
    expect(() =>
      normaliseVideo({
        tenantId: 'tenant-a',
        channelId: 'UC1',
        raw: {},
        redactedDescription: null,
        ingestedAt: '2026-05-26T10:00:00.000Z',
        auditHash: 'h',
      }),
    ).toThrow();
  });
});

describe('YouTube redactor', () => {
  it('redacts NIDA + phone + email + channel-ids', () => {
    const channel = 'UCabcdefghijklmnopqrstuv';
    const r = redactDescription({
      description: `${channel} — call +255 712 345 678 — info@borjie.ai`,
      salt: 's',
    });
    expect(r).not.toContain('info@borjie.ai');
    expect(r).not.toContain(channel);
    expect(r).toMatch(/UC_h_[a-f0-9]{16}/);
  });

  it('redactFreeText handles plain free-text', () => {
    const r = redactFreeText('NIDA 12345678-1234-1234, info@borjie.ai');
    expect(r).not.toContain('12345678');
    expect(r).not.toContain('info@borjie.ai');
  });

  it('hashChannelId is deterministic per salt', () => {
    expect(hashChannelId('s', 'UCabc')).toBe(hashChannelId('s', 'UCabc'));
    expect(hashChannelId('s', 'UCabc')).not.toBe(
      hashChannelId('s2', 'UCabc'),
    );
  });
});

describe('youtube videos repo idempotency', () => {
  it('returns inserted=false on duplicate (tenant, channel, video)', async () => {
    const repo = createInMemoryYouTubeVideosRepository();
    const video = {
      tenantId: 'tenant-a',
      channelId: 'UC1',
      videoId: 'v1',
      title: null,
      description: null,
      durationS: null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      publishedAt: null,
      raw: {},
      ingestedAt: '2026-05-26T10:00:00Z',
      auditHash: 'h',
    } as const;
    const a = await repo.upsert(video);
    const b = await repo.upsert(video);
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
  });
});
