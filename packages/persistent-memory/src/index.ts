/**
 * `@borjie/persistent-memory` — public surface.
 *
 * Wave 18GG. The temporal-continuity substrate so Mr. Mwikila never
 * forgets across crashes, restarts, sessions, days, weeks, or
 * months. Spec: docs/DESIGN/MEMORY_AMNESIA_PREVENTION_SOTA.md.
 *
 * Sibling waves: 18AA (semantic store), 18DD (crash revival),
 * 18T (cognitive engine), 18V (junior architecture). This package
 * is consumed by all four.
 *
 * Four substrates form the API:
 *
 *   - session-memory    — short-term tier (sliding-TTL working snapshot)
 *   - skills            — procedural memory tier (Voyager-style)
 *   - pending-threads   — anti-amnesia checkpoint table
 *   - thread-summaries  — MemGPT-style summarised turn-block records
 *
 * Every write goes through the host-wired `AuditChainPort`. There is
 * no out-of-band write path.
 */

// ---------------------------------------------------------------------------
// Types — the public domain surface
// ---------------------------------------------------------------------------
export {
  // Constants
  SESSION_MEMORY_TTL_DAYS,
  SESSION_RECENT_TURNS,
  SKILL_DECAY_DAYS,
  SKILL_COMPOSE_MIN_INVOCATIONS,
  SKILL_PROMOTE_MIN_SUCCESS_RATE,
  SUMMARISE_BUDGET_TOKENS,
  SUMMARISE_BLOCK_TOKENS,
  // Session-memory types
  type ActiveDecision,
  type PendingQuestion,
  type SessionMemory,
  // Skill types
  SKILL_STATUSES,
  type SkillStatus,
  type Precondition,
  type Postcondition,
  type RetryPolicy,
  type SkillStep,
  type Skill,
  // Pending-thread types
  PENDING_KINDS,
  type PendingKind,
  type PendingThread,
  // Thread-summary types
  type ThreadSummary,
  // Operation contexts
  type MemoryWriteContext,
  // Ports
  type SessionMemoryRepository,
  type SkillRepository,
  type PendingThreadRepository,
  type ThreadSummaryRepository,
  type AuditChainPort,
  // Errors
  PersistentMemoryError,
  // Zod schemas
  skillSchema,
  skillStepSchema,
  skillStatusSchema,
  pendingKindSchema,
  pendingThreadInsertSchema,
  sessionMemoryUpsertSchema,
} from './types.js';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export {
  computeSessionExpiry,
  isSessionMemoryFresh,
  type TtlPolicyInput,
} from './session/ttl-policy.js';
export {
  createSessionMemoryUpsert,
  type SessionMemoryUpsertFn,
  type SessionMemoryUpsertInput,
  type SessionMemoryBuilderDeps,
} from './session/session-memory-builder.js';
export {
  createSessionRecall,
  type SessionRecallFn,
  type SessionRecallDeps,
} from './session/session-recall.js';

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
export {
  createSkillObserve,
  createSkillLookupByIntent,
  type SkillObserveFn,
  type SkillObserveInput,
  type SkillLookupByIntentFn,
  type SkillRegistryDeps,
  type SkillLookupDeps,
} from './skill/skill-registry.js';
export {
  decideSkillPromotion,
  aggregateSkillSequences,
  type SkillComposeDecision,
  type SkillObservationStats,
} from './skill/skill-composer.js';
export {
  decideSkillDecay,
  deprecateSkill,
  type DecayDecision,
} from './skill/skill-decay.js';

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------
export {
  createPendingThreadInsert,
  createPendingThreadResolve,
  type PendingThreadInsertFn,
  type PendingThreadResolveFn,
  type PendingThreadInsertInput,
  type PendingThreadTrackerDeps,
} from './threads/pending-thread-tracker.js';
export {
  composeResumptionBrief,
  type ResumptionBrief,
  type ResumptionBriefInput,
} from './threads/thread-resumer.js';

// ---------------------------------------------------------------------------
// Summarisation
// ---------------------------------------------------------------------------
export {
  evaluateBudget,
  type BudgetDecision,
  type BudgetInput,
} from './summarisation/context-budget-tracker.js';
export {
  planSummarisation,
  createSummarise,
  type SummarisationPlan,
  type SummariseFn,
  type SummariseInput,
  type SummariseDeps,
  type TurnSummary,
} from './summarisation/memgpt-summariser.js';

// ---------------------------------------------------------------------------
// Storage — reference in-memory implementations
// ---------------------------------------------------------------------------
export { createInMemorySessionMemoryRepository } from './storage/session-memory-repository.js';
export { createInMemorySkillRepository } from './storage/skill-repository.js';
export { createInMemoryPendingThreadRepository } from './storage/pending-thread-repository.js';
export { createInMemoryThreadSummaryRepository } from './storage/thread-summary-repository.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export { createInMemoryAuditChain } from './audit/audit-chain-link.js';
