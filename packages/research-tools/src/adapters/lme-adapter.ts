/**
 * LME (London Metal Exchange) real-time price adapter.
 *
 * DEEP_RESEARCH_SPEC §5.6: paid API. Live branch of
 * `packages/mining-commodity-intelligence/src/adapters/lme.ts`. TTL
 * 5 min on price ticks, 1 hr on fundamentals (warehouse stocks, premia).
 *
 * Behaviour:
 *   - Reads LME_API_KEY from env; if absent, logs a warning and
 *     returns [] (caller falls back to Kitco).
 *   - This adapter is the *research-tools* facade — it returns
 *     ResearchArtifact rows so the executor can stamp them like any
 *     other tool. The mining-commodity-intelligence adapter remains
 *     the canonical price-feed wrapper for downstream pricing logic.
 *
 * @module @borjie/research-tools/adapters/lme-adapter
 */

import { z } from 'zod';

import type {
  ResearchArtifact,
  ToolAdapter,
  ToolContext,
} from '../types.js';
import {
  buildArtifact,
  deriveArtifactId,
  pickLogger,
  readCache,
  readEnvKey,
  reserveBudget,
  safeFetch,
  writeCache,
} from './shared.js';

const LmeSpotSchema = z.object({
  commodity: z.string(),
  price: z.number(),
  currency: z.string().optional(),
  asOf: z.string(),
});

export const LME_NAME = 'lme-prices';
export const LME_VERSION = '1.0.0';
export const LME_COST_CENTS = 1;
export const LME_PRICE_TTL_SECONDS = 5 * 60;
export const LME_FUNDAMENTALS_TTL_SECONDS = 60 * 60;

export type LmeMetric = 'spot' | 'warehouse_stock' | 'premium';

export interface LmeInput {
  readonly commodity: string;
  readonly metric?: LmeMetric;
}

export interface LmeAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.lme.com/v1';

export function createLmeAdapter(
  config: LmeAdapterConfig = {},
): ToolAdapter<LmeInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: LME_NAME,
    version: LME_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: LME_COST_CENTS,
    async invoke(
      input: LmeInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const apiKey = config.apiKey ?? readEnvKey('LME_API_KEY');
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

      if (!apiKey) {
        logger.warn('lme: LME_API_KEY missing, returning []');
        return [];
      }

      const metric: LmeMetric = input.metric ?? 'spot';
      const ttl =
        metric === 'spot' ? LME_PRICE_TTL_SECONDS : LME_FUNDAMENTALS_TTL_SECONDS;

      const cacheParams: Readonly<Record<string, unknown>> = {
        c: input.commodity,
        m: metric,
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: LME_NAME,
        params: cacheParams,
        ttl_seconds: ttl,
      });
      if (cached) {
        logger.info('lme: cache hit', { commodity: input.commodity });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: LME_COST_CENTS,
        logger,
        adapter: LME_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const url =
        metric === 'spot'
          ? `${baseUrl}/spot/${encodeURIComponent(input.commodity)}`
          : `${baseUrl}/${metric}/${encodeURIComponent(input.commodity)}`;

      const fetchResult = await safeFetch({
        url,
        init: {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        },
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(LME_COST_CENTS);
        logger.warn('lme: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof LmeSpotSchema>;
      try {
        parsed = LmeSpotSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(LME_COST_CENTS);
        logger.warn('lme: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const retrieved_at = new Date().toISOString();
      const id = deriveArtifactId(ctx.step_id, url, 0);
      const summary = `LME ${parsed.commodity} ${metric}: ${parsed.price} ${parsed.currency ?? 'USD'} as of ${parsed.asOf}`;
      const buildInput: Parameters<typeof buildArtifact>[0] = {
        id,
        step_id: ctx.step_id,
        source_uri: url,
        source_kind: 'feed',
        title: `LME ${parsed.commodity} ${metric}`,
        content: summary,
        excerpt: summary,
        tool_name: LME_NAME,
        cost_usd_cents: LME_COST_CENTS,
        retrieved_at,
        published_at: parsed.asOf,
        is_fast_moving_topic: true,
      };
      const artifacts: ReadonlyArray<ResearchArtifact> = [buildArtifact(buildInput)];

      await ctx.cost_tracker.commit(LME_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: LME_NAME,
          params: cacheParams,
          ttl_seconds: ttl,
        },
        artifacts,
      );
      logger.info('lme: ok', { commodity: input.commodity, price: parsed.price });
      return artifacts;
    },
  };
}
