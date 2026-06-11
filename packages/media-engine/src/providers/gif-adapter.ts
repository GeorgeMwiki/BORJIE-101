/**
 * GIF / animation provider adapter.
 *
 * There is no frontier "GIF model" (MEDIA_GENERATION_SOTA_SPEC §2.3):
 * a GIF/animated-WebP is a POST-PROCESS of a short video. This adapter
 * represents a host-side transcoder service that takes a short clip
 * (referenced in the request body) and returns the animated bytes.
 * Keys are INJECTED; unconfigured ⇒ `provider_unconfigured` so the
 * registry falls through to the stub floor (which emits a real GIF89a).
 *
 * @module @borjie/media-engine/providers/gif-adapter
 */

import type { MediaProvider } from './port.js';
import { createHttpProvider } from './http-adapter.js';

export interface GifAdapterConfig {
  /** Base URL of the host's transcode service. */
  readonly transcodeBaseUrl?: string;
}

/** GIF transcoder — palettegen/paletteuse pipeline behind a service. */
export function createGifTranscoderProvider(
  config: GifAdapterConfig = {},
): MediaProvider {
  const base = config.transcodeBaseUrl ?? 'http://media-transcode.internal';
  return createHttpProvider({
    id: 'gif_transcoder',
    capabilities: ['gif'],
    endpoint: () => `${base}/v1/transcode/gif`,
    buildBody: (inv) => ({
      prompt: inv.prompt,
      duration_sec: inv.durationSec,
      aspect_ratio: inv.aspectRatio,
      output: 'gif',
    }),
    format: () => 'gif',
    synthId: false,
    cost: { perGifCents: 2 },
  });
}
