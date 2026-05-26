/**
 * Normaliser: Graph-API media payload -> canonical InstagramPost row.
 *
 * Pure function. No I/O. Inputs are post-redaction; the redactor
 * runs at the boundary.
 */

import type { InstagramKind, InstagramPost } from '../types.js';

export interface NormalizeParams {
  readonly tenantId: string;
  readonly account: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly redactedCaption: string | null;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export function normaliseMedia(params: NormalizeParams): InstagramPost {
  const raw = params.raw;
  const idVal = raw['id'];
  if (typeof idVal !== 'string' || idVal === '') {
    throw new Error('Instagram media payload missing id');
  }
  const mediaType = raw['media_type'];
  const kind: InstagramKind = mapMediaType(mediaType);
  const mediaUrls: string[] = [];
  if (typeof raw['media_url'] === 'string' && raw['media_url'] !== '') {
    mediaUrls.push(raw['media_url']);
  }
  const metrics: Record<string, number> = {};
  if (typeof raw['like_count'] === 'number') {
    metrics['likes'] = raw['like_count'];
  }
  if (typeof raw['comments_count'] === 'number') {
    metrics['comments'] = raw['comments_count'];
  }
  const postedAt =
    typeof raw['timestamp'] === 'string' ? raw['timestamp'] : null;
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

function mapMediaType(value: unknown): InstagramKind {
  if (value === 'IMAGE') return 'image';
  if (value === 'VIDEO') return 'video';
  if (value === 'CAROUSEL_ALBUM') return 'carousel_album';
  if (value === 'REELS') return 'reels';
  if (value === 'STORY') return 'story';
  return 'image';
}
