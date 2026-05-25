/**
 * Public surface for entity resolution. Importers can use either the
 * sub-path export or the root `@borjie/progressive-intelligence`.
 */
export { resolveEntity, type ResolveEntityArgs } from './resolve.js';
export { mergeEntities, type MergeEntitiesArgs } from './merge.js';
export {
  cosineSimilarity,
  levenshtein,
  levenshteinSimilarity,
  jaroWinkler,
  fuzzyStringSimilarity,
  normalizeIdentifier,
} from './scoring.js';
