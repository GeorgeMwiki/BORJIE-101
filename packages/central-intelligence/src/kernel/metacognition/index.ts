/**
 * Metacognition barrel — autobiography, defection probe, activation probe,
 * recursive higher-order thought.
 *
 * These modules expose the brain's self-model surface. Consumers compose
 * them at the kernel + sleep-time-worker layers.
 */

export {
  generateAutobiography,
  type Autobiography,
  type AutobiographyArgs,
  type AutobiographyDecisionRecord,
} from './autobiography.js';
