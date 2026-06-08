/**
 * Media-engine bootstrap context provider.
 *
 * The `@borjie/media-engine` reads NO env of its own; keys, the cost budget,
 * the wall clock, and `fetch` all arrive through an injected
 * `MediaEngineContext`. This module is the SINGLE bootstrap seam that reads
 * provider keys from the env source (mirrors every other LLM wiring in the
 * composition layer) and projects them into the per-call context shape.
 *
 * No secrets are logged; only the SET of configured provider ids is surfaced
 * for boot telemetry. The actual key strings never leave this module except
 * into the engine's injected provider adapters.
 *
 * @module composition/modality-capability/media-context
 */

import type {
  MediaEngineContext,
  MediaLogger,
  MediaProviderId,
  FetchLike,
} from '@borjie/media-engine';

/** Default per-request media budget (cents) when no env override is set. */
const DEFAULT_MEDIA_BUDGET_CENTS = 500;

/**
 * Map provider env-var names → the engine's `MediaProviderId`. Keys are read
 * ONCE here at bootstrap; absent keys simply remove that provider from
 * contention (the engine degrades down the registry ladder to the stub).
 */
const PROVIDER_KEY_ENV: ReadonlyArray<readonly [MediaProviderId, string]> = [
  ['flux', 'BFL_API_KEY'],
  ['imagen', 'GOOGLE_GENAI_API_KEY'],
  ['seedream', 'BYTEPLUS_API_KEY'],
  ['sora', 'OPENAI_API_KEY'],
  ['veo', 'GOOGLE_GENAI_API_KEY'],
  ['seedance', 'BYTEPLUS_API_KEY'],
];

export interface MediaContextProviderDeps {
  readonly envSource: Readonly<Record<string, string | undefined>>;
  readonly logger?: { info?(meta: object, msg: string): void };
  /** Injected fetch for the real HTTP adapters (absent ⇒ stub-only host). */
  readonly fetch?: FetchLike;
}

export interface MediaContextProvider {
  /** Build a per-call context for a tenant. */
  contextFor(tenantId: string): MediaEngineContext;
  /** The provider ids that have a key present (telemetry; no secrets). */
  readonly configuredProviderIds: ReadonlyArray<MediaProviderId>;
}

/** A Pino-style logger adapted to the engine's minimal `MediaLogger`. */
function toMediaLogger(logger?: {
  info?(meta: object, msg: string): void;
  warn?(meta: object, msg: string): void;
}): MediaLogger {
  return {
    info(meta: object, msg: string): void {
      logger?.info?.(meta, msg);
    },
    warn(meta: object, msg: string): void {
      logger?.warn?.(meta, msg);
    },
    error(meta: object, msg: string): void {
      logger?.warn?.(meta, msg);
    },
  };
}

/**
 * Build the media context provider. Reads provider keys once from the
 * injected env source. The returned `contextFor(tenantId)` is the per-call
 * context the engine consumes.
 */
export function createMediaContextProvider(
  deps: MediaContextProviderDeps,
): MediaContextProvider {
  const providerKeys: Partial<Record<MediaProviderId, string>> = {};
  for (const [id, envName] of PROVIDER_KEY_ENV) {
    const key = deps.envSource[envName]?.trim();
    if (key && !providerKeys[id]) providerKeys[id] = key;
  }
  const configuredProviderIds = Object.keys(providerKeys) as MediaProviderId[];
  const budgetRaw = Number(deps.envSource['BORJIE_MEDIA_BUDGET_CENTS'] ?? '');
  const budgetCents =
    Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : DEFAULT_MEDIA_BUDGET_CENTS;
  const mediaLogger = toMediaLogger(deps.logger);

  deps.logger?.info?.(
    { wiring: 'media-engine', configuredProviderIds },
    `media-engine context: ${configuredProviderIds.length} provider key(s) configured (else stub)`,
  );

  return {
    configuredProviderIds,
    contextFor(tenantId: string): MediaEngineContext {
      return {
        providerKeys,
        budgetCents,
        logger: mediaLogger,
        now: () => new Date(),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      };
    },
  };
}
