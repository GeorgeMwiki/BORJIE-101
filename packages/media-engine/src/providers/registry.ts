/**
 * Provider registry — owns the set of available providers and the
 * per-modality selection ladder.
 *
 * Selection is deterministic: for a modality we walk the configured
 * ladder and pick the first provider that (a) serves the modality and
 * (b) is usable in this context — i.e. either needs no key (the stub) or
 * has a key present. The stub is ALWAYS registered last as the
 * never-fails floor, so the engine runs with zero keys.
 *
 * @module @borjie/media-engine/providers/registry
 */

import type {
  MediaModality,
  MediaProviderId,
} from '../types.js';
import {
  MediaEngineError,
} from '../types.js';
import type { MediaProvider } from './port.js';
import { providerServes } from './port.js';
import { createStubProvider } from './stub-provider.js';

/** Default preference ladder per modality (most-preferred first). */
const DEFAULT_LADDER: Readonly<
  Record<MediaModality, ReadonlyArray<MediaProviderId>>
> = Object.freeze({
  // Image: Imagen / FLUX / Seedream class, then stub floor.
  image: Object.freeze<MediaProviderId[]>([
    'imagen',
    'flux',
    'seedream',
    'stub',
  ]),
  // Short video: Seedance #1 Arena + cheapest, then Veo, then Sora; stub floor.
  short_video: Object.freeze<MediaProviderId[]>([
    'seedance',
    'veo',
    'sora',
    'stub',
  ]),
  // GIF: a dedicated transcoder (post-process a short clip), then stub floor.
  gif: Object.freeze<MediaProviderId[]>(['gif_transcoder', 'stub']),
});

export interface MediaProviderRegistry {
  /** Register a provider. Throws on duplicate id. */
  register(provider: MediaProvider): void;
  /** Look up a provider by id, or null. */
  get(id: MediaProviderId): MediaProvider | null;
  /** All registered providers (insertion order). */
  list(): ReadonlyArray<MediaProvider>;
  /**
   * Resolve the best usable provider for a modality given which keys are
   * present. Walks the ladder; falls back to the stub floor. Throws
   * `no_provider` only if nothing — not even the stub — can serve it.
   */
  select(
    modality: MediaModality,
    keyedProviderIds: ReadonlySet<MediaProviderId>,
  ): MediaProvider;
}

/**
 * Build a registry seeded with the deterministic stub so the engine
 * always has a zero-keys floor. Real adapters are added by the host via
 * `register`.
 */
export function createProviderRegistry(): MediaProviderRegistry {
  const byId = new Map<MediaProviderId, MediaProvider>();
  const order: MediaProvider[] = [];

  const register = (provider: MediaProvider): void => {
    if (byId.has(provider.id)) {
      throw new MediaEngineError(
        'invalid_request',
        `duplicate provider id: ${provider.id}`,
      );
    }
    byId.set(provider.id, provider);
    order.push(provider);
  };

  // Seed the never-fails floor.
  register(createStubProvider());

  const isUsable = (
    provider: MediaProvider,
    keyedProviderIds: ReadonlySet<MediaProviderId>,
  ): boolean => {
    if (!provider.requiresKey) return true;
    return keyedProviderIds.has(provider.id);
  };

  const select = (
    modality: MediaModality,
    keyedProviderIds: ReadonlySet<MediaProviderId>,
  ): MediaProvider => {
    const ladder = DEFAULT_LADDER[modality];
    for (const id of ladder) {
      const provider = byId.get(id);
      if (
        provider &&
        providerServes(provider, modality) &&
        isUsable(provider, keyedProviderIds)
      ) {
        return provider;
      }
    }
    // Ladder exhausted (only happens if the stub was somehow removed).
    const stub = byId.get('stub');
    if (stub && providerServes(stub, modality)) return stub;
    throw new MediaEngineError(
      'no_provider',
      `no usable provider for modality '${modality}'`,
    );
  };

  return {
    register,
    get: (id) => byId.get(id) ?? null,
    list: () => [...order],
    select,
  };
}
