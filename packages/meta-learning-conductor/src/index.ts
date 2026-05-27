/**
 * `@borjie/meta-learning-conductor` — public barrel.
 *
 * Wave SELFIMPROVE. Orchestrates the self-improvement loop:
 *
 *   measurement → curate → reward-shape → evaluate → decide → apply
 *
 * Every dependency the runner needs comes in as an injected port —
 * the package has no global state and no I/O of its own.
 *
 * Persona: Mr. Mwikila. Brand: Borjie.
 * Spec: Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  Decision,
  RunStatus,
  Example,
  MetaLearningRun,
  CapabilityCataloguePort,
  RawTrace,
  TraceSourcePort,
  PIIRedactor,
  EvaluatorPort,
  AuditChainPort,
  ClockPort,
  UuidPort,
  Logger,
  RewardShapingConfig,
  PromotionDeciderConfig,
} from './types.js';

export {
  DEFAULT_REWARD_SHAPING,
  DEFAULT_DECIDER_CONFIG,
} from './types.js';

// ---------------------------------------------------------------------------
// Curator
// ---------------------------------------------------------------------------

export {
  canonicalJson,
  curateExamples,
  shapeReward,
  type CurateParams,
  type CurateOutcome,
} from './curator/example-curator.js';

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export {
  runBeforeAfterEval,
  EvaluatorError,
  type RunEvalParams,
  type EvalOutcome,
} from './evaluator/evaluator.js';

// ---------------------------------------------------------------------------
// Decider
// ---------------------------------------------------------------------------

export {
  decidePromotion,
  type DecideInput,
  type DecideOutcome,
} from './decider/promotion-decider.js';

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export {
  createMetaLearningRunner,
  type MetaLearningRunnerDeps,
  type RunOnceParams,
  type RunOnceOutcome,
} from './runner/meta-learning-runner.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export {
  createInMemoryMetaLearningRepository,
  type MetaLearningRunRepository,
} from './repositories/in-memory-repo.js';

export {
  createSqlMetaLearningRepository,
  type SqlClientPort,
  type RunInsertRow,
  type RunUpdateRow,
  type RunSelectRow,
  type ExampleInsertRow,
  type ExampleSelectRow,
} from './repositories/sql-repo.js';
