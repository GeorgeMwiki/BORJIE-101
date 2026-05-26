/**
 * Facebook poller. Default 6h.
 */

import { listPosts } from '../client/facebook-client.js';
import { redactMessage } from '../redact/pii-redactor.js';
import { normalisePost } from './normalizer.js';
import type {
  ClockPort,
  FacebookPost,
  FetcherPort,
  Logger,
} from '../types.js';

export interface PollParams {
  readonly tenantId: string;
  readonly account: string;
  readonly accessToken: string;
  readonly cursor: string | null;
  readonly salt: string;
  readonly fetcher: FetcherPort;
  readonly clock: ClockPort;
  readonly auditHash: (payload: Readonly<Record<string, unknown>>) => string;
  readonly logger?: Logger;
}

export interface PollOutcome {
  readonly posts: ReadonlyArray<FacebookPost>;
  readonly nextCursor: string | null;
}

export async function pollFacebook(
  params: PollParams,
): Promise<PollOutcome> {
  const res = await listPosts({
    accessToken: params.accessToken,
    account: params.account,
    ...(params.cursor !== null && { cursor: params.cursor }),
    fetcher: params.fetcher,
  });
  const posts: FacebookPost[] = [];
  for (const raw of res.items) {
    const message =
      typeof raw['message'] === 'string' ? raw['message'] : null;
    const redacted = redactMessage({ message, salt: params.salt });
    const ingestedAt = params.clock.nowIso();
    const post = normalisePost({
      tenantId: params.tenantId,
      account: params.account,
      raw,
      redactedMessage: redacted,
      ingestedAt,
      auditHash: params.auditHash({
        id: raw['id'],
        tenantId: params.tenantId,
        account: params.account,
        ingestedAt,
      }),
    });
    posts.push(post);
  }
  params.logger?.info('facebook poll complete', {
    tenantId: params.tenantId,
    account: params.account,
    count: posts.length,
  });
  return Object.freeze({ posts, nextCursor: res.nextCursor });
}
