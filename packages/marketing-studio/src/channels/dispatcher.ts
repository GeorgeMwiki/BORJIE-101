/**
 * Channel dispatcher — maps `Channel` → `ChannelAdapter`. Lookup is
 * pure; missing channels return null (caller decides on refusal vs.
 * graceful skip).
 */

import type { Channel } from '../types.js';
import { linkedinOrganicAdapter, linkedinAdsAdapter } from './linkedin-adapter.js';
import { xOrganicAdapter, xAdsAdapter } from './x-adapter.js';
import { metaOrganicAdapter, metaAdsAdapter } from './meta-adapter.js';
import { tiktokOrganicAdapter, tiktokAdsAdapter } from './tiktok-adapter.js';
import { youtubeOrganicAdapter, youtubeAdsAdapter } from './youtube-adapter.js';
import { googleAdsAdapter } from './google-ads-adapter.js';
import { emailAdapter } from './email-adapter.js';
import { webLandingAdapter } from './web-landing-adapter.js';
import { prWireAdapter } from './pr-wire-adapter.js';
import type { ChannelAdapter } from './_adapter.js';

const REGISTRY: Readonly<Partial<Record<Channel, ChannelAdapter>>> = Object.freeze({
  linkedin_organic: linkedinOrganicAdapter,
  linkedin_ads: linkedinAdsAdapter,
  x_organic: xOrganicAdapter,
  x_ads: xAdsAdapter,
  meta_organic: metaOrganicAdapter,
  meta_ads: metaAdsAdapter,
  tiktok_organic: tiktokOrganicAdapter,
  tiktok_ads: tiktokAdsAdapter,
  youtube_organic: youtubeOrganicAdapter,
  youtube_ads: youtubeAdsAdapter,
  google_ads: googleAdsAdapter,
  email: emailAdapter,
  web_landing: webLandingAdapter,
  pr_wire: prWireAdapter,
});

export function dispatchChannel(channel: Channel): ChannelAdapter | null {
  return REGISTRY[channel] ?? null;
}

export function listRegisteredChannels(): ReadonlyArray<Channel> {
  return Object.keys(REGISTRY) as ReadonlyArray<Channel>;
}
