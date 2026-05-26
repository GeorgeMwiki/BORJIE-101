/**
 * Meta channel adapter — Graph API v19 (Facebook + Instagram organic
 * + ads).
 *
 * Env-gated: requires `META_PAGE_ACCESS_TOKEN` + `META_PAGE_ID` for
 * organic; ads adds `META_AD_ACCOUNT_ID`.
 */

import type { Channel, ComposedAsset } from '../types.js';
import {
  envGap,
  readEnv,
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

const ORGANIC_ENV = ['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID'] as const;
const ADS_ENV = [...ORGANIC_ENV, 'META_AD_ACCOUNT_ID'] as const;

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
          channel_post_id: `meta-dry-${asset.id}`,
          permalink: `https://www.facebook.com/${env['META_PAGE_ID']}/posts/${asset.id}`,
          published_at: new Date().toISOString(),
        };
      }
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: 'Meta production publish not yet wired',
      };
    },
  });
}

export const metaOrganicAdapter = buildAdapter('meta_organic', ORGANIC_ENV);
export const metaAdsAdapter = buildAdapter('meta_ads', ADS_ENV);
