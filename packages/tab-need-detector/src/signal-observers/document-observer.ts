/**
 * Piece O — Document observer.
 *
 * Subscribes to `document_extractions` rows emitted by Piece K's
 * extraction pipeline. The table may not exist yet — observer accepts
 * events directly via the in-memory contract below.
 *
 * Maps `doc_type` to a suggested module via the scoring matrix.
 */

import { evaluateDocType } from '../scoring-matrix.js';
import type { DocUploadPayload, NewSignalInput } from '../types.js';

/**
 * One observed document extraction event.
 */
export interface DocumentExtractionEvent {
  readonly tenantId: string;
  readonly userId: string;
  readonly documentId: string;
  readonly docType: string;
  readonly confidence?: number;
}

/**
 * Convert a document extraction event into zero or more signals.
 *
 * The confidence (if supplied) damps the weight: weight *= confidence,
 * clamped to [0, weight]. A doc_type with confidence < 0.5 produces
 * a weak signal; a confident classification produces a full-strength one.
 */
export function observeDocument(
  event: DocumentExtractionEvent,
): readonly NewSignalInput[] {
  if (!event || !event.tenantId || !event.userId || !event.docType) return [];

  const hits = evaluateDocType(event.docType);
  if (hits.length === 0) return [];

  const confidence =
    typeof event.confidence === 'number' &&
    Number.isFinite(event.confidence) &&
    event.confidence >= 0 &&
    event.confidence <= 1
      ? event.confidence
      : 1;

  const payload: DocUploadPayload = {
    documentId: event.documentId,
    docType: event.docType,
    ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
  };

  return hits.map((hit) => ({
    tenantId: event.tenantId,
    userId: event.userId,
    signalKind: 'doc_upload' as const,
    signalPayload: { ...payload, matchedRule: hit.rule },
    suggestedModuleTemplateId: hit.suggestedModuleTemplateId,
    weight: hit.weight * confidence,
  }));
}
