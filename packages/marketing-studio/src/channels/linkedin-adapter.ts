/**
 * LinkedIn channel adapter — Marketing Developer Platform v202401.
 *
 * Env-gated: requires `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_ORG_URN`.
 * In tests + when keys absent, returns `{ ok: false, code: 'ENV_GAP' }`.
 */

import type { Channel, ComposedAsset } from '../types.js';
import {
  envGap,
  readEnv,
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

const REQUIRED_ENV = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORG_URN'] as const;

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
          channel_post_id: `li-dry-${asset.id}`,
          permalink: `https://www.linkedin.com/feed/update/urn:li:share:${asset.id}/`,
          published_at: new Date().toISOString(),
        };
      }
      // Production HTTP call elided — we keep the adapter env-gated
      // until the LinkedIn org_urn provisioning is finalized.
      return {
        ok: false,
        code: 'PROVIDER_ERROR',
        message: 'LinkedIn production publish not yet wired',
      };
    },
  });
}

export const linkedinOrganicAdapter = buildAdapter('linkedin_organic');
export const linkedinAdsAdapter = buildAdapter('linkedin_ads');
