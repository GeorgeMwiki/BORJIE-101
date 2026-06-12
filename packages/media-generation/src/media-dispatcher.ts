/**
 * `createMediaDispatcher` — thin ad-hoc image dispatcher.
 *
 * The recipe path (`composeMedia` / `runRecipe`) is for structured,
 * branded, approval-gated artifacts with declared data inputs and the full
 * safety + C2PA + watermark pipeline. THIS dispatcher is its lightweight
 * counterpart for ad-hoc, free-text image prompts arriving off the brain's
 * `mining.media.generate_image` tool: it composes the canonical image
 * provider ladder (flux → ideogram → recraft → imagen → sd35), dispatches
 * with priority-ordered fallback, and returns `{blob, url, provider}` in
 * the exact shape the api-gateway `image-generator.ts` consumer expects.
 *
 * Graceful degradation: every provider adapter reads its own API key from
 * the environment and returns `null` when the key is absent. With NO image
 * provider key set, all adapters degrade and `dispatchToProvider` throws
 * `MediaCompositionError('PROVIDER_NOT_AVAILABLE')` — the caller catches it
 * and renders its own fallback. With ≥1 provider key set, the REAL provider
 * label (e.g. `flux`) is returned, never a synthetic `fallback-1x1`.
 *
 * No `process.env` keys are read here directly; the adapters resolve their
 * own credentials, and an optional `fetchImpl` is threaded through the
 * provider context for deterministic tests.
 *
 * @module @borjie/media-generation/media-dispatcher
 */

import type {
  BrandSpec,
  MediaArtifact,
  MediaAspectRatio,
  MediaClass,
  MediaLogger,
  MediaProviderAdapter,
  MediaProviderInput,
} from './types.js';
import { createFluxAdapter } from './providers/flux-adapter.js';
import { createIdeogramAdapter } from './providers/ideogram-adapter.js';
import { createRecraftAdapter } from './providers/recraft-adapter.js';
import { createImagenAdapter } from './providers/imagen-adapter.js';
import { createSd35Adapter } from './providers/sd35-adapter.js';
import {
  dispatchToProvider,
  reorderForCapability,
} from './providers/dispatcher.js';
import type { ThinAdapterConfig } from './providers/factory.js';
import { createClassBudgetTracker } from './budgets/cost-tracker.js';
import { getBrandSpec } from './brand-lock/brand-spec.js';

/**
 * Synthetic class for ad-hoc image dispatch. `marketing_still` carries a
 * 15¢ budget — enough to clear the priciest image provider on the ladder
 * (Imagen ~13¢) so budget never silently strands a configured provider.
 */
const ADHOC_IMAGE_CLASS: MediaClass = 'marketing_still';

const VALID_ASPECT_RATIOS: ReadonlySet<string> = new Set([
  '1:1',
  '4:5',
  '9:16',
  '16:9',
  '21:9',
]);

export interface MediaDispatcherConfig {
  /** Tenant whose brand spec governs the prompt prefix. Defaults to the
   *  Borjie default brand (`getBrandSpec` falls back when unregistered). */
  readonly tenantId?: string;
  /** Brand-spec override; when omitted the tenant's brand is resolved. */
  readonly brandSpec?: BrandSpec;
  /** Injected fetch — for deterministic tests. Production uses global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly logger?: MediaLogger;
}

export interface GenerateMediaArgs {
  readonly kind: 'image';
  readonly prompt: string;
  /** Pixel size hint (e.g. `1024x1024`); used to derive aspect ratio. */
  readonly size?: string;
  readonly aspectRatio?: string;
  /** Reserved for future palette pinning; the brand spec drives colour today. */
  readonly brandColors?: ReadonlyArray<string>;
}

export interface GenerateMediaResult {
  /** Raw artifact bytes — the caller inlines or persists these. */
  readonly blob: Buffer;
  /** Hosted asset URL when a provider returns one; null otherwise. */
  readonly url: string | null;
  /** Real provider id that produced the artifact (e.g. `flux`). */
  readonly provider: string;
  /** Storage key the artifact would persist under. */
  readonly storageKey: string;
}

export interface MediaDispatcher {
  generate(args: GenerateMediaArgs): Promise<GenerateMediaResult>;
}

/**
 * Map a caller-supplied aspect ratio (or pixel size) onto the closed-set
 * `MediaAspectRatio`. Falls back to `1:1` when neither is interpretable.
 */
function resolveAspectRatio(
  aspectRatio?: string,
  size?: string,
): MediaAspectRatio {
  if (aspectRatio && VALID_ASPECT_RATIOS.has(aspectRatio)) {
    return aspectRatio as MediaAspectRatio;
  }
  if (size) {
    const parts = size.split('x');
    const w = Number.parseInt(parts[0] ?? '', 10);
    const h = Number.parseInt(parts[1] ?? '', 10);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      if (w === h) return '1:1';
      return w > h ? '16:9' : '9:16';
    }
  }
  return '1:1';
}

/**
 * Build the ad-hoc image dispatcher. Zero-arg callable (the api-gateway
 * `image-generator.ts` invokes it with no arguments); the optional config
 * exists for brand/tenant pinning and deterministic tests.
 */
export function createMediaDispatcher(
  config: MediaDispatcherConfig = {},
): MediaDispatcher {
  const tenantId = config.tenantId ?? 'system';
  const recipeKey: ThinAdapterConfig['recipe'] = {
    id: 'adhoc_image',
    version: 1,
    class: ADHOC_IMAGE_CLASS,
    authority_tier: 0,
    approval_required: false,
  };
  const adapterConfig: ThinAdapterConfig = {
    recipe: recipeKey,
    span_citations: [],
  };

  return {
    async generate(args: GenerateMediaArgs): Promise<GenerateMediaResult> {
      if (args.kind !== 'image') {
        throw new Error(
          `createMediaDispatcher: unsupported kind '${String(args.kind)}'`,
        );
      }
      if (!args.prompt || args.prompt.trim().length === 0) {
        throw new Error('createMediaDispatcher: prompt must not be empty');
      }

      const adapters: ReadonlyArray<
        MediaProviderAdapter<MediaProviderInput, MediaArtifact>
      > = [
        createFluxAdapter(adapterConfig),
        createIdeogramAdapter(adapterConfig),
        createRecraftAdapter(adapterConfig),
        createImagenAdapter(adapterConfig),
        createSd35Adapter(adapterConfig),
      ];
      const ordered = reorderForCapability('text_to_image', adapters);

      const input: MediaProviderInput = {
        prompt: args.prompt,
        aspect_ratio: resolveAspectRatio(args.aspectRatio, args.size),
        format: 'image',
      };

      const { artifact } = await dispatchToProvider({
        capability: 'text_to_image',
        input,
        ctx: {
          tenant_id: tenantId,
          recipe_id: recipeKey.id,
          recipe_version: recipeKey.version,
          brand_spec: config.brandSpec ?? getBrandSpec(tenantId),
          cost_tracker: createClassBudgetTracker(ADHOC_IMAGE_CLASS),
          ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
          ...(config.logger ? { logger: config.logger } : {}),
        },
        adapters: ordered,
      });

      return {
        blob: artifact.body,
        url: null,
        provider: artifact.provenance.model_provider,
        storageKey: artifact.storage_key,
      };
    },
  };
}
