/**
 * TikTok poller. Default 6h cadence; webhook opt-in.
 *
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.3 + §7.
 */

import { listVideos } from '../client/tiktok-client.js';
import { redactCaption } from '../redact/pii-redactor.js';
import { normaliseVideo } from './normalizer.js';
import type {
  ClockPort,
  FetcherPort,
  Logger,
  TikTokPost,
} from '../types.js';

export interface PollParams {
  readonly tenantId: string;
  readonly account: string;
  readonly advertiserId: string;
  readonly accessToken: string;
  readonly cursor: string | null;
  readonly salt: string;
  readonly fetcher: FetcherPort;
  readonly clock: ClockPort;
  readonly auditHash: (payload: Readonly<Record<string, unknown>>) => string;
  readonly logger?: Logger;
}

export interface PollOutcome {
  readonly posts: ReadonlyArray<TikTokPost>;
  readonly nextCursor: string | null;
}

export async function pollTikTok(
  params: PollParams,
): Promise<PollOutcome> {
  const res = await listVideos({
    accessToken: params.accessToken,
    advertiserId: params.advertiserId,
    ...(params.cursor !== null && { cursor: params.cursor }),
    fetcher: params.fetcher,
  });
  const posts: TikTokPost[] = [];
  for (const raw of res.items) {
    const caption =
      typeof raw['video_description'] === 'string'
        ? raw['video_description']
        : typeof raw['caption'] === 'string'
          ? raw['caption']
          : null;
    const redacted = redactCaption({ caption, salt: params.salt });
    const ingestedAt = params.clock.nowIso();
    const payload = {
      id: raw['video_id'] ?? raw['id'],
      tenantId: params.tenantId,
      account: params.account,
      ingestedAt,
    };
    posts.push(
      normaliseVideo({
        tenantId: params.tenantId,
        account: params.account,
        raw,
        redactedCaption: redacted,
        ingestedAt,
        auditHash: params.auditHash(payload),
      }),
    );
  }
  params.logger?.info('tiktok poll complete', {
    tenantId: params.tenantId,
    account: params.account,
    count: posts.length,
  });
  return Object.freeze({
    posts,
    nextCursor: res.nextCursor,
  });
}
