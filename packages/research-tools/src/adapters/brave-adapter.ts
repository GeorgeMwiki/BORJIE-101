/**
 * Brave Search adapter — tertiary fallback / sanity-check oracle.
 *
 * DEEP_RESEARCH_SPEC §5.1: cheap, broad, complementary index. Used to
 * cross-check whether Tavily + Exa missed something Brave found.
 *
 * Behaviour:
 *   - Reads BRAVE_SEARCH_API_KEY from env; if absent, returns [].
 *   - Cache TTL: 1 hour.
 *   - Cost: ~0.5¢ per query (Brave Q2 2026 free-tier pricing).
 *
 * @module @borjie/research-tools/adapters/brave-adapter
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

const BraveResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional().default(''),
  page_age: z.string().optional(),
  age: z.string().optional(),
});

const BraveWebSchema = z.object({
  results: z.array(BraveResultSchema).optional().default([]),
});

const BraveResponseSchema = z.object({
  web: BraveWebSchema.optional(),
  news: z
    .object({
      results: z.array(BraveResultSchema).optional().default([]),
    })
    .optional(),
});

export const BRAVE_NAME = 'brave-search';
export const BRAVE_VERSION = '1.0.0';
export const BRAVE_COST_CENTS = 1; // 1¢ to keep integer cents accounting
export const BRAVE_CACHE_TTL_SECONDS = 60 * 60;

export interface BraveInput {
  readonly query: string;
  readonly count?: number;
  readonly safesearch?: 'strict' | 'moderate' | 'off';
  readonly freshness?: 'pd' | 'pw' | 'pm' | 'py';
  readonly is_fast_moving_topic?: boolean;
}

export interface BraveAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.search.brave.com/res/v1';

export function createBraveAdapter(
  config: BraveAdapterConfig = {},
): ToolAdapter<BraveInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: BRAVE_NAME,
    version: BRAVE_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: BRAVE_COST_CENTS,
    async invoke(
      input: BraveInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const apiKey = config.apiKey ?? readEnvKey('BRAVE_SEARCH_API_KEY');
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

      if (!apiKey) {
        logger.warn('brave: BRAVE_SEARCH_API_KEY missing, returning []');
        return [];
      }

      const cacheParams: Readonly<Record<string, unknown>> = {
        q: input.query,
        c: input.count ?? 5,
        sf: input.safesearch ?? 'moderate',
        fr: input.freshness ?? '',
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: BRAVE_NAME,
        params: cacheParams,
        ttl_seconds: BRAVE_CACHE_TTL_SECONDS,
      });
      if (cached) {
        logger.info('brave: cache hit', { query: input.query });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: BRAVE_COST_CENTS,
        logger,
        adapter: BRAVE_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const params = new URLSearchParams({
        q: input.query,
        count: String(input.count ?? 5),
        safesearch: input.safesearch ?? 'moderate',
      });
      if (input.freshness) params.set('freshness', input.freshness);

      const fetchResult = await safeFetch({
        url: `${baseUrl}/web/search?${params.toString()}`,
        init: {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': apiKey,
          },
        },
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(BRAVE_COST_CENTS);
        logger.warn('brave: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof BraveResponseSchema>;
      try {
        parsed = BraveResponseSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(BRAVE_COST_CENTS);
        logger.warn('brave: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const retrieved_at = new Date().toISOString();
      const rows = parsed.web?.results ?? [];
      const artifacts: ReadonlyArray<ResearchArtifact> = rows.map((r, idx) => {
        const id = deriveArtifactId(ctx.step_id, r.url, idx);
        const buildInput: Parameters<typeof buildArtifact>[0] = {
          id,
          step_id: ctx.step_id,
          source_uri: r.url,
          source_kind: 'web',
          title: r.title,
          content: r.description ?? '',
          excerpt: (r.description ?? '').slice(0, 500),
          tool_name: BRAVE_NAME,
          cost_usd_cents: BRAVE_COST_CENTS / Math.max(1, rows.length),
          retrieved_at,
          is_fast_moving_topic: input.is_fast_moving_topic === true,
        };
        return buildArtifact(buildInput);
      });

      await ctx.cost_tracker.commit(BRAVE_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: BRAVE_NAME,
          params: cacheParams,
          ttl_seconds: BRAVE_CACHE_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('brave: ok', { results: artifacts.length });
      return artifacts;
    },
  };
}
