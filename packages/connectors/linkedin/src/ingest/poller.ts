/**
 * LinkedIn poller. Default 1h cadence (no webhooks on standard tier).
 *
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.5 + §7.
 */

import { listPosts } from '../client/linkedin-client.js';
import { redactCaption } from '../redact/pii-redactor.js';
import { normalisePost } from './normalizer.js';
import type {
  ClockPort,
  FetcherPort,
  LinkedInPost,
  Logger,
} from '../types.js';

export interface PollParams {
  readonly tenantId: string;
  readonly account: string;
  readonly authorUrn: string;
  readonly accessToken: string;
  readonly start: number;
  readonly count?: number;
  readonly salt: string;
  readonly fetcher: FetcherPort;
  readonly clock: ClockPort;
  readonly auditHash: (payload: Readonly<Record<string, unknown>>) => string;
  readonly logger?: Logger;
}

export interface PollOutcome {
  readonly posts: ReadonlyArray<LinkedInPost>;
  readonly nextStart: number | null;
}

export async function pollLinkedIn(
  params: PollParams,
): Promise<PollOutcome> {
  const res = await listPosts({
    accessToken: params.accessToken,
    authorUrn: params.authorUrn,
    start: params.start,
    ...(params.count !== undefined && { count: params.count }),
    fetcher: params.fetcher,
  });
  const posts: LinkedInPost[] = [];
  for (const raw of res.items) {
    const commentary = raw['commentary'];
    const caption = typeof commentary === 'string' ? commentary : null;
    const redacted = redactCaption({ caption, salt: params.salt });
    const ingestedAt = params.clock.nowIso();
    const payload = {
      id: raw['id'],
      tenantId: params.tenantId,
      account: params.account,
      ingestedAt,
    };
    posts.push(
      normalisePost({
        tenantId: params.tenantId,
        account: params.account,
        raw,
        redactedCaption: redacted,
        ingestedAt,
        auditHash: params.auditHash(payload),
      }),
    );
  }
  params.logger?.info('linkedin poll complete', {
    tenantId: params.tenantId,
    account: params.account,
    count: posts.length,
  });
  return Object.freeze({
    posts,
    nextStart: res.nextStart,
  });
}
