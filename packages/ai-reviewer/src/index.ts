/**
 * `@borjie/ai-reviewer` — public surface.
 *
 * Veteran-expert AI reviewer for property-management workflows. Composes
 * 10 per-kind policies (pre-checks + red-lines + brain prompts) with a
 * brain port for nuanced cases and a coaching layer for work-in-progress
 * hints.
 *
 * Wire it from the composition root:
 *
 *   const reviewer = createAIReviewer({
 *     brain: ...,                  // BrainPort backed by ai-copilot
 *     audit: ...,                  // ReviewAuditPort writing to WORM
 *     coachBrain: ...,             // optional BrainCoachPort
 *     userContextStore: ...,       // optional dossier port
 *   });
 *
 *   await reviewer.review(request);
 *   await reviewer.coach(workInProgress);
 */

export * from './types.js';

export {
  createAIReviewer,
  POLICY_REGISTRY,
  type AIReviewer,
  type CreateAIReviewerArgs,
} from './orchestrator.js';

export {
  parcelEditPolicy,
  polygonDrawPolicy,
  metadataUpdatePolicy,
  photoAddPolicy,
  inspectionPolicy,
  newLeasePolicy,
  maintenanceCompletionPolicy,
  documentUploadPolicy,
  poApprovalPolicy,
  requisitionSubmissionPolicy,
  policyFor,
} from './policies/index.js';

export {
  runBrainReview,
  REVIEWER_SYSTEM_PROMPT,
  type RunBrainReviewArgs,
} from './brain/index.js';

export { coachWorkInProgress, type CoachArgs } from './coaching/index.js';
