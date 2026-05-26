/**
 * Tavily Search adapter — primary web search.
 *
 * Tavily is the SOTA agentic-search index (DEEP_RESEARCH_SPEC §5.1).
 * `search_depth=advanced` returns AI-ready synthesised snippets plus
 * raw URLs we can deep-fetch later.
 *
 * Behaviour:
 *   - Reads TAVILY_API_KEY from env; if absent, logs a warning and
 *     returns [] (graceful degradation, never throws).
 *   - Cache key: tavily:query=<q>|depth=<d>|topic=<t>. TTL: 1 hour.
 *   - Cost: ~1¢ per advanced query (Tavily Q2 2026 pricing).
 *   - Budget: reserves cost BEFORE calling; releases on failure.
 *
 * @module @borjie/research-tools/adapters/tavily-adapter
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

// ---------------------------------------------------------------------------
// Schema (Tavily response shape — see https://docs.tavily.com)
// ===========================================================================

const TavilyResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number().optional(),
  published_date: z.string().optional(),
  raw_content: z.string().nullable().optional(),
});

const TavilyResponseSchema = z.object({
  query: z.string().optional(),
  answer: z.string().nullable().optional(),
  results: z.array(TavilyResultSchema),
});

// ---------------------------------------------------------------------------
// Adapter
// ===========================================================================

export const TAVILY_NAME = 'tavily-search';
export const TAVILY_VERSION = '1.0.0';
export const TAVILY_COST_CENTS = 1; // 1¢/query estimate
export const TAVILY_CACHE_TTL_SECONDS = 60 * 60; // 1h

export interface TavilyInput {
  readonly query: string;
  readonly search_depth?: 'basic' | 'advanced';
  readonly topic?: 'general' | 'news';
  readonly max_results?: number;
  /** Filter to results matching these include-domains. */
  readonly include_domains?: ReadonlyArray<string>;
  /** Mark the topic as fast-moving for the scorer's recency decay. */
  readonly is_fast_moving_topic?: boolean;
}

export interface TavilyAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.tavily.com';

export function createTavilyAdapter(
  config: TavilyAdapterConfig = {},
): ToolAdapter<TavilyInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: TAVILY_NAME,
    version: TAVILY_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: TAVILY_COST_CENTS,
    async invoke(
      input: TavilyInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const apiKey = config.apiKey ?? readEnvKey('TAVILY_API_KEY');
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

      if (!apiKey) {
        logger.warn('tavily: TAVILY_API_KEY missing, returning []');
        return [];
      }

      const cacheParams: Readonly<Record<string, unknown>> = {
        q: input.query,
        depth: input.search_depth ?? 'advanced',
        topic: input.topic ?? 'general',
        max: input.max_results ?? 5,
        include: input.include_domains ?? [],
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: TAVILY_NAME,
        params: cacheParams,
        ttl_seconds: TAVILY_CACHE_TTL_SECONDS,
      });
      if (cached) {
        logger.info('tavily: cache hit', { query: input.query });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: TAVILY_COST_CENTS,
        logger,
        adapter: TAVILY_NAME,
        ...(ctx.owner_confirm
          ? {
              owner_confirm_needed: () =>
                ctx.owner_confirm?.needsConfirm(0) ?? false,
            }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const body = {
        api_key: apiKey,
        query: input.query,
        search_depth: input.search_depth ?? 'advanced',
        topic: input.topic ?? 'general',
        max_results: input.max_results ?? 5,
        ...(input.include_domains && input.include_domains.length > 0
          ? { include_domains: [...input.include_domains] }
          : {}),
      };

      const fetchResult = await safeFetch({
        url: `${baseUrl}/search`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(TAVILY_COST_CENTS);
        logger.warn('tavily: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof TavilyResponseSchema>;
      try {
        parsed = TavilyResponseSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(TAVILY_COST_CENTS);
        logger.warn('tavily: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const retrieved_at = new Date().toISOString();
      const artifacts: ReadonlyArray<ResearchArtifact> = parsed.results.map(
        (r, idx) => {
          const id = deriveArtifactId(ctx.step_id, r.url, idx);
          const content = r.raw_content && r.raw_content.length > 0 ? r.raw_content : r.content;
          const buildInput: Parameters<typeof buildArtifact>[0] = {
            id,
            step_id: ctx.step_id,
            source_uri: r.url,
            source_kind: 'web',
            title: r.title,
            content,
            excerpt: r.content.slice(0, 500),
            tool_name: TAVILY_NAME,
            cost_usd_cents: TAVILY_COST_CENTS / Math.max(1, parsed.results.length),
            retrieved_at,
            is_fast_moving_topic: input.is_fast_moving_topic === true,
            ...(r.published_date ? { published_at: r.published_date } : {}),
          };
          return buildArtifact(buildInput);
        },
      );

      await ctx.cost_tracker.commit(TAVILY_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: TAVILY_NAME,
          params: cacheParams,
          ttl_seconds: TAVILY_CACHE_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('tavily: ok', { results: artifacts.length });
      return artifacts;
    },
  };
}
