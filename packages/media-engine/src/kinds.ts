/**
 * Typed media-request kind catalogue.
 *
 * Each kind resolves to a static {@link MediaKindProfile} — modality,
 * owning surface, default aspect ratio, approval requirement. Public-
 * facing kinds (`requiresApproval: true`) are tier-2 and need an
 * owner-approval gate plus a non-empty evidence chain.
 *
 * @module @borjie/media-engine/kinds
 */

import type { MediaKindProfile, MediaRequestKind } from './types.js';

/**
 * The closed catalogue. Borjie mining-estate first, then BN real-estate.
 * Frozen so callers cannot mutate the shared profile objects.
 */
export const MEDIA_KIND_PROFILES: Readonly<
  Record<MediaRequestKind, MediaKindProfile>
> = Object.freeze({
  // --- Borjie mining-estate -------------------------------------------------
  mining_site_map: Object.freeze({
    kind: 'mining_site_map',
    domain: 'mining_estate',
    modality: 'image',
    defaultAspectRatio: '16:9',
    requiresApproval: false,
  }),
  equipment_process_diagram: Object.freeze({
    kind: 'equipment_process_diagram',
    domain: 'mining_estate',
    modality: 'image',
    defaultAspectRatio: '16:9',
    requiresApproval: false,
  }),
  marketplace_listing_hero: Object.freeze({
    kind: 'marketplace_listing_hero',
    domain: 'mining_estate',
    modality: 'image',
    defaultAspectRatio: '4:5',
    requiresApproval: true,
  }),
  investor_brand_video: Object.freeze({
    kind: 'investor_brand_video',
    domain: 'mining_estate',
    modality: 'short_video',
    defaultAspectRatio: '16:9',
    requiresApproval: true,
    defaultDurationSec: 8,
  }),

  // --- BN real-estate -------------------------------------------------------
  property_hero: Object.freeze({
    kind: 'property_hero',
    domain: 'real_estate',
    modality: 'image',
    defaultAspectRatio: '4:5',
    requiresApproval: true,
  }),
  virtual_staging: Object.freeze({
    kind: 'virtual_staging',
    domain: 'real_estate',
    modality: 'image',
    defaultAspectRatio: '4:5',
    requiresApproval: true,
  }),
  neighbourhood_reel: Object.freeze({
    kind: 'neighbourhood_reel',
    domain: 'real_estate',
    modality: 'gif',
    defaultAspectRatio: '9:16',
    requiresApproval: true,
    defaultDurationSec: 6,
  }),
});

/**
 * Resolve a kind to its profile, or `null` when unknown. Callers map a
 * null to {@link MediaEngineError} `unknown_kind`.
 */
export function profileForKind(
  kind: string,
): MediaKindProfile | null {
  return (
    MEDIA_KIND_PROFILES[kind as MediaRequestKind] ?? null
  );
}

/** All known kinds, useful for registries + tests. */
export function allMediaKinds(): ReadonlyArray<MediaRequestKind> {
  return Object.keys(MEDIA_KIND_PROFILES) as MediaRequestKind[];
}
