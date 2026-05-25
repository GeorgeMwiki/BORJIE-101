/**
 * Confidence thresholds that drive the proposal routing.
 *
 *   auto-map        ≥ AUTO_MAP_THRESHOLD       (skip LLM, fall straight to heuristic mapping)
 *   llm-proposal    AUTO_MAP > c ≥ LLM_PROPOSAL_THRESHOLD  (call LLM, show owner the suggestion)
 *   manual-review   c < LLM_PROPOSAL_THRESHOLD  (LLM proposal + flag low confidence)
 *
 * Tuning these is the main lever for calibration; tests assert each
 * boundary explicitly.
 */

export const AUTO_MAP_THRESHOLD = 0.85;
export const LLM_PROPOSAL_THRESHOLD = 0.55;

export type RoutingDecision = 'auto-map' | 'llm-proposal' | 'manual-review';

export function routeByConfidence(confidence: number): RoutingDecision {
  if (confidence >= AUTO_MAP_THRESHOLD) return 'auto-map';
  if (confidence >= LLM_PROPOSAL_THRESHOLD) return 'llm-proposal';
  return 'manual-review';
}
