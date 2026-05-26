/**
 * @borjie/ai-copilot
 * 
 * AI copilots, predictive workflows, and governed automation
 * for the BORJIE property management platform.
 * 
 * Features:
 * - Maintenance triage copilot
 * - Owner reporting copilot
 * - Communication drafting copilot
 * - Risk alerting copilot
 * - Arrears risk prediction
 * - Churn risk prediction
 * - Maintenance recurrence prediction
 * - Occupancy health scoring
 * - Governed prompt library
 * - Human-in-the-loop review workflows
 * - AI governance and audit logging
 * 
 * @example
 * ```typescript
 * import { createAICopilot } from '@borjie/ai-copilot';
 * 
 * const copilot = createAICopilot({
 *   openai: { apiKey: process.env.OPENAI_API_KEY },
 * });
 * 
 * // Triage a maintenance request
 * const result = await copilot.triageMaintenance(input, tenant, actor, context);
 * 
 * // Predict arrears risk
 * const risk = await copilot.predictArrearsRisk(input, tenant);
 * ```
 */

// Main orchestrator
export {
  AICopilot,
  createAICopilot,
  createMockAICopilot,
  type AICopilotConfig,
  type CopilotHealthStatus,
} from './ai-copilot.js';

// ============================================
// Brain — singular-intelligence layer
// (amplifies AICopilot; does not replace it)
// ============================================
export * from './brain.js';
export * from './config/index.js';
export * from './thread/index.js';
export * from './personas/index.js';
export * from './orchestrator/index.js';
export * from './skills/index.js';
export * from './eval/index.js';

// Types
export * from './types/index.js';

// Prompts
export {
  PromptRegistry,
  createPromptRegistry,
  InMemoryPromptStorage,
} from './prompts/prompt-registry.js';

export type {
  PromptStorageBackend,
  PromptNotFoundError,
  PromptValidationError,
  PromptCompilationError,
  PromptRegistryError,
} from './prompts/prompt-registry.js';

export {
  DEFAULT_PROMPTS,
  MAINTENANCE_TRIAGE_PROMPT,
  OWNER_REPORTING_PROMPT,
  COMMUNICATION_DRAFTING_PROMPT,
  RISK_ALERTING_PROMPT,
  MAINTENANCE_TRIAGE_SYSTEM_PROMPT,
  OWNER_REPORTING_SYSTEM_PROMPT,
  COMMUNICATION_DRAFTING_SYSTEM_PROMPT,
  RISK_ALERTING_SYSTEM_PROMPT,
} from './prompts/default-prompts.js';

// Providers
export {
  AIProviderRegistry,
  OpenAIProvider,
  MockAIProvider,
} from './providers/ai-provider.js';

export type {
  AIProvider,
  OpenAIProviderConfig,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
  ModelInfo,
} from './providers/ai-provider.js';

// Shared Anthropic client (used by services migrating off OpenAI)
export {
  ModelTier,
  createAnthropicClient,
  generateStructured,
  StructuredGenerationFailedError,
} from './providers/anthropic-client.js';

export type {
  ModelTierId,
  AnthropicClient,
  AnthropicClientConfig,
  AnthropicSdkLike,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  GenerateStructuredOptions,
  GenerateStructuredResult,
} from './providers/anthropic-client.js';

// Services
export {
  BaseCopilot,
  type CopilotError,
  type CopilotInvocationOptions,
  type CopilotInvocationResult,
  type CopilotEventListener,
  type CopilotFactory,
} from './services/base-copilot.js';

export {
  ReviewService,
  createReviewService,
  InMemoryReviewStorage,
  type ReviewStorageBackend,
  type ReviewRequirement,
  type ReviewDecisionInput,
  type PendingReviewItem,
  type ReviewPolicyConfig,
  type ReviewMetrics,
  type ReviewNotFoundError,
  type ReviewNotRequiredError,
  type ReviewServiceError,
} from './services/review-service.js';

// Copilots
export {
  MaintenanceTriageCopilot,
  createMaintenanceTriageCopilot,
} from './copilots/maintenance-triage.copilot.js';

// Predictions
export {
  PredictionEngine,
  createPredictionEngine,
  type PredictionError,
  type ModelConfig,
  type PredictionEventListener,
} from './predictions/prediction-engine.js';

// Governance
export {
  AIGovernanceService,
  createAIGovernanceService,
  InMemoryGovernanceStorage,
  AIOperationType,
  type AIAuditEvent,
  type UsageMetrics,
  type CostTracking,
  type QualityFeedback,
  type AuditQueryOptions,
  type AIGovernanceStorageBackend,
} from './governance/ai-governance.js';

// ============================================
// AI Copilot Services
// ============================================

// Maintenance Triage
export {
  MaintenanceTriageService,
  createMaintenanceTriageService,
  classifyMaintenanceRequest,
  MaintenanceCategory as TriageMaintenanceCategory,
  MaintenanceSeverity,
  MaintenanceUrgencyLevel,
  type MaintenanceTriageConfig,
  type MaintenanceImage,
  type ClassifyMaintenanceResult,
} from './services/maintenance-triage.js';

// Churn Predictor
export {
  ChurnPredictorService,
  createChurnPredictorService,
  predictChurnRisk,
  ChurnRiskLevel,
  type ChurnPredictorConfig,
  type CustomerData,
  type ChurnDriver,
  type RetentionRecommendation,
  type ChurnPredictionResult,
} from './services/churn-predictor.js';

// Payment Risk
export {
  PaymentRiskService,
  createPaymentRiskService,
  predictPaymentRisk,
  PaymentRiskLevel,
  PaymentPattern,
  type PaymentRiskConfig,
  type PaymentCustomerData,
  type PaymentRiskFactor,
  type PaymentIntervention,
  type PaymentRiskResult,
} from './services/payment-risk.js';

// Next Best Action
export {
  NextBestActionService,
  createNextBestActionService,
  getNextBestAction,
  ActionCategory,
  ActionUrgency,
  type NextBestActionConfig,
  type NBACustomerContext,
  type RecommendedAction,
  type NextBestActionResult,
} from './services/next-best-action.js';

// Sentiment Analyzer
export {
  SentimentAnalyzerService,
  createSentimentAnalyzerService,
  analyzeSentiment,
  SentimentLevel,
  EmotionType,
  type SentimentAnalyzerConfig,
  type MessageContext,
  type DetectedEmotion,
  type ResponseRecommendation,
  type SentimentAnalysisResult,
} from './services/sentiment-analyzer.js';

// Vendor Matcher
export {
  VendorMatcherService,
  createVendorMatcherService,
  matchVendor,
  VendorSpecialty,
  type VendorMatcherConfig,
  type WorkOrderInput,
  type VendorProfile,
  type VendorMatch,
  type VendorMatchingResult,
} from './services/vendor-matcher.js';

// Renewal Optimizer
export {
  RenewalOptimizerService,
  createRenewalOptimizerService,
  generateRenewalOptions,
  PricingStrategy,
  type RenewalOptimizerConfig,
  type LeaseData,
  type PricingOption,
  type RenewalOptimizationResult,
} from './services/renewal-optimizer.js';

// Copilot Prompts
export {
  MAINTENANCE_TRIAGE_CLASSIFICATION_PROMPT,
  CHURN_PREDICTION_PROMPT,
  PAYMENT_RISK_PROMPT,
  NEXT_BEST_ACTION_PROMPT,
  SENTIMENT_ANALYSIS_PROMPT,
  VENDOR_MATCHING_PROMPT,
  RENEWAL_OPTIMIZATION_PROMPT,
  // Module C: AI Personalization Engine Prompts
  PREFERENCE_PROFILE_PROMPT,
  FRICTION_FINGERPRINT_PROMPT,
  NBA_MANAGER_QUEUE_PROMPT,
  DISPUTE_RISK_PROMPT,
  VENDOR_SCORE_PROMPT,
  RENEWAL_STRATEGY_PROMPT,
  CONVERSATIONAL_PERSONALIZATION_PROMPT,
  AI_COPILOT_PROMPTS,
  type PromptTemplate,
} from './prompts/copilot-prompts.js';

// ============================================
// Module C: AI Personalization Engine
// ============================================

// Workflow C.1: Tenant Preference Profile Engine
export {
  PreferenceProfileEngine,
  createPreferenceProfileEngine,
  buildPreferenceProfile,
  ChannelPreference,
  CommunicationStyle,
  LanguagePreference,
  ResponseSpeed,
  type PreferenceProfileEngineConfig,
  type OnboardingData,
  type CommunicationEvent,
  type PreferenceNode,
  type PreferenceGraph,
  type CommunicationAdaptation,
  type PreferenceProfileResult,
} from './services/preference-profile-engine.js';

// Workflow C.2: Friction Fingerprint Analyzer
export {
  FrictionFingerprintAnalyzer,
  createFrictionFingerprintAnalyzer,
  analyzeFingerprint,
  SensitivityCategory,
  EscalationSpeed,
  ResolutionPreference,
  ProactivenessLevel,
  type FrictionFingerprintAnalyzerConfig,
  type CheckInData,
  type InteractionHistory as FrictionInteractionHistory,
  type TenantContext as FrictionTenantContext,
  type SensitivityScore,
  type EscalationProfile,
  type ResolutionProfile,
  type AIProactivenessGuideline,
  type FrictionFingerprintResult,
} from './services/friction-fingerprint-analyzer.js';

// Workflow C.3: NBA Manager Queue
export {
  NBAManagerQueueService,
  createNBAManagerQueueService,
  generateManagerQueue,
  ActionType,
  ExecutionMode,
  QueuePriority,
  DEFAULT_POLICY_THRESHOLDS,
  type NBAManagerQueueConfig,
  type TenantSignals,
  type PolicyThresholds,
  type QueueConfiguration,
  type QueuedAction,
  type ManagerQueueResult,
} from './services/nba-manager-queue.js';

// Risk Scoring Models
export {
  RiskScoringService,
  createRiskScoringService,
  calculateDisputeRisk,
  calculateVendorScore,
  DisputeCategory,
  DisputeRiskLevel,
  VendorSpecialization,
  VendorTier,
  type RiskScoringConfig,
  type DisputeHistoryData,
  type DisputeRiskFactor,
  type DisputeRiskResult,
  type VendorPerformanceData,
  type VendorScoreComponent,
  type VendorScoreResult,
} from './services/risk-scoring.js';

// Enhanced Renewal Strategy Generator
export {
  RenewalStrategyGenerator,
  createRenewalStrategyGenerator,
  generateRenewalStrategy,
  RenewalStrategy,
  IncentiveType,
  DEFAULT_PROPERTY_POLICIES,
  type RenewalStrategyConfig,
  type TenantRenewalData,
  type MarketCompData,
  type PropertyPolicies,
  type RenewalOption,
  type VacancyScenario,
  type RenewalStrategyResult,
} from './services/renewal-strategy-generator.js';

// Cost Ledger — per-tenant AI-usage accounting (imported by api-gateway
// composition root for budget enforcement). Missing from the barrel caused
// service-registry to fall back to degraded mode on boot.
export * from './cost-ledger.js';

// ============================================
// Wave-11 — AI security hardening + semantic memory + heartbeat
// ============================================
export * from './security/index.js';
export * from './memory/index.js';
export * from './heartbeat/index.js';

// ============================================
// Wave-11 — OpenClaw port: ambient brain, agent certification,
// background intelligence, conversation state, proactive insights.
// Namespaced to avoid collisions with existing barrel symbols.
// ============================================
export * as AmbientBrain from './ambient-brain/index.js';
export * as AgentCertification from './agent-certification/index.js';
export * as BackgroundIntelligence from './background-intelligence/index.js';
export * as ConversationState from './conversation-state/index.js';
export * as ProactiveInsights from './proactive-insights/index.js';

// ============================================
// Wave-11 — Knowledge base, workflows, document analysis, estate skills.
// ============================================
export * from './knowledge/index.js';
export * from './workflows/index.js';
export * from './document-analysis/index.js';
export * from './skills/estate/index.js';

// Property grading — Mr. Mwikila's A–F report card system.
export * as PropertyGrading from './property-grading/index.js';

// Conversational Personalization
export {
  ConversationalPersonalizationService,
  createConversationalPersonalizationService,
  generatePersonalizedMessage,
  MessageIntent,
  EmotionalTone,
  type ConversationalPersonalizationConfig,
  type TenantContext as PersonalizationTenantContext,
  type InteractionHistory as PersonalizationInteractionHistory,
  type MessageRequest,
  type PersonalizedMessage,
  type ConversationResponse,
} from './services/conversational-personalization.js';

// ============================================
// Wave 12 — Intelligence Orchestrator + Progressive Intelligence.
// Namespaced to avoid collisions with existing barrel symbols
// (e.g. ProactiveInsights, Brain orchestrator).
// ============================================
export * as IntelligenceOrchestrator from './intelligence-orchestrator/index.js';
export * as ProgressiveIntelligence from './progressive-intelligence/index.js';

// ============================================
// Wave 12 — Learning Journeys + Learning Engine + Rent-Credit-Building.
// Namespaced to avoid collisions.
// ============================================
export * as LearningJourneys from './learning-journeys/index.js';
export * as LearningEngine from './learning-engine/index.js';
export * as RentCreditBuilding from './rent-credit-building/index.js';

// ============================================
// Adaptive Training — admin-driven, Mr. Mwikila-generated training paths.
// Replaces the rigid classroom/course model. Namespaced so it stays
// isolated from classroom and learning-journeys symbol sets.
// ============================================
export * as Training from './training/index.js';

// ============================================
// Organizational Awareness — process mining, bottleneck detection,
// improvement tracking, and the "talk to your organization" skill.
// Namespaced to avoid colliding with existing intelligence symbols.
// ============================================
export * as OrgAwareness from './org-awareness/index.js';
export * as OrgSkills from './skills/org/index.js';

// ============================================
// Tenant Credit Rating — FICO-scale 300-850 rating, portable certificate,
// opt-in cross-landlord sharing. Barrel-exported so the api-gateway router
// can import the service factory and certificate helpers directly.
// ============================================
export * from './credit-rating/index.js';

// ============================================
// AI-Native suite — Agent PhG. Eight capabilities that leverage LLMs to do
// work humans cannot do at scale (sentiment-monitor, market-surveillance,
// multimodal-inspection, polyglot-support, predictive-interventions,
// policy-simulator, natural-language-query, pattern-mining). Namespaced to
// avoid colliding with existing per-service exports.
// ============================================
export * as AiNative from './ai-native/index.js';

// ============================================
// Learning-Loop — Wave 28. Closed self-improvement substrate:
//   outcome → memory → pattern → policy proposal → dry-run → human → rollout
// Namespaced so the learning-loop surface stays distinct from the
// existing LearningEngine / LearningJourneys exports.
// ============================================
export * as LearningLoop from './learning-loop/index.js';

// ============================================
// Risk-Recompute dispatcher — Wave 27 Agent F (Part B.6). Event-driven
// risk-score recomputation. Subscribes to the platform event bus and
// fans-out payment/lease/case/inspection/message events to the
// per-kind compute functions (credit-rating, property-grade,
// vendor-scorecard, churn-probability, tenant-sentiment). Namespaced
// so the router factory + types stay addressable without colliding
// with the existing per-service exports; the dispatcher factory and
// default classifier are also re-exported directly so the api-gateway
// composition root can wire them without a nested import path.
// ============================================
export * as RiskRecompute from './risk-recompute/index.js';
export {
  createRiskRecomputeDispatcher,
  defaultRiskEventClassifier,
  DEFAULT_SUBSCRIBED_EVENT_TYPES,
  DEFAULT_DEDUPE_WINDOW_MS,
  RISK_KINDS,
} from './risk-recompute/index.js';
export type {
  RiskRecomputeDispatcher,
  RiskRecomputeDispatcherDeps,
  SubscribableEventBus as RiskSubscribableEventBus,
  RiskComputeFn,
  RiskComputeJob,
  RiskComputeRegistry,
  RiskDispatchResult,
  RiskDispatcherTelemetry,
  RiskEventClassifier,
  RiskKind,
  RiskTriggerMatch,
} from './risk-recompute/index.js';

// ============================================
// Tenant Branding — Wave 27 Agent E. Per-tenant AI persona identity
// (display name, honorific, greeting, pronoun). Replaces hardcoded
// 'Mr. Mwikila' literals with a country-neutral default + tenant
// overrides. Pure resolvers + a stateful service wrapping an in-memory
// (or Postgres-backed) repository.
// ============================================
export {
  aiPersonaDisplayName,
  aiPersonaFullName,
  aiGreeting,
  aiPronoun,
  renderBrandedTemplate,
  DEFAULT_AI_PERSONA_DISPLAY_NAME,
  DEFAULT_AI_GREETING,
  DEFAULT_AI_PRONOUN,
  MR_MWIKILA_ALIAS,
  type BrandingCapableTenant,
  type TenantBrandingOverrides,
} from './branding/tenant-branding.service.js';

export {
  TenantBrandingService,
  InMemoryTenantBrandingRepository,
  type TenantBrandingRepository,
  type TenantBrandingConfig,
} from './branding/tenant-branding.store.js';

// ============================================
// Wave 28 — Head Briefing. Cohesive first-login morning screen that
// assembles autonomy activity, pending approvals, escalations, KPI
// deltas, recommendations, and anomalies into a single BriefingDocument
// plus markdown + voice-narration renderers. Namespaced so the
// BriefingDocument / RecommendationsSource symbols don't collide with
// the existing BriefingGenerator / StrategicAdvisor exports from the
// autonomy barrel.
// ============================================
export * as HeadBriefing from './head-briefing/index.js';

// ============================================
// Wave 28 — Junior-AI factory + new-head onboarding tour.
// Namespaced so these new public surfaces do not collide with the
// existing onboarding / autonomy symbol sets. Team leads provision
// scoped juniors via JuniorAIFactory; fresh heads get a guided tour
// via NewHeadTour (complementary to, not a replacement for, the
// 7-step autonomy policy wizard).
// ============================================
export * as JuniorAIFactory from './junior-ai-factory/index.js';
export * as NewHeadTour from './onboarding/new-head/index.js';

// ============================================
// Wave 28 — Linguistic/Cognitive DNA ports.
//
// EstateGlossary — curated multilingual estate-term corpus with
// jurisdiction tagging + statute citations; grounds legal-drafter,
// compliance, and tenant-chat output.
//
// DpMemory — cross-tenant pattern library with differential-privacy
// aggregation, consent manager, and budget ledger.
//
// ExtendedThinking — stake-aware router toggling extended inner-loop
// reasoning for high-stakes decisions (terminations, evictions,
// tribunal filings) vs low-stakes (reminders).
//
// MultiScriptHarness — regression gate across Arabic, CJK, Devanagari,
// Swahili, and Latin EMEA/LATAM locales with rubric-based scoring.
//
// ShadowMode — dry-run simulator that records what autonomy *would*
// have done at elevated levels before trust is granted.
//
// LearningReflection — per-action self-reflection written back into
// semantic memory (I did X, outcome was Y, next time I'd Z).
//
// ProactiveLoop — closes the draft-propose-approve-execute loop for
// predictive-intervention signals across domains.
//
// VoicePersonaDNA — pinned tone/pace/register/taboo rules per persona,
// with a consistency validator + drift detector.
//
// HeadBriefing — cohesive first-login morning screen composer
// (already namespaced above; kept adjacent for the linguistic DNA
// surface map).
//
// ArrearsLadder / MoveOut / TenderToContract — explicit state-machine
// orchestrators for previously-implicit multi-step workflows.
// ============================================
export * as EstateGlossary from './estate-glossary/index.js';
export * as DpMemory from './dp-memory/index.js';
export * as ExtendedThinking from './extended-thinking/index.js';
export * as MultiScriptHarness from './multi-script-harness/index.js';
export * as ShadowMode from './shadow-mode/index.js';
export * as VoicePersonaDNA from './voice-persona-dna/index.js';
export * as ProactiveLoop from './proactive-loop/index.js';

// ============================================
// Wave 29 — Graph-Signals. Maps `@borjie/forecasting` Forecasts onto
// the proactive-loop Signal contract so per-node TGN forecasts flow
// through the same draft → approve → execute pipeline as every other
// proactive source. Namespaced to keep the narrow mapping surface
// isolated from the main barrel.
// ============================================
export * as GraphSignals from './graph-signals/index.js';
export * as ArrearsLadderOrchestrator from './orchestrators/arrears-ladder/index.js';
export * as MoveOutOrchestrator from './orchestrators/move-out/index.js';
export * as TenderToContractOrchestrator from './orchestrators/tender-to-contract/index.js';

// ============================================
// Parity K6.2 — GDPR Art. 20 / PDPA s.27 DSAR compiler. Closes parity-gap G3
// (BOSS lacked a data-export path beside `gdpr-service.executeDeletion`). The
// compiler assembles a single JSON bundle of every personal-data row for one
// subject across the property-management surfaces (customers, leases,
// payments, communications, voice turns, owner statements, maintenance
// tickets, KRA MRI filings, GePG transactions, CoT reservoir). Per-field
// classifications are layered through a `ClassificationLookup` port wired
// in the composition root to the database package's classification registry.
// ============================================
export * from './gdpr/index.js';

// ============================================
// LITFIN audit Wave-2 #8 — V8-isolate JS sandbox (`isolated-vm`).
// Ports `LITFIN PROJECT/src/core/litfin-ai/sandbox/js-sandbox.ts` to replace
// the Node `vm` module which OWASP GenAI Q1 2026 flagged as a top-three risk
// for agent platforms running tool calls on tenant data. The default
// snippet budget is 200 ms wall-clock / 32 MB heap; the snippet is double-
// capped (UTF-16 + UTF-8) to defend against astral-plane inflation, and the
// result is scrubbed to JSON-clonable primitives before crossing back into
// the host caller. Use `runJsSandbox` from this barrel any time a copilot
// needs to evaluate caller-supplied JS over governed inputs.
// ============================================
export {
  runJsSandbox,
  DEFAULT_MAX_CODE_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MEMORY_MB,
  MAX_TIMEOUT_MS,
  MAX_MEMORY_MB,
  type SandboxRunResult,
  type SandboxOptions,
} from './sandbox/js-sandbox.js';

// ============================================
// Wave-2 #10 — Company Brain Primitive (research:
// `.audit/litfin-sota-2026-05-23/11-company-brain-primitive.md`).
//
// Brain Event Bus: ACL-tagged, tenant-isolated, fan-out bus that
// connectors (WhatsApp, Slack, Gmail, M-Pesa, …) emit into and that
// consumers (consolidation-worker, work-graph indexer, skill miner)
// subscribe to. Mirrors the Onyx/Glean "permission-aware ingestion"
// pattern — ACL is captured at the same time as content, never
// post-filtered.
//
// Namespaced to keep the brain-bus surface distinct from the
// existing observability EventBus exports (different aggregate
// shape, different consumer semantics).
// ============================================
export * as BrainEventBus from './brain-event-bus/index.js';


// ============================================
// Wave 28b — Mining juniors. Namespaced to avoid collisions with the
// existing knowledge/orchestrator/skills modules that share names like
// `Citation`, `ProposedAction`, `Channel`. Direct callers (chat orchestrator,
// junior-ai-factory) import the most-used Master Brain + Document Agent
// symbols from the un-namespaced re-exports below.
// ============================================
export * as MiningJuniors from './juniors/index.js';
export {
  createMasterBrainAgent,
  createDefaultMasterBrainAgent,
  type MasterBrainAgent,
  type MasterBrainInput,
  type MasterBrainOutput,
  MasterBrainInputSchema,
  MasterBrainOutputSchema,
  MasterBrainMode,
} from './juniors/master-brain.js';
export {
  createDocumentAgent,
  documentAgent,
} from './juniors/document-agent.js';
