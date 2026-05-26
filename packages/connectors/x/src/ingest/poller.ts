/**
 * X poller. Default 15min cadence. Pulls timeline + mentions.
 *
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.4 + §7.
 */

import { listMentions, listTweets } from '../client/x-client.js';
import { redactTweetText } from '../redact/pii-redactor.js';
import { normaliseTweet } from './normalizer.js';
import type {
  ClockPort,
  FetcherPort,
  Logger,
  XPost,
} from '../types.js';

export interface PollParams {
  readonly tenantId: string;
  readonly account: string;
  readonly userId: string;
  readonly accessToken: string;
  readonly timelineCursor: string | null;
  readonly mentionsCursor: string | null;
  readonly salt: string;
  readonly fetcher: FetcherPort;
  readonly clock: ClockPort;
  readonly auditHash: (payload: Readonly<Record<string, unknown>>) => string;
  readonly logger?: Logger;
}

export interface PollOutcome {
  readonly posts: ReadonlyArray<XPost>;
  readonly nextTimelineCursor: string | null;
  readonly nextMentionsCursor: string | null;
}

export async function pollX(params: PollParams): Promise<PollOutcome> {
  const [timeline, mentions] = await Promise.all([
    listTweets({
      accessToken: params.accessToken,
      userId: params.userId,
      ...(params.timelineCursor !== null && {
        cursor: params.timelineCursor,
      }),
      fetcher: params.fetcher,
    }),
    listMentions({
      accessToken: params.accessToken,
      userId: params.userId,
      ...(params.mentionsCursor !== null && {
        cursor: params.mentionsCursor,
      }),
      fetcher: params.fetcher,
    }),
  ]);

  const all = [...timeline.items, ...mentions.items];
  const seen = new Set<string>();
  const posts: XPost[] = [];
  for (const raw of all) {
    const id = raw['id'];
    if (typeof id !== 'string') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const text = typeof raw['text'] === 'string' ? raw['text'] : null;
    const redacted = redactTweetText({ text, salt: params.salt });
    const ingestedAt = params.clock.nowIso();
    const payload = {
      id,
      tenantId: params.tenantId,
      account: params.account,
      ingestedAt,
    };
    posts.push(
      normaliseTweet({
        tenantId: params.tenantId,
        account: params.account,
        raw,
        redactedText: redacted,
        ingestedAt,
        auditHash: params.auditHash(payload),
      }),
    );
  }
  params.logger?.info('x poll complete', {
    tenantId: params.tenantId,
    account: params.account,
    count: posts.length,
  });
  return Object.freeze({
    posts,
    nextTimelineCursor: timeline.nextCursor,
    nextMentionsCursor: mentions.nextCursor,
  });
}
