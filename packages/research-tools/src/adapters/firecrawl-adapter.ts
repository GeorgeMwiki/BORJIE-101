/**
 * Firecrawl adapter — JS-rendered fetch + markdown clean.
 *
 * DEEP_RESEARCH_SPEC §5.2: Firecrawl handles JS-rendered pages and
 * outperforms ScrapingBee on dynamic mining-news sites. Returns
 * markdown-cleaned content + images + structured tables.
 *
 * Behaviour:
 *   - Reads FIRECRAWL_API_KEY from env; if absent, returns [].
 *   - Cache TTL: 30 minutes (page content changes faster than search).
 *   - Cost: ~2¢ per scrape (Firecrawl Q2 2026 pricing band).
 *
 * @module @borjie/research-tools/adapters/firecrawl-adapter
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

const FirecrawlDataSchema = z.object({
  markdown: z.string().optional(),
  html: z.string().optional(),
  content: z.string().optional(),
  metadata: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      sourceURL: z.string().optional(),
      publishedTime: z.string().optional(),
    })
    .optional(),
});

const FirecrawlResponseSchema = z.object({
  success: z.boolean().optional(),
  data: FirecrawlDataSchema.optional(),
});

export const FIRECRAWL_NAME = 'firecrawl-fetch';
export const FIRECRAWL_VERSION = '1.0.0';
export const FIRECRAWL_COST_CENTS = 2;
export const FIRECRAWL_CACHE_TTL_SECONDS = 30 * 60;

export interface FirecrawlInput {
  readonly url: string;
  readonly only_main_content?: boolean;
  readonly formats?: ReadonlyArray<'markdown' | 'html' | 'links'>;
  readonly is_fast_moving_topic?: boolean;
}

export interface FirecrawlAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.firecrawl.dev/v1';

export function createFirecrawlAdapter(
  config: FirecrawlAdapterConfig = {},
): ToolAdapter<FirecrawlInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: FIRECRAWL_NAME,
    version: FIRECRAWL_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: FIRECRAWL_COST_CENTS,
    async invoke(
      input: FirecrawlInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const apiKey = config.apiKey ?? readEnvKey('FIRECRAWL_API_KEY');
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

      if (!apiKey) {
        logger.warn('firecrawl: FIRECRAWL_API_KEY missing, returning []');
        return [];
      }

      const cacheParams: Readonly<Record<string, unknown>> = {
        u: input.url,
        only_main: input.only_main_content ?? true,
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: FIRECRAWL_NAME,
        params: cacheParams,
        ttl_seconds: FIRECRAWL_CACHE_TTL_SECONDS,
      });
      if (cached) {
        logger.info('firecrawl: cache hit', { url: input.url });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: FIRECRAWL_COST_CENTS,
        logger,
        adapter: FIRECRAWL_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      const body = {
        url: input.url,
        formats: input.formats ?? ['markdown'],
        onlyMainContent: input.only_main_content ?? true,
      };

      const fetchResult = await safeFetch({
        url: `${baseUrl}/scrape`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        timeoutMs: 30_000,
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(FIRECRAWL_COST_CENTS);
        logger.warn('firecrawl: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof FirecrawlResponseSchema>;
      try {
        parsed = FirecrawlResponseSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(FIRECRAWL_COST_CENTS);
        logger.warn('firecrawl: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const data = parsed.data;
      if (!data) {
        await ctx.cost_tracker.release(FIRECRAWL_COST_CENTS);
        logger.warn('firecrawl: empty data');
        return [];
      }

      const content = data.markdown ?? data.content ?? data.html ?? '';
      const title = data.metadata?.title ?? input.url;
      const sourceUri = data.metadata?.sourceURL ?? input.url;

      const id = deriveArtifactId(ctx.step_id, sourceUri, 0);
      const retrieved_at = new Date().toISOString();
      const buildInput: Parameters<typeof buildArtifact>[0] = {
        id,
        step_id: ctx.step_id,
        source_uri: sourceUri,
        source_kind: 'web',
        title,
        content,
        excerpt: content.slice(0, 500),
        tool_name: FIRECRAWL_NAME,
        cost_usd_cents: FIRECRAWL_COST_CENTS,
        retrieved_at,
        is_fast_moving_topic: input.is_fast_moving_topic === true,
        ...(data.metadata?.publishedTime
          ? { published_at: data.metadata.publishedTime }
          : {}),
      };
      const artifact = buildArtifact(buildInput);
      const artifacts: ReadonlyArray<ResearchArtifact> = [artifact];

      await ctx.cost_tracker.commit(FIRECRAWL_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: FIRECRAWL_NAME,
          params: cacheParams,
          ttl_seconds: FIRECRAWL_CACHE_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('firecrawl: ok', { url: input.url, len: content.length });
      return artifacts;
    },
  };
}
