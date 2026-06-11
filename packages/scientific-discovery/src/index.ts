/**
 * @borjie/scientific-discovery — public barrel.
 *
 * This is the package's single entry point: `package.json` `main`/
 * `exports` resolve to `dist/index.js`, which is the compiled form of
 * this file. Until this barrel existed the package was an orphan — no
 * `index.ts` meant `dist/index.js` was never emitted, so every
 * `import '@borjie/scientific-discovery'` failed to resolve.
 *
 * The public surface, in dependency order:
 *   - types.ts              — all pure contracts (no runtime)
 *   - co-scientist/*        — the 6-agent Google AI Co-Scientist loop
 *   - causal-fusion/*       — DAG builder + the sidecar transport clients
 *   - sidecar/*             — the concrete composed SidecarClient
 *   - discovery-card/*      — the admin-portal render-contract emitter
 *   - storm/*               — the STORM perspective bank
 *   - seed-library/*        — the 25-hypothesis seed library
 *
 * Nothing else is exported. Internal helpers stay module-private.
 */

// ─────────────────────────────────────────────────────────────────────
// Pure contracts — every type, every zod schema, every enum.
// ─────────────────────────────────────────────────────────────────────
export {
  DISCOVERY_AREAS,
  PERSPECTIVES,
  HypothesisSeedSchema,
  HypothesisSchema,
  CausalDAGSchema,
  RefutationScoresSchema,
  CausalFusionResultSchema,
} from './types.js';
export type {
  DiscoveryArea,
  Perspective,
  HypothesisSeed,
  Hypothesis,
  CausalDAG,
  RefutationScores,
  CausalFusionResult,
  Evidence,
  EvidenceKind,
  EloEntry,
  RankedHypothesis,
  DiscoveryCard,
  LLMClient,
  LLMCompletionRequest,
  LLMCompletionResponse,
  SidecarClient,
  SidecarRefuteRequest,
  SidecarRefuteResponse,
  SidecarPcmciRequest,
  SidecarPcmciResponse,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Co-Scientist orchestrator + its 6 agents.
// ─────────────────────────────────────────────────────────────────────
export { runDiscovery } from './co-scientist/orchestrator.js';
export type { OrchestratorInput, DiscoveryRun } from './co-scientist/orchestrator.js';

export { generateHypotheses } from './co-scientist/generation-agent.js';
export type { GenerateInput } from './co-scientist/generation-agent.js';

export { reflectOnHypotheses } from './co-scientist/reflection-agent.js';
export type { ReflectionVerdict } from './co-scientist/reflection-agent.js';

export { rankHypotheses, applyEloUpdate } from './co-scientist/ranking-agent.js';
export type { RankInput } from './co-scientist/ranking-agent.js';

export { evolveHypotheses } from './co-scientist/evolution-agent.js';
export type { EvolveInput } from './co-scientist/evolution-agent.js';

export { findProximityLinks } from './co-scientist/proximity-agent.js';
export type { ProximityLink } from './co-scientist/proximity-agent.js';

export { metaReview } from './co-scientist/meta-review-agent.js';
export type { MetaReview, MetaReviewInput } from './co-scientist/meta-review-agent.js';

// ─────────────────────────────────────────────────────────────────────
// CausalFusion — DAG builder + the sidecar transport clients.
// ─────────────────────────────────────────────────────────────────────
export { buildCausalDag, passesRefutation } from './causal-fusion/dag-builder.js';
export type { BuildDagOptions } from './causal-fusion/dag-builder.js';

export {
  createRefutationClient,
  buildSidecarHeaders,
  resolveSidecarBaseUrl,
  SidecarUnavailableError,
  SidecarHttpError,
  SidecarSchemaError,
} from './causal-fusion/refutation-client.js';
export type { RefutationClient, RefutationClientOptions } from './causal-fusion/refutation-client.js';

export { createPcmciClient } from './causal-fusion/pcmciplus-client.js';
export type { PcmciClient, PcmciClientOptions } from './causal-fusion/pcmciplus-client.js';

// ─────────────────────────────────────────────────────────────────────
// Concrete composed sidecar client — what the worker hands to runDiscovery.
// ─────────────────────────────────────────────────────────────────────
export { createSidecarClient } from './sidecar/sidecar-client.js';
export type { SidecarClientOptions } from './sidecar/sidecar-client.js';

// ─────────────────────────────────────────────────────────────────────
// Discovery Card emitter.
// ─────────────────────────────────────────────────────────────────────
export { buildDiscoveryCard } from './discovery-card/card-builder.js';
export type { CardBuilderInput } from './discovery-card/card-builder.js';

// ─────────────────────────────────────────────────────────────────────
// STORM perspective bank.
// ─────────────────────────────────────────────────────────────────────
export { PERSPECTIVE_BANK, getPerspective, listPerspectives } from './storm/perspective-bank.js';
export type { PerspectiveSpec } from './storm/perspective-bank.js';

// ─────────────────────────────────────────────────────────────────────
// Seed library — the 25-hypothesis prior pool.
// ─────────────────────────────────────────────────────────────────────
export {
  SEED_LIBRARY,
  findSeedById,
  seedsByArea,
  seedsByPerspective,
  AVAILABLE_CAPACITY_SEEDS,
  OUTSTANDING_ROYALTIES_SEEDS,
  MAINTENANCE_SEEDS,
  PRICING_SEEDS,
  CHURN_SEEDS,
} from './seed-library/index.js';
