/**
 * GDELT 2.0 news adapter.
 *
 * DEEP_RESEARCH_SPEC §5.8: GDELT 2.0 is free, real-time, multilingual.
 * Query for regulator names, mineral names, mining-company names,
 * Tanzanian licence numbers.
 *
 * No API key required. Cost: effectively 0¢ — but we still record
 * 0 cents through the cost tracker for accounting symmetry.
 *
 * Behaviour:
 *   - Cache TTL: 15 minutes (news is fresh-burning).
 *
 * @module @borjie/research-tools/adapters/gdelt-adapter
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

const GdeltArticleSchema = z.object({
  url: z.string(),
  url_mobile: z.string().optional(),
  title: z.string(),
  seendate: z.string().optional(),
  socialimage: z.string().optional(),
  domain: z.string().optional(),
  language: z.string().optional(),
  sourcecountry: z.string().optional(),
});

const GdeltResponseSchema = z.object({
  articles: z.array(GdeltArticleSchema).optional().default([]),
});

export const GDELT_NAME = 'gdelt-news';
export const GDELT_VERSION = '2.0.0';
export const GDELT_COST_CENTS = 0;
export const GDELT_CACHE_TTL_SECONDS = 15 * 60;

export interface GdeltInput {
  readonly query: string;
  readonly max_records?: number;
  readonly timespan?: string; // e.g. "24h", "7d"
  readonly source_lang?: string;
  readonly source_country?: string;
}

export interface GdeltAdapterConfig {
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export function createGdeltAdapter(
  config: GdeltAdapterConfig = {},
): ToolAdapter<GdeltInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: GDELT_NAME,
    version: GDELT_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: GDELT_COST_CENTS,
    async invoke(
      input: GdeltInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const baseUrl =
        config.baseUrl ?? readEnvKey('GDELT_BASE_URL') ?? DEFAULT_BASE_URL;

      const cacheParams: Readonly<Record<string, unknown>> = {
        q: input.query,
        m: input.max_records ?? 25,
        ts: input.timespan ?? '24h',
        lang: input.source_lang ?? '',
        country: input.source_country ?? '',
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: GDELT_NAME,
        params: cacheParams,
        ttl_seconds: GDELT_CACHE_TTL_SECONDS,
      });
      if (cached) {
        logger.info('gdelt: cache hit', { query: input.query });
        return cached;
      }

      // GDELT is free but we still gate through the cost tracker so the
      // executor's idempotency / dedup logic stays uniform across adapters.
      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: GDELT_COST_CENTS,
        logger,
        adapter: GDELT_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const params = new URLSearchParams({
        query: input.query,
        mode: 'artlist',
        format: 'json',
        maxrecords: String(input.max_records ?? 25),
        timespan: input.timespan ?? '24h',
      });
      if (input.source_lang) params.set('sourcelang', input.source_lang);
      if (input.source_country) params.set('sourcecountry', input.source_country);

      const fetchResult = await safeFetch({
        url: `${baseUrl}?${params.toString()}`,
        init: { method: 'GET', headers: { Accept: 'application/json' } },
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(GDELT_COST_CENTS);
        logger.warn('gdelt: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof GdeltResponseSchema>;
      try {
        parsed = GdeltResponseSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(GDELT_COST_CENTS);
        logger.warn('gdelt: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const retrieved_at = new Date().toISOString();
      const rows = parsed.articles ?? [];
      const artifacts: ReadonlyArray<ResearchArtifact> = rows.map((r, idx) => {
        const id = deriveArtifactId(ctx.step_id, r.url, idx);
        const buildInput: Parameters<typeof buildArtifact>[0] = {
          id,
          step_id: ctx.step_id,
          source_uri: r.url,
          source_kind: 'feed',
          title: r.title,
          content: r.title,
          excerpt: r.title.slice(0, 500),
          tool_name: GDELT_NAME,
          cost_usd_cents: 0,
          retrieved_at,
          is_fast_moving_topic: true,
          ...(r.seendate ? { published_at: r.seendate } : {}),
        };
        return buildArtifact(buildInput);
      });

      await ctx.cost_tracker.commit(GDELT_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: GDELT_NAME,
          params: cacheParams,
          ttl_seconds: GDELT_CACHE_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('gdelt: ok', { results: artifacts.length });
      return artifacts;
    },
  };
}
