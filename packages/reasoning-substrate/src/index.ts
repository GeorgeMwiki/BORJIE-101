/**
 * @borjie/reasoning-substrate — public surface.
 *
 * Phase M-A: the deep-reasoning substrate the MD agent runs on.
 *
 * Closes L1 audit picks #1, #2, #3:
 *
 *   #1  Adaptive thinking + interleaved tool use (Claude 4.6+)
 *       → `./adaptive-thinking/createThinkingMessage`
 *       → `./continuity/prepareNextTurn` (thinking-block continuity)
 *
 *   #2  Plan-and-Solve+ (Wang ACL 2023) outer plan
 *       → `./plan-and-solve/wrapWithPlanAndSolve`
 *
 *   #3  Self-Discover task-class structures (Zhou DeepMind 2024)
 *       → `./self-discover/discoverReasoningStructure`
 *       → 39 universal primitives + 6 BORJIE domain primitives
 *       → Cached in K-D's TemporalKG by `(taskClass, jurisdiction)`
 *
 * Integration shims:
 *
 *   - `./integrations/buildReasoningPrefix`     ← K-D prefix cache
 *   - `./integrations/scoreWithKEConstitutional` ← K-E critic
 *   - `./integrations/recordTaggedReflection`    ← K-D Reflexion writer
 *
 * Critical API quirk (per L1 audit): Opus 4.7 returns 400 on the
 * legacy `thinking: { type: 'enabled', ... }` shape. The wrapper here
 * makes the legacy shape unrepresentable.
 */

// Adaptive thinking
export {
  createThinkingMessage,
  buildRequest,
  buildTelemetry,
  type AdaptiveEffort,
  type AdaptiveThinkingParam,
  type AnthropicClientLike,
  type AnthropicMessageRequest,
  type AnthropicMessageResponse,
  type AnthropicUsage,
  type AnyBlock,
  type AssistantBlock,
  type AssistantMessage,
  type CreateThinkingMessageArgs,
  type CreateThinkingMessageResult,
  type Message,
  type RedactedThinkingBlock,
  type SystemMessage,
  type TextBlock,
  type ThinkingBlock,
  type ThinkingTelemetryEvent,
  type ThinkingTelemetrySink,
  type ToolResultBlock,
  type ToolSpec,
  type ToolUseBlock,
  type UserMessage,
} from './adaptive-thinking/index.js';

// Plan-and-Solve+
export {
  wrapWithPlanAndSolve,
  planAndSolveSkeleton,
  DEFAULT_EXTRACTION_STRICTNESS,
  type ExtractionStrictness,
  type PlanAndSolveConfig,
} from './plan-and-solve/index.js';

// Self-Discover
export {
  ALL_PRIMITIVES,
  BORJIE_PRIMITIVES,
  EVICTION_TZ_DSM_STRUCTURE,
  ReasoningStructureValidationError,
  REASONING_STRUCTURE_SCHEMA_VERSION,
  SEED_STRUCTURES,
  TENANT_DISPUTE_GLOBAL_STRUCTURE,
  UNIVERSAL_PRIMITIVES,
  buildAdaptPrompt,
  buildImplementPrompt,
  buildSelectPrompt,
  createInMemoryReasoningStructureCache,
  discoverReasoningStructure,
  findPrimitiveById,
  primitiveCounts,
  type BorjieTaskClass,
  type DiscoverArgs,
  type DiscoverResult,
  type DiscovererPort,
  type ReasoningPrimitive,
  type ReasoningPrimitiveDomain,
  type ReasoningStep,
  type ReasoningStructure,
  type ReasoningStructureCachePort,
  type TaskSampleInput,
} from './self-discover/index.js';

// Continuity
export {
  ThinkingContinuityError,
  assertThinkingBlockOrder,
  extractThinkingBlocks,
  prepareNextTurn,
  type PrepareNextTurnArgs,
  type PrepareNextTurnResult,
} from './continuity/index.js';

// Integrations (K-D / K-E shims)
export {
  buildConstitutionalReflection,
  buildReasoningPrefix,
  buildTaggedReflectionText,
  constitutionallyRelevantSteps,
  recordTaggedReflection,
  scoreWithKEConstitutional,
  stableStringify,
  type BuildPrefixArgs,
  type BuildReflectionArgs,
  type ConstitutionalClusterReflection,
  type ConstitutionalCriticPort,
  type RecordTaggedReflectionArgs,
  type ReflexionOutcome as KdReflexionOutcome,
  type ReflexionWriterPort,
  type StepOutput,
} from './integrations/index.js';
