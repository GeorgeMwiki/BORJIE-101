/**
 * Kitco free gold / silver spot adapter.
 *
 * DEEP_RESEARCH_SPEC §5.6: free fallback when LME is paywalled. Live
 * branch of `packages/mining-commodity-intelligence/src/adapters/kitco.ts`.
 * TTL: 5 minutes.
 *
 * Behaviour:
 *   - No API key required for the public endpoint. KITCO_FEED_URL env
 *     override allowed.
 *   - Returns ResearchArtifact rows; the executor stamps them like any
 *     other tool.
 *
 * @module @borjie/research-tools/adapters/kitco-adapter
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

const KitcoTickSchema = z.object({
  metal: z.string(),
  spot: z.number(),
  currency: z.string().optional(),
  asOf: z.string(),
  bid: z.number().optional(),
  ask: z.number().optional(),
});

export const KITCO_NAME = 'kitco-prices';
export const KITCO_VERSION = '1.0.0';
export const KITCO_COST_CENTS = 0;
export const KITCO_TTL_SECONDS = 5 * 60;

export interface KitcoInput {
  /** Free-form metal name. The Kitco endpoint typically supports
   *  gold | silver | platinum | palladium. */
  readonly metal: string;
}

export interface KitcoAdapterConfig {
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://www.kitco.com/api/v2/spot';

export function createKitcoAdapter(
  config: KitcoAdapterConfig = {},
): ToolAdapter<KitcoInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: KITCO_NAME,
    version: KITCO_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: KITCO_COST_CENTS,
    async invoke(
      input: KitcoInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const baseUrl =
        config.baseUrl ?? readEnvKey('KITCO_FEED_URL') ?? DEFAULT_BASE_URL;

      const cacheParams: Readonly<Record<string, unknown>> = { m: input.metal };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: KITCO_NAME,
        params: cacheParams,
        ttl_seconds: KITCO_TTL_SECONDS,
      });
      if (cached) {
        logger.info('kitco: cache hit', { metal: input.metal });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: KITCO_COST_CENTS,
        logger,
        adapter: KITCO_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const url = `${baseUrl}/${encodeURIComponent(input.metal)}`;
      const fetchResult = await safeFetch({
        url,
        init: { method: 'GET', headers: { Accept: 'application/json' } },
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(KITCO_COST_CENTS);
        logger.warn('kitco: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof KitcoTickSchema>;
      try {
        parsed = KitcoTickSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(KITCO_COST_CENTS);
        logger.warn('kitco: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const retrieved_at = new Date().toISOString();
      const summary = `Kitco ${parsed.metal} spot: ${parsed.spot} ${parsed.currency ?? 'USD'} as of ${parsed.asOf}`;
      const id = deriveArtifactId(ctx.step_id, url, 0);
      const buildInput: Parameters<typeof buildArtifact>[0] = {
        id,
        step_id: ctx.step_id,
        source_uri: url,
        source_kind: 'feed',
        title: `Kitco ${parsed.metal} spot`,
        content: summary,
        excerpt: summary,
        tool_name: KITCO_NAME,
        cost_usd_cents: KITCO_COST_CENTS,
        retrieved_at,
        published_at: parsed.asOf,
        is_fast_moving_topic: true,
      };
      const artifacts: ReadonlyArray<ResearchArtifact> = [buildArtifact(buildInput)];

      await ctx.cost_tracker.commit(KITCO_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: KITCO_NAME,
          params: cacheParams,
          ttl_seconds: KITCO_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('kitco: ok', { metal: input.metal, spot: parsed.spot });
      return artifacts;
    },
  };
}
