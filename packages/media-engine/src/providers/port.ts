/**
 * ProviderPort — the single interface every media provider implements.
 *
 * A provider is asked for ONE modality at a time. It declares the
 * modalities it serves (`capabilities`), an estimate of cost, and a
 * `generate` that returns real bytes (or throws a typed
 * {@link MediaEngineError}). Providers NEVER read process.env — the api
 * key arrives via {@link ProviderInvocation.apiKey}. When that key is
 * absent a real adapter MUST degrade (throw `provider_unconfigured`),
 * never fabricate output.
 *
 * @module @borjie/media-engine/providers/port
 */

import type {
  FetchLike,
  MediaAspectRatio,
  MediaCapability,
  MediaFormat,
  MediaLogger,
  MediaModality,
  MediaProviderId,
} from '../types.js';

/** What a provider returns: real bytes + the chosen format. */
export interface ProviderOutput {
  readonly body: Uint8Array;
  readonly format: MediaFormat;
  /** True if the provider embeds an invisible SynthID watermark. */
  readonly synthIdPresent: boolean;
}

/**
 * Everything a provider needs for one generation. The host injects
 * `apiKey` (may be undefined) and `fetch` (may be undefined for the
 * stub). The provider must not reach outside this object for config.
 */
export interface ProviderInvocation {
  readonly modality: MediaModality;
  readonly prompt: string;
  readonly aspectRatio: MediaAspectRatio;
  readonly durationSec: number;
  /** Injected api key; undefined ⇒ real adapters throw `provider_unconfigured`. */
  readonly apiKey?: string;
  /** Injected fetch; undefined ⇒ HTTP adapters throw `provider_unconfigured`. */
  readonly fetch?: FetchLike;
  readonly logger: MediaLogger;
  /** Deterministic seed (derived from request) for reproducible stubs. */
  readonly seed: string;
}

/** The provider port. */
export interface MediaProvider {
  readonly id: MediaProviderId;
  /** Modalities this provider can serve. */
  readonly capabilities: ReadonlyArray<MediaCapability>;
  /** True when no api key is needed (only the in-repo stub). */
  readonly requiresKey: boolean;
  /**
   * Estimate the cost of a generation in integer cents. Used by the cost
   * guard BEFORE invocation so an over-budget call never fires.
   */
  estimateCostCents(modality: MediaModality, durationSec: number): number;
  /** Produce real bytes, or throw a typed {@link MediaEngineError}. */
  generate(invocation: ProviderInvocation): Promise<ProviderOutput>;
}

/** True if a provider can serve the requested modality. */
export function providerServes(
  provider: MediaProvider,
  modality: MediaModality,
): boolean {
  return provider.capabilities.includes(
    modality as MediaCapability,
  );
}
