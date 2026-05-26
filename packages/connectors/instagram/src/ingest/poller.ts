/**
 * Instagram poller. Default 6h cadence; reconciles missed webhooks.
 *
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §7.
 */

import { listMedia } from '../client/instagram-client.js';
import { redactCaption } from '../redact/pii-redactor.js';
import { normaliseMedia } from './normalizer.js';
import type {
  ClockPort,
  FetcherPort,
  InstagramPost,
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
  readonly posts: ReadonlyArray<InstagramPost>;
  readonly nextCursor: string | null;
}

export async function pollInstagram(
  params: PollParams,
): Promise<PollOutcome> {
  const res = await listMedia({
    accessToken: params.accessToken,
    account: params.account,
    ...(params.cursor !== null && { cursor: params.cursor }),
    fetcher: params.fetcher,
  });
  const posts: InstagramPost[] = [];
  for (const raw of res.items) {
    const caption =
      typeof raw['caption'] === 'string' ? raw['caption'] : null;
    const redacted = redactCaption({ caption, salt: params.salt });
    const ingestedAt = params.clock.nowIso();
    const payload = {
      id: raw['id'],
      tenantId: params.tenantId,
      account: params.account,
      ingestedAt,
    };
    const post = normaliseMedia({
      tenantId: params.tenantId,
      account: params.account,
      raw,
      redactedCaption: redacted,
      ingestedAt,
      auditHash: params.auditHash(payload),
    });
    posts.push(post);
  }
  params.logger?.info('instagram poll complete', {
    tenantId: params.tenantId,
    account: params.account,
    count: posts.length,
  });
  return Object.freeze({
    posts,
    nextCursor: res.nextCursor,
  });
}
