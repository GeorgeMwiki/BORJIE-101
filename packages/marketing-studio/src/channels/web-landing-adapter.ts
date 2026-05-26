/**
 * Web Landing adapter — writes the rendered HTML into a Vercel /
 * Next.js `apps/marketing/` route.
 *
 * In tests we never touch the filesystem — the adapter exposes the
 * intended path under `permalink`. Production wiring is delegated to
 * a separate route-writer in services/marketing-publish-worker (out
 * of scope for this wave).
 */

import type { ComposedAsset } from '../types.js';
import {
  type ChannelAdapter,
  type PublishContext,
  type PublishResult,
} from './_adapter.js';

export const webLandingAdapter: ChannelAdapter = Object.freeze({
  channel: 'web_landing' as const,
  publish: async (
    asset: ComposedAsset,
    ctx: PublishContext,
  ): Promise<PublishResult> => {
    const baseUrl = ctx.env?.['MARKETING_BASE_URL'] ?? 'https://borjie.co.tz';
    const path = `/campaigns/${asset.utm_tags['utm_campaign'] ?? 'unknown'}/${asset.variant_id}`;
    if (ctx.dry_run === true) {
      return {
        ok: true,
        channel_post_id: `web-dry-${asset.id}`,
        permalink: `${baseUrl}${path}`,
        published_at: new Date().toISOString(),
      };
    }
    return {
      ok: true,
      channel_post_id: `web-${asset.id}`,
      permalink: `${baseUrl}${path}`,
      published_at: new Date().toISOString(),
    };
  },
});
