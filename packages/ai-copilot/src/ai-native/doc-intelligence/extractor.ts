/**
 * Document entity + obligation extractor.
 *
 * Pipeline:
 *   1. Budget guard.
 *   2. LLM extraction — language detection is INSIDE the LLM call; the
 *      caller never passes a hardcoded 'en' default.
 *   3. Persist entities + obligations with provenance.
 *   4. Fire-and-record embeddings for each entity (via semantic memory port).
 *   5. Return a result with document-span citations for every record.
 *
 * Polyglot-first: the extractor's outputs always carry `languageCode` so
 * downstream dashboards can render in the right language.
 */

import type { CostLedger } from '../../cost-ledger.js';
import { assertBudget, recordAiUsage } from '../phl-common/budget.js';
import {
  generateId,
  promptHashDjb2,
  type Citation,
  type AiNativeResult,
} from '../phl-common/types.js';
import type {
  DocIntelligenceLLMPort,
  DocIntelligenceRepository,
  DocIntelligenceResult,
  ExtractedEntity,
  ExtractedObligation,
  ExtractionInput,
  SemanticMemoryPort,
} from './types.js';

export interface DocIntelligenceDeps {
  readonly ledger?: CostLedger;
  readonly llm: DocIntelligenceLLMPort;
  readonly repo: DocIntelligenceRepository;
  readonly semanticMemory?: SemanticMemoryPort;
  readonly now?: () => Date;
}

export interface DocumentIntelligence {
  extract(
    input: ExtractionInput,
    options?: { readonly correlationId?: string },
  ): Promise<AiNativeResult<DocIntelligenceResult>>;
}

function buildPromptSummary(input: ExtractionInput): string {
  // Deterministic for prompt-hash stability.
  return [
    `tenant:${input.tenantId}`,
    `document:${input.documentId}`,
    `langHint:${input.languageHint ?? 'none'}`,
    `country:${input.countryCode ?? 'none'}`,
    `len:${input.canonicalText.length}`,
    // Include first + last 200 chars (fingerprint) so prompt-hash reflects
    // document content without bloating the hash input.
    `head:${input.canonicalText.slice(0, 200)}`,
    `tail:${input.canonicalText.slice(-200)}`,
  ].join('\n');
}

export function createDocumentIntelligence(
  deps: DocIntelligenceDeps,
): DocumentIntelligence {
  const now = deps.now ?? (() => new Date());

  return {
    async extract(input, options) {
      if (!input.tenantId || !input.documentId) {
        return {
          success: false,
          code: 'VALIDATION',
          message: 'tenantId and documentId are required',
        };
      }
      if (!input.canonicalText || input.canonicalText.trim() === '') {
        return {
          success: false,
          code: 'VALIDATION',
          message: 'canonicalText is required',
        };
      }

      const context = {
        tenantId: input.tenantId,
        operation: 'ai-native.doc-intelligence.extract',
        correlationId: options?.correlationId,
      };

      try {
        await assertBudget(deps, context);
      } catch (err) {
        if (
          err instanceof Error &&
          (err as { code?: string }).code === 'AI_BUDGET_EXCEEDED'
        ) {
          return {
            success: false,
            code: 'BUDGET_EXCEEDED',
            message: err.message,
          };
        }
        throw err;
      }

      const promptSummary = buildPromptSummary(input);
      const hash = promptHashDjb2(promptSummary);

      let output;
      try {
        output = await deps.llm.extract({
          text: input.canonicalText,
          languageHint: input.languageHint,
          countryCode: input.countryCode,
          promptHash: hash,
        });
      } catch (err) {
        return {
          success: false,
          code: 'UPSTREAM_ERROR',
          message:
            err instanceof Error ? err.message : 'doc-intelligence LLM error',
        };
      }

      await recordAiUsage(deps, context, {
        provider: 'ai-native',
        model: output.modelVersion,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        costUsdMicro: output.costUsdMicro,
      });

      const createdAt = now().toISOString();

      // Write embeddings then finalize entity rows.
      const entities: ExtractedEntity[] = [];
      for (const e of output.entities) {
        let embeddingRef: string | null = null;
        if (deps.semanticMemory) {
          try {
            const memRes = await deps.semanticMemory.recordEntityEmbedding({
              tenantId: input.tenantId,
              documentId: input.documentId,
              entityValue: e.entityValue,
              entityKind: e.entityKind,
            });
            embeddingRef = memRes?.embeddingRef ?? null;
          } catch {
            embeddingRef = null;
          }
        }
        entities.push(
          Object.freeze({
            id: generateId('dent'),
            tenantId: input.tenantId,
            documentId: input.documentId,
            entityKind: e.entityKind,
            entityValue: e.entityValue,
            entityRaw: e.entityRaw,
            normalizedForm: { ...e.normalizedForm },
            languageCode: e.languageCode ?? output.detectedLanguage,
            spanStart: e.spanStart,
            spanEnd: e.spanEnd,
            confidence: e.confidence,
            embeddingRef,
            modelVersion: output.modelVersion,
            promptHash: hash,
            createdAt,
          }),
        );
      }

      const obligations: ExtractedObligation[] = output.obligations.map((o) =>
        Object.freeze({
          id: generateId('dobl'),
          tenantId: input.tenantId,
          documentId: input.documentId,
          obligor: o.obligor,
          obligee: o.obligee,
          actionSummary: o.actionSummary,
          dueDate: o.dueDate,
          recurrence: o.recurrence,
          consequenceIfMissed: o.consequenceIfMissed,
          riskFlags: Object.freeze([...o.riskFlags]),
          languageCode: o.languageCode ?? output.detectedLanguage,
          spanStart: o.spanStart,
          spanEnd: o.spanEnd,
          confidence: o.confidence,
          modelVersion: output.modelVersion,
          promptHash: hash,
          explanation: o.explanation,
          createdAt,
        }),
      );

      await deps.repo.insertEntities(entities);
      await deps.repo.insertObligations(obligations);

      // Build citations from document spans so the UI can highlight.
      const citations: Citation[] = [];
      for (const e of entities) {
        if (e.spanStart !== null && e.spanEnd !== null) {
          citations.push({
            kind: 'document_span',
            ref: `${input.documentId}:${e.spanStart}-${e.spanEnd}`,
            note: `${e.entityKind}: ${e.entityValue}`,
          });
        }
      }
      for (const o of obligations) {
        if (o.spanStart !== null && o.spanEnd !== null) {
          citations.push({
            kind: 'document_span',
            ref: `${input.documentId}:${o.spanStart}-${o.spanEnd}`,
            note: `obligation: ${o.actionSummary}`,
          });
        }
      }

      return {
        success: true,
        data: {
          documentId: input.documentId,
          detectedLanguage: output.detectedLanguage,
          entities: Object.freeze(entities),
          obligations: Object.freeze(obligations),
          citations: Object.freeze(citations),
          modelVersion: output.modelVersion,
          promptHash: hash,
        },
      };
    },
  };
}
