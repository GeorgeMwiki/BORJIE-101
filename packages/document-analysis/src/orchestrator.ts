/**
 * Pipeline orchestrator — drives a document through every stage and
 * persists each layer. Emits a pipeline event after every stage so the
 * audit chain captures the full journey.
 *
 * Public entry: `analyzeDocument(documentId, tenantId, deps)`. The caller
 * has already run `ingestDocument()` to create the row. The orchestrator
 * fetches the document, walks it through OCR → layout → extract →
 * resolve → route, and updates `processing_state` along the way.
 */

import { randomUUID } from 'node:crypto';
import { classifyDocType, extractEntities } from './extract/index.js';
import { extractText } from './ocr/index.js';
import { parseLayout } from './layout/index.js';
import { decideRouting } from './route/index.js';
import { resolveEntities } from './resolve/index.js';
import type {
  IDocumentRepository,
  IExtractionRepository,
  IEntityRepository,
  IRoutingRepository,
  IDocumentStorage,
  IEntityResolver,
  IEventBus,
  ILlmClient,
  CreateExtractionInput,
  CreateEntityInput,
  CreateRoutingInput,
} from './ports.js';
import { THRESHOLDS, type Document, type Extraction } from './types.js';

export interface OrchestratorDeps {
  readonly documents: IDocumentRepository;
  readonly extractions: IExtractionRepository;
  readonly entities: IEntityRepository;
  readonly routing: IRoutingRepository;
  readonly storage: IDocumentStorage;
  readonly resolver: IEntityResolver;
  readonly events: IEventBus;
  readonly llm?: ILlmClient | null;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

export interface AnalysisOutput {
  readonly document: Document;
  readonly extractions: ReadonlyArray<Extraction>;
  readonly entityResolutions: ReadonlyArray<{
    readonly extractionId: string;
    readonly resolvedEntityId: string | null;
    readonly confidence: number;
    readonly method: string;
  }>;
  readonly routings: ReadonlyArray<{
    readonly module: string;
    readonly action: string;
    readonly hitlRequired: boolean;
  }>;
  /** Doc type chosen by the classifier (after extractions). */
  readonly docType: string;
  readonly docTypeConfidence: number;
}

export class DocumentNotFoundError extends Error {
  constructor(documentId: string) {
    super(`document not found: ${documentId}`);
    this.name = 'DocumentNotFoundError';
  }
}

/**
 * End-to-end analysis of one document.
 *
 * Stages (each emits a pipeline event):
 *   1. fetch document (storage + repo)
 *   2. OCR / native text extraction
 *   3. layout parse
 *   4. classify
 *   5. extract entities
 *   6. resolve entities against core_entity
 *   7. decide routing
 *   8. persist + mark `done`
 */
export async function analyzeDocument(
  documentId: string,
  tenantId: string,
  deps: OrchestratorDeps,
): Promise<AnalysisOutput> {
  const newId = deps.newId ?? (() => randomUUID());
  const now = deps.now ?? (() => new Date());

  // 1. Fetch the document.
  const document = await deps.documents.findById(tenantId, documentId);
  if (!document) throw new DocumentNotFoundError(documentId);

  try {
    // 2. OCR / text extraction.
    const buffer = await deps.storage.getObject(tenantId, document.storagePath);
    const ocr = await extractText({
      content: buffer,
      mimeType: document.mimeType,
    });
    await deps.documents.updateState(tenantId, documentId, 'ocr_done', {
      ocrText: ocr.text,
      ocrLanguage: ocr.language,
      pageCount: ocr.pageCount ?? undefined,
    });
    deps.events.emit({
      tenantId,
      documentId,
      stage: 'ocr_done',
      at: now(),
      metadata: {
        method: ocr.method,
        confidence: ocr.confidence,
        language: ocr.language,
      },
    });

    // 3. Layout parse.
    const layout = await parseLayout({
      text: ocr.text,
      mimeType: document.mimeType,
    });
    await deps.documents.updateState(tenantId, documentId, 'parsed');
    deps.events.emit({
      tenantId,
      documentId,
      stage: 'parsed',
      at: now(),
      metadata: { pageCount: layout.pageCount, blockCount: layout.blocks.length },
    });

    // 4. Classify.
    const classify = await classifyDocType(ocr.text, { llm: deps.llm ?? null });

    // 5. Extract entities.
    const extracted = extractEntities({
      docType: classify.docType,
      text: ocr.text,
      layout,
    });

    // Persist `doc_type` as its own extraction so downstream consumers
    // can look it up uniformly. Then persist every other field.
    const extractionInputs: CreateExtractionInput[] = [
      {
        id: newId(),
        documentId,
        tenantId,
        extractionKind: 'doc_type',
        key: 'doc_type',
        value: { docType: classify.docType, scores: classify.scores },
        confidence: classify.confidence,
        page: null,
        bbox: null,
        sourceMethod: classify.llmUsed ? 'llm_extract' : 'rule',
      },
    ];
    const extractionIdByKey = new Map<string, string>();
    for (const field of extracted) {
      const id = newId();
      extractionIdByKey.set(field.key, id);
      extractionInputs.push({
        id,
        documentId,
        tenantId,
        extractionKind: field.extractionKind,
        key: field.key,
        value: field.value,
        confidence: field.confidence,
        page: field.page,
        bbox: field.bbox,
        sourceMethod: field.sourceMethod,
      });
    }
    const persistedExtractions = await deps.extractions.createMany(
      tenantId,
      extractionInputs,
    );
    await deps.documents.updateState(tenantId, documentId, 'extracted');
    deps.events.emit({
      tenantId,
      documentId,
      stage: 'extracted',
      at: now(),
      metadata: {
        docType: classify.docType,
        confidence: classify.confidence,
        fieldCount: extracted.length,
      },
    });

    // 6. Resolve entity-flavoured extractions against canonical entities.
    const entityFields = extracted.filter((e) => e.extractionKind === 'entity');
    const resolutions = await resolveEntities(
      tenantId,
      entityFields.map((e) => ({
        extraction: e,
        queryText: typeof e.value === 'string' ? e.value : String(e.value ?? ''),
      })),
      deps.resolver,
    );

    const entityInputs: CreateEntityInput[] = resolutions
      .map((r) => {
        const extractionId = extractionIdByKey.get(r.extractionKey);
        if (!extractionId) return null;
        return {
          id: newId(),
          documentId,
          tenantId,
          extractionId,
          resolvedEntityId: r.resolvedEntityId,
          resolutionConfidence: r.resolutionConfidence,
          resolutionMethod: r.resolutionMethod,
          resolutionHitlStatus: r.hitlStatus,
        };
      })
      .filter((x): x is CreateEntityInput => x !== null);

    if (entityInputs.length > 0) {
      await deps.entities.createMany(tenantId, entityInputs);
    }
    deps.events.emit({
      tenantId,
      documentId,
      stage: 'resolved',
      at: now(),
      metadata: { resolved: entityInputs.length },
    });

    // 7. Decide routing.
    const decisions = decideRouting({
      docType: classify.docType,
      docTypeConfidence: classify.confidence,
      extractions: extracted,
    });
    const routingInputs: CreateRoutingInput[] = decisions.map((d) => ({
      id: newId(),
      documentId,
      tenantId,
      targetModule: d.targetModule,
      targetAction: d.targetAction,
      targetEntityId: null,
      status: d.status,
      reasoning: d.reasoning,
      hitlRequired: d.hitlRequired,
    }));
    if (routingInputs.length > 0) {
      await deps.routing.createMany(tenantId, routingInputs);
    }
    await deps.documents.updateState(tenantId, documentId, 'routed');
    deps.events.emit({
      tenantId,
      documentId,
      stage: 'routed',
      at: now(),
      metadata: { count: routingInputs.length },
    });

    // 8. Done.
    const finalDoc = await deps.documents.updateState(tenantId, documentId, 'done');
    deps.events.emit({
      tenantId,
      documentId,
      stage: 'done',
      at: now(),
      metadata: { thresholds: THRESHOLDS },
    });

    return {
      document: finalDoc,
      extractions: persistedExtractions,
      entityResolutions: entityInputs.map((e) => ({
        extractionId: e.extractionId,
        resolvedEntityId: e.resolvedEntityId,
        confidence: e.resolutionConfidence,
        method: e.resolutionMethod,
      })),
      routings: routingInputs.map((r) => ({
        module: r.targetModule,
        action: r.targetAction,
        hitlRequired: r.hitlRequired,
      })),
      docType: classify.docType,
      docTypeConfidence: classify.confidence,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.documents.updateState(tenantId, documentId, 'error', {
      processingError: message,
    });
    deps.events.emit({
      tenantId,
      documentId,
      stage: 'error',
      at: now(),
      metadata: { error: message },
    });
    throw err;
  }
}

// ─── Citation helper ─────────────────────────────────────────────────────

export interface CitationView {
  readonly extractionId: string;
  readonly documentId: string;
  readonly page: number | null;
  readonly bbox: Extraction['bbox'];
  readonly value: unknown;
  readonly key: string;
}

/**
 * `renderCitation(extractionId)` — returns a citation view for the
 * frontend to highlight the source.
 */
export async function renderCitation(
  tenantId: string,
  extractionId: string,
  extractions: IExtractionRepository,
): Promise<CitationView | null> {
  const ex = await extractions.findById(tenantId, extractionId);
  if (!ex) return null;
  return {
    extractionId: ex.id,
    documentId: ex.documentId,
    page: ex.page,
    bbox: ex.bbox,
    value: ex.value,
    key: ex.key,
  };
}
