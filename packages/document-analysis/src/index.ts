/**
 * @borjie/document-analysis — Piece K.
 *
 * Public surface for the document-analysis pipeline. Sub-paths are also
 * available for narrow imports — see package.json `exports`.
 */

export * from './types.js';
export * from './ports.js';
export * from './ingest.js';
export * from './orchestrator.js';
export {
  CrossTenantAccessError,
  InMemoryDocumentRepository,
  InMemoryExtractionRepository,
  InMemoryEntityRepository,
  InMemoryRoutingRepository,
  InMemoryDocumentStorage,
  InMemoryEntityResolver,
  InMemoryEventBus,
  stringSimilarity,
  cosineSimilarity,
} from './in-memory-adapters.js';

export {
  detectLanguage,
  extractText,
  runTesseract,
  TesseractUnavailableError,
  type DetectedLanguage,
  type OcrResult,
  type TesseractOptions,
} from './ocr/index.js';
export { parseLayout, locateInLayout, type ParsedLayout, type LayoutBlock } from './layout/index.js';
export {
  classifyDocType,
  extractEntities,
  type ClassifyResult,
  type ClassifyOptions,
  type ExtractEntitiesInput,
  type ExtractedField,
} from './extract/index.js';
export { resolveEntities, type ResolutionResult } from './resolve/index.js';
export { decideRouting, ROUTING_MATRIX, type RoutingDecision } from './route/index.js';
