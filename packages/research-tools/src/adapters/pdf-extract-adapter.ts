/**
 * PDF-extract adapter — wraps `packages/document-analysis`.
 *
 * DEEP_RESEARCH_SPEC §5.3: the existing document-analysis orchestrator
 * already runs OCR + layout + classifier + entity extraction. The
 * research-tools layer just facades it as a tool the executor can call.
 *
 * To keep this package light + tree-shakeable, the adapter takes a
 * caller-supplied `pdfExtractor` port. The orchestrator service wires
 * in the real document-analysis pipeline; tests + lightweight callers
 * can supply an in-memory stub.
 *
 * @module @borjie/research-tools/adapters/pdf-extract-adapter
 */

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
  reserveBudget,
  writeCache,
} from './shared.js';

export const PDF_EXTRACT_NAME = 'pdf-extract';
export const PDF_EXTRACT_VERSION = '1.0.0';
export const PDF_EXTRACT_COST_CENTS = 3; // OCR provider cost amortised
export const PDF_EXTRACT_TTL_SECONDS = 24 * 60 * 60; // PDFs are stable

/**
 * Caller-supplied port. The orchestrator service wires this to
 * `packages/document-analysis/orchestrator.runDocumentAnalysisPipeline`.
 */
export interface PdfExtractorPort {
  extract(
    input: PdfExtractInput,
  ): Promise<PdfExtractorResult>;
}

export interface PdfExtractorResult {
  readonly text: string;
  readonly title?: string;
  readonly page_count?: number;
  readonly source_uri?: string;
  readonly published_at?: string;
}

export interface PdfExtractInput {
  /** URL to the PDF OR base64-encoded bytes (caller decides). */
  readonly source: string;
  /** Hint: is this a PDF URL or inline bytes? Adapter passes through. */
  readonly source_kind?: 'url' | 'bytes';
  readonly hint_title?: string;
}

export interface PdfExtractAdapterConfig {
  readonly extractor: PdfExtractorPort;
}

export function createPdfExtractAdapter(
  config: PdfExtractAdapterConfig,
): ToolAdapter<PdfExtractInput, ReadonlyArray<ResearchArtifact>> {
  return {
    name: PDF_EXTRACT_NAME,
    version: PDF_EXTRACT_VERSION,
    authority_tier: 0,
    cost_per_call_usd_cents: PDF_EXTRACT_COST_CENTS,
    async invoke(
      input: PdfExtractInput,
      ctx: ToolContext,
    ): Promise<ReadonlyArray<ResearchArtifact>> {
      const logger = pickLogger(ctx);

      const cacheParams: Readonly<Record<string, unknown>> = {
        s: input.source,
        k: input.source_kind ?? 'url',
      };
      const cached = await readCache<ReadonlyArray<ResearchArtifact>>({
        cache: ctx.cache,
        adapter: PDF_EXTRACT_NAME,
        params: cacheParams,
        ttl_seconds: PDF_EXTRACT_TTL_SECONDS,
      });
      if (cached) {
        logger.info('pdf-extract: cache hit', { source: input.source });
        return cached;
      }

      const gate = await reserveBudget({
        cost_tracker: ctx.cost_tracker,
        estimated_cost_cents: PDF_EXTRACT_COST_CENTS,
        logger,
        adapter: PDF_EXTRACT_NAME,
        ...(ctx.owner_confirm
          ? { owner_confirm_needed: () => ctx.owner_confirm?.needsConfirm(0) ?? false }
          : {}),
      });
      if (!gate.allowed) {
        return [];
      }

      let result: PdfExtractorResult;
      try {
        result = await config.extractor.extract(input);
      } catch (err) {
        await ctx.cost_tracker.release(PDF_EXTRACT_COST_CENTS);
        logger.error('pdf-extract: extractor failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }

      const sourceUri = result.source_uri ?? input.source;
      const id = deriveArtifactId(ctx.step_id, sourceUri, 0);
      const retrieved_at = new Date().toISOString();
      const title = result.title ?? input.hint_title ?? sourceUri;
      const buildInput: Parameters<typeof buildArtifact>[0] = {
        id,
        step_id: ctx.step_id,
        source_uri: sourceUri,
        source_kind: 'pdf',
        title,
        content: result.text,
        excerpt: result.text.slice(0, 500),
        tool_name: PDF_EXTRACT_NAME,
        cost_usd_cents: PDF_EXTRACT_COST_CENTS,
        retrieved_at,
        ...(result.published_at ? { published_at: result.published_at } : {}),
      };
      const artifacts: ReadonlyArray<ResearchArtifact> = [buildArtifact(buildInput)];

      await ctx.cost_tracker.commit(PDF_EXTRACT_COST_CENTS);
      await writeCache(
        {
          cache: ctx.cache,
          adapter: PDF_EXTRACT_NAME,
          params: cacheParams,
          ttl_seconds: PDF_EXTRACT_TTL_SECONDS,
        },
        artifacts,
      );
      logger.info('pdf-extract: ok', { len: result.text.length });
      return artifacts;
    },
  };
}
