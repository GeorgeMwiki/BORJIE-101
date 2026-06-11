/**
 * @borjie/brain-llm-router/model-recommender — AI-SUGGEST (suggest-only).
 * Scores candidate models per use-case from cost + capability + latency
 * metadata and returns ranked suggestions. NEVER writes config (HITL).
 */

export { suggestModelRouting } from './suggest.js';
export type {
  ModelCandidate,
  ModelMetrics,
  SuggestArgs,
  ModelSuggestion,
  UseCaseSuggestion,
  SuggestResult,
} from './suggest.js';
