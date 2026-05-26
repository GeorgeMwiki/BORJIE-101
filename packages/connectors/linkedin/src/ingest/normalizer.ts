/**
 * Normaliser: LinkedIn /rest/posts element -> canonical LinkedInPost.
 *
 * Pure function. No I/O.
 */

import type { LinkedInKind, LinkedInPost } from '../types.js';

export interface NormalizeParams {
  readonly tenantId: string;
  readonly account: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly redactedCaption: string | null;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export function normalisePost(params: NormalizeParams): LinkedInPost {
  const raw = params.raw;
  const idVal = raw['id'];
  if (typeof idVal !== 'string' || idVal === '') {
    throw new Error('LinkedIn post payload missing id');
  }
  const kind: LinkedInKind = mapKind(raw);
  const mediaUrls: string[] = [];
  // LinkedIn content shapes; we only attempt URL extraction shallow.
  const content = raw['content'] as Record<string, unknown> | undefined;
  if (content && typeof content === 'object') {
    const media = content['media'] as Record<string, unknown> | undefined;
    if (media && typeof media['id'] === 'string') {
      mediaUrls.push(media['id']);
    }
  }
  const postedAt = pickIso(raw['createdAt']) ?? pickIso(raw['publishedAt']);
  return Object.freeze({
    tenantId: params.tenantId,
    account: params.account,
    postId: idVal,
    kind,
    caption: params.redactedCaption,
    mediaUrls: Object.freeze(mediaUrls),
    metrics: Object.freeze({}),
    postedAt,
    raw: params.raw,
    ingestedAt: params.ingestedAt,
    auditHash: params.auditHash,
  });
}

function mapKind(raw: Readonly<Record<string, unknown>>): LinkedInKind {
  const content = raw['content'] as Record<string, unknown> | undefined;
  if (content && typeof content === 'object') {
    if (content['article']) return 'article';
    if (content['video']) return 'video';
    if (content['image']) return 'image';
    if (content['event']) return 'event';
    if (content['document']) return 'document';
  }
  return 'share';
}

function pickIso(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  return null;
}
