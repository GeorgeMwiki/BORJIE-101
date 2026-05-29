/**
 * Public surface of the brilliant intent-inferrer service.
 * Wave COMPANY-BRAIN (Y-A).
 */

export { inferIngestIntent, type InferIntentOptions } from './inferrer.js';
export { generateHeuristicIntent, type HeuristicOptions } from './heuristic.js';
export type {
  IngestIntent,
  IngestSnapshot,
  ProposedOpportunity,
  ProposedReminder,
  ProposedRisk,
  ProposedTab,
} from './types.js';
