/**
 * TikTok channel adapter — TikTok Marketing API.
 *
 * Env-gated: requires `TIKTOK_ACCESS_TOKEN` + `TIKTOK_ADVERTISER_ID`
 * (for ads) or `TIKTOK_BUSINESS_ID` (for organic).
 */

import type { Channel, ComposedAsset } from '../types.js';
import {
  envGap,
  readEnv,
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

const ORGANIC_ENV = ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_BUSINESS_ID'] as const;
const ADS_ENV = ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'] as const;

function buildAdapter(
  channel: Channel,
  envKeys: ReadonlyArray<string>,
): ChannelAdapter {
  return Object.freeze({
    channel,
    publish: async (
      asset: ComposedAsset,
      ctx: PublishContext,
    ): Promise<PublishResult> => {
      const env = readEnv(envKeys, ctx.env);
      const missing = envKeys.filter((k) => env[k] === undefined);
      if (missing.length > 0) {
        return envGap(channel, missing);
      }
      if (ctx.dry_run === true) {
        return {
          ok: true,
          channel_post_id: `tt-dry-${asset.id}`,
          permalink: `https://www.tiktok.com/@borjie/video/${asset.id}`,
          published_at: new Date().toISOString(),
        };
      }
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: 'TikTok production publish not yet wired',
      };
    },
  });
}

export const tiktokOrganicAdapter = buildAdapter('tiktok_organic', ORGANIC_ENV);
export const tiktokAdsAdapter = buildAdapter('tiktok_ads', ADS_ENV);
