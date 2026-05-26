/**
 * X (Twitter) channel adapter — X API v2.
 *
 * Env-gated: requires `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
 * `X_ACCESS_SECRET`. Paid tier required for publish (`free` tier is
 * read-only).
 */

import type { Channel, ComposedAsset } from '../types.js';
import {
  envGap,
  readEnv,
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

const REQUIRED_ENV = [
  'X_API_KEY',
  'X_API_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_SECRET',
] as const;

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
          channel_post_id: `x-dry-${asset.id}`,
          permalink: `https://x.com/i/web/status/${asset.id}`,
          published_at: new Date().toISOString(),
        };
      }
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: 'X production publish not yet wired',
      };
    },
  });
}

export const xOrganicAdapter = buildAdapter('x_organic');
export const xAdsAdapter = buildAdapter('x_ads');
