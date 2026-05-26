/**
 * Provider dispatcher — selects the best `MediaProviderAdapter` for a
 * (capability, prompt, brand_spec, budget) tuple, with priority-ordered
 * fallback when the primary provider fails.
 *
 * Canonical fallback paths (MEDIA_GENERATION_SPEC §4):
 *   - Video:  Runway → Sora → Seedance.
 *   - Image:  Flux → Ideogram → Imagen → SD3.5.
 *   - Lipsync: Hedra → HeyGen.
 *   - Inpainting: Firefly → Flux Fill.
 *
 * Fallback is recorded in `MediaProvenance.model_provider` so the audit
 * trail captures exactly which model generated which artefact.
 *
 * @module @borjie/media-generation/providers/dispatcher
 */

import type {
  AdapterResult,
  MediaArtifact,
  MediaCapability,
  MediaProviderAdapter,
  MediaProviderId,
  MediaProviderInput,
  ProviderContext,
} from '../types.js';
import { MediaCompositionError } from '../types.js';
import { pickLogger } from './shared.js';

export interface DispatchResult {
  readonly artifact: MediaArtifact;
  readonly fallback_path: ReadonlyArray<MediaProviderId>;
}

export interface DispatchArgs {
  readonly capability: MediaCapability;
  readonly input: MediaProviderInput;
  readonly ctx: ProviderContext;
  /** Ordered list of adapters to try. First with the capability gets the
   *  call; on null result the dispatcher tries the next. */
  readonly adapters: ReadonlyArray<
    MediaProviderAdapter<MediaProviderInput, MediaArtifact>
  >;
}

/**
 * Run the dispatch loop. Returns the first non-null adapter result +
 * the list of providers tried (in order). Throws
 * `MediaCompositionError('PROVIDER_NOT_AVAILABLE')` if every adapter
 * returns null.
 */
export async function dispatchToProvider(
  args: DispatchArgs,
): Promise<DispatchResult> {
  const logger = pickLogger(args.ctx.logger);
  const tried: MediaProviderId[] = [];

  for (const adapter of args.adapters) {
    if (!adapter.capabilities.includes(args.capability)) continue;
    tried.push(adapter.provider_id);
    logger.info('media-dispatcher: trying provider', {
      provider: adapter.provider_id,
      capability: args.capability,
    });
    let result: AdapterResult = null;
    try {
      result = await adapter.invoke(args.input, args.ctx);
    } catch (err) {
      logger.warn('media-dispatcher: adapter threw, continuing fallback', {
        provider: adapter.provider_id,
        err: err instanceof Error ? err.message : String(err),
      });
      result = null;
    }
    if (result) {
      return { artifact: result, fallback_path: Object.freeze(tried.slice()) };
    }
  }

  throw new MediaCompositionError(
    'PROVIDER_NOT_AVAILABLE',
    `no provider succeeded for capability ${args.capability}`,
    tried,
  );
}

/**
 * Canonical fallback orders per capability — used to wire the
 * default adapter sequence.
 */
export const FALLBACK_BY_CAPABILITY: Readonly<
  Record<MediaCapability, ReadonlyArray<MediaProviderId>>
> = Object.freeze({
  text_to_image: Object.freeze([
    'flux',
    'ideogram',
    'recraft',
    'imagen',
    'sd35',
  ] as ReadonlyArray<MediaProviderId>),
  image_to_image: Object.freeze([
    'flux',
    'recraft',
    'sd35',
    'firefly',
  ] as ReadonlyArray<MediaProviderId>),
  text_to_video: Object.freeze([
    'runway',
    'sora',
    'seedance',
  ] as ReadonlyArray<MediaProviderId>),
  image_to_video: Object.freeze([
    'runway',
    'sora',
    'seedance',
  ] as ReadonlyArray<MediaProviderId>),
  lipsync_video: Object.freeze([
    'hedra',
    'heygen',
  ] as ReadonlyArray<MediaProviderId>),
  inpainting: Object.freeze([
    'firefly',
    'flux',
  ] as ReadonlyArray<MediaProviderId>),
});

/**
 * Reorder a supplied adapter list to match the canonical fallback
 * order for the requested capability. Adapters whose `provider_id` is
 * absent from the canonical list are appended at the end (preserving
 * caller-supplied custom order).
 */
export function reorderForCapability<
  A extends MediaProviderAdapter<MediaProviderInput, MediaArtifact>,
>(
  capability: MediaCapability,
  adapters: ReadonlyArray<A>,
): ReadonlyArray<A> {
  const order = FALLBACK_BY_CAPABILITY[capability];
  const byId = new Map<MediaProviderId, A>();
  for (const a of adapters) {
    byId.set(a.provider_id, a);
  }
  const ordered: A[] = [];
  for (const id of order) {
    const found = byId.get(id);
    if (found) {
      ordered.push(found);
      byId.delete(id);
    }
  }
  // Append any caller-supplied adapters not in the canonical order.
  for (const remaining of byId.values()) {
    ordered.push(remaining);
  }
  return Object.freeze(ordered);
}

/**
 * Caveat 4 (Wave 18X) — cost-aware fallback ladder.
 *
 * Given a list of capability-eligible adapters and the remaining
 * budget for this dispatch, reorder them so the cheapest provider
 * that fits the remaining budget is tried first. Adapters whose
 * per-unit cost exceeds the remaining budget are dropped from the
 * ladder entirely (they cannot succeed without breaking the budget
 * reservation in the cost-tracker). Ties broken by canonical
 * capability order.
 *
 * This is layered ON TOP of `reorderForCapability` — the canonical
 * order acts as a quality preference among equally-priced providers;
 * the cost-aware sort wins when budgets are tight.
 *
 * Pure: takes the canonical-ordered ladder + remaining budget, returns
 * a new immutable ladder.
 */
export function reorderForCost<
  A extends MediaProviderAdapter<MediaProviderInput, MediaArtifact>,
>(
  capabilityOrderedAdapters: ReadonlyArray<A>,
  remaining_budget_cents: number,
): ReadonlyArray<A> {
  // Canonical position acts as the tiebreaker — preserve the index
  // we received the adapter at so equal-cost picks keep canonical
  // order.
  type Indexed = { readonly index: number; readonly adapter: A };
  const indexed: Indexed[] = capabilityOrderedAdapters.map((adapter, index) => ({
    index,
    adapter,
  }));

  // Drop adapters whose per-unit cost cannot fit the remaining
  // budget. The cost-tracker would refuse the reservation anyway, so
  // we save the round trip and avoid emitting a false fallback in
  // MediaProvenance.model_provider.
  const affordable = indexed.filter(
    (i) => i.adapter.cost_per_unit_usd_cents <= remaining_budget_cents,
  );

  // Sort by cost asc, then canonical index asc.
  const sorted = affordable.slice().sort((a, b) => {
    const costDelta =
      a.adapter.cost_per_unit_usd_cents - b.adapter.cost_per_unit_usd_cents;
    if (costDelta !== 0) return costDelta;
    return a.index - b.index;
  });

  return Object.freeze(sorted.map((i) => i.adapter));
}

/**
 * Convenience: apply both passes — canonical capability ordering
 * then cost-aware re-rank — in one call. Used by the recipe helper.
 *
 * Capability-incompatible adapters are dropped (unlike
 * `reorderForCapability` which preserves caller-supplied adapters
 * with unrelated capabilities at the tail). The cost-aware ladder is
 * strict: every returned adapter both fits the budget AND advertises
 * the requested capability.
 */
export function reorderForCapabilityAndCost<
  A extends MediaProviderAdapter<MediaProviderInput, MediaArtifact>,
>(
  capability: MediaCapability,
  adapters: ReadonlyArray<A>,
  remaining_budget_cents: number,
): ReadonlyArray<A> {
  const capable = adapters.filter((a) => a.capabilities.includes(capability));
  const capabilityOrdered = reorderForCapability(capability, capable);
  return reorderForCost(capabilityOrdered, remaining_budget_cents);
}
