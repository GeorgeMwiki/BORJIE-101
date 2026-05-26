/**
 * YouTube channel adapter — YouTube Data API v3.
 *
 * Env-gated: requires `YOUTUBE_OAUTH_TOKEN` + `YOUTUBE_CHANNEL_ID`.
 */

import type { Channel, ComposedAsset } from '../types.js';
import {
  envGap,
  readEnv,
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

const REQUIRED_ENV = ['YOUTUBE_OAUTH_TOKEN', 'YOUTUBE_CHANNEL_ID'] as const;

function buildAdapter(channel: Channel): ChannelAdapter {
  return Object.freeze({
    channel,
    publish: async (
      asset: ComposedAsset,
      ctx: PublishContext,
    ): Promise<PublishResult> => {
      const env = readEnv([...REQUIRED_ENV], ctx.env);
      const missing = REQUIRED_ENV.filter((k) => env[k] === undefined);
      if (missing.length > 0) {
        return envGap(channel, missing);
      }
      if (ctx.dry_run === true) {
        return {
          ok: true,
          channel_post_id: `yt-dry-${asset.id}`,
          permalink: `https://www.youtube.com/watch?v=${asset.id}`,
          published_at: new Date().toISOString(),
        };
      }
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: 'YouTube production publish not yet wired',
      };
    },
  });
}

export const youtubeOrganicAdapter = buildAdapter('youtube_organic');
export const youtubeAdsAdapter = buildAdapter('youtube_ads');
