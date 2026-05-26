/**
 * Live-mode guard.
 *
 * Caveat 5 (Wave 18X) — production paths must not silently fall back
 * to recorded fixtures pretending to be live provider responses. Mr.
 * Mwikila's MD persona refuses to publish a media artefact whose
 * provenance claims a real provider call but whose adapter was a
 * test mock.
 *
 * The guard inspects two signals before letting an adapter ladder
 * enter the dispatcher in production:
 *
 *   1. `BORJIE_LIVE_MODE` env var. Set to `'strict'` to enforce; any
 *      other value (or absent) skips the check (the common-case test
 *      environment).
 *   2. Adapter metadata: an adapter that wires production HTTP calls
 *      via `safeFetch` carries `provider_id` in the canonical set
 *      and a non-empty `model_id`. Adapters fabricated for tests are
 *      expected to opt out via `__is_live_adapter = false` and any
 *      adapter not explicitly marked as `__is_live_adapter !== false`
 *      is treated as live (the production default).
 *
 * In strict live mode the guard throws
 * `MediaCompositionError('PROVIDER_NOT_AVAILABLE')` rather than
 * silently downgrading to a non-live adapter — failure must be loud.
 *
 * Tests by default use NODE_ENV='test' (vitest default) so this
 * guard is a no-op there; the production binary sets
 * `BORJIE_LIVE_MODE=strict` from the bootstrap.
 *
 * @module @borjie/media-generation/providers/live-mode-guard
 */

import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { MediaCompositionError } from '../types.js';
import { readEnvKey } from './shared.js';

/**
 * A non-live adapter declares itself by setting the
 * `__is_live_adapter` flag to false. The flag is intentionally
 * non-enumerable so it does not show up in serialised audit rows;
 * the guard inspects it via the unknown-property cast.
 */
export interface NonLiveAdapterMarker {
  readonly __is_live_adapter?: boolean;
}

export function markAdapterAsNonLive<
  A extends MediaProviderAdapter<MediaProviderInput, MediaArtifact>,
>(adapter: A): A {
  Object.defineProperty(adapter, '__is_live_adapter', {
    value: false,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return adapter;
}

export function isLiveAdapter(
  adapter: MediaProviderAdapter<MediaProviderInput, MediaArtifact>,
): boolean {
  const v = (adapter as unknown as NonLiveAdapterMarker).__is_live_adapter;
  // Default: missing flag = live. Explicit `false` = non-live.
  return v !== false;
}

/**
 * Is the dispatcher running in strict live mode? Tests typically
 * leave the env var unset; production bootstrap sets it to `strict`.
 */
export function isStrictLiveMode(): boolean {
  const raw = readEnvKey('BORJIE_LIVE_MODE');
  return raw === 'strict';
}

/**
 * Refuse an adapter ladder that mixes live and non-live adapters in
 * strict live mode. Returns the (possibly-narrowed) ladder
 * containing only live adapters, or throws when every adapter has
 * been filtered out.
 *
 * Pure: takes the ladder, returns a new immutable ladder. Production
 * caller threads this between `reorderForCapabilityAndCost` and
 * `dispatchToProvider`.
 */
export function applyLiveModeGuard<
  A extends MediaProviderAdapter<MediaProviderInput, MediaArtifact>,
>(adapters: ReadonlyArray<A>): ReadonlyArray<A> {
  if (!isStrictLiveMode()) return adapters;
  const liveOnly = adapters.filter(isLiveAdapter);
  if (liveOnly.length === 0) {
    const droppedIds = adapters.map((a) => a.provider_id);
    throw new MediaCompositionError(
      'PROVIDER_NOT_AVAILABLE',
      'live-mode guard: every adapter is marked non-live; refusing to publish a recorded-fixture artefact in production',
      droppedIds,
    );
  }
  return Object.freeze([...liveOnly]);
}
