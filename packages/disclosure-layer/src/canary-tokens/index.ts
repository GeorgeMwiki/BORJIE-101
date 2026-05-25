/**
 * Canary-tokens — system-prompt leakage detection.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §4
 */

export {
  type CanaryToken,
  type CanaryDetectionResult,
  type CanaryConfig,
  DEFAULT_CANARY_CONFIG,
} from './types.js';
export { generateCanary, embedCanaryInSystemPrompt, isCanaryExpired } from './generator.js';
export {
  detectCanaryLeak,
  detectAnyCanaryLeak,
  detectPartialCanaryLeak,
} from './detector.js';
