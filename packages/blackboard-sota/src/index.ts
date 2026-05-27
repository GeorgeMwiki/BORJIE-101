/**
 * `@borjie/blackboard-sota` — public surface.
 *
 * Wave BLACKBOARD-CORE. The architectural upgrade above Wave 18HH's
 * `blackboard_postings` primitive. Classic Erman/Hayes-Roth blackboard
 * pattern modernised for multi-agent LLM systems: regions, knowledge
 * sources, opportunistic control shell, cross-reference detection,
 * token-budgeted summarisation, per-region hash chain.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md.
 * Persona: Mr. Mwikila (Managing Director). Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types — public type surface
// ---------------------------------------------------------------------------

export type {
  Region,
  RegionKind,
  RegionStatus,
  KnowledgeSource,
  KnowledgeSourceKind,
  Post,
  CrossReference,
  CrossReferenceKind,
  Summary,
  SummaryKind,
  ControlActivation,
  OpenRegionInput,
  RegisterKnowledgeSourceInput,
  AppendPostInput,
  RecordCrossReferenceInput,
  AppendSummaryInput,
  RegionsRepository,
  KnowledgeSourcesRepository,
  PostsRepository,
  CrossReferencesRepository,
  SummariesRepository,
} from './types.js';

export {
  REGION_KINDS,
  REGION_STATUSES,
  KS_KINDS,
  CROSSREF_KINDS,
  SUMMARY_KINDS,
  BLACKBOARD_CONSTANTS,
} from './types.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export {
  buildBlackboardLogger,
  type BlackboardLoggerOptions,
} from './logger.js';

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

export {
  createRegionManager,
  InvalidRegionTransitionError,
  RegionNotFoundError,
  type RegionManager,
} from './regions/region-manager.js';

// ---------------------------------------------------------------------------
// Knowledge sources
// ---------------------------------------------------------------------------

export {
  createKnowledgeSourceRegistry,
  type KnowledgeSourceRegistry,
} from './knowledge-sources/ks-registry.js';

// ---------------------------------------------------------------------------
// Posts (publisher + stream)
// ---------------------------------------------------------------------------

export {
  createPostPublisher,
  EmbeddingDimensionError,
  type PostPublisher,
  type PostPublisherDeps,
} from './posts/post-publisher.js';
export {
  createPostStream,
  type PostStream,
  type PostStreamDeps,
} from './posts/post-stream.js';

// ---------------------------------------------------------------------------
// Control shell + activation policy
// ---------------------------------------------------------------------------

export {
  createControlShell,
  type ControlShell,
  type ControlShellDeps,
  type CompetenceLookupPort,
  type KSActivityClockPort,
  type PickNextInput,
} from './control/control-shell.js';
export {
  scoreActivation,
  computeFreshness,
  type ActivationContext,
  type ActivationScore,
} from './control/activation-policy.js';

// ---------------------------------------------------------------------------
// Cross-reference detection
// ---------------------------------------------------------------------------

export {
  cosineSimilarity,
  assertEmbeddingDim,
  type EmbeddingPort,
} from './crossref/embedding-port.js';
export {
  createCrossReferenceDetector,
  type CrossReferenceDetector,
  type DetectCrossReferencesInput,
} from './crossref/crossref-detector.js';

// ---------------------------------------------------------------------------
// Summarisation
// ---------------------------------------------------------------------------

export {
  createSummaryGenerator,
  type SummaryGenerator,
  type SummaryGeneratorDeps,
  type SummaryLLMPort,
  type SummaryLLMRequest,
  type SummaryLLMResponse,
} from './summary/summary-generator.js';
export {
  createRollingSummaryCron,
  type RollingSummaryCron,
  type RollingSummaryCronDeps,
  type RollingSummaryCronTickResult,
} from './summary/rolling-summary-cron.js';

// ---------------------------------------------------------------------------
// Audit chain
// ---------------------------------------------------------------------------

export {
  computeBlackboardHash,
  verifyRegionChain,
  GENESIS_HASH,
} from './audit/hash-chain.js';

// ---------------------------------------------------------------------------
// Storage adapters (in-memory; production wires Drizzle on the
// database pkg's `blackboard-sota.schema.ts`)
// ---------------------------------------------------------------------------

export { createInMemoryRegionsRepository } from './repositories/in-memory-regions-repository.js';
export { createInMemoryKnowledgeSourcesRepository } from './repositories/in-memory-knowledge-sources-repository.js';
export { createInMemoryPostsRepository } from './repositories/in-memory-posts-repository.js';
export { createInMemoryCrossReferencesRepository } from './repositories/in-memory-cross-references-repository.js';
export { createInMemorySummariesRepository } from './repositories/in-memory-summaries-repository.js';
