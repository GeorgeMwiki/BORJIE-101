/**
 * Real IMAGE provider adapters — Imagen-3 / FLUX / Seedream class.
 *
 * Each is a {@link createHttpProvider} spec. Endpoints + request shapes
 * follow the 2026 SOTA landscape in MEDIA_GENERATION_SOTA_SPEC §2.2.
 * Keys are INJECTED; an unconfigured adapter throws `provider_unconfigured`
 * so the registry falls through to the stub floor.
 *
 * The base URLs are injected through a config object — the host wires the
 * real endpoints at bootstrap. Defaults are the documented public hosts.
 *
 * @module @borjie/media-engine/providers/image-adapters
 */

import type { MediaProvider } from './port.js';
import { createHttpProvider } from './http-adapter.js';

export interface ImageAdapterConfig {
  /** Override base URLs (testing / regional routing). */
  readonly imagenBaseUrl?: string;
  readonly fluxBaseUrl?: string;
  readonly seedreamBaseUrl?: string;
}

/** Google Imagen — `:predict` returns `bytesBase64Encoded` (SynthID on). */
export function createImagenProvider(
  config: ImageAdapterConfig = {},
): MediaProvider {
  const base =
    config.imagenBaseUrl ??
    'https://generativelanguage.googleapis.com/v1/models/imagen';
  return createHttpProvider({
    id: 'imagen',
    capabilities: ['image'],
    endpoint: () => `${base}:predict`,
    buildBody: (inv) => ({
      instances: [{ prompt: inv.prompt }],
      parameters: { aspectRatio: inv.aspectRatio, sampleCount: 1 },
    }),
    format: () => 'png',
    synthId: true,
    cost: { perImageCents: 13 },
  });
}

/** Black Forest Labs FLUX — async create; the host's job runner polls. */
export function createFluxProvider(
  config: ImageAdapterConfig = {},
): MediaProvider {
  const base = config.fluxBaseUrl ?? 'https://api.bfl.ml/v1';
  return createHttpProvider({
    id: 'flux',
    capabilities: ['image'],
    endpoint: () => `${base}/flux-pro-1.1-ultra`,
    buildBody: (inv) => ({
      prompt: inv.prompt,
      aspect_ratio: inv.aspectRatio,
      output_format: 'png',
    }),
    format: () => 'png',
    synthId: false,
    cost: { perImageCents: 6 },
    authHeader: 'x-key',
    authPrefix: '',
  });
}

/** Seedream-class image provider (ByteDance ModelArk). */
export function createSeedreamProvider(
  config: ImageAdapterConfig = {},
): MediaProvider {
  const base =
    config.seedreamBaseUrl ?? 'https://ark.ap-southeast.bytepluses.com/api/v3';
  return createHttpProvider({
    id: 'seedream',
    capabilities: ['image'],
    endpoint: () => `${base}/images/generations`,
    buildBody: (inv) => ({
      model: 'seedream-3-0',
      prompt: inv.prompt,
      size: inv.aspectRatio,
      response_format: 'b64_json',
    }),
    format: () => 'png',
    synthId: false,
    cost: { perImageCents: 4 },
  });
}
