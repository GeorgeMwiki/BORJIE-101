/**
 * Head-briefing barrel — Wave 28.
 *
 * Public surface for the cohesive "first-login head screen" that
 * assembles autonomy activity, pending approvals, escalations, KPI
 * deltas, recommendations, and anomalies into a single curated
 * BriefingDocument.
 */

export * from './types.js';
export {
  createBriefingComposer,
  type BriefingComposer,
  type BriefingComposerDeps,
} from './composer.js';
export { renderMarkdown } from './markdown-renderer.js';
export {
  narrateForVoice,
  countWords,
  estimateSecondsForVoice,
  WORDS_PER_MINUTE,
  MAX_NARRATION_SECONDS,
  MIN_NARRATION_SECONDS,
} from './voice-narrator.js';
