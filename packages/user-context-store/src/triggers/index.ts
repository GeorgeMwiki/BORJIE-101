/**
 * Triggers public barrel.
 */
export { computeTriggers } from './engine.js';
export { ALL_TRIGGER_RULES, triggerKey, type TriggerRule } from './rules.js';
export {
  resolveNoiThreshold,
  parseMeasuredDropPct,
  noiDownIsMaterial,
  FALLBACK_MATERIAL_DROP_PCT,
  MIN_COHORT_SIZE,
  type NoiThreshold,
  type ThresholdSource,
} from './noi-threshold.js';
