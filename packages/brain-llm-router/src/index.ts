/**
 * @borjie/brain-llm-router — Phase N-C top-level exports.
 *
 * The LLM-as-Soul brain layer. Models are interchangeable; this package
 * owns accuracy via DSPy compile + Self-Consistency vote + CoVe verify +
 * provider fallback + cost cascade.
 *
 * Single entry point: `brainCall({task, prompt, tenantId, options?}, ctx)`.
 */

export * from './types.js';

// Universal client
export {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  OllamaAdapter,
  VLLMAdapter,
} from './universal-client/index.js';

// Task ladder
export {
  TASK_LADDER,
  ALL_TASK_KINDS,
  resolveLadder,
  selectAtDepth,
} from './task-ladder/index.js';
export type { TenantLadderMap, TenantLadderOverride } from './task-ladder/index.js';

// Provider fallback
export {
  CircuitBreaker,
  exponentialBackoffMs,
  runFallback,
} from './provider-fallback/index.js';
export type {
  FallbackAttempt,
  FallbackResult,
  FallbackConfig,
  ProviderLadderEntry,
} from './provider-fallback/index.js';

// Cost cascade
export { runCascade, computeCost, getPricing, MODEL_PRICING, normaliseModel } from './cost-cascade/index.js';
export type { CascadeStep, CascadeConfig, CascadeResult, EvalFn } from './cost-cascade/index.js';

// DSPy compile
export {
  defineSignature,
  hashSignature,
  compileSignature,
  formatSystem,
  PromptCache,
  PromptCacheMissError,
  InMemoryCacheStore,
  normaliseModelKey,
} from './dspy-compile/index.js';
export type {
  Signature,
  SignatureField,
  FewShotExample,
  CompiledPrompt,
  CompileOptions,
  CacheReader,
  CacheWriter,
} from './dspy-compile/index.js';

// Hedged requests
export { hedgedInvoke } from './hedged-requests/index.js';
export type { HedgedInvokeConfig, HedgedResult } from './hedged-requests/index.js';

// Prompt portability
export {
  renderXml,
  renderForProvider,
  parseXml,
  lintPortability,
  semanticSimilarity,
  ALL_XML_SECTIONS,
} from './prompt-portability/index.js';
export type { XmlPrompt } from './prompt-portability/index.js';

// Cost cap
export { preflightCostCheck, postflightCharge, InMemorySpendLedger } from './cost-cap/index.js';
export type {
  CostCapConfig,
  CostCapEvent,
  SpendLedger,
  TenantBudget,
  TenantBudgetReader,
  TenantKillSwitch,
} from './cost-cap/index.js';

// Eval-drift logger
export {
  fnv1a,
  logDrift,
  passRate,
  regressionTriggered,
  InMemoryEvalDriftSink,
} from './eval-drift-logger/index.js';
export type {
  EvalDriftEvent,
  EvalDriftSink,
  LogDriftArgs,
  PassRateWindow,
} from './eval-drift-logger/index.js';

// Brain-call orchestrator (THE entry point)
export {
  brainCall,
  projectCallCost,
  majorityVote,
  runCove,
} from './brain-call-orchestrator/index.js';
export type {
  BrainCallContext,
  BrainCallResult,
  ModelClientRegistry,
  VoteResult,
  CoveConfig,
  CoveResult,
} from './brain-call-orchestrator/index.js';

// Dynamic registry — extended with min-tier policy (WX port 1)
export {
  MODEL_REQUIREMENTS,
  enforceMinTier,
  requiresOpusFamily,
  requiresSonnetOrBetter,
  getEnforcementLog,
  getEnforcementStats,
  setMinTierLogger,
  setEnforcementAuditSink,
  clearMinTierLogger,
  clearEnforcementAuditSink,
} from './dynamic-registry/min-tier-policy.js';
export type {
  TaskCategory as MinTierTaskCategory,
  ModelRequirement,
  EnforceResult,
  EnforcementLogEntry,
  MinTierLogger,
  EnforcementAuditSink,
} from './dynamic-registry/min-tier-policy.js';

// Rate-limit pre-flight (WX port 2)
export {
  RateLimitNearExhaustionError,
  checkRateLimitFloor,
  extractRetryAfterMsFromError,
  updateRateLimitFromHeaders,
  parseRetryAfterMs,
  getProviderRateLimitState,
  resetProviderRateLimitState,
} from './rate-limit-preflight/index.js';
export type {
  ProviderRateLimitState,
  PreflightProvider,
  HeadersLike,
} from './rate-limit-preflight/index.js';

// Concurrency gate (WX port 3)
export {
  SlotAcquireTimeoutError,
  acquireSlot,
  createConcurrencyGate,
  getDefaultTenantCapacity,
  getDefaultGlobalCapacity,
  resetConcurrencyGate,
} from './concurrency-gate/index.js';
export type {
  AcquireOptions,
  ConcurrencyGate,
  SlotRelease,
} from './concurrency-gate/index.js';

// Provider-fingerprint scrubber (WX port 4)
export {
  PROVIDER_FINGERPRINT_PATTERNS,
  scrubProviderFingerprints,
} from './provider-fingerprint-scrubber/index.js';
export type { ScrubResult } from './provider-fingerprint-scrubber/index.js';

// PII egress scrubber (WX port 5)
export {
  safeText,
  safePayload,
  setPiiScrubberConfig,
  resetPiiScrubberConfig,
  PII_PATTERNS,
  scrubPiiText,
} from './pii-input-scrubber/index.js';
export type {
  PiiScrubberConfig,
  BrandRedactor,
  PiiScrubber,
  PresidioScrubber,
  PiiPattern,
} from './pii-input-scrubber/index.js';

// AI kill-switch (WX port 6)
export {
  isKillSwitchActive,
  buildKillSwitchPrompt,
  setKillSwitchDbReader,
  resetKillSwitchDbReader,
} from './kill-switch/index.js';
export type {
  KillSwitchLanguage,
  KillSwitchDbReader,
} from './kill-switch/index.js';

// Routing overrides (WX port 7)
export {
  routingOverrideEntrySchema,
  routingOverridePatchSchema,
  LOCKED_CATEGORIES,
  InMemoryOverrideAdapter,
  RoutingOverrideRepository,
} from './routing-overrides/index.js';
export type {
  RoutingOverrideEntry,
  RoutingOverridePatch,
  OverridePort,
  RoutingOverride,
} from './routing-overrides/index.js';

// Cost meter (WX port 8)
export {
  meterCall,
  getTenantSpend,
  resetTenantSpend,
  resetAllTenantSpend,
  setCostMeterEmitter,
  resetCostMeterEmitter,
} from './cost-meter/index.js';
export type {
  CostMeterEvent,
  CostMeterEmitter,
  MeterCallArgs,
  TenantSpendSnapshot,
} from './cost-meter/index.js';

// Policy audit — OCSF emitter + cross-family alert (WX port 9)
export {
  formatPolicyDecisionOcsf,
  bindMinTierToOcsf,
  bindCrossFamilyFallbackToLogger,
} from './policy-audit/index.js';
export type {
  PolicyDecisionOcsf,
  OcsfEmitter,
  CrossFamilyFallbackEvent,
  CrossFamilyFallbackEmitter,
} from './policy-audit/index.js';
