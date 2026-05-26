/**
 * Image-vision adapter — Anthropic Claude Haiku 4.5 vision.
 *
 * DEEP_RESEARCH_SPEC §5.5: cheap chart / image reader. Reads chart
 * axes + extracts data points as JSON; 90% of Sonnet quality at lower
 * cost per the cost-cascade pricing table.
 *
 * Behaviour:
 *   - Reads ANTHROPIC_API_KEY from env; if absent, returns [].
 *   - Cache TTL: 24h (images don't change).
 *   - Cost: ~10¢ per chart extraction (Haiku 4.5 input + output token band).
 *   - Uses Anthropic Messages API with vision content blocks.
 *
 * @module @borjie/research-tools/adapters/image-vision-adapter
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

const VisionResponseSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export const IMAGE_VISION_NAME = 'image-vision';
export const IMAGE_VISION_VERSION = '1.0.0';
export const IMAGE_VISION_COST_CENTS = 10;
export const IMAGE_VISION_TTL_SECONDS = 24 * 60 * 60;

export interface ImageVisionInput {
  /** Either a URL OR base64-encoded image bytes (with data: prefix). */
  readonly image_source: string;
  readonly image_kind?: 'url' | 'base64';
  readonly media_type?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Prompt — defaults to "extract this chart's data as JSON". */
  readonly prompt?: string;
  /** Model override — defaults to claude-haiku-4-5. */
  readonly model?: string;
}

export interface ImageVisionAdapterConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly defaultModel?: string;
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_PROMPT =
  'Read this chart or image carefully. Return a structured JSON object with: title (string), axes ({ x: string, y: string }), units (string), series (array of { label, points: [{x, y}] }), and any annotations.';

export function createImageVisionAdapter(
  config: ImageVisionAdapterConfig = {},
): ToolAdapter<ImageVisionInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: IMAGE_VISION_NAME,
    version: IMAGE_VISION_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: IMAGE_VISION_COST_CENTS,
    async invoke(
      input: ImageVisionInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);
      const apiKey = config.apiKey ?? readEnvKey('ANTHROPIC_API_KEY');
      const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
      const model = input.model ?? config.defaultModel ?? DEFAULT_MODEL;

      if (!apiKey) {
        logger.warn('image-vision: ANTHROPIC_API_KEY missing, returning []');
        return [];
      }

      const cacheParams: Readonly<Record<string, unknown>> = {
        s: input.image_source,
        k: input.image_kind ?? 'url',
        m: model,
        p: input.prompt ?? '',
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: IMAGE_VISION_NAME,
        params: cacheParams,
        ttl_seconds: IMAGE_VISION_TTL_SECONDS,
      });
      if (cached) {
        logger.info('image-vision: cache hit', { source: input.image_source });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: IMAGE_VISION_COST_CENTS,
        logger,
        adapter: IMAGE_VISION_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      // Build the message body. Anthropic Messages API supports either
      // base64 inline image blocks OR URL-typed image blocks.
      const imageBlock =
        input.image_kind === 'base64'
          ? {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.media_type ?? 'image/jpeg',
                data: stripDataUrlPrefix(input.image_source),
              },
            }
          : {
              type: 'image',
              source: { type: 'url', url: input.image_source },
            };

      const body = {
        model,
        max_tokens: 2_000,
        messages: [
          {
            role: 'user',
            content: [
              imageBlock,
              { type: 'text', text: input.prompt ?? DEFAULT_PROMPT },
            ],
          },
        ],
      };

      const fetchResult = await safeFetch({
        url: `${baseUrl}/messages`,
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        },
        timeoutMs: 30_000,
        ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      });

      if (!fetchResult.ok) {
        await ctx.cost_tracker.release(IMAGE_VISION_COST_CENTS);
        logger.warn('image-vision: fetch failed', { reason: fetchResult.reason });
        return [];
      }

      let parsed: z.infer<typeof VisionResponseSchema>;
      try {
        parsed = VisionResponseSchema.parse(JSON.parse(fetchResult.bodyText));
      } catch (err) {
        await ctx.cost_tracker.release(IMAGE_VISION_COST_CENTS);
        logger.warn('image-vision: response parse failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const textBlocks = parsed.content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text ?? '');
      const content = textBlocks.join('\n').trim();
      if (content.length === 0) {
        await ctx.cost_tracker.release(IMAGE_VISION_COST_CENTS);
        logger.warn('image-vision: empty response');
        return [];
      }

      const retrieved_at = new Date().toISOString();
      const sourceUri =
        input.image_kind === 'url' || input.image_kind === undefined
          ? input.image_source
          : `data:${input.media_type ?? 'image/jpeg'};base64`;
      const id = deriveArtifactId(ctx.step_id, sourceUri, 0);
      const buildInput: Parameters<typeof buildArtifact>[0] = {
        id,
        step_id: ctx.step_id,
        source_uri: sourceUri,
        source_kind: 'image',
        title: `Vision extraction (${model})`,
        content,
        excerpt: content.slice(0, 500),
        tool_name: IMAGE_VISION_NAME,
        cost_usd_cents: IMAGE_VISION_COST_CENTS,
        retrieved_at,
      };
      const artifacts: ReadonlyArray<ResearchArtifact> = [buildArtifact(buildInput)];

      await ctx.cost_tracker.commit(IMAGE_VISION_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: IMAGE_VISION_NAME,
          params: cacheParams,
          ttl_seconds: IMAGE_VISION_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('image-vision: ok', { len: content.length });
      return artifacts;
    },
  };
}

function stripDataUrlPrefix(source: string): string {
  const i = source.indexOf(',');
  if (i < 0) return source;
  return source.slice(i + 1);
}
