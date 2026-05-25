/**
 * @borjie/central-intelligence — AOP (Agent Operating Procedure)
 * surface.
 *
 * Decagon-style versioned AOP registry: NL operating procedures compile
 * to structured agent runs; new versions are regression-gated against
 * historical transcripts; canary controller routes traffic gradually
 * and auto-rolls back on SLO breach.
 *
 * See `aop-spec.ts` for the full architectural narrative.
 */

export {
  AOPSpecSchema,
  AopModelDescriptorSchema,
  RegressionSetSchema,
  RegressionTranscriptSchema,
  parseAOPSpec,
  parseRegressionSet,
  type AOPSpec,
  type AopModelDescriptor,
  type RegressionSet,
  type RegressionTranscript,
} from './aop-spec.js';

export {
  createAOPRegistry,
  createInMemoryAOPRegistryStore,
  type AOPRegistry,
  type AOPRegistryStore,
  type CreateAOPRegistryArgs,
} from './aop-registry.js';

export {
  createAOPRunner,
  type AOPExecutor,
  type AOPRequest,
  type AOPRunner,
  type AOPRunnerDeps,
  type AOPTrace,
  type AOPToolCallTrace,
} from './aop-runner.js';

export {
  createRegressionRunner,
  scoreTranscript,
  type RegressionReport,
  type RegressionRunner,
  type RegressionRunnerDeps,
  type TranscriptResult,
} from './regression-runner.js';

export {
  createAOPCanaryBridge,
  type AOPCanaryAdapter,
  type AOPCanaryBridge,
  type AOPCanaryBridgeDeps,
  type AOPCanaryStage,
  type PromoteOutcome,
  type RollbackOutcome,
} from './canary-bridge.js';
