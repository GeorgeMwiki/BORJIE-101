/**
 * `@borjie/post-training-rlvr` — public surface.
 *
 * Wave 19C — Reinforcement Learning from Verifiable Rewards
 * orchestration layer for Mr. Mwikila post-training. See
 * `Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md`.
 *
 * Eight functional groups:
 *
 *   1. Types — RlvrRun, RlvrTrace, Verifier, VerificationResult,
 *              RewardShape, CuratedExample, RedactionConfig.
 *   2. Verifier registry.
 *   3. Built-in verifiers — citation-resolves, tra-schema,
 *              royalty-math, brand-lock, calibration,
 *              mutation-authority.
 *   4. Reward shaper.
 *   5. Pipeline — trace-collector, redactor, curator.
 *   6. Runner — RlvrRunner orchestrator.
 *   7. Repositories — in-memory + SQL ports.
 *   8. Defaults — DEFAULT_CURATOR_CONFIG.
 */

// ── Types ──────────────────────────────────────────────────────────────
export type {
  CuratedExample,
  CuratorConfig,
  ExclusionReason,
  RedactionConfig,
  RewardShape,
  RewardWeights,
  RlvrRun,
  RlvrRunKind,
  RlvrRunStatus,
  RlvrToolCall,
  RlvrTrace,
  Verdict,
  Verifier,
  VerificationResult,
} from './types.js';

export { DEFAULT_CURATOR_CONFIG } from './types.js';

// ── Verifier registry ──────────────────────────────────────────────────
export {
  createVerifierRegistry,
  type VerifierRegistry,
} from './verifiers/registry.js';

// ── Built-in verifiers ─────────────────────────────────────────────────
export {
  createCitationResolvesVerifier,
  type Fetcher,
  type CitationResolvesConfig,
} from './verifiers/builtins/citation-resolves.js';
export {
  createTraSchemaVerifier,
  TraFilingSchema,
  type TraFiling,
} from './verifiers/builtins/tra-schema.js';
export {
  createRoyaltyMathVerifier,
  type RoyaltyMathConfig,
} from './verifiers/builtins/royalty-math.js';
export {
  createBrandLockVerifier,
  type BrandLockChecker,
  type BrandLockConfig,
  type BrandLockViolation,
} from './verifiers/builtins/brand-lock.js';
export { createCalibrationVerifier } from './verifiers/builtins/calibration.js';
export { createMutationAuthorityVerifier } from './verifiers/builtins/mutation-authority.js';

// ── Reward ─────────────────────────────────────────────────────────────
export {
  shapeReward,
  type ShapeRewardInput,
} from './reward/reward-shaper.js';

// ── Pipeline ───────────────────────────────────────────────────────────
export {
  createTraceCollector,
  type Clock,
  type CollectTraceInput,
  type IdGen,
  type TraceCollectorConfig,
} from './pipeline/trace-collector.js';
export {
  redactTrace,
  findLeakedSecrets,
} from './pipeline/redactor.js';
export { curate, type CurateInput } from './pipeline/curator.js';

// ── Runner ─────────────────────────────────────────────────────────────
export {
  RlvrRunner,
  type RlvrRunnerDeps,
  type StartRunInput,
  type CompleteRunInput,
  type CompleteRunOutput,
} from './runner/rlvr-runner.js';

// ── Repositories ───────────────────────────────────────────────────────
export {
  createInMemoryRlvrRunRepository,
  createSqlRlvrRunRepository,
  type RlvrRunRepository,
  type SqlExecutor,
} from './repositories/rlvr-run.repository.js';
export {
  createInMemoryRlvrTraceRepository,
  type RlvrTraceRepository,
} from './repositories/rlvr-trace.repository.js';
export {
  createInMemoryRlvrVerificationRepository,
  type RlvrVerificationRepository,
  type StoredVerification,
} from './repositories/rlvr-verification.repository.js';
export {
  createInMemoryRlvrCuratedExampleRepository,
  type RlvrCuratedExampleRepository,
} from './repositories/rlvr-curated-example.repository.js';
