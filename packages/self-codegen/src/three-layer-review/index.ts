/**
 * Module 4 — three-layer-review
 * Inline subagent + CodeRabbit-class adapter + /ultrareview (CODEOWNER-only).
 */

export * from './types.js';
export {
  InlineSubagentReviewer,
  classifyFindings,
  type InlineSubagentRunner,
} from './layer-1-inline-subagent.js';
export {
  CodeRabbitClassReviewer,
  MockDiffReviewer,
  type DiffReviewerCall,
} from './layer-2-coderabbit-adapter.js';
export {
  UltrareviewReviewer,
  type UltrareviewArgs,
} from './layer-3-ultrareview.js';
export { combineVerdicts, runThreeLayerReview } from './combine-verdicts.js';
