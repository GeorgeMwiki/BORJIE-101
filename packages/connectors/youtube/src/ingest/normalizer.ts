/**
 * Normaliser: YouTube videos.list element -> canonical YouTubeVideo.
 *
 * Pure function. No I/O. Expects merged snippet+statistics+
 * contentDetails payload (part=snippet,statistics,contentDetails).
 */

import type { YouTubeVideo } from '../types.js';

export interface NormalizeParams {
  readonly tenantId: string;
  readonly channelId: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly redactedDescription: string | null;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export function normaliseVideo(params: NormalizeParams): YouTubeVideo {
  const raw = params.raw;
  const idVal = raw['id'];
  if (typeof idVal !== 'string' || idVal === '') {
    throw new Error('YouTube video payload missing id');
  }
  const snippet = (raw['snippet'] ?? {}) as Record<string, unknown>;
  const stats = (raw['statistics'] ?? {}) as Record<string, unknown>;
  const content = (raw['contentDetails'] ?? {}) as Record<string, unknown>;
  return Object.freeze({
    tenantId: params.tenantId,
    channelId: params.channelId,
    videoId: idVal,
    title: typeof snippet['title'] === 'string' ? (snippet['title'] as string) : null,
    description: params.redactedDescription,
    durationS: parseIso8601Duration(
      typeof content['duration'] === 'string'
        ? (content['duration'] as string)
        : null,
    ),
    viewCount: toNumber(stats['viewCount']),
    likeCount: toNumber(stats['likeCount']),
    commentCount: toNumber(stats['commentCount']),
    publishedAt:
      typeof snippet['publishedAt'] === 'string'
        ? (snippet['publishedAt'] as string)
        : null,
    raw: params.raw,
    ingestedAt: params.ingestedAt,
    auditHash: params.auditHash,
  });
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * ISO-8601 duration parser. Supports PT#H#M#S forms (sufficient for
 * YouTube `contentDetails.duration`). Returns total seconds.
 */
export function parseIso8601Duration(d: string | null): number | null {
  if (d === null) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + s;
}
