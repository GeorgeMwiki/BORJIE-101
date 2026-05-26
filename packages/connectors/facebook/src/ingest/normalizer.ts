/**
 * Normaliser: Graph /posts payload -> canonical FacebookPost.
 */

import type { FacebookKind, FacebookPost } from '../types.js';

export interface NormalizeParams {
  readonly tenantId: string;
  readonly account: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly redactedMessage: string | null;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export function normalisePost(params: NormalizeParams): FacebookPost {
  const raw = params.raw;
  const idVal = raw['id'];
  if (typeof idVal !== 'string' || idVal === '') {
    throw new Error('Facebook post payload missing id');
  }
  const kind = inferKind(raw);
  const mediaUrls: string[] = [];
  const attachments = raw['attachments'];
  if (
    attachments &&
    typeof attachments === 'object' &&
    'data' in (attachments as Record<string, unknown>)
  ) {
    const dataArr = (attachments as { data?: ReadonlyArray<unknown> }).data ?? [];
    for (const a of dataArr) {
      if (typeof a === 'object' && a !== null) {
        const obj = a as Record<string, unknown>;
        if (typeof obj['url'] === 'string') {
          mediaUrls.push(obj['url']);
        } else if (typeof obj['media_url'] === 'string') {
          mediaUrls.push(obj['media_url']);
        }
      }
    }
  }
  const metrics: Record<string, number> = {};
  const reactions = raw['reactions'];
  if (
    reactions &&
    typeof reactions === 'object' &&
    'summary' in (reactions as Record<string, unknown>)
  ) {
    const s = (reactions as { summary?: { total_count?: number } }).summary;
    if (typeof s?.total_count === 'number') {
      metrics['reactions'] = s.total_count;
    }
  }
  const comments = raw['comments'];
  if (
    comments &&
    typeof comments === 'object' &&
    'summary' in (comments as Record<string, unknown>)
  ) {
    const s = (comments as { summary?: { total_count?: number } }).summary;
    if (typeof s?.total_count === 'number') {
      metrics['comments'] = s.total_count;
    }
  }
  const postedAt =
    typeof raw['created_time'] === 'string' ? raw['created_time'] : null;
  return Object.freeze({
    tenantId: params.tenantId,
    account: params.account,
    postId: idVal,
    kind,
    caption: params.redactedMessage,
    mediaUrls: Object.freeze(mediaUrls),
    metrics: Object.freeze(metrics),
    postedAt,
    raw,
    ingestedAt: params.ingestedAt,
    auditHash: params.auditHash,
  });
}

function inferKind(raw: Readonly<Record<string, unknown>>): FacebookKind {
  // Posts API doesn't return a canonical `type` post-Graph v3.3; we
  // infer from attachments. Default to 'status'.
  const att = raw['attachments'];
  if (
    att &&
    typeof att === 'object' &&
    Array.isArray((att as { data?: unknown[] }).data)
  ) {
    const dataArr = (att as { data: unknown[] }).data;
    const first = dataArr[0];
    if (first && typeof first === 'object') {
      const t = (first as Record<string, unknown>)['type'];
      if (t === 'photo') return 'photo';
      if (t === 'video_inline' || t === 'video_autoplay') return 'video';
      if (t === 'share') return 'link';
      if (t === 'event') return 'event';
      if (t === 'note') return 'note';
    }
  }
  return 'status';
}
