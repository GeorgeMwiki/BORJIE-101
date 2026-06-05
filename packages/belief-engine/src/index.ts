/**
 * `@borjie/belief-engine` — public surface.
 *
 * Epistemic belief layer ported from LITFIN (LP-17/18). Pure logic with an
 * injected `BeliefStorePort`; the engine NEVER writes a belief directly —
 * every write routes through `reviseBelief` → convince-loop → store.upsert,
 * and a revision only replaces a value when the confidence delta clears the
 * 0.25 gate (0.05–0.25 queues for review; below 0.05 is a no-op).
 *
 * Wire a Drizzle/Supabase `BeliefStorePort` at the app composition root
 * targeting brain_beliefs / belief_revisions / belief_review_queue
 * (migration 0274). The in-memory store ships for tests + local dev.
 */

// Types + ports
export * from './types.js';
export type { PreferencePair, TenantScope } from './learning-types.js';

// Belief store (pure helpers + in-memory adapter)
export {
  makeSubjectKey,
  computeConfidence,
  clamp01,
  createInMemoryBeliefStore,
  type InMemoryBeliefStore,
} from './belief-store.js';

// Convince-loop + guarded revise entry
export {
  convinceLoop,
  sanitizeSearchQuery,
  REVISE_DELTA_THRESHOLD,
  SPLIT_DELTA_THRESHOLD,
  QUARANTINE_REVISE_FLOOR,
  type ConvinceArgs,
  type ConvinceDeps,
  type WebSearchPort,
} from './convince-loop.js';
export { reviseBelief, type ReviseBeliefDeps } from './revise-belief.js';

// Value comparison + evidence weighting (pure)
export { valuesOverlap, SCALAR_TOLERANCE_PCT } from './value-overlap.js';
export {
  newSideEvidenceWeight,
  priorSideEvidenceWeight,
  ageInDays,
  PORTAL_AUTHORITY,
} from './evidence-weight.js';

// DPO preference-learner (pure)
export {
  createHeadState,
  trainHead,
  predictWinProbability,
  dpoLoss,
  rankByPreferenceHead,
  inferModalDimension,
  DEFAULT_TRAIN_CONFIG,
  type PreferenceHeadState,
  type TrainConfig,
} from './preference-learner.js';

// LinUCB contextual bandit (pure)
export {
  createArmState,
  ucbScore,
  updateArmState,
  selectArmByUcb,
  type ArmState,
  type FeatureVector,
  type LinUcbConfig,
} from './bandit.js';

// Mem0 ADD/UPDATE/DELETE/NOOP semantics (pure)
export {
  decideMem0Op,
  describeMem0Decision,
  type Mem0Decision,
  type Mem0Candidate,
  type Mem0ExistingFact,
  type DecideMem0Options,
} from './mem0-semantics.js';

// Nightly Pearson belief×outcome correlation pass
export {
  findCorrelations,
  pearson,
  DEFAULT_MIN_SAMPLE,
  R_THRESHOLD,
  P_THRESHOLD,
  type OutcomeRow,
  type OutcomeFetcher,
  type FindCorrelationsArgs,
  type FindCorrelationsDeps,
  type PearsonResult,
} from './correlation-detector.js';
