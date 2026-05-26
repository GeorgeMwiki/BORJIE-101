/**
 * YouTube poller. Lists recent videos (search.list) then hits
 * videos.list to refresh statistics. Default 6h cadence.
 *
 * Spec: Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md §2.6 + §7.
 */

import {
  searchChannelVideos,
  videosList,
} from '../client/youtube-client.js';
import { redactDescription } from '../redact/pii-redactor.js';
import { normaliseVideo } from './normalizer.js';
import type {
  ClockPort,
  FetcherPort,
  Logger,
  YouTubeVideo,
} from '../types.js';

export interface PollParams {
  readonly tenantId: string;
  readonly channelId: string;
  readonly accessToken: string;
  readonly pageToken: string | null;
  readonly salt: string;
  readonly fetcher: FetcherPort;
  readonly clock: ClockPort;
  readonly auditHash: (payload: Readonly<Record<string, unknown>>) => string;
  readonly logger?: Logger;
}

export interface PollOutcome {
  readonly videos: ReadonlyArray<YouTubeVideo>;
  readonly nextPageToken: string | null;
}

export async function pollYouTube(
  params: PollParams,
): Promise<PollOutcome> {
  const search = await searchChannelVideos({
    accessToken: params.accessToken,
    channelId: params.channelId,
    ...(params.pageToken !== null && { pageToken: params.pageToken }),
    fetcher: params.fetcher,
  });
  const ids = search.items
    .map((it) => {
      const id = it['id'];
      if (id !== null && typeof id === 'object') {
        const idObj = id as { videoId?: unknown };
        if (typeof idObj.videoId === 'string') return idObj.videoId;
      }
      return null;
    })
    .filter((x): x is string => x !== null);

  if (ids.length === 0) {
    params.logger?.info('youtube poll empty', {
      channelId: params.channelId,
    });
    return Object.freeze({
      videos: [],
      nextPageToken: search.nextPageToken,
    });
  }

  const stats = await videosList({
    accessToken: params.accessToken,
    videoIds: ids,
    fetcher: params.fetcher,
  });

  const videos: YouTubeVideo[] = [];
  for (const raw of stats.items) {
    const snippet = (raw['snippet'] ?? {}) as Record<string, unknown>;
    const desc =
      typeof snippet['description'] === 'string'
        ? (snippet['description'] as string)
        : null;
    const redacted = redactDescription({
      description: desc,
      salt: params.salt,
    });
    const ingestedAt = params.clock.nowIso();
    const payload = {
      id: raw['id'],
      tenantId: params.tenantId,
      channelId: params.channelId,
      ingestedAt,
    };
    videos.push(
      normaliseVideo({
        tenantId: params.tenantId,
        channelId: params.channelId,
        raw,
        redactedDescription: redacted,
        ingestedAt,
        auditHash: params.auditHash(payload),
      }),
    );
  }
  params.logger?.info('youtube poll complete', {
    tenantId: params.tenantId,
    channelId: params.channelId,
    count: videos.length,
  });
  return Object.freeze({
    videos,
    nextPageToken: search.nextPageToken,
  });
}
