/**
 * Exa Search adapter — secondary semantic web search.
 *
 * DEEP_RESEARCH_SPEC §5.1: Exa is the secondary fallback. Semantic
 * embedding-based search; superior on long-tail "find me a paper /
 * filing / niche source" queries.
 *
 * Behaviour:
 *   - Reads EXA_API_KEY from env; if absent, logs a warning and
 *     returns [] (graceful degradation).
 *   - Cache TTL: 1 hour.
 *   - Cost: ~5¢ per neural-search call (Exa Q2 2026 pricing band).
 *
 * @module @borjie/research-tools/adapters/exa-adapter
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

const ExaResultSchema = z.object({
  id: z.string().optional(),
  url: z.string(),
  title: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  highlights: z.array(z.string()).optional(),
  publishedDate: z.string().nullable().optional(),
  score: z.number().optional(),
});

const ExaResponseSchema = z.object({
  results: z.array(ExaResultSchema),
});

export const EXA_NAME = 'exa-search';
export const EXA_VERSION = '1.0.0';
export const EXA_COST_CENTS = 5;
export const EXA_CACHE_TTL_SECONDS = 60 * 60;

export interface ExaInput {
  readonly query: string;
  readonly num_results?: number;
  readonly type?: 'neural' | 'keyword' | 'auto';
  readonly use_autoprompt?: boolean;
  readonly include_domains?: ReadonlyArray<string>;
  readonly is_fast_moving_topic?: boolean;
  readonly include_text_contents?: boolean;
}

export interface ExaAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.exa.ai';

export function createExaAdapter(
  config: ExaAdapterConfig = {},
): ToolAdapter<ExaInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: EXA_NAME,
    version: EXA_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: EXA_COST_CENTS,
    async invoke(
      input: ExaInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const apiKey = config.apiKey ?? readEnvKey('EXA_API_KEY');
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

      if (!apiKey) {
        logger.warn('exa: EXA_API_KEY missing, returning []');
        return [];
      }

      const cacheParams: Readonly<Record<string, unknown>> = {
        q: input.query,
        n: input.num_results ?? 5,
        t: input.type ?? 'auto',
        ap: input.use_autoprompt ?? true,
        inc: input.include_domains ?? [],
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: EXA_NAME,
        params: cacheParams,
        ttl_seconds: EXA_CACHE_TTL_SECONDS,
      });
      if (cached) {
        logger.info('exa: cache hit', { query: input.query });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: EXA_COST_CENTS,
        logger,
        adapter: EXA_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const body = {
        query: input.query,
        numResults: input.num_results ?? 5,
        type: input.type ?? 'auto',
        useAutoprompt: input.use_autoprompt ?? true,
        ...(input.include_domains && input.include_domains.length > 0
          ? { includeDomains: [...input.include_domains] }
          : {}),
        ...(input.include_text_contents === true
          ? { contents: { text: true } }
          : {}),
      };

      const fetchResult = await safeFetch({
        url: `${baseUrl}/search`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify(body),
        },
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(EXA_COST_CENTS);
        logger.warn('exa: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof ExaResponseSchema>;
      try {
        parsed = ExaResponseSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(EXA_COST_CENTS);
        logger.warn('exa: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const retrieved_at = new Date().toISOString();
      const artifacts: ReadonlyArray<ResearchArtifact> = parsed.results.map(
        (r, idx) => {
          const id = deriveArtifactId(ctx.step_id, r.url, idx);
          const text = r.text ?? '';
          const highlight = (r.highlights ?? []).join(' ');
          const content = text.length > 0 ? text : highlight;
          const buildInput: Parameters<typeof buildArtifact>[0] = {
            id,
            step_id: ctx.step_id,
            source_uri: r.url,
            source_kind: 'web',
            title: r.title ?? r.url,
            content,
            excerpt: (highlight.length > 0 ? highlight : text).slice(0, 500),
            tool_name: EXA_NAME,
            cost_usd_cents: EXA_COST_CENTS / Math.max(1, parsed.results.length),
            retrieved_at,
            is_fast_moving_topic: input.is_fast_moving_topic === true,
            ...(r.publishedDate ? { published_at: r.publishedDate } : {}),
          };
          return buildArtifact(buildInput);
        },
      );

      await ctx.cost_tracker.commit(EXA_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: EXA_NAME,
          params: cacheParams,
          ttl_seconds: EXA_CACHE_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('exa: ok', { results: artifacts.length });
      return artifacts;
    },
  };
}
