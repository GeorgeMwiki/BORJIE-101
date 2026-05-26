/**
 * Normaliser: TikTok video payload -> canonical TikTokPost row.
 *
 * Pure function. No I/O.
 */

import type { TikTokKind, TikTokPost } from '../types.js';

export interface NormalizeParams {
  readonly tenantId: string;
  readonly account: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly redactedCaption: string | null;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export function normaliseVideo(params: NormalizeParams): TikTokPost {
  const raw = params.raw;
  const idVal = raw['video_id'] ?? raw['id'];
  if (typeof idVal !== 'string' || idVal === '') {
    throw new Error('TikTok video payload missing id');
  }
  const kind = mapKind(raw['video_type']);
  const mediaUrls: string[] = [];
  const embed = raw['embed_url'];
  if (typeof embed === 'string' && embed !== '') {
    mediaUrls.push(embed);
  }
  const metrics: Record<string, number> = {};
  for (const key of [
    'play_count',
    'like_count',
    'comment_count',
    'share_count',
  ] as const) {
    const v = raw[key];
    if (typeof v === 'number') metrics[key] = v;
  }
  const postedAt =
    typeof raw['create_time'] === 'string'
      ? raw['create_time']
      : typeof raw['create_time'] === 'number'
        ? new Date(raw['create_time'] * 1000).toISOString()
        : null;
  return Object.freeze({
    tenantId: params.tenantId,
    account: params.account,
    postId: idVal,
    kind,
    caption: params.redactedCaption,
    mediaUrls: Object.freeze(mediaUrls),
    metrics: Object.freeze(metrics),
    postedAt,
    raw: params.raw,
    ingestedAt: params.ingestedAt,
    auditHash: params.auditHash,
  });
}

function mapKind(value: unknown): TikTokKind {
  if (value === 'photo') return 'photo';
  if (value === 'live_replay') return 'live_replay';
  return 'video';
}
