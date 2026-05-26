/**
 * Google Ads channel adapter — Google Ads API v15.
 *
 * Env-gated: requires `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`,
 * `GOOGLE_ADS_OAUTH_TOKEN`.
 */

import type { ComposedAsset } from '../types.js';
import {
  envGap,
  readEnv,
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

const REQUIRED_ENV = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'GOOGLE_ADS_OAUTH_TOKEN',
] as const;

export const googleAdsAdapter: ChannelAdapter = Object.freeze({
  channel: 'google_ads' as const,
  publish: async (
    asset: ComposedAsset,
    ctx: PublishContext,
  ): Promise<PublishResult> => {
    const env = readEnv([...REQUIRED_ENV], ctx.env);
    const missing = REQUIRED_ENV.filter((k) => env[k] === undefined);
    if (missing.length > 0) {
      return envGap('google_ads', missing);
    }
    if (ctx.dry_run === true) {
      return {
        ok: true,
        channel_post_id: `gads-dry-${asset.id}`,
        permalink: `https://ads.google.com/campaigns/${asset.id}`,
        published_at: new Date().toISOString(),
      };
    }
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: 'Google Ads production publish not yet wired',
    };
  },
});
