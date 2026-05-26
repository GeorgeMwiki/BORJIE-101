/**
 * `@borjie/research-tools` — public surface.
 *
 * Typed agentic-search adapters + source-quality scorer + bias
 * detection. Implements the tool layer of the Deep Research engine
 * (DEEP_RESEARCH_SPEC Phase 2). No business logic — pure adapters,
 * scorer, cache, cost-tracker, citation builder, audit-chain link.
 *
 * Consumed by `services/research-orchestrator/` (Phase 2) which hosts
 * the Planner + Executor + Scorer + Synthesizer pipeline.
 */

// ── Types ─────────────────────────────────────────────────────────────
export {
  RESEARCH_MODES,
  RESEARCH_TOOLS,
  SOURCE_KINDS,
  SOURCE_CLASSES,
  BIAS_FLAGS,
  EntitySchema,
  SpanCitationSchema,
  ResearchArtifactSchema,
  ResearchStepSchema,
  ResearchPlanSchema,
  ResearchResultSchema,
  NOOP_LOGGER,
  type ResearchMode,
  type ResearchTool,
  type SourceKind,
  type SourceClass,
  type BiasFlag,
  type Entity,
  type SpanCitation,
  type ResearchArtifact,
  type ResearchStep,
  type ResearchPlan,
  type ResearchResult,
  type ToolAdapter,
  type ToolContext,
  type ToolCostMeta,
  type CacheTtlSeconds,
  type AuthorityTier,
  type Cache,
  type CostTracker,
  type OwnerConfirmGate,
  type ResearchLogger,
} from './types.js';

// ── Scorer ────────────────────────────────────────────────────────────
export {
  scoreSource,
  classifySource,
  SOURCE_BASE_SCORE,
  type SourceScoreInput,
  type SourceScoreOutput,
} from './scorer/source-quality.js';

export {
  detectBiasFlags,
  type BiasDetectInput,
} from './scorer/bias-detector.js';

// ── Cache ─────────────────────────────────────────────────────────────
export {
  createInMemoryCache,
  createRedisCache,
  createCache,
  buildCacheKey,
  type RedisLike,
  type CacheFactoryOptions,
} from './cache/redis-cache.js';

// ── Budgets ───────────────────────────────────────────────────────────
export {
  createCostTracker,
  createOwnerConfirmGate,
  NEVER_GATES,
  type CostTrackerOptions,
  type OwnerConfirmGateOptions,
} from './budgets/cost-tracker.js';

// ── Citations ─────────────────────────────────────────────────────────
export {
  buildSpanCitation,
  deriveCitationId,
  type BuildCitationInput,
} from './citations/citation-builder.js';

// ── Audit chain link ──────────────────────────────────────────────────
export {
  hashArtifact,
  buildResultAuditPayload,
  computeResultAuditHash,
  summariseArtifactAudit,
  type ResultAuditPayloadInput,
  type ArtifactAuditSummary,
} from './audit/audit-chain-link.js';

// ── Adapters ──────────────────────────────────────────────────────────
export {
  createTavilyAdapter,
  TAVILY_NAME,
  TAVILY_VERSION,
  TAVILY_COST_CENTS,
  TAVILY_CACHE_TTL_SECONDS,
  type TavilyInput,
  type TavilyAdapterConfig,
} from './adapters/tavily-adapter.js';

export {
  createExaAdapter,
  EXA_NAME,
  EXA_VERSION,
  EXA_COST_CENTS,
  EXA_CACHE_TTL_SECONDS,
  type ExaInput,
  type ExaAdapterConfig,
} from './adapters/exa-adapter.js';

export {
  createBraveAdapter,
  BRAVE_NAME,
  BRAVE_VERSION,
  BRAVE_COST_CENTS,
  BRAVE_CACHE_TTL_SECONDS,
  type BraveInput,
  type BraveAdapterConfig,
} from './adapters/brave-adapter.js';

export {
  createFirecrawlAdapter,
  FIRECRAWL_NAME,
  FIRECRAWL_VERSION,
  FIRECRAWL_COST_CENTS,
  FIRECRAWL_CACHE_TTL_SECONDS,
  type FirecrawlInput,
  type FirecrawlAdapterConfig,
} from './adapters/firecrawl-adapter.js';

export {
  createGdeltAdapter,
  GDELT_NAME,
  GDELT_VERSION,
  GDELT_COST_CENTS,
  GDELT_CACHE_TTL_SECONDS,
  type GdeltInput,
  type GdeltAdapterConfig,
} from './adapters/gdelt-adapter.js';

export {
  createLmeAdapter,
  LME_NAME,
  LME_VERSION,
  LME_COST_CENTS,
  LME_PRICE_TTL_SECONDS,
  LME_FUNDAMENTALS_TTL_SECONDS,
  type LmeInput,
  type LmeAdapterConfig,
  type LmeMetric,
} from './adapters/lme-adapter.js';

export {
  createKitcoAdapter,
  KITCO_NAME,
  KITCO_VERSION,
  KITCO_COST_CENTS,
  KITCO_TTL_SECONDS,
  type KitcoInput,
  type KitcoAdapterConfig,
} from './adapters/kitco-adapter.js';

export {
  createRegulatorFeedAdapter,
  parseFeed,
  REGULATOR_NAME,
  REGULATOR_VERSION,
  REGULATOR_COST_CENTS,
  REGULATOR_TTL_SECONDS,
  type RegulatorKind,
  type RegulatorFeedInput,
  type RegulatorFeedAdapterConfig,
} from './adapters/regulator-feed-adapter.js';

export {
  createPdfExtractAdapter,
  PDF_EXTRACT_NAME,
  PDF_EXTRACT_VERSION,
  PDF_EXTRACT_COST_CENTS,
  PDF_EXTRACT_TTL_SECONDS,
  type PdfExtractInput,
  type PdfExtractorPort,
  type PdfExtractorResult,
  type PdfExtractAdapterConfig,
} from './adapters/pdf-extract-adapter.js';

export {
  createImageVisionAdapter,
  IMAGE_VISION_NAME,
  IMAGE_VISION_VERSION,
  IMAGE_VISION_COST_CENTS,
  IMAGE_VISION_TTL_SECONDS,
  type ImageVisionInput,
  type ImageVisionAdapterConfig,
} from './adapters/image-vision-adapter.js';

// ── Adapter shared helpers ────────────────────────────────────────────
export {
  safeFetch,
  reserveBudget,
  buildArtifact,
  deriveArtifactId,
  readCache,
  writeCache,
  readEnvKey,
  pickLogger,
  type SafeFetchOptions,
  type SafeFetchResult,
  type SafeFetchSuccess,
  type SafeFetchFailure,
  type BuildArtifactInput,
  type BudgetGateOptions,
  type BudgetGateResult,
  type CacheWrapOptions,
} from './adapters/shared.js';
