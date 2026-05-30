/**
 * MD Follow-Up — Public API.
 *
 * @module features/central-command/md/follow-up
 */

export type {
  EscalationLevel,
  ExtractedCommitment,
  ExtractorFn,
  ExtractorInput,
  FollowUp,
  FollowUpPriority,
  FollowUpStatus,
  SchedulerTickOutput,
} from "./types";

export {
  followUpSchema,
  extractedCommitmentSchema,
  extractorInputSchema,
  followUpPrioritySchema,
  followUpStatusSchema,
  escalationLevelSchema,
} from "./types";

export { defaultExtractor } from "./extractor";

export {
  computeEscalation,
  applyEscalation,
  type EscalationResult,
} from "./escalation";

export {
  runFollowUpScheduler,
  partitionByBucket,
  type SchedulerInput,
} from "./scheduler";

export {
  makeFollowUpPersister,
  type FollowUpPersister,
  type FollowUpPersisterConfig,
  type SupabaseLike as FollowUpSupabaseLike,
} from "./persister";

export {
  makeFollowUpService,
  type CaptureInput,
  type CaptureResult,
  type FollowUpService,
  type FollowUpServiceDeps,
  type TickInput,
} from "./follow-up-service";
