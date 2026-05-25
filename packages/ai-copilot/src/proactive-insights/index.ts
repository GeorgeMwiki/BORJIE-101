/**
 * Proactive insights \u2014 per-session barrel.
 */
export * from './types.js';
export { INSIGHT_RULES } from './insight-rules.js';
export {
  evaluateInsights,
  prioritise,
  shouldShow,
  filterShowable,
  getProactiveInsights,
} from './insight-engine.js';
export {
  predictNeeds,
  type PredictedNeed,
} from './predictive-needs.js';
export {
  StallDetector,
  type StallDetectorConfig,
  type ActivitySignal,
  type StallState,
} from './stall-detector.js';
