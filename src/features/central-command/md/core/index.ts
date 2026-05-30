/**
 * MD Core - Barrel
 *
 * @module features/central-command/md/core
 */

export {
  MdEventSchema,
  MdTurnInputSchema,
  MdObservationSchema,
  MdAssessmentSchema,
  MdProposalSchema,
  MdActionSchema,
  MdFollowUpSchema,
  MdStyleUpdateSchema,
  MdAssistantTextSchema,
  MdFrameworkSchema,
  MdSeveritySchema,
  MdAutonomyLevelSchema,
  MdSubjectRefSchema,
  MdCitationSchema,
  MD_EVENT_KINDS,
  MD_FRAMEWORK_TAGS,
  MD_SEVERITIES,
  MD_AUTONOMY_LEVELS,
  isMdEventKind,
  parseMdEvent,
} from "./types";

export type {
  MdEvent,
  MdEventKind,
  MdObservation,
  MdAssessment,
  MdProposal,
  MdAction,
  MdFollowUp,
  MdStyleUpdate,
  MdAssistantText,
  MdFramework,
  MdSeverity,
  MdAutonomyLevel,
  MdSubjectRef,
  MdCitation,
  MdTurnInput,
  MdTurnResult,
} from "./types";

export { buildMdSystemPrompt, MD_SYSTEM_PROMPT_BLOCKS } from "./system-prompt";

export type { MdSystemPromptInput } from "./system-prompt";

export {
  BusinessStateService,
  BUSINESS_STATE_TTL_MS,
  emptySnapshot,
} from "./business-state";

export type {
  BusinessStateFetcher,
  BusinessStateServiceOptions,
} from "./business-state";

export {
  MdOrchestrator,
  renderMdSystemPromptForTurn,
  renderMdSystemPromptFromTurn,
} from "./orchestrator";

export type { MdOrchestratorDeps, MdOrchestratorOptions } from "./orchestrator";

export type {
  BusinessSnapshot,
  RankedAction,
  MdNbaPort,
  MdAutoPopulatePort,
  MdAutoPopulateRequest,
  MdAutoPopulateResult,
  MdOwnerStylePort,
  MdOwnerStyleProfile,
  MdOwnerStyleObservation,
  MdFollowUpPort,
  MdFollowUpRequest,
  MdFollowUpRecord,
  MdSubagents,
} from "./contracts";
