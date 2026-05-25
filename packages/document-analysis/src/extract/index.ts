/**
 * Semantic extraction barrel. Two layers:
 *  - `classifyDocType` — what kind of document is this?
 *  - `extractEntities`  — given the type, what entities does it carry?
 */

export { classifyDocType, type ClassifyResult, type ClassifyOptions } from './doc-classifier.js';
export {
  extractEntities,
  type ExtractEntitiesInput,
  type ExtractedField,
} from './entity-extractor.js';
