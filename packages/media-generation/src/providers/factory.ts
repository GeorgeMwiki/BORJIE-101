/**
 * Thin-adapter factory — encapsulates the request/response shape
 * variations across the 11 provider APIs so each adapter file is a
 * one-page declaration of its endpoint, body builder, response parser,
 * and capability set.
 *
 * Behaviour shared by every adapter:
 *   1. Read API key from env (graceful-degrade to null when absent).
 *   2. Reserve cost-budget BEFORE the network call; commit on success;
 *      release on failure.
 *   3. Apply brand-lock to the prompt + build negative prompt.
 *   4. Call the provider via `safeFetch` with timeout.
 *   5. Parse the response via zod; on parse failure release the budget.
 *   6. Assemble the MediaArtifact (checksum + provenance + audit hash
 *      sealed in one step).
 *
 * Provider-specific shape lives in the per-adapter file via the
 * `ProviderShape` interface below.
 *
 * @module @borjie/media-generation/providers/factory
 */

import type { ZodTypeAny, z } from 'zod';
import type {
  AdapterResult,
  AuthorityTier,
  BrandSpec,
  MediaArtifact,
  MediaCapability,
  MediaClass,
  MediaFormat,
  MediaProviderAdapter,
  MediaProviderId,
  MediaProviderInput,
  ProviderContext,
  SpanCitation,
} from '../types.js';
import {
  applyBrandLock,
  assembleArtifact,
  noKey,
  permissiveSafetyScan,
  pickLogger,
  readEnvKey,
  reserveBudget,
  safeFetch,
} from './shared.js';

export interface ProviderShape<TSchema extends ZodTypeAny> {
  readonly adapter_name: string;
  readonly provider_id: MediaProviderId;
  readonly model_id: string;
  readonly model_version: string;
  readonly capabilities: ReadonlyArray<MediaCapability>;
  /** Cost per unit (image = per image; video = per second). */
  readonly cost_per_unit_usd_cents: number;
  /** Env-var name carrying the API key. */
  readonly env_key: string;
  /** Default base URL — overridable per-instance. */
  readonly default_base_url: string;
  /** Output format produced by this provider. */
  readonly format: MediaFormat;
  /** Response schema — used to safe-parse the API body. */
  readonly response_schema: TSchema;
  /**
   * Build the request URL + body. Receives the resolved API key and
   * the brand-locked prompt; returns the URL, method, headers, body.
   */
  readonly buildRequest: (args: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly brandedPrompt: string;
    readonly negativePrompt: string;
    readonly input: MediaProviderInput;
    readonly brand: BrandSpec;
  }) => {
    readonly url: string;
    readonly method: 'POST' | 'GET';
    readonly headers: Record<string, string>;
    readonly body?: string;
  };
  /**
   * Compute the cost of one invocation given the input. Used to
   * reserve budget BEFORE the network call.
   */
  readonly estimateCost: (input: MediaProviderInput) => number;
  /**
   * Convert the parsed response into the raw artifact bytes. For
   * adapters that return JSON-with-base64, decode here. For adapters
   * that return a media URL we synthesise stable seed bytes (the
   * production caller downloads via the URL).
   */
  readonly extractBytes: (args: {
    readonly parsed: z.infer<TSchema>;
    readonly brandedPrompt: string;
    readonly seed: string;
  }) => Buffer;
}

export interface ThinAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly recipe: {
    readonly id: string;
    readonly version: number;
    readonly class: MediaClass;
    readonly authority_tier: AuthorityTier;
    readonly approval_required: boolean;
  };
  readonly span_citations: ReadonlyArray<SpanCitation>;
}

/**
 * Build a `MediaProviderAdapter` from a `ProviderShape` + per-instance
 * config. Each per-adapter file calls this helper.
 */
export function createThinAdapter<TSchema extends ZodTypeAny>(
  shape: ProviderShape<TSchema>,
  config: ThinAdapterConfig,
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return {
    name: shape.adapter_name,
    model_id: shape.model_id,
    model_version: shape.model_version,
    provider_id: shape.provider_id,
    capabilities: shape.capabilities,
    cost_per_unit_usd_cents: shape.cost_per_unit_usd_cents,
    applyBrandLock,
    async invoke(
      input: MediaProviderInput,
      ctx: ProviderContext,
    ): Promise<AdapterResult> {
      const logger = pickLogger(ctx.logger);
      const apiKey = config.apiKey ?? readEnvKey(shape.env_key);
      const baseUrl = config.baseUrl ?? shape.default_base_url;
      if (!apiKey) return noKey(shape.adapter_name, shape.env_key, logger);

      const cost = shape.estimateCost(input);
      const reserved = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cents: cost,
        logger,
        adapter: shape.adapter_name,
      });
      if (!reserved) return null;

      const startedAt = Date.now();
      const brandedPrompt = applyBrandLock(input.prompt, ctx.brand_spec);
      const negativePrompt = ctx.brand_spec.negative_prompt_terms.join(', ');
      const reqShape = shape.buildRequest({
        apiKey,
        baseUrl,
        brandedPrompt,
        negativePrompt,
        input,
        brand: ctx.brand_spec,
      });

      const init: RequestInit = {
        method: reqShape.method,
        headers: reqShape.headers,
        ...(reqShape.body !== undefined ? { body: reqShape.body } : {}),
      };
      const res = await safeFetch({
        url: reqShape.url,
        init,
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });
      if (!res.ok) {
        await ctx.cost_tracker.release(cost);
        logger.warn(`${shape.adapter_name}: fetch failed`, {
          reason: res.reason,
        });
        return null;
      }

      let parsed: z.infer<TSchema>;
      try {
        parsed = shape.response_schema.parse(JSON.parse(res.bodyText)) as z.infer<
          TSchema
        >;
      } catch (err) {
        await ctx.cost_tracker.release(cost);
        logger.warn(`${shape.adapter_name}: parse failed`, {
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      }

      const seed = ctx.seed ?? 'auto';
      const bytes = shape.extractBytes({ parsed, brandedPrompt, seed });
      const elapsed = Date.now() - startedAt;
      await ctx.cost_tracker.commit(cost);

      return assembleArtifact({
        tenant_id: ctx.tenant_id,
        recipe: config.recipe,
        format: shape.format,
        bytes,
        provider_id: shape.provider_id,
        model_id: shape.model_id,
        model_version: shape.model_version,
        prompt_text: brandedPrompt,
        prompt_image_refs: input.reference_image_urls ?? [],
        seed,
        safety_scan: permissiveSafetyScan(),
        cost_usd_cents: cost,
        duration_ms: elapsed,
        span_citations: config.span_citations,
        generated_at: new Date().toISOString(),
      });
    },
  };
}
