/**
 * `@borjie/agent-platform/junior-spawner` — barrel.
 *
 * Wave 18V-DYNAMIC. Spec: `Docs/DESIGN/JUNIOR_DYNAMIC_SPAWNING_SPEC.md`.
 *
 * NOTE: this barrel is intentionally a *sub-barrel*. The parent
 * `agent-platform/src/index.ts` is being touched concurrently by
 * Wave 18V-FIX; we do NOT re-export from there to avoid merge
 * conflicts. Downstream consumers import from
 * `@borjie/agent-platform/src/junior-spawner/index.ts` until the
 * parent barrel is wired in a follow-up.
 */

// Types — public surface
export type {
  JuniorProvenance,
  JuniorLifecycleStatus,
  SpawnerAudience,
  SpawnerJuniorScope,
  SpawnerJuniorMode,
  SpawnerEscalationPolicy,
  ResearchSessionHandle,
  ResolvedScope,
  AttachmentRef,
  JuniorSpawnRequest,
  SpawnDecisionKind,
  SpawnDecision,
  SpawnedJuniorAuthorPayload,
  PersistedJuniorRecord,
  SelectJuniorFn,
  SpawnNewJuniorFn,
  FeedbackKind,
  JuniorTurnFeedbackRecord,
  LifecycleThresholds,
} from './types.js';

export {
  DEFAULT_LIFECYCLE_THRESHOLDS,
  SELECTION_MATCH_THRESHOLD,
  MR_MWIKILA_DISPLAY_NAME,
} from './types.js';

// Selection
export {
  scoreJuniorAgainstIntent,
  topMatchInPool,
  findSeedMatch,
  type MatcherResult,
} from './selection/seed-matcher.js';
export { findSpawnedMatch } from './selection/spawned-matcher.js';
export { findTenantAuthoredMatch } from './selection/tenant-authored-matcher.js';
export {
  selectJunior,
  type SelectJuniorDeps,
} from './selection/select-junior.js';

// Spawn
export {
  validateSpawnedJuniorPayload,
  type ValidationResult,
} from './spawn/payload-validator.js';
export {
  buildSpawnPrompt,
  runSpawnLlmCall,
  SPAWN_COST_BUDGET_USD,
  SPAWN_LATENCY_BUDGET_MS,
  EXTENDED_THINKING_TOKENS,
  type BrainCallFn,
  type BrainCallInput,
  type BrainCallResult,
  type SpawnOutcome,
} from './spawn/spawner-llm.js';
export {
  buildDraftRecord,
  registerDraftJunior,
  type RegistrarInput,
} from './spawn/junior-registrar.js';

// Lifecycle
export {
  decidePromotion,
  shouldPromoteDraftToShadow,
  type PromotionStats,
  type PromotionDecision,
} from './lifecycle/promotion-decider.js';
export {
  decideDeprecation,
  type DeprecationStats,
  type DeprecationDecision,
} from './lifecycle/deprecation-decider.js';
export {
  createInMemoryAuditChainEmitter,
  type AuditChainEmitter,
  type LifecycleAuditEvent,
} from './lifecycle/audit-chain-link.js';

// Satisfaction
export {
  scoreFeedbackRow,
  rollingSatisfaction,
  rollingSatisfactionLastN,
} from './satisfaction/satisfaction-scorer.js';
export {
  createInMemoryFeedbackRepository,
  type FeedbackRepository,
} from './satisfaction/feedback-repository.js';

// Storage
export {
  createInMemoryJuniorRepository,
  type JuniorRepository,
} from './storage/junior-repository.js';
