/**
 * BrandSpec — the source-of-truth for the brand-DNA prompt prefix
 * system.
 *
 * The default Borjie spec mirrors the OKLCH palette anchors used by
 * `packages/design-system/lib/tokens.ts` and the wordmark file in
 * `packages/design-system/src/brand/`. Adding a new tenant brand
 * requires shipping a new BrandSpec with palette anchors, wordmark
 * path, negative-prompt denylist, and consent-token policy.
 *
 * Pure data. No I/O.
 *
 * @module @borjie/media-generation/brand-lock/brand-spec
 */

import type { BrandSpec } from '../types.js';

/**
 * Default Borjie brand spec — the prompt prefix builder uses these
 * values to assemble the mechanical prefix and negative prompt for
 * every generation.
 *
 * Palette anchors mirror the brand signal ramp used in `packages/
 * design-system/lib/tokens.ts`. Wordmark path is exported as a logical
 * reference (`packages/design-system/src/brand/wordmark.svg`); the
 * watermarking module resolves the actual file at runtime.
 */
export const BorjieBrandSpec: BrandSpec = Object.freeze({
  brand: 'borjie',
  photographic_style:
    'documentary, golden-hour, warm but technical, shallow depth of field',
  palette: Object.freeze([
    Object.freeze({
      name: 'signal_primary',
      oklch: 'oklch(0.78 0.16 75)',
      hex: '#f59e0b',
    }),
    Object.freeze({
      name: 'foreground_neutral',
      oklch: 'oklch(0.96 0.02 75)',
      hex: '#f8fafc',
    }),
    Object.freeze({
      name: 'surface_background',
      oklch: 'oklch(0.18 0.02 65)',
      hex: '#0f172a',
    }),
    Object.freeze({
      name: 'signature_gradient_anchor_a',
      oklch: 'oklch(0.34 0.10 250)',
      hex: '#1F3864',
    }),
    Object.freeze({
      name: 'signature_gradient_anchor_b',
      oklch: 'oklch(0.65 0.18 45)',
      hex: '#C45B12',
    }),
  ]),
  typography_rule:
    'font-display sans-serif (Geist or Inter); no other font families on graphics',
  wordmark_policy:
    'when present, top-left, opacity 1, no rotation, no scaling below 64px width',
  negative_prompt_terms: Object.freeze([
    'off-brand color scheme',
    'deepfake of real Borjie personnel without consent',
    'watermark removal',
    'erased watermark',
    'NSFW',
    'nudity',
    'gore',
    'violence',
    'stock-photo cliche',
    'low-resolution',
    'pixelated',
    'cartoonish style',
    'off-brand typography',
    'fake logo',
    'plagiarised composition',
  ]),
  wordmark_svg_path: 'packages/design-system/src/brand/wordmark.svg',
  signature_gradient_direction: '135deg',
  real_person_consent_required: true,
});

/**
 * Tenant-scoped BrandSpec registry.
 *
 * Caveat 2 (Wave 18X) — the style guard must be tenant-scoped: each
 * tenant's media generations are locked to their own BrandSpec
 * (palette, photographic style, wordmark policy, negative-prompt
 * denylist). Default tenants resolve to the Borjie spec; explicit
 * overrides ship via `registerBrandSpec(tenantId, spec)`. The registry
 * is immutable — registration returns a *new* registry rather than
 * mutating in place — but a module-level singleton provides a
 * convenient default for `getBrandSpec`.
 *
 * Mr. Mwikila's MD persona never mixes BrandSpecs across tenants; a
 * cross-tenant call falls back to the default Borjie spec rather than
 * leaking another tenant's brand DNA.
 */
export interface BrandSpecRegistry {
  readonly get: (tenantId: string) => BrandSpec;
  readonly register: (tenantId: string, spec: BrandSpec) => BrandSpecRegistry;
  readonly list: () => ReadonlyArray<{
    readonly tenant_id: string;
    readonly spec: BrandSpec;
  }>;
}

function buildRegistry(
  entries: ReadonlyMap<string, BrandSpec>,
  fallback: BrandSpec,
): BrandSpecRegistry {
  return {
    get(tenantId: string): BrandSpec {
      return entries.get(tenantId) ?? fallback;
    },
    register(tenantId: string, spec: BrandSpec): BrandSpecRegistry {
      const next = new Map(entries);
      next.set(tenantId, spec);
      return buildRegistry(next, fallback);
    },
    list() {
      return Array.from(entries.entries()).map(([tenant_id, spec]) => ({
        tenant_id,
        spec,
      }));
    },
  };
}

/**
 * Create an empty tenant-scoped BrandSpec registry with a caller-
 * supplied fallback (defaults to Borjie). Tests and the dynamic
 * recipe author construct fresh registries this way.
 */
export function createBrandSpecRegistry(
  fallback: BrandSpec = BorjieBrandSpec,
): BrandSpecRegistry {
  return buildRegistry(new Map(), fallback);
}

let activeRegistry: BrandSpecRegistry = createBrandSpecRegistry(BorjieBrandSpec);

/**
 * Register a tenant-specific BrandSpec override into the active
 * singleton. Returns the new registry so callers that want the
 * immutable handle can capture it (e.g. for snapshotting in tests).
 *
 * Important: this is the ONLY supported mutation point. Bypassing it
 * (e.g. mutating the imported BorjieBrandSpec object) does not change
 * the active registry — Object.freeze on the default spec prevents it.
 */
export function registerBrandSpec(
  tenantId: string,
  spec: BrandSpec,
): BrandSpecRegistry {
  if (tenantId.trim().length === 0) {
    throw new Error('registerBrandSpec: tenantId must be non-empty');
  }
  activeRegistry = activeRegistry.register(tenantId, spec);
  return activeRegistry;
}

/**
 * Snapshot of the active singleton — used by tests that need to
 * restore state between cases. Returns a *new* registry, never the
 * mutable handle.
 */
export function snapshotBrandSpecRegistry(): BrandSpecRegistry {
  return activeRegistry;
}

/**
 * Replace the active singleton with a caller-supplied registry. Used
 * by tests to scope a particular registry to a single suite and by
 * the multi-tenant boot path to load tenant configs from the database.
 */
export function setActiveBrandSpecRegistry(registry: BrandSpecRegistry): void {
  activeRegistry = registry;
}

/**
 * Read the active brand spec for a tenant. Falls back to the Borjie
 * default when the tenant has not registered an override.
 */
export function getBrandSpec(tenantId: string): BrandSpec {
  return activeRegistry.get(tenantId);
}
