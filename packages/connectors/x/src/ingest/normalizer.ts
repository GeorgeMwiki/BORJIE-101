/**
 * Normaliser: X v2 tweet payload -> canonical XPost row.
 *
 * Pure function. No I/O.
 */

import type { XKind, XPost } from '../types.js';

export interface NormalizeParams {
  readonly tenantId: string;
  readonly account: string;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly redactedText: string | null;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export function normaliseTweet(params: NormalizeParams): XPost {
  const raw = params.raw;
  const idVal = raw['id'];
  if (typeof idVal !== 'string' || idVal === '') {
    throw new Error('X tweet payload missing id');
  }
  const kind: XKind = mapKind(raw['referenced_tweets']);
  const metrics: Record<string, number> = {};
  const m = raw['public_metrics'];
  if (m !== null && typeof m === 'object') {
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (typeof v === 'number') metrics[k] = v;
    }
  }
  const postedAt =
    typeof raw['created_at'] === 'string' ? raw['created_at'] : null;
  return Object.freeze({
    tenantId: params.tenantId,
    account: params.account,
    postId: idVal,
    kind,
    text: params.redactedText,
    mediaUrls: Object.freeze([]),
    metrics: Object.freeze(metrics),
    postedAt,
    raw: params.raw,
    ingestedAt: params.ingestedAt,
    auditHash: params.auditHash,
  });
}

function mapKind(value: unknown): XKind {
  if (!Array.isArray(value) || value.length === 0) return 'tweet';
  const ref = value[0] as { type?: string } | undefined;
  const t = ref?.type;
  if (t === 'replied_to') return 'reply';
  if (t === 'retweeted') return 'retweet';
  if (t === 'quoted') return 'quote';
  return 'tweet';
}
