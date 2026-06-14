/**
 * Composition root — wires Postgres repos + event bus + domain services
 * into a single typed `ServiceRegistry` that downstream routers pluck
 * out of the Hono context.
 *
 * Rules of engagement:
 *
 *  - Every service that has a Postgres repo AND is pure-DB (no external
 *    API) is constructed here so its endpoints return real data, not
 *    503s.
 *
 *  - Services whose Postgres repos have not yet landed are returned as
 *    `null` — the routers degrade to 503 with a clear reason, which is
 *    the pilot-acceptable behaviour.
 *
 *  - Services requiring external creds (GePG, Anthropic, SendGrid...)
 *    are constructed lazily per request in their routers; the registry
 *    doesn't short-circuit them.
 *
 *  - If `DATABASE_URL` is unset the registry returns an empty skeleton;
 *    routers MUST tolerate that — they should already since the
 *    original stubs also expected potential absence.
 *
 * Subpath imports are used for each domain module (e.g.
 * `@borjie/domain-services/marketplace`) because the top-level
 * barrel re-exports the marketplace/negotiation/waitlist domains under
 * namespaces (`Marketplace.*`, `Negotiation.*`, etc.) which is awkward
 * for direct value access. Subpaths give us clean class imports.
 */

import { createDatabaseClient } from '@borjie/database';
import { logger } from '../utils/logger.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
/**
 * The `DatabaseClient` type alias from `@borjie/database` resolves
 * as a namespace when pulled through the package barrel (TS2709) due
 * to `export *` chains widening the symbol space after the Wave 7
 * Drizzle 0.36 upgrade. We derive the type directly from the factory
 * function instead so composition-root callers never have to reach
 * for the alias.
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  autonomousActionAudit as headBriefingActionAudit,
  miningApprovalItems as headBriefingApprovalItems,
  incidents as headBriefingIncidents,
} from '@borjie/database';
import {
  ListingService,
  EnquiryService,
  TenderService,
  PostgresMarketplaceListingRepository,
  PostgresTenderRepository,
  PostgresBidRepository,
} from '@borjie/domain-services/marketplace';
import { NegotiationService } from '@borjie/domain-services/negotiation';
// Mining-domain Wave 5 — replaces the property-domain negotiation repos
// (PostgresNegotiationPolicyRepository / PostgresNegotiationRepository /
// PostgresNegotiationTurnRepository) with a buyer<->seller bid-thread
// repository keyed by `marketplace_bids.id`.
import { PostgresBidNegotiationRepository } from '@borjie/domain-services/marketplace';
import {
  WaitlistService,
  WaitlistVacancyHandler,
} from '@borjie/domain-services/waitlist';
import {
  OccupancyTimelineService,
  PostgresOccupancyTimelineRepository,
} from '@borjie/domain-services/occupancy';
import { StationMasterRouter } from '@borjie/domain-services/routing';
import {
  RenewalService,
  MoveOutChecklistService,
  type RenewalRepository,
  type RenewalLeaseSnapshot,
} from '@borjie/domain-services/lease';
// Mining hard-fork wave 6 — mining-domain replacements for the seven
// remaining property-domain repositories. Each of these targets a fresh
// mining-schema table (or composes against existing ones) and is wired
// alongside the legacy slot until downstream consumers migrate.
import { PostgresOfftakeQueueRepository } from '@borjie/domain-services/offtake-queue';
import { PostgresWorkerIncentivesRepository } from '@borjie/domain-services/worker-incentives';
import { PostgresSitePreShiftInspectionRepository } from '@borjie/domain-services/site-pre-shift-inspection';
import { DrizzleOreGradingWeightsRepository } from '@borjie/domain-services/ore-grading-weights';
import { DrizzleSiteLiveMetricsSource } from '@borjie/domain-services/site-live-metrics';
import { PostgresSiteSupervisorCoverageRepository } from '@borjie/domain-services/site-supervisor-coverage';
import { DrizzleEquipmentMaintenanceTaxonomyRepository } from '@borjie/domain-services/equipment-maintenance-taxonomy';
// Mining maintenance-taxonomy service (REAL, over
// DrizzleEquipmentMaintenanceTaxonomyRepository). Reshapes the legacy
// property category/problem surface onto the mining equipment-kind model.
import {
  createMiningMaintenanceTaxonomyService,
  type MiningMaintenanceTaxonomyService,
} from '@borjie/domain-services/maintenance-taxonomy';
// Mining ADVISOR wave — stage-aware capability advisor (REAL, over the
// Drizzle `StageAdvisorDb` adapter + migration 0295 tables). Backs the
// `/api/v1/stage` route; once the `stageAdvisor` slot is non-null the route
// resolves a live service instead of returning 503 SERVICE_UNAVAILABLE.
import {
  createStageAdvisor,
  type StageAdvisor,
} from '@borjie/stage-advisor';
import { createDrizzleStageAdvisorDb } from './stage/drizzle-stage-advisor-db.js';
// Wave 26 Z3 — rich ApprovalWorkflowService + Postgres adapters for
// move-out checklists and approval requests. Pairs with migration 0097.
import { ApprovalWorkflowService } from '@borjie/domain-services/approvals';
import { PostgresMoveOutRepository } from './move-out-repository.js';
import {
  PostgresApprovalRequestRepository,
  PostgresApprovalPolicyRepositoryAdapter,
} from './approval-request-repository.js';
// Mining-domain Wave 5 — replaces the property-tenant FinancialProfile +
// RiskReport repos with buyer-centric equivalents persisting to `buyers`
// (extension columns) + `buyer_risk_reports`.
import {
  PostgresBuyerFinancialProfileRepository,
  PostgresBuyerRiskReportRepository,
} from '@borjie/domain-services/buyer';
// FinancialProfileService / RiskReportService are property-domain
// services pending mining-equivalent rewrite — slots stay `null` in the
// live registry until that follow-up batch lands. Type-only imports so
// the `ServiceRegistry` interface still resolves them.
import type {
  FinancialProfileService,
  RiskReportService,
  MiningFinancialProfileService,
} from '@borjie/domain-services/customer';
// Mining-domain buyer financial-profile service (REAL, over the buyer
// financial-profile + risk-report repos). Replaces the property-tenant
// FinancialProfileService for the `/financial-profile` route. Value import
// (the block above is type-only).
import { createMiningFinancialProfileService } from '@borjie/domain-services/customer';
// Mining hard-fork wave 6 — property-domain PostgresGamificationRepository
// has been retired (`reward_policies` / `tenant_gamification_profile` /
// `reward_events` tables dropped by migration 0003). The mining-domain
// replacement (PostgresWorkerIncentivesRepository) is imported above and
// surfaced via the new `workerIncentives` slot; the legacy `gamification`
// slot stays null in the live registry until downstream consumers
// migrate.
import { createGamificationService } from '@borjie/domain-services/gamification';
import {
  MigrationService,
  PostgresMigrationRepository,
} from '@borjie/domain-services/migration';
// REMOVED (borjie hard-fork): CaseService + PostgresCaseRepository — the
// residential-property `cases` table was dropped in 0003_mining_domain.sql;
// mining uses `grievances`. (The Sublease + DamageDeduction namespaces from
// the same subpath survive — imported below.)
import { InMemoryEventBus, type EventBus } from '@borjie/domain-services';

// Wave 8 — Warehouse inventory (S7), Maintenance taxonomy (S7), IoT (S3).
// Mining-domain Wave 5 — the property-inventory DrizzleWarehouseRepository
// + createWarehouseService are retired. The mining ore-stockpile warehouse
// service (REAL, over DrizzleOreWarehouseRepository + DrizzleOreGradingRepository)
// replaces them and backs the `/warehouse` route end-to-end.
import {
  createMiningWarehouseService,
  type MiningWarehouseService,
} from '@borjie/domain-services/warehouse';
import {
  DrizzleOreWarehouseRepository,
  DrizzleOreGradingRepository,
} from '@borjie/domain-services/ore';
// Mining hard-fork wave 6 — property-domain MaintenanceTaxonomyService
// has been retired. The mining-domain replacement
// (DrizzleEquipmentMaintenanceTaxonomyRepository) is imported above; the
// legacy `maintenanceTaxonomy` slot below stays null in the live
// registry until downstream consumers are migrated.
import {
  createIotService,
  type IotService,
} from '@borjie/domain-services/iot';
// Mining-domain Wave 5 — `createPropertyGradingAdapters` previously
// bound to property-domain tables removed by migration 0003. The mining
// ore-grading repo lives under `@borjie/domain-services/ore`.
// Wave 29 — forecasting package (TGN + conformal). The concrete
// inference / repository adapters live in external services; the slot
// below stays null until their env vars are set, and the router
// returns 503 FORECAST_SERVICE_UNAVAILABLE in that case.
import type {
  Forecaster,
  FeatureExtractor,
  ForecastRepository,
} from '@borjie/forecasting';
import { AssetGrading } from '@borjie/ai-copilot';
type AssetGradingService = import('@borjie/ai-copilot').AssetGrading.AssetGradingService;
// The credit-rating feature was removed in the borjie hard-fork (its router is
// gone + its DB tables were dropped). The registry keeps a `creditRating` slot
// (its null-guarded consumers in background-wiring / service-context stay
// valid) but it is permanently `null` — the Postgres repo queried deleted
// credit_rating_* tables, so the factory + repo imports are removed.
import { type CreditRatingService } from '@borjie/ai-copilot';
// Wave-K W-Data — DSAR (Art.20/PDPA s.27) Drizzle-backed data source +
// classification lookup. Bound here so the dsar router can pull a real
// per-tenant data source out of the service registry.
import {
  createDsarDataSourceDrizzle,
  createDatabaseClassificationLookup,
  createDsarRtbfExecutor,
  type DsarDataSource,
  type DsarClassificationLookup,
  type DsarRtbfExecutor,
} from '@borjie/ai-copilot';
// Wave-K W-Data — unified privacy-budget composer (G2 closure) and the
// per-column classification registry. Both reachable via the main
// `@borjie/database` barrel. The graph-privacy dp-aggregator
// delegates budget reads/writes through the composer when wired; the
// legacy in-process PlatformBudgetLedger is the back-compat fallback.
//
// `PrivacyBudgetComposerService` is re-exported through the database
// barrel which produces TS2709 (namespace-as-type widening); derive the
// type from the factory return value instead — same pattern as the
// `DatabaseClient` alias above.
import {
  classify as classifyDbColumn,
  createApprovalPolicyService,
  createKernelGoalsService,
  createPrivacyBudgetComposerService,
  createSensorRoutingService,
  createPersonaRegistryService,
} from '@borjie/database';
import { createPersonaRegistry } from '@borjie/central-intelligence';
type PrivacyBudgetComposerService = ReturnType<typeof createPrivacyBudgetComposerService>;
import {
  createArrearsService,
  type ArrearsService,
} from '@borjie/payments-ledger-service/arrears';
import {
  PostgresArrearsRepository,
  PostgresLedgerPort,
  createPostgresArrearsEntryLoader,
  type ArrearsEntryLoader,
} from './arrears-infrastructure.js';
// Wave WS-4 — platform billing (SaaS revenue). The service drives the
// platform fee through the provider PORT (IPaymentProvider) + LedgerService.
import {
  PlatformBillingService,
  makeTenantCurrencyResolver,
} from './billing/platform-billing-service.js';
import { buildLedgerService } from './ledger/index.js';
import { StripePaymentProvider } from '@borjie/payments-ledger-service';

// Wave 9 enterprise polish — Feature flags, GDPR, AI cost ledger.
import {
  createFeatureFlagsService,
  DrizzleFeatureFlagsRepository,
  type FeatureFlagsService,
} from '@borjie/domain-services/feature-flags';
import {
  createGdprService,
  DrizzleGdprRepository,
  type GdprService,
} from '@borjie/domain-services/compliance';
import {
  createCostLedger,
  type CostLedger,
} from '@borjie/ai-copilot';
// Wave-26 Agent Z4 — previously-unwired AI brain utilities now wired through
// the composition root so routers + background workers can consume them.
import {
  buildMultiLLMRouterFromEnv,
  withBudgetGuard,
  createAnthropicClient,
  ModelTier,
  type MultiLLMRouter,
  type BudgetGuardedAnthropicClient,
} from '@borjie/ai-copilot/providers';
import { DrizzleCostLedgerRepository } from './cost-ledger-repository.js';

// Wave 12 — AI copilot subsystems wired into composition root.
import {
  AgentCertificationService,
  PostgresCertStore,
  type SqlRunner as CertSqlRunner,
} from '@borjie/ai-copilot/agent-certification';
import {
  createVoiceRouter,
  ElevenLabsProvider,
  OpenAIVoiceProvider,
  type VoiceRouter,
} from '@borjie/ai-copilot/voice';
import type { BorjieMcpServer } from '@borjie/mcp-server';
import { buildMcpServer } from './mcp-wiring.js';
import {
  createMonthlyCloseWiring,
  type MonthlyCloseWiring,
} from './monthly-close-wiring.js';
import {
  createVoiceAgentWiring,
  type VoiceAgentWiring,
} from './voice-agent-wiring.js';
// FINAL NEEDS-DESIGN wave — env-gated speech-to-text. Builds a real OpenAI
// Whisper adapter when STT_API_KEY / OPENAI_API_KEY is set, else a null port
// so the voice agent degrades gracefully (VOICE_NOT_CONFIGURED) — never a
// fabricated transcript.
import { createSttProvider } from './voice/stt-provider-factory.js';
// AINATIVE — `/ai-native` (4 PhL capabilities: dynamicPricing,
// docIntelligence, legalDrafter, voiceAgent). The wiring factory builds
// the `services.aiNative` object the router reads. REAL Anthropic compute
// + compliance-plugins miningLaw; in-memory persistence for the 3
// archived-table capabilities, durable Drizzle for the voice agent.
import { buildAiNativeServices } from './ai-native-wiring.js';
// TASK-AGENTS — `/task-agents`. The executor runs any of the 15 shipped
// task-agents under autonomy-policy + budget guardrails. The registry is
// the canonical frozen agent map; the services bag is the live `services`
// object (agents read keys defensively, executor handles missing keys as a
// clean error outcome).
import {
  TaskAgentExecutor,
  TASK_AGENT_REGISTRY,
} from '@borjie/ai-copilot/task-agents';
import {
  createBrainKernelWiring,
  type BrainKernelWiring as BrainKernelWiringSlot,
} from './brain-kernel-wiring.js';
// ProdFix-1 wires 4 + 5 — NIDA + e-Ardhi adapters + lazy Temporal
// dispatchers + HQ tool registry composition. Encapsulated so the
// service-registry stays thin.
import {
  createHqToolPortBindings,
  type HqToolPortBindings,
} from './hq-tool-port-bindings.js';
import { createConsolidationWorkerAdapter } from './hq-tool-registry.js';
import {
  runConsolidationForActiveTenants,
  discoverEpisodicScopesForTenant,
  type AnthropicLikeClient as ConsolidationAnthropicLike,
} from './consolidation-runner.js';
// REMOVED (borjie hard-fork): market-surveillance-wiring queried deleted
// property tables (leases, properties, units) and was never read by any route.
import {
  createPredictiveInterventionsWiring,
  type PredictiveInterventionsWiring,
} from './predictive-interventions-wiring.js';
import {
  createWakeLoopCronSupervisor,
  type WakeLoopCronSupervisor,
} from './wake-loop-cron.js';
import {
  createSovereignLedgerVerifyCronSupervisor,
  type SovereignLedgerVerifyCronSupervisor,
} from './sovereign-ledger-verify-cron.js';
import {
  createAuditVerifyCronSupervisor,
  type AuditVerifyCronSupervisor,
} from './audit-verify-cron.js';
import { createDrizzleAiAuditChainRepo } from './ai-audit-chain-repo.js';
import {
  createSecuritySuite,
  type SecuritySuite,
} from '@borjie/ai-copilot';
import {
  createParityCapabilityDashboard,
  type ParityCapabilityDashboardService,
} from './parity-capability-dashboard.factory.js';
import { createParityJudgeRunner } from './parity-judge-runner-wiring.js';
// Central Command Phase A C6 / Phase B B2 — cross-portal Redis pubsub bus.
// Async factory: returns `Promise<CrossPortalBus>` because the Redis-backed
// implementation lazy-imports `ioredis`. The registry holds the promise so
// downstream consumers (SSE fan-out, HQ-tool broadcast hooks) `await` once.
import {
  createCrossPortalBus,
  type CrossPortalBus,
} from './cross-portal-bus.js';
// Central Command Phase C C2 — closes B1's `publishCrossPortalEvent` +
// `dispatcher` + `recipientResolver` wiring follow-ups.
import {
  createKillswitchFanoutPublisher,
  type KillswitchFanoutPublisher,
} from './cross-portal-killswitch-fanout.js';
import {
  createNotificationDispatcherAdapter,
  createRecipientResolverAdapter,
  type NotificationDispatcherLike,
  type RecipientResolverLike,
} from './notification-dispatcher-adapter.js';
// Central Command Phase B B2 — idle-session emitter (Reflexion writer
// daemon). Scans `sensorium_event_log` every minute and writes a
// reflexion-buffer entry for every (tenant, user, session) tuple that
// has gone idle ≥ 5 min. Constructed in live mode only (no DB → no
// activity source → nothing to scan); inert until `.start()` from
// `index.ts`.
import {
  createIdleSessionEmitter,
  createSensoriumActiveSessionSource,
  type IdleSessionEmitter,
} from './idle-session-emitter.js';
// Central Command Phase C C4 — session-replay retention purge worker.
// Periodic supervisor that deletes `session_replay_chunks` rows older
// than `retentionDays` (default 90) and (best-effort) the corresponding
// cold-store blobs. Constructed in live mode only; inert until
// `.start()` from `index.ts`.
import {
  createSessionReplayRetention,
  createDrizzlePurgeDb,
  type SessionReplayRetention,
} from './session-replay-retention.js';
// Reflexion-buffer service satisfies the emitter's `ReflexionWriterPort`
// shape. Drizzle-backed; lives behind a `null`-tolerant runtime check
// inside the supervisor when the DB is unavailable.
import { createReflexionBufferService } from '@borjie/database';

// P38 + P54 wiring (re-added after P66 main-merge clobbered them).
// `persistent-stores-wiring.ts` glues the 5 persistent-store ports
// (LessonStore / WormAuditStore / SkillRegistryWriter / AOPRegistryStore /
// A2A TaskStore) to their Drizzle-backed adapters; `document-storage-wiring.ts`
// returns the `StorageProvider` consumed by DocumentService / EvidencePackBuilder.
// Both are read by `service-context.middleware.ts` (flat per-request keys)
// and by `index.ts:579` (boot-time `modeByStore` log).
import {
  createPersistentStores,
  type PersistentStores,
} from './persistent-stores-wiring.js';
import {
  createDocumentStorageWiring,
  type DocumentStorageWiring,
} from './document-storage-wiring.js';
import {
  createTrainingAdminEndpoints,
  createTrainingGenerator,
  createTrainingAssignmentService,
  createTrainingDeliveryService,
  createInMemoryTrainingRepository,
  type TrainingAdminEndpoints,
  type MasteryPort,
} from '@borjie/ai-copilot/training';
import { OrgAwareness } from '@borjie/ai-copilot';
// Wave 18 final annihilation — autonomy policy service wired into the
// composition root so `GET/PUT /api/v1/autonomy/policy` stops returning
// 503 NOT_IMPLEMENTED.
import {
  AutonomyPolicyService,
  InMemoryAutonomyPolicyRepository,
  buildDefaultPolicy,
} from '@borjie/ai-copilot/autonomy';
import { PostgresAutonomyPolicyRepository } from './autonomy-policy-repository.js';
// Wave 27 Agent E — Tenant Branding (per-tenant AI persona identity).
import {
  TenantBrandingService,
  InMemoryTenantBrandingRepository,
} from '@borjie/ai-copilot';
// Wave 28 — Head Briefing composer + source-port types. Assembles the
// cohesive morning screen from overnight autonomy, pending approvals,
// escalations, KPI deltas, recommendations, and anomalies. Ports are
// wired to in-memory stubs in degraded mode so the /head/briefing
// endpoint always returns a shaped document.
import { HeadBriefing } from '@borjie/ai-copilot';
import {
  ExceptionInbox,
  InMemoryExceptionRepository,
} from '@borjie/ai-copilot/autonomy';
// Wave 28 — Junior-AI factory (team-lead self-service provisioning).
// Repo is in-memory in both degraded and live modes until the Postgres
// adapter lands; provisioning state is non-critical and recoverable.
import {
  JuniorAIFactoryService,
  InMemoryJuniorAIRepository,
} from '@borjie/ai-copilot/junior-ai-factory';
// Central Intelligence — embodied first-person agent (per-tenant +
// platform scopes). The concrete LLM adapter lives in a separate
// service; the agent slot stays null until `CI_LLM_URL` is set so the
// router returns 503 INTELLIGENCE_SERVICE_UNAVAILABLE. Memory is always
// wired to the in-memory default so threads work in-session; a
// pgvector-backed adapter will replace it for production.
// Follow-up wave-30 (#33): swap in pgvector-backed ConversationMemory for prod.
import {
  createInMemoryConversationMemory,
  createInMemoryAuditSinkAndReader,
  createConversationAuditRecorder,
  type CentralIntelligenceAgent,
  type ConversationMemory,
  type ConversationAuditReader,
  type ConversationAuditRecorder,
  type PersonaRegistry,
} from '@borjie/central-intelligence';
// Multimodal Brain wiring for the workforce-mobile Photo Advisor
// (`/api/v1/mining/brain/vision-turn`). The router ships a `setBrainResolver`
// injection seam; until the composition root calls it, the route honest-503s
// (`BRAIN_NOT_CONFIGURED`). We wire a per-tenant `BrainRegistry` here — the SAME
// construction `routes/brain.hono.ts` uses — so the route resolves a real
// multimodal Brain. Honest-degrade: when Anthropic/Supabase creds are absent
// (`tryLoadBrainEnv` → null) we leave the resolver unset and the route keeps
// its clean 503 — never a crash-on-boot.
import {
  createBrain,
  BrainRegistry,
  PostgresThreadStoreBackend,
  tryLoadBrainEnv,
} from '@borjie/ai-copilot';
import { BrainThreadRepository } from '@borjie/database';
import { getBrainExtraSkills } from './brain-extensions.js';
import { setBrainResolver } from '../routes/mining/brain-vision.hono.js';
// Tier-2 Capability-Composition Engine wiring. The owner chat-actions route
// ships a `setCompositionEngine` injection seam; until the composition root
// calls it the engine slot stays null and the unknown-verb path defers to a
// plain brain turn UNCHANGED. We build the engine here — reusing the SAME
// circuit-breaker + OTel-wrapped Anthropic client construction the kernel
// debate uses — ONLY when a real Anthropic key is present (CI-inert).
import { setCompositionEngine } from '../routes/owner/chat-actions.hono.js';
import { buildCapabilityCompositionEngine } from './power-tools-wiring.js';
import { wrapAnthropicWithCircuitBreaker } from './anthropic-circuit-breaker.js';
import { wrapAnthropicWithOtelSpans } from './anthropic-otel-spans.js';
import type { AnthropicMessagesClient } from '@borjie/central-intelligence';
// PO-port wave-5 wiring #1 — six-layer cognitive memory (episodic, narrative,
// procedural, reflective, topic-files, cohort cache). Lives ALONGSIDE the
// existing single-layer `ConversationMemory` (which the streaming kernel
// still consumes). MemoryV2 surfaces the richer cognitive substrate that
// future sleep-pass orchestrators + reflection jobs will read/write.
// MEM-01 — the in-memory variant ships in degraded mode; LIVE mode now selects
// the Drizzle-backed stores (`createDrizzleMemoryV2`, migration 0312) when a DB
// handle is present so the substrate SURVIVES a process restart.
import {
  createInMemoryMemoryV2,
  createDrizzleMemoryV2,
  type MemoryV2,
} from '@borjie/memory-v2';
// PO-port wave-5 wiring #2 — per-tenant LLM budget cap + auto-downgrade
// ladder. Every llmRouter / Anthropic-client call routes through
// `governor.evaluateCall` first. Default caps: $50/day, 5M tokens/day;
// downgrade ladder kicks in at 85% of cap (opus → sonnet → haiku).
// Overridable per-tenant via the budget store; ops can also override
// via env (LLM_BUDGET_DAILY_CENTS etc.) once the seed helper lands.
import {
  createLLMBudgetGovernor,
  createInMemoryBudgetStore,
  type LLMBudgetGovernor,
} from '@borjie/llm-budget-governor';
// P76 BUG-HI-3 closure — Postgres-backed `BudgetStore` swap. Live mode
// now persists per-tenant spend to `tenant_llm_budgets` so caps survive
// restarts. Degraded mode keeps the in-memory adapter (logs a single
// warn so operators know spend won't persist).
import { wireBudgetStore } from './llm-budget-postgres-wiring.js';
// PO-port wave-5 wiring #3 — OCSF 1.5 emitter. Secondary audit sink that
// maps every internal audit event to OCSF + pushes to syslog / file /
// HTTP for SIEM ingestion (Sentinel / Splunk / Datadog). Coexists with
// the primary AuditTrailRecorder which writes to Postgres + the
// hash-chained sovereign ledger; the OCSF emitter is fire-and-forget
// and never blocks the primary audit path.
import type {
  InternalAuditEvent as OcsfInternalAuditEvent,
  OCSFSink,
} from '@borjie/ocsf-emitter';
import { createOcsfBundle } from './ocsf-emitter-wiring.js';
// PO-port wave-5 wiring #4 — cross-tenant denial recorder. Audit-side
// sink fired from `ensureTenantIsolation` (TENANT_MISMATCH branch) and
// any other authz-policy denial surface. Fire-and-forget; never blocks
// the response path. Defaults to an in-memory ring buffer (10k rows);
// swap to a Drizzle adapter in a follow-up.
import {
  createCrossOrgDenialRecorderBundle,
  type CrossOrgDenialRecorderBundle,
} from './cross-org-denial-recorder-wiring.js';
// Borjie ported-utilities wiring (Batch 1 — utility namespaces, structure inherited from pre-fork lineage; evolved independently).
// Bundles memory-tool-wire-adapter + probe-runners +
// conformal-calibration-online so consumers
// can pull canonical pure-function surfaces via DI rather than reaching
// for the raw packages from arbitrary callsites.
import {
  createPortedUtilitiesBundle,
  type PortedUtilitiesBundle,
} from './ported-utilities-wiring.js';
// Borjie ported-domain wiring (Batch 2 — 5 domain bundles, structure inherited).
// Bundles mcp-cost-persistence + fairness-eval + analytics +
// knowledge-graph + compliance-pack. Analytics + KG ship pre-wired
// in-memory instances; the others are DI-exposed namespaces (their
// instantiation needs per-tenant brain / collectors which the
// composition root cannot bind statically).
import {
  createPortedDomainBundle,
  type PortedDomainBundle,
} from './ported-domain-wiring.js';
// Borjie ported-platform wiring (Batch 3 — 5 platform bundles, structure inherited).
// Bundles security-hardening + document-ai + progressive-intelligence +
// document-quality-guarantor + audio-capture. Each ships a pre-wired
// facade with safe defaults (in-memory stores / mock ports) plus the
// raw namespace export so consumers can swap in concrete adapters.
import {
  createPortedPlatformBundle,
  type PortedPlatformBundle,
} from './ported-platform-wiring.js';
// Borjie ported-agent-stack wiring (Batch 4 — 6 agent-stack bundles, structure inherited).
// Bundles agent-runtime + mcp + agent-orchestrator + open-coding-agent-
// patterns + openclaw-operating-model + agentic-os. Brain-dependent
// members are namespace-only (no safe defaults without an LLM key);
// the OpenClaw operating-model facade is pre-wired async via a
// Promise slot (same pattern as cross-portal bus).
import {
  createPortedAgentStackBundle,
  type PortedAgentStackBundle,
} from './ported-agent-stack-wiring.js';
// P75 follow-up — per-tenant brain-dependent agent-stack assembly. The
// The ported-agent-stack bundle exposes namespaces only because the brain port must be
// tenant-scoped (every Anthropic call debits the correct tenant's
// budget cap). This factory + LRU+TTL cache resolves a fully-wired
// AgentStack (brain + orchestrator + open-coding + agent-runtime
// factory) per tenant on demand.
import {
  createAgentStackBundle,
  type AgentStack,
  type AgentStackBundle,
  type BudgetGuardedAnthropicFactory as AgentStackBudgetGuardedAnthropicFactory,
} from './agent-stack-brain-wiring.js';
// Canonical Property Graph (CPG) — Neo4j query service. Constructed
// lazily so the gateway still boots when NEO4J_URI is unset; the graph
// router returns 503 GRAPH_SERVICE_UNAVAILABLE when this slot is null.
import {
  createNeo4jClient,
  createGraphQueryService,
  type GraphQueryService,
} from '@borjie/graph-sync';

// Wave 26 — Agent Z2: four Postgres repos that Wave-25 Agent T flagged as
// "tests passing but no router / composition wiring". Importing through
// the namespace barrels added to cases/inspections so the classes reach
// the composition root without churning every callsite.
import {
  Sublease as SubleaseNs,
  DamageDeduction as DamageDeductionNs,
} from '@borjie/domain-services/cases';
import {
  ConditionalSurvey as ConditionalSurveyNs,
  Far as FarNs,
} from '@borjie/domain-services/inspections';
// Mining-domain Wave 5 — property-domain PostgresFarRepository
// (asset_components / far_assignments) is replaced by the site-level
// Field Asset Register persisting to `assets` + `maintenance_events`.
import { PostgresSiteFarRepository } from '@borjie/domain-services/site';
type PostgresSubleaseRepository = InstanceType<
  typeof SubleaseNs.PostgresSubleaseRepository
>;
type PostgresTenantGroupRepository = InstanceType<
  typeof SubleaseNs.PostgresTenantGroupRepository
>;
type SubleaseService = InstanceType<typeof SubleaseNs.SubleaseService>;
type PostgresDamageDeductionRepository = InstanceType<
  typeof DamageDeductionNs.PostgresDamageDeductionRepository
>;
type DamageDeductionService = InstanceType<
  typeof DamageDeductionNs.DamageDeductionService
>;
// Mining hard-fork wave 6 — property-domain
// `PostgresConditionalSurveyRepository` has been retired (it persisted to
// `conditional_surveys` + sibling tables dropped by migration 0003). The
// mining-domain replacement
// (`PostgresSitePreShiftInspectionRepository`) is bound via the new
// `sitePreShiftInspection` slot below. We keep `PostgresConditionalSurveyRepository`
// as `never` so the legacy `conditionalSurveys.repo` slot still types
// cleanly as `null`. The in-memory `ConditionalSurveyService` keeps its
// type alias from the namespace barrel.
type PostgresConditionalSurveyRepository = never;
type ConditionalSurveyService = InstanceType<
  typeof ConditionalSurveyNs.ConditionalSurveyService
>;
// Mining-domain Wave 5 — `FarNs.PostgresFarRepository` (property-tenant
// asset components) has been retired. We retain the type alias as
// `never` so the `far` registry slot keeps its `null` shape until
// follow-up batches reshape its consumers around the mining
// `PostgresSiteFarRepository`.
type PostgresFarRepository = never;
// Mining FAR — the `far.service` slot now carries the REAL mining
// `MiningFarService` (over `PostgresSiteFarRepository`). The legacy
// property `FarNs.FarService` is no longer referenced by the slot.
type FarService = InstanceType<typeof FarNs.MiningFarService>;

type OrgAwarenessRegistry = {
  readonly miner: InstanceType<typeof OrgAwareness.ProcessMiner>;
  readonly bottleneckDetector: InstanceType<
    typeof OrgAwareness.BottleneckDetector
  >;
  readonly improvementTracker: InstanceType<
    typeof OrgAwareness.ImprovementTracker
  >;
  readonly queryService: InstanceType<typeof OrgAwareness.OrgQueryService>;
  readonly observationStore: InstanceType<
    typeof OrgAwareness.InMemoryProcessObservationStore
  >;
  readonly bottleneckStore: InstanceType<
    typeof OrgAwareness.InMemoryBottleneckStore
  >;
  readonly snapshotStore: InstanceType<
    typeof OrgAwareness.InMemoryImprovementSnapshotStore
  >;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceRegistry {
  /** Pure-DB services — instantiated iff DATABASE_URL is set. */
  readonly marketplace: {
    readonly listing: ListingService | null;
    readonly enquiry: EnquiryService | null;
    readonly tender: TenderService | null;
  };
  readonly negotiation: NegotiationService | null;
  readonly waitlist: {
    readonly service: WaitlistService | null;
    readonly vacancyHandler: WaitlistVacancyHandler | null;
  };
  readonly occupancyTimeline: OccupancyTimelineService | null;
  readonly stationMasterRouter: StationMasterRouter | null;
  // Mining hard-fork wave 6 — property-domain coverage repo retired.
  // The mining-domain replacement is surfaced via `siteSupervisorCoverage`
  // below. Slot kept as `null` for back-compat with consumers that still
  // null-check it.
  readonly stationMasterCoverageRepo: null;
  readonly renewal: RenewalService | null;
  // Mining-domain — the `/financial-profile` route now binds to the REAL
  // mining buyer financial-profile service. `riskReport` stays a legacy
  // slot (route unmounted; the repo is surfaced via `buyerRiskReport`).
  readonly financialProfile:
    | FinancialProfileService
    | MiningFinancialProfileService
    | null;
  readonly riskReport: RiskReportService | null;
  readonly gamification: ReturnType<typeof createGamificationService> | null;
  readonly migration: MigrationService | null;

  /**
   * R20 / KI-013 — Migration Wizard Copilot binding.
   *
   * Production wiring requires a configured prompt registry + AI
   * provider registry + review service (all already constructed when
   * `ANTHROPIC_API_KEY` is present). When the LLM is unavailable, the
   * slot stays `null` and `POST /api/v1/brain/migration/:runId/ask`
   * surfaces a typed 501 rather than a silent fabricated ack.
   */
  readonly migrationWizardCopilot:
    | {
        run(args: {
          readonly tenantId: string;
          readonly actorId: string;
          readonly runId: string;
          readonly message: string;
        }): Promise<unknown>;
      }
    | null;

  /** Wave 8 additions — pure-DB.
   *
   * `maintenanceTaxonomy` was a property-domain slot retired during
   * the mining hard-fork; the mining-domain replacement is the
   * `equipmentMaintenanceTaxonomy` slot below. The slot stays as `null`
   * for back-compat with consumers that still null-check it. */
  readonly warehouse: MiningWarehouseService | null;
  readonly maintenanceTaxonomy: MiningMaintenanceTaxonomyService | null;
  readonly iot: IotService | null;

  /** Wave 9 enterprise polish — feature flags, GDPR, AI cost ledger. */
  readonly featureFlags: FeatureFlagsService | null;
  readonly gdpr: GdprService | null;
  readonly aiCostLedger: CostLedger | null;

  /** Mining ADVISOR wave — stage-aware capability advisor (migration 0295).
   *  Null in degraded mode (no DB to read metrics/state from); the
   *  `/api/v1/stage` router returns 503 SERVICE_UNAVAILABLE when this slot
   *  is unwired. Backed by the Drizzle `StageAdvisorDb` adapter in the live
   *  registry below. */
  readonly stageAdvisor: StageAdvisor | null;

  /** Wave-K W-Data — DSAR (Art.20/PDPA s.27) port wiring. The data
   *  source is null in degraded mode; the dsar router falls back to
   *  the compiler's empty-data-source so the bundle still shapes
   *  cleanly. The classification lookup is always wired (in-process
   *  registry, no DB needed). */
  readonly dsarDataSource: DsarDataSource | null;
  readonly dsarClassifications: DsarClassificationLookup;
  /** Wave-K Final Zero — DSAR RTBF executor (GDPR Art.17 / PDPA s.31).
   *  Null in degraded mode; the dsar router returns 503
   *  RTBF_EXECUTOR_UNAVAILABLE when the slot is unwired. */
  readonly dsarRtbfExecutor: DsarRtbfExecutor | null;

  /** Wave-K W-Data — unified privacy-budget composer (G2 closure).
   *  Always wired (in-memory adapter in degraded mode, Drizzle adapter
   *  when ready). The graph-privacy dp-aggregator delegates budget
   *  reads/writes through this composer; the legacy in-process
   *  PlatformBudgetLedger is the back-compat fallback. */
  readonly privacyBudgetComposer: PrivacyBudgetComposerService;

  /**
   * Wave 26 Agent Z4 — multi-LLM router built from env keys. Null when no
   * Anthropic key is configured (the gateway still boots, the brain routes
   * return 503 `BRAIN_NOT_CONFIGURED` as before). When present, the router
   * already enforces per-tenant budget via `CostLedger.assertWithinBudget`
   * up-front and records usage after every provider call.
   */
  readonly llmRouter: MultiLLMRouter | null;

  /**
   * Wave 26 Agent Z4 — Anthropic client wrapped with `withBudgetGuard` so
   * every `messages.create` call checks the per-tenant monthly cap and
   * records usage into the `CostLedger`. Exposed as a pure factory because
   * the tenant context is only known at request time — callers invoke
   * `buildBudgetGuardedAnthropicClient(tenantId, operation?)` to get a
   * client with the right context closed over.
   */
  readonly buildBudgetGuardedAnthropicClient:
    | ((tenantId: string, operation?: string) => BudgetGuardedAnthropicClient)
    | null;

  /**
   * PO-port wave-5 wiring #2 — per-tenant LLM budget governor with
   * auto-downgrade ladder (opus → sonnet → haiku). Sits in front of
   * `llmRouter` / Anthropic clients: every call routes through
   * `governor.evaluateCall({ tenantId, model, estimatedTokens })` first;
   * the governor either proceeds, downgrades to a cheaper tier, or
   * blocks when the tenant has burned through their cap. Always wired
   * (in-memory budget store in both degraded + live until a Postgres
   * adapter lands). Default caps: $50/day, $1000/month per tenant —
   * seedable via `governor.recordSpend` or the `seedBudget` admin
   * helper, overridable per-tenant via the budget store.
   */
  readonly llmBudgetGovernor: LLMBudgetGovernor;

  /** Arrears ledger (NEW 4). Service + loader for the projection endpoint. */
  readonly arrears: {
    readonly service: ArrearsService | null;
    readonly repo: PostgresArrearsRepository | null;
    readonly ledgerPort: PostgresLedgerPort | null;
    readonly entryLoader: ArrearsEntryLoader | null;
  };

  // REMOVED (borjie hard-fork): the `cases` registry slot — residential-property
  // residue; the `cases` table was dropped in 0003_mining_domain.sql.

  /** Wave 12 — AI copilot subsystems wired into the composition root. */
  readonly mcp: BorjieMcpServer | null;
  readonly agentCertification: AgentCertificationService | null;
  readonly training: TrainingAdminEndpoints | null;
  readonly voice: VoiceRouter | null;

  /** Organizational Awareness — process mining, bottleneck detection,
   *  improvement tracking, "talk to your organization" query service.
   *  In-memory-backed for pilot; swap to Postgres adapters when ready. */
  readonly orgAwareness: OrgAwarenessRegistry;

  /** Autonomy policy — per-tenant Autonomous Department Mode config.
   *  Postgres-backed in live mode, in-memory when DATABASE_URL is unset
   *  (so the endpoint stays 200 OK in local dev). */
  readonly autonomy: {
    readonly policyService: AutonomyPolicyService;
  };

  /** Tenant branding (Wave 27 Agent E) — per-tenant AI persona identity.
   *  Replaces hardcoded 'Mr. Mwikila' literals with configurable overrides
   *  (display name, honorific, greeting, pronoun). In-memory repository in
   *  both live + degraded modes until a Postgres migration lands. */
  readonly branding: {
    readonly service: TenantBrandingService;
  };

  /** Head briefing (Wave 28) — cohesive morning screen composer. Pulls
   *  from overnight-autonomy / pending-approvals / escalations / KPI /
   *  recommendations / anomalies sources and returns a single
   *  BriefingDocument. In-memory stubs in both live + degraded modes
   *  until real data-warehouse + ambient-brain adapters land. */
  readonly headBriefing: {
    readonly composer: HeadBriefing.BriefingComposer;
  };

  /** Junior-AI factory (Wave 28) — self-service provisioning for team
   *  leads. Each junior inherits a strict subset of the tenant
   *  AutonomyPolicy and is lifecycle-bounded. In-memory repo in both
   *  modes (provisioning state is non-critical; Postgres adapter is
   *  a follow-up). */
  readonly juniorAI: {
    readonly factoryService: JuniorAIFactoryService;
  };

  /** Canonical Property Graph (CPG) — Neo4j-backed relationship graph.
   *  Null in both degraded + live modes when NEO4J_URI is unset so the
   *  gateway boots without a Neo4j upstream; the `graph.router` degrades
   *  to 503 GRAPH_SERVICE_UNAVAILABLE in that case. When env vars are
   *  present we construct a pooled `Neo4jClient` and wrap it in a
   *  `GraphQueryService` that every route (named queries, 1-ring
   *  neighbourhood, k-hop expansion, graph health) shares. */
  readonly graph: {
    readonly queryService: GraphQueryService | null;
  };

  /** Asset grading — A–F report card scoring + portfolio rollup.
   *  Postgres-backed in live mode, null when DATABASE_URL is unset. */
  readonly assetGrading: AssetGradingService | null;

  /**
   * PO-port wave-5 wiring #1 — six-layer cognitive memory v2 (episodic,
   * narrative, procedural, reflective, topic files, cohort cache).
   * Always non-null — the in-memory variant ships in both degraded and
   * live mode until pgvector / Drizzle-backed adapters land. Consumers
   * (sleep-pass orchestrator, reflection workers, brain-kernel) read
   * from the appropriate sub-store via `registry.memoryV2.stores.*`.
   *
   * NOTE: this layer is ADDITIVE to `centralIntelligence.memory`
   * (single-layer thread memory used by the streaming agent loop). The
   * two surfaces will fold together when pgvector wiring lands.
   */
  readonly memoryV2: MemoryV2;

  /** Central Intelligence — embodied first-person agent surface.
   *  The concrete LLM adapter lives in a separate service; `agent` only
   *  becomes non-null when `CI_LLM_URL` is present AND the adapter has
   *  been wired (follow-up PR). `memory` is always wired to the
   *  in-memory default so threads survive in-session — a pgvector-
   *  backed adapter will replace it for production persistence.
   *  Follow-up wave-30 (#33): swap `memory` to pgvector-backed adapter.
   */
  readonly centralIntelligence: {
    readonly agent: CentralIntelligenceAgent | null;
    readonly memory: ConversationMemory | null;
    /** Audit reader — read-side of the cryptographic conversation
     *  chain. Always wired (in-memory pair in degraded mode, Postgres-
     *  backed in live mode); every agent event records to the sink
     *  and surfaces via the reader for the audit-panel UI. */
    readonly auditReader: ConversationAuditReader | null;
    /** Recorder injected into the agent loop. */
    readonly auditRecorder: ConversationAuditRecorder | null;
    /**
     * Wave-K T1 — brain-kernel wiring. Null when no Anthropic key is
     * configured (the voice agent falls back to the degraded stub).
     * When present, exposes the `BrainKernel` itself plus the env-
     * backed killswitch port, the decision-trace recorder, the seeded
     * tool registry, and the resolved uncertainty-policy mode so
     * downstream routers / admin endpoints can read them without
     * re-instantiating.
     *
     * Decision-trace recorder is exposed here (not via a dedicated
     * admin route in this wave) so future ops UIs can pull recent
     * traces with `recorder.getRecentTraces(tenantId, limit)`. The
     * admin route lands in a follow-up owned by W-Ops.
     */
    readonly brainKernel: BrainKernelWiringSlot | null;
  };

  /**
   * PO-port wave-5 wiring #3 — OCSF 1.5 secondary audit sink.
   *
   * Pluggable sink: in-memory (default in degraded / dev), JSON-lines
   * file (default in live; env `OCSF_LOG_PATH`), syslog or HTTP
   * (follow-up adapters). Maps every internal audit event onto the
   * OCSF envelope with PII redaction.
   *
   * The OCSF sink is a SECONDARY pipeline — never blocks or replaces
   * the primary `AuditTrailRecorder` (hash-chained Postgres). It runs
   * fire-and-forget; sink errors are swallowed via the `emitted` flag
   * on the EmitResult so a transient SIEM outage cannot break a
   * response path. Consumers wire-in by calling
   * `ocsf.emit(internalEvent)` after their primary audit record lands.
   */
  readonly ocsf: {
    readonly sink: OCSFSink;
    readonly emit: (
      event: OcsfInternalAuditEvent,
    ) => Promise<{ readonly emitted: boolean }>;
  };

  /**
   * PO-port wave-5 wiring #4 — cross-tenant denial recorder.
   *
   * Audit-side sink fired from `ensureTenantIsolation` middleware's
   * TENANT_MISMATCH branch (and any future authz-policy denial site).
   * Records each denial via the bundle's per-process recorder state
   * (1s per-actor rate-limit + LRU-trim at 5000 buckets so a malicious
   * actor cannot OOM the gateway). Default sink: in-memory ring
   * buffer (10k rows). Always wired in both degraded + live modes.
   *
   * Brute-force scanner (`findBruteForcePatterns` from the package) is
   * reachable by feeding `bundle.recentRows()` into it from an ops
   * endpoint; the recorder itself only writes.
   */
  readonly crossOrgDenialRecorder: CrossOrgDenialRecorderBundle;

  /**
   * Ported-utilities batch 1 — utility namespaces exposed via DI (structure inherited from pre-fork lineage).
   *
   * Always non-null in both degraded + live modes (every member is a
   * pure-function surface). Consumers reach for `portedUtilities.<pkg>.<fn>`
   * to avoid scattering raw package imports across the codebase. The
   * downstream consumers per package:
   *   - `memoryToolWireAdapter` — Anthropic Memory Tool envelope for
   *     the BrainKernel ↔ topic-files memory boundary
   *   - `probeRunners` — sycophancy + defection probe schedulers (eval
   *     workers + CI gate)
   *   - `conformalCalibrationOnline` — adaptive α-update for the
   *     forecasting confidence interval calibrator
   */
  readonly portedUtilities: PortedUtilitiesBundle;

  /**
   * Ported-domain batch 2 — 5 domain bundles exposed via DI (structure inherited).
   *
   * Always non-null in both degraded + live modes. Members:
   *   - `mcpCostPersistence` — per-MCP cost tracking + health
   *     probe namespace (state machines instantiated per-server)
   *   - `fairnessEval` — counterfactual fairness namespace
   *     (`createFairnessEval` invoked per-tenant with the brain
   *     port resolvable at runtime)
   *   - `analytics` — analytics namespace; `analyticsInstance` is
   *     the pre-wired facade
   *   - `knowledgeGraph` — KG namespace; `knowledgeGraphInstance`
   *     is the in-memory facade (real-estate ontology, mock
   *     embedder). Production swap: Neo4j adapter + OpenAI embedder
   *   - `compliancePack` — 10 framework catalogs + DSAR + erasure
   *     cascade + envelope encryption + residency + breach
   *     notification namespace (per-tenant engine instantiated by
   *     the caller via `createComplianceEngine`)
   */
  readonly portedDomain: PortedDomainBundle;

  /**
   * Ported-platform batch 3 — 5 platform-domain bundles exposed via DI (structure inherited).
   *
   * Always non-null in both degraded + live modes. Each bundle member
   * ships a pre-wired facade with safe defaults so the gateway boots
   * without external creds. Members:
   *   - `securityHardening` namespace + `securityHardeningInstance`
   *     pre-wired with NODE_ENV-aware headers env, in-memory rate-
   *     limit store, in-memory step-up store, anomaly detector,
   *     credential-stuffing detector
   *   - `documentAI` namespace + `documentAIInstance` pre-wired with
   *     mock OCR + mock e-sig (production swap: pass Anthropic +
   *     DocuSign ports via `createDocumentAI({ brain, eSignature })`)
   *   - `progressiveIntelligence` namespace +
   *     `progressiveIntelligenceInstance` pre-wired with deterministic
   *     mock embedder (no brain — coaching / streaming endpoints
   *     return dormant results until a brain port is bound)
   *   - `documentQualityGuarantor` namespace + `dqgAuditStore`
   *     pre-wired in-memory audit chain. Per-tenant guarantor facades
   *     are instantiated at request time because intake/output
   *     orchestrators bind to per-tenant brain + format-registry ports
   *   - `audioCapture` namespace + `audioCaptureInstance` pre-wired
   *     with no ports — every adapter is null until provider creds
   *     land. Consumers gate on `audioCaptureInstance.stt !== null`
   */
  readonly portedPlatform: PortedPlatformBundle;

  /**
   * Ported-agent-stack batch 4 — 6 agent-stack bundles exposed via DI (structure inherited).
   *
   * Always non-null in both degraded + live modes. Most members are
   * namespace-only because they require a brain port (per-tenant,
   * per-request); the OpenClaw operating-model is the exception and
   * ships pre-wired via an async `openclawInstance: Promise<...>`
   * slot (in-memory stores + auto-seeded 10 shipped agent domains).
   * Members:
   *   - `agentRuntime` namespace (Claude Code parity — hooks +
   *     slash + sub-agents + skills + MCP host + memory + permissions).
   *     Async factory; instantiated per project / per worker.
   *   - `mcp` namespace (deep MCP protocol primitives — sister to the
   *     already-wired `@borjie/mcp-server` deployable surface).
   *   - `agentOrchestrator` namespace (single + multi + state machine +
   *     cost optimisation + durable + judge-jury). Brain-dependent.
   *   - `openCodingAgentPatterns` namespace (repo-map + minimal diff +
   *     sandbox + TDD + plan persistence + browser + trajectory).
   *     Brain-dependent.
   *   - `openclawOperatingModel` namespace + `openclawInstance`
   *     pre-wired Promise (in-memory + auto-seeded 10 domains).
   *   - `agenticOS` namespace (meta-synthesis layer). Requires 5+
   *     concrete ports; namespace-only until those converge.
   */
  readonly portedAgentStack: PortedAgentStackBundle;

  /**
   * P75 follow-up — per-tenant brain-dependent agent-stack factory.
   *
   * Resolves a fully-wired `AgentStack` per tenant from a bounded
   * LRU+TTL cache (100 tenants × 5 min). Each stack carries:
   *
   *   - `brain` — Anthropic-backed `BrainPort` (agent-orchestrator
   *     shape; budget-guarded so every call debits the tenant's cap).
   *   - `orchestrator` — `createOrchestrator({ brain })` pre-built.
   *   - `openCodingAgent` — opt-in via `enableOpenCodingAgent: true`
   *     (heavy: repo-map + sandbox + browser).
   *   - `agentRuntimeFactory` — async lazy factory with the tenant
   *     brain pre-bound; callers supply only `projectPath`.
   *   - `agenticOs: null` — until the agent-registry + constitution +
   *     kg ports converge under a single namespace (follow-up).
   *
   * Returns `brain: null` when no `ANTHROPIC_API_KEY` is set;
   * consumers fall back to their degraded paths.
   *
   * Access pattern: `registry.agentStack.getAgentStackForTenant(tenantId)`.
   * The `cache` slot is exposed for ops introspection (size / clear).
   */
  readonly agentStack: AgentStackBundle;

  /** Wave 29 — Forecasting (TGN + conformal prediction intervals).
   *  Every member is `null` until BOTH `TGN_INFERENCE_URL` and
   *  `FORECASTING_REPO_URL` are set. When null, the forecast router
   *  returns 503 `FORECAST_SERVICE_UNAVAILABLE`. No mock data is ever
   *  returned. The inference + repository adapters are PORTS — the
   *  concrete runtime (Python TGN sidecar + Postgres or Memgraph repo)
   *  is plugged in by the deploy, not this file. */
  readonly forecasting: {
    readonly forecaster: Forecaster | null;
    readonly featureExtractor: FeatureExtractor | null;
    readonly repository: ForecastRepository | null;
  };

  /** Tenant credit rating — FICO-scale 300-850 rating with CRB bands
   *  and portable certificate. Postgres-backed in live mode. */
  readonly creditRating: CreditRatingService | null;

  /** Move-out checklist (Wave 26 Z3). Tracks the 4-step end-of-tenancy
   *  workflow (final inspection, utility readings, deposit reconciliation,
   *  residency-proof letter). Postgres-backed when DATABASE_URL is set. */
  readonly moveOut: {
    readonly service: MoveOutChecklistService | null;
  };

  /** Approval workflow (Wave 26 Z3). Handles pending-approval requests for
   *  maintenance_cost, refund, discount, lease_exception, payment_flexibility.
   *  Integrates with the autonomy-policy thresholds (Wave 18). */
  readonly approvals: {
    readonly service: ApprovalWorkflowService | null;
  };

  /** Wave 26 — Sublease + tenant-group persistence. Postgres-backed when
   *  DATABASE_URL is set; null in degraded mode. The router degrades to
   *  503 cleanly when the slot is null. */
  readonly sublease: {
    readonly service: SubleaseService | null;
    readonly repo: PostgresSubleaseRepository | null;
    readonly tenantGroupRepo: PostgresTenantGroupRepository | null;
  };

  /** Wave 26 — Damage-deduction negotiation claims (move-out). */
  readonly damageDeductions: {
    readonly service: DamageDeductionService | null;
    readonly repo: PostgresDamageDeductionRepository | null;
  };

  /** Wave 26 — Conditional surveys (findings + action plans). */
  readonly conditionalSurveys: {
    readonly service: ConditionalSurveyService | null;
    readonly repo: PostgresConditionalSurveyRepository | null;
  };

  /** Mining Field Asset Register (FAR) — site fixed assets + scheduled
   *  inspection/maintenance cadence + the inspection event log. `service`
   *  is the REAL mining `MiningFarService`; `repo` is the mining
   *  `PostgresSiteFarRepository` (over `assets` + `maintenance_events`),
   *  surfaced so the route's discoverability + repo-backed GETs resolve.
   *  Both null in degraded mode. */
  readonly far: {
    readonly service: FarService | null;
    readonly repo: PostgresSiteFarRepository | null;
  };

  /**
   * Wave WS-4 — platform billing (the platform's own SaaS revenue path).
   * Backs GET /api/v1/billing/subscription. Non-null ONLY when a payment
   * provider is configured (STRIPE_SECRET_KEY) AND DATABASE_URL is set: the
   * service drives the platform fee through the provider PORT (IPaymentProvider)
   * and posts the receivable through LedgerService.post(). Null otherwise — the
   * billing router falls through to its loud-failure / degraded path. Typed
   * structurally (not via a hard import) so the registry file stays free of a
   * billing-service dependency cycle.
   */
  readonly platformBilling: {
    getSubscription(tenantId: string): Promise<unknown>;
    subscribe(input: {
      readonly tenantId: string;
      readonly plan: string;
      readonly mrrMinor: number;
      readonly seats: number;
      readonly billingPeriod: string;
      readonly providerCustomerId: string;
      readonly actorId: string;
    }): Promise<unknown>;
  } | null;

  /** Mining-domain Wave 5 — buyer financial-profile repo (credit limit,
   *  AML status, banking, payment history) over the `buyers` extension
   *  columns added by migration 0005. Null when DATABASE_URL is unset. */
  readonly buyerFinancialProfile: PostgresBuyerFinancialProfileRepository | null;

  /** Mining-domain Wave 5 — buyer risk-report repo over
   *  `buyer_risk_reports`. Append-only composite scores keyed by
   *  buyer + tenant. Null when DATABASE_URL is unset. */
  readonly buyerRiskReport: PostgresBuyerRiskReportRepository | null;

  /** Mining-domain Wave 5 — site Field Asset Register over `assets` +
   *  `maintenance_events`. Null when DATABASE_URL is unset. */
  readonly siteFar: PostgresSiteFarRepository | null;

  /** Mining-domain Wave 5 — bid-negotiation thread repo over
   *  `bid_negotiations`. Buyer<->seller offers + counters on a
   *  marketplace bid. Null when DATABASE_URL is unset. */
  readonly bidNegotiation: PostgresBidNegotiationRepository | null;

  /** Mining-domain Wave 5 — ore-parcel grading snapshot repo over
   *  `ore_grade_snapshots`. Append-only assay/processability/fit
   *  records per parcel. Null when DATABASE_URL is unset. */
  readonly oreGrading: DrizzleOreGradingRepository | null;

  /** Mining-domain Wave 5 — ore stockpile (warehouse) repo over
   *  `ore_stockpiles`. Tracks physical custody of ore parcels at
   *  site / warehouse / in-transit. Null when DATABASE_URL is unset. */
  readonly oreWarehouse: DrizzleOreWarehouseRepository | null;

  /** Mining hard-fork wave 6 — buyers waiting for ore parcels of a
   *  given mineral. Status moves forward only:
   *  waiting → matched → fulfilled (or expired/cancelled). Persists to
   *  `offtake_queue`. Null when DATABASE_URL is unset. */
  readonly offtakeQueue: PostgresOfftakeQueueRepository | null;

  /** Mining hard-fork wave 6 — per-worker safety badges, productivity
   *  rewards, attendance streaks, incident-free milestones. Persists
   *  to `worker_incentives`. Null when DATABASE_URL is unset. */
  readonly workerIncentives: PostgresWorkerIncentivesRepository | null;

  /** Mining hard-fork wave 6 — per-asset pre-shift safety checklist
   *  signed off by a supervisor before the crew starts the shift.
   *  Persists to `pre_shift_inspections`. Null when DATABASE_URL is
   *  unset. */
  readonly sitePreShiftInspection: PostgresSitePreShiftInspectionRepository | null;

  /** Mining hard-fork wave 6 — per-tenant ore-grading weights config
   *  (grade / processability / tonnage / deleterious penalty /
   *  logistics / confidence). Stored inside `tenants.settings` jsonb.
   *  Null when DATABASE_URL is unset. */
  readonly oreGradingWeights: DrizzleOreGradingWeightsRepository | null;

  /** Mining hard-fork wave 6 — per-site live ops snapshot (asset health,
   *  maintenance load, attendance) over `sites`, `assets`,
   *  `maintenance_events`, `attendance`. Null when DATABASE_URL is
   *  unset. */
  readonly siteLiveMetrics: DrizzleSiteLiveMetricsSource | null;

  /** Mining hard-fork wave 6 — site/shift supervisor coverage bindings
   *  (who supervises which site for which shift, with validity
   *  windows). Persists to `site_supervisor_coverage`. Null when
   *  DATABASE_URL is unset. */
  readonly siteSupervisorCoverage: PostgresSiteSupervisorCoverageRepository | null;

  /** Mining hard-fork wave 6 — per-equipment-kind problem catalog
   *  (platform defaults + per-tenant overrides). Persists to
   *  `equipment_maintenance_taxonomy`. Null when DATABASE_URL is
   *  unset. */
  readonly equipmentMaintenanceTaxonomy: DrizzleEquipmentMaintenanceTaxonomyRepository | null;

  /** Monthly close orchestrator (Wave 28 PhA2) — Drizzle-backed
   *  RunStorePort + stub external ports (reconciliation, statements,
   *  disbursement, notification, event, autonomy). The orchestrator
   *  is constructable today and persists run/step state to Postgres;
   *  concrete external-port adapters land in follow-ups. */
  readonly monthlyClose: MonthlyCloseWiring | null;

  /** Voice agent — Drizzle-backed VoiceTurnRepository + degraded brain
   *  stub. STT / TTS / customer-resolver are null (the agent supports
   *  null on all three). Production deployment of those adapters is
   *  a follow-up; the agent is operable in degraded mode today. */
  readonly voiceAgent: VoiceAgentWiring | null;

  /** AI-native (Agent PhL) — the `services.aiNative` object the
   *  `/ai-native` router reads. Carries `dynamicPricing` /
   *  `docIntelligence` (+ repo) / `legalDrafter` (+ repo) / `voiceAgent`.
   *  The 3 LLM-backed capabilities are present only when an Anthropic key
   *  is configured (otherwise the route degrades to 503 per capability);
   *  the voice agent always wires. Always a (possibly-partial) object —
   *  never null — so the router can read members without a null-guard;
   *  degraded mode supplies an empty object. */
  readonly aiNative: ReturnType<typeof buildAiNativeServices>;

  /** Task-agents — the executor that runs any of the 15 shipped
   *  task-agents under autonomy + budget guardrails. Bound in the live
   *  registry with the canonical `TASK_AGENT_REGISTRY` + the assembled
   *  live services bag + the AI cost ledger. Null in degraded mode (the
   *  `/task-agents` router returns a clean 503 then). */
  readonly taskAgentExecutor: TaskAgentExecutor | null;

  // REMOVED (borjie hard-fork): marketSurveillance — queried deleted property
  // tables (leases/properties/units) and had zero route consumers.

  /** Predictive interventions agent — Drizzle-backed prediction +
   *  opportunity persistence. `listActiveTenants` returns [] until the
   *  occupancy/leases adapter lands. LLM port is undefined so the agent
   *  runs in heuristic-baseline mode. */
  readonly predictiveInterventions: PredictiveInterventionsWiring | null;

  /** Wake-loop cron supervisor (K7 parity-litfin Gap H). Periodically
   *  invokes `runWakeCycle` across every active tenant so the kernel's
   *  ambient brain detectors (arrears/lease-expiry/vacancy) actually
   *  fire on schedule. Null in degraded mode. Constructed but inert
   *  until `start()` is called from the gateway boot sequence. */
  readonly wakeLoopCron: WakeLoopCronSupervisor | null;

  /** Sovereign-ledger verify cron (Wave-K Tier-3). Periodically walks
   *  the sovereign action-ledger chain for every active tenant and
   *  emits `sovereign-ledger.verified` / `sovereign-ledger.tampered`
   *  on the shared bus. Null in degraded mode. Inert until `start()`. */
  readonly sovereignLedgerVerifyCron: SovereignLedgerVerifyCronSupervisor | null;

  /**
   * AI audit-chain verify cron (Phase D D2). Periodically calls
   * `verifyRandomSample(tenantId, p=0.05)` every 15 min and
   * `verifyLedgerChain(tenantId)` nightly per active tenant. Emits
   * `ai-audit.tampered` on the shared bus + structured ERROR log on
   * any failed verdict. Null in degraded mode (no AI-audit verifier
   * wired). Inert until `.start()`.
   */
  readonly auditVerifyCron: AuditVerifyCronSupervisor | null;

  /** Parity capability dashboard (Wave-K parity-litfin Gap C). Aggregates
   *  `kernel_provenance` + `kernel_cot_reservoir` rows into the per-
   *  capability tiles the mission-eval UI renders. Null in degraded
   *  mode — the router falls back to a zeroed payload. */
  readonly parityCapabilityDashboard: ParityCapabilityDashboardService | null;

  /**
   * Cross-portal pubsub bus (Central Command Phase A C6 / Phase B B2).
   * One bus per gateway process. Per-tenant and global channels
   * (see `cross-portal-bus.ts`). Held as a `Promise` because the
   * Redis-backed implementation lazy-imports `ioredis`; `await` once
   * at the consumer call site. Always wired (in-memory fallback when
   * `REDIS_URL` is unset).
   */
  readonly crossPortalBus: Promise<CrossPortalBus>;

  /**
   * Idle-session emitter (Central Command Phase B B2). Periodic
   * supervisor that writes a Reflexion buffer entry per idle
   * (tenant, user, session) tuple discovered in the sensorium event
   * log. Null in degraded mode (no DB → no activity source). Inert
   * until `.start()` from `index.ts`.
   */
  readonly idleSessionEmitter: IdleSessionEmitter | null;

  /**
   * Session-replay retention purge worker (Central Command Phase C C4).
   * Periodic supervisor that deletes `session_replay_chunks` rows
   * older than `retentionDays` days (default 90) and best-effort
   * deletes the corresponding cold-store blobs. Null in degraded mode
   * (no DB → nothing to purge). Inert until `.start()` from `index.ts`.
   */
  readonly sessionReplayRetention: SessionReplayRetention | null;

  /**
   * Central Command Phase C C2 — cross-portal killswitch fan-out
   * publisher. Implements B1's `publishCrossPortalEvent` hook on the
   * `killswitch-write.service.ts` adapter so every state change is
   * broadcast onto the global topic for live brain re-reads.
   *
   * Always wired (the cross-portal bus is always wired — in-memory in
   * degraded mode, Redis-backed in live mode). The publisher itself
   * is a closure; calling it before the bus resolves is safe.
   */
  readonly killswitchFanoutPublisher: KillswitchFanoutPublisher;

  /**
   * Central Command Phase C C2 — notification dispatcher adapter that
   * bridges B1's `PlatformAnnouncementService.dispatcher` slot to the
   * composition root's event bus + cross-portal bus. Always wired
   * (uses only always-present surfaces).
   */
  readonly notificationDispatcherAdapter: NotificationDispatcherLike;

  /**
   * Central Command Phase C C2 — recipient resolver adapter that
   * counts users matching an announcement audience. Null in degraded
   * mode (needs DB); the announcement service tolerates null by
   * stamping `recipientCount = 0` and proceeding.
   */
  readonly recipientResolverAdapter: RecipientResolverLike | null;

  /** Single shared in-process event bus. */
  readonly eventBus: EventBus;

  /** Underlying Drizzle client (null in degraded mode). */
  readonly db: DatabaseClient | null;

  /** True when DATABASE_URL was set and services were constructed. */
  readonly isLive: boolean;

  /**
   * P38 — persistent-store ports. Wires LessonStore / WormAuditStore /
   * SkillRegistryWriter / AOPRegistryStore + per-tenant A2A TaskStore
   * factory. In degraded mode the in-memory ports are wired; in live mode
   * the Drizzle-backed adapters from `@borjie/database`. Per-port
   * `PERSISTENT_*_DISABLED` env flags force the in-memory path even when
   * `db` is set. Read by `service-context.middleware.ts` (every request)
   * and the boot-time `modeByStore` log in `index.ts:579`.
   */
  readonly persistentStores: PersistentStores;

  /**
   * P54 — document StorageProvider bridge. Routes DocumentService +
   * EvidencePackBuilder uploads through the shared `@borjie/storage-
   * adapter` (Supabase backend) via the tenant-scoped-path bridge. Falls
   * back to `LocalStorageProvider` when Supabase env is unset.
   */
  readonly documentStorage: DocumentStorageWiring;

  /**
   * Phase D D7 — Persona Registry admin surface. Kernel `PersonaRegistry`
   * hydrated from the Drizzle-backed `createPersonaRegistryService` store.
   * Null in degraded mode (no DB); the persona-registry router returns 503
   * NOT_IMPLEMENTED when this slot is null. Built asynchronously in
   * `buildServices` after the service object is constructed (mirrors the
   * `mcp` post-construction patch pattern).
   */
  personaRegistry: PersonaRegistry | null;
}

export interface BuildServicesInput {
  readonly db: DatabaseClient | null;
  /** Optional pre-seeded event bus (tests). */
  readonly eventBus?: EventBus;
}

// ---------------------------------------------------------------------------
// Degraded skeleton — every service null
// ---------------------------------------------------------------------------

function buildOrgAwareness(eventBus: EventBus): OrgAwarenessRegistry {
  const observationStore = new OrgAwareness.InMemoryProcessObservationStore();
  const bottleneckStore = new OrgAwareness.InMemoryBottleneckStore();
  const snapshotStore = new OrgAwareness.InMemoryImprovementSnapshotStore();
  const miner = OrgAwareness.createProcessMiner({
    store: observationStore,
  });
  const bottleneckDetector = OrgAwareness.createBottleneckDetector({
    observationStore,
    bottleneckStore,
    miner,
  });
  const improvementTracker = OrgAwareness.createImprovementTracker({
    store: snapshotStore,
  });
  const queryService = OrgAwareness.createOrgQueryService({
    miner,
    bottleneckStore,
    improvementTracker,
  });
  // Subscribe to platform events so every emitted lifecycle event
  // lands in the process-miner's observation stream. Bus-shape shim
  // because `EventBus.publish(env)` wraps events — we expose a
  // `subscribe(type, handler)` facade over the existing bus.
  const busShim: OrgAwareness.PlatformBusLike = {
    subscribe(eventType, handler) {
      const offs: Array<() => void> = [];
      const sub = (eventBus as unknown as {
        subscribe?: (t: string, h: (e: unknown) => void) => () => void;
      }).subscribe;
      if (typeof sub === 'function') {
        offs.push(
          sub.call(eventBus, eventType, (envelope: unknown) => {
            const evt = (envelope as { event?: unknown })?.event ?? envelope;
            handler(evt as OrgAwareness.PlatformEventLike);
          }),
        );
      }
      return () => {
        for (const off of offs) off();
      };
    },
  };
  OrgAwareness.subscribeOrgEvents({ bus: busShim, miner });
  return {
    miner,
    bottleneckDetector,
    improvementTracker,
    queryService,
    observationStore,
    bottleneckStore,
    snapshotStore,
  };
}

/** Domains the briefing buckets overnight autonomous actions by. */
const HEAD_BRIEFING_DOMAINS: ReadonlyArray<string> = [
  'finance',
  'offtake',
  'maintenance',
  'compliance',
  'communications',
  'marketing',
  'hr',
  'procurement',
  'insurance',
  'legal_proceedings',
  'community_welfare',
];

/** Map a free-text audit `domain` onto a known briefing domain bucket. */
function narrowBriefingDomain(domain: string): string {
  return HEAD_BRIEFING_DOMAINS.includes(domain) ? domain : 'finance';
}

/**
 * Build the head-briefing composer.
 *
 * When a Drizzle handle is present every source is a REAL tenant-scoped
 * read:
 *   - overnight        ← autonomous_action_audit (last 24h, by domain)
 *   - pending approvals ← mining_approval_items WHERE status='pending'
 *   - escalations      ← ExceptionInbox.listOpen (Wave-13 inbox)
 *   - anomalies        ← incidents WHERE severity in (high,critical) recent
 *   - KPI / recommendations remain empty-shaped (see fixNote below)
 *
 * Without a DB handle (in-memory / test boot) the sources degrade to the
 * shaped-but-empty briefing — the prior pilot behaviour.
 *
 * KNOWN RESIDUAL (recorded for the orchestrator): `KpiDeltasSection` is a
 * property-domain shape (occupancyPct / collectionsRate / arrearsDays /
 * maintenanceSLA / tenantSatisfaction / noi) declared in
 * `@borjie/ai-copilot` — NOT in this file's ownership. Populating it with
 * mining KPIs (tonnage / recovery / royalty accrual / safety) requires
 * re-shaping that type in the ai-copilot package first, so the KPI source
 * stays zero-valued here rather than fabricating property numbers.
 */
function buildHeadBriefingComposer(
  exceptionInbox: ExceptionInbox | null,
  db: DatabaseClient | null,
): HeadBriefing.BriefingComposer {
  const overnightSource: HeadBriefing.OvernightSource = {
    async summarize(tenantId, since) {
      if (!db) return { totalAutonomousActions: 0, byDomain: {}, notableActions: [] };
      try {
        const rows = await db
          .select({
            id: headBriefingActionAudit.id,
            action: headBriefingActionAudit.action,
            domain: headBriefingActionAudit.domain,
            reasoning: headBriefingActionAudit.reasoning,
          })
          .from(headBriefingActionAudit)
          .where(
            and(
              eq(headBriefingActionAudit.tenantId, tenantId),
              gte(headBriefingActionAudit.createdAt, since),
            ),
          )
          .orderBy(desc(headBriefingActionAudit.createdAt))
          .limit(50);
        const byDomain: Record<string, number> = {};
        for (const r of rows) {
          const d = narrowBriefingDomain(r.domain);
          byDomain[d] = (byDomain[d] ?? 0) + 1;
        }
        return {
          totalAutonomousActions: rows.length,
          byDomain: byDomain as HeadBriefing.OvernightSection['byDomain'],
          notableActions: rows.slice(0, 5).map((r) => ({
            actionId: r.id,
            domain: narrowBriefingDomain(
              r.domain,
            ) as HeadBriefing.NotableAutonomousAction['domain'],
            summary: r.action,
            confidence: 0.7,
          })),
        };
      } catch {
        return { totalAutonomousActions: 0, byDomain: {}, notableActions: [] };
      }
    },
  };
  const pendingApprovalsSource: HeadBriefing.PendingApprovalsSource = {
    async list(tenantId) {
      if (!db) return { count: 0, items: [] };
      try {
        const rows = await db
          .select({
            id: headBriefingApprovalItems.id,
            requestKind: headBriefingApprovalItems.requestKind,
          })
          .from(headBriefingApprovalItems)
          .where(
            and(
              eq(headBriefingApprovalItems.tenantId, tenantId),
              eq(headBriefingApprovalItems.status, 'pending'),
            ),
          )
          .orderBy(desc(headBriefingApprovalItems.createdAt))
          .limit(20);
        return {
          count: rows.length,
          items: rows.map((r) => ({
            approvalId: r.id,
            kind: 'single' as const,
            summary: r.requestKind,
            urgency: 'medium' as const,
          })),
        };
      } catch {
        return { count: 0, items: [] };
      }
    },
  };
  const escalationsSource: HeadBriefing.EscalationsSource = {
    async list(tenantId) {
      if (!exceptionInbox) {
        return {
          count: 0,
          byPriority: { P1: 0, P2: 0, P3: 0 },
          items: [],
        };
      }
      const open = await exceptionInbox.listOpen(tenantId, { limit: 10 });
      const byPriority = { P1: 0, P2: 0, P3: 0 };
      for (const e of open) {
        byPriority[e.priority] = (byPriority[e.priority] ?? 0) + 1;
      }
      return {
        count: open.length,
        byPriority,
        items: open.map((e) => ({
          exceptionId: e.id,
          priority: e.priority,
          summary: e.title,
          domain: e.domain,
        })),
      };
    },
  };
  const kpiSource: HeadBriefing.KpiSource = {
    async fetch() {
      // KpiDeltasSection is a property-domain shape owned by
      // @borjie/ai-copilot (see KNOWN RESIDUAL above). Zero-valued until
      // that type is re-shaped to mining KPIs — honest empty, not fabricated.
      return {
        occupancyPct: { value: 0, delta7d: 0 },
        collectionsRate: { value: 0, delta7d: 0 },
        arrearsDays: { value: 0, delta7d: 0 },
        maintenanceSLA: { value: 0, delta7d: 0 },
        tenantSatisfaction: { value: 0, delta30d: 0 },
        noi: { value: 0, delta30d: 0 },
      };
    },
  };
  const recommendationsSource: HeadBriefing.RecommendationsSource = {
    async list() {
      return [];
    },
  };
  const anomaliesSource: HeadBriefing.AnomaliesSource = {
    async list(tenantId) {
      if (!db) return [];
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const rows = await db
          .select({
            id: headBriefingIncidents.id,
            kind: headBriefingIncidents.kind,
            severity: headBriefingIncidents.severity,
            description: headBriefingIncidents.description,
          })
          .from(headBriefingIncidents)
          .where(
            and(
              eq(headBriefingIncidents.tenantId, tenantId),
              gte(headBriefingIncidents.createdAt, since),
              sql`${headBriefingIncidents.severity} in ('high','critical')`,
            ),
          )
          .orderBy(desc(headBriefingIncidents.createdAt))
          .limit(5);
        return rows.map((r) => ({
          area: r.kind,
          observation: r.description ?? `A ${r.severity} ${r.kind} incident was logged.`,
          possibleCause: 'See the incident record for root-cause detail.',
          suggestedInvestigation: 'Review the incident and its corrective actions.',
        }));
      } catch {
        return [];
      }
    },
  };
  return HeadBriefing.createBriefingComposer({
    overnightSource,
    pendingApprovalsSource,
    escalationsSource,
    kpiSource,
    recommendationsSource,
    anomaliesSource,
  });
}

/**
 * Build the Canonical Property Graph (CPG) query service.
 *
 * Returns null when NEO4J_URI is unset so the gateway boots without a
 * Neo4j upstream; the graph router surfaces 503 GRAPH_SERVICE_UNAVAILABLE
 * in that case. When present, we construct a pooled `Neo4jClient` via
 * `createNeo4jClient` (which reads NEO4J_USER / NEO4J_PASSWORD /
 * NEO4J_DATABASE internally) and wrap it in a `GraphQueryService`. The
 * client is eagerly instantiated but `verifyConnectivity` is NOT called
 * — boot stays fast; the health endpoint probes liveness on demand.
 */
function buildGraphQueryService(): GraphQueryService | null {
  if (!process.env.NEO4J_URI?.trim()) return null;
  try {
    const client = createNeo4jClient();
    return createGraphQueryService(client);
  } catch (err) {
    logger.warn('service-registry: graph query service init failed — returning null', { value: err instanceof Error ? err.message : err });
    return null;
  }
}

/**
 * Wire the per-tenant multimodal Brain resolver into the workforce-mobile
 * Photo Advisor router (`/api/v1/mining/brain/vision-turn`).
 *
 * Mirrors the EXACT per-tenant `BrainRegistry` construction in
 * `routes/brain.hono.ts`: a `PostgresThreadStoreBackend` over a per-tenant
 * `BrainThreadRepository`, then `createBrain({ anthropic, threadStoreBackend,
 * extraSkills })`. The same registry shape means the vision turn shares the
 * tenant's durable thread store + skill catalog with the text brain path.
 *
 * Honest-degrade (never crash-on-boot):
 *   - `tryLoadBrainEnv` returns null when Anthropic/Supabase creds are absent →
 *     we leave the resolver UNSET so the route keeps its clean `BRAIN_NOT_
 *     CONFIGURED` 503. (`createBrain` THROWS without a real key, so we must not
 *     even attempt construction in that mode.)
 *   - the per-tenant factory throw is caught inside the resolver → the route
 *     resolves a null Brain → its own `BRAIN_NOT_AVAILABLE` 503, not a throw.
 *   - any unexpected fault wiring the registry is swallowed (warn-once) so the
 *     route simply stays on its 503 path; brain boot is never blocked.
 *
 * Idempotent: safe to call once per registry build (the resolver is a module-
 * global setter; the last registry built wins, all share the same db handle).
 */
function wireMultimodalBrainResolver(db: DatabaseClient): void {
  try {
    const brainEnv = tryLoadBrainEnv(process.env);
    if (!brainEnv) {
      logger.warn(
        { wiring: 'mining-brain-vision' },
        'mining-brain-vision: Anthropic/Supabase creds absent (tryLoadBrainEnv → null); ' +
          'leaving vision-turn brain resolver unset — route honest-503s BRAIN_NOT_CONFIGURED',
      );
      return;
    }

    const anthropic: { apiKey: string; baseUrl?: string; defaultModel?: string } = {
      apiKey: brainEnv.ANTHROPIC_API_KEY,
    };
    if (brainEnv.ANTHROPIC_BASE_URL !== undefined) {
      anthropic.baseUrl = brainEnv.ANTHROPIC_BASE_URL;
    }
    if (brainEnv.ANTHROPIC_MODEL_DEFAULT !== undefined) {
      anthropic.defaultModel = brainEnv.ANTHROPIC_MODEL_DEFAULT;
    }

    const registry = new BrainRegistry((tenantId: string) => {
      const repo = new BrainThreadRepository(db);
      const backend = new PostgresThreadStoreBackend(repo, () => tenantId);
      return createBrain({
        anthropic,
        threadStoreBackend: backend,
        extraSkills: getBrainExtraSkills(),
      });
    });

    setBrainResolver(({ tenantId }) => {
      try {
        return registry.for(tenantId);
      } catch (err) {
        // A per-tenant factory fault degrades to a null Brain — the route maps
        // that to its own BRAIN_NOT_AVAILABLE 503 rather than throwing.
        logger.warn(
          {
            wiring: 'mining-brain-vision',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'mining-brain-vision: per-tenant Brain construction failed — vision-turn returns BRAIN_NOT_AVAILABLE',
        );
        return null;
      }
    });

    logger.info(
      { wiring: 'mining-brain-vision', resolverWired: true },
      'mining-brain-vision: per-tenant Brain resolver wired — vision-turn reachable',
    );
  } catch (err) {
    // Never break boot — leaving the resolver unset keeps the route on its
    // honest 503.
    logger.warn(
      {
        wiring: 'mining-brain-vision',
        err: err instanceof Error ? err.message : String(err),
      },
      'mining-brain-vision: resolver wiring failed; vision-turn keeps its 503 path',
    );
  }
}

/**
 * Wire the Tier-2 Capability-Composition Engine into the owner chat-actions
 * route (`setCompositionEngine`). When wired, the engine attempts to FULFILL a
 * brain-generated unknown verb by composing the power-tool inventory into a
 * governed, transactional chain BEFORE the route defers to a plain brain turn.
 *
 * CI-INERTNESS (non-negotiable): we build the engine ONLY when a real Anthropic
 * key is present (`tryLoadBrainEnv → non-null` AND the SDK loads). When creds
 * are absent we leave the slot UNSET, so the deferToBrain path is byte-for-byte
 * unchanged and the central-intelligence test suite + stub-sensor CI are
 * unaffected — the SAME discipline as kernel-debate. Construction reuses the
 * EXACT raw → circuit-breaker → OTel composition the kernel sensors use; we
 * never fabricate a parallel model client. Never breaks boot: any fault leaves
 * the slot unset and the route on its unchanged deferToBrain path.
 */
async function wireCapabilityCompositionEngine(): Promise<void> {
  try {
    const brainEnv = tryLoadBrainEnv(process.env);
    if (!brainEnv) {
      logger.warn(
        { wiring: 'capability-composition' },
        'capability-composition: Anthropic creds absent (tryLoadBrainEnv → null); ' +
          'leaving composition engine unset — unknown-verb path defers to brain unchanged (CI-inert)',
      );
      return;
    }

    let rawClient: AnthropicMessagesClient | null = null;
    try {
      const mod = await import('@anthropic-ai/sdk');
      const Anthropic = (mod.default ?? mod) as unknown as new (cfg: {
        apiKey: string;
        baseURL?: string;
      }) => AnthropicMessagesClient;
      rawClient = new Anthropic(
        brainEnv.ANTHROPIC_BASE_URL !== undefined
          ? { apiKey: brainEnv.ANTHROPIC_API_KEY, baseURL: brainEnv.ANTHROPIC_BASE_URL }
          : { apiKey: brainEnv.ANTHROPIC_API_KEY },
      );
    } catch (err) {
      logger.warn(
        {
          wiring: 'capability-composition',
          err: err instanceof Error ? err.message : String(err),
        },
        'capability-composition: @anthropic-ai/sdk not loadable; leaving engine unset (CI-inert)',
      );
      return;
    }

    // Compose raw → circuit-breaker → OTel, matching the kernel sensor stack.
    const wrapped = wrapAnthropicWithOtelSpans(
      wrapAnthropicWithCircuitBreaker(rawClient, {
        failureThreshold: 5,
        recoveryTimeoutMs: 30_000,
      }),
    );

    const engine = buildCapabilityCompositionEngine(
      wrapped,
      brainEnv.ANTHROPIC_MODEL_DEFAULT !== undefined
        ? { model: brainEnv.ANTHROPIC_MODEL_DEFAULT }
        : {},
    );
    setCompositionEngine(engine);
    logger.info(
      { wiring: 'capability-composition', engineWired: true },
      'capability-composition: Tier-2 engine wired — unknown-verb path attempts a governed composition before deferring to brain',
    );
  } catch (err) {
    // Never break boot — leaving the engine unset keeps the deferToBrain path.
    logger.warn(
      {
        wiring: 'capability-composition',
        err: err instanceof Error ? err.message : String(err),
      },
      'capability-composition: engine wiring failed; unknown-verb path keeps its deferToBrain return',
    );
  }
}

/**
 * MEM-01 — select the durable six-layer memory-v2 substrate.
 *
 * When a live DB handle is present, every layer is backed by the Drizzle
 * stores (migration 0312) so episodes / arcs / skills / notes / topic shards /
 * cohort cache SURVIVE a process restart. Without a DB handle (no-DATABASE_URL
 * boot / tests) we fall back to the ephemeral in-memory substrate so the
 * gateway still boots. Each Drizzle store implements the identical port as its
 * in-memory counterpart, so no downstream consumer changes. Construction
 * failures degrade to the in-memory substrate (the slot is always non-null).
 */
function buildMemoryV2(db: DatabaseClient | null): MemoryV2 {
  if (db === null) {
    logger.warn(
      'service-registry: no db handle; memory-v2 is in-memory (volatile across restarts)',
    );
    return createInMemoryMemoryV2();
  }
  try {
    const v2 = createDrizzleMemoryV2(db, {
      // Adapt the structural store logger (message, meta) to the Pino
      // (meta, message) call order so redaction works correctly.
      logger: {
        warn: (message, meta) => logger.warn(meta ?? {}, message),
      },
    });
    logger.info(
      'service-registry: memory-v2 backed by Drizzle (durable across restarts)',
    );
    return v2;
  } catch (err) {
    logger.warn(
      'service-registry: memory-v2 Drizzle construction failed — falling back to in-memory',
      { value: err instanceof Error ? err.message : String(err) },
    );
    return createInMemoryMemoryV2();
  }
}

/**
 * Wave WS-4 — build the platform-billing service for the LIVE registry.
 *
 * Non-null ONLY when a payment provider is configured (STRIPE_SECRET_KEY).
 * The service drives the platform fee through the provider PORT
 * (IPaymentProvider) and posts the receivable through LedgerService.post() —
 * the established money seam, never a parallel ledger. When no provider key
 * is present the slot stays null and the billing router falls through to its
 * loud-failure / degraded path (unchanged behaviour). Typed via the registry
 * slot shape (structural) so no billing-service type leaks into the slot.
 */
function buildPlatformBilling(
  db: ReturnType<typeof createDatabaseClient>,
): ServiceRegistry['platformBilling'] {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!stripeKey) return null;
  try {
    const provider = new StripePaymentProvider({
      secretKey: stripeKey,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '',
    });
    const ledger = buildLedgerService(db);
    return new PlatformBillingService({
      db,
      provider,
      ledger,
      resolveCurrency: makeTenantCurrencyResolver(db),
    });
  } catch (err) {
    logger.warn(
      'service-registry: platform-billing init failed — returning null',
      { value: err instanceof Error ? err.message : err },
    );
    return null;
  }
}

function degradedRegistry(eventBus: EventBus): ServiceRegistry {
  // Single bus instance reused for the bus slot and the C2 fan-out /
  // dispatcher adapters so all three converge on the same in-memory
  // (or Redis, when REDIS_URL is set) backend. Constructed once at
  // call time so each fresh degraded registry gets a fresh bus.
  const degradedCrossPortalBus = createCrossPortalBus({
    redisUrl: process.env.REDIS_URL ?? null,
  });
  return {
    marketplace: { listing: null, enquiry: null, tender: null },
    negotiation: null,
    waitlist: { service: null, vacancyHandler: null },
    occupancyTimeline: null,
    stationMasterRouter: null,
    stationMasterCoverageRepo: null,
    renewal: null,
    financialProfile: null,
    riskReport: null,
    gamification: null,
    migration: null,
    migrationWizardCopilot: null,
    warehouse: null,
    maintenanceTaxonomy: null,
    iot: null,
    featureFlags: null,
    gdpr: null,
    aiCostLedger: null,
    // Mining ADVISOR wave — stage-advisor needs a real DB to read the
    // org metrics / persisted hysteresis state from; null in degraded mode
    // so the /api/v1/stage router returns 503 SERVICE_UNAVAILABLE rather
    // than fabricating a stage.
    stageAdvisor: null,
    // Wave-K W-Data — DSAR data source is null in degraded mode (no
    // DB to read from). The classification lookup is always wired
    // because it is an in-process frozen registry. The budget
    // composer falls back to an in-memory adapter that satisfies the
    // full port contract — fine for single-replica dev / DB-down.
    dsarDataSource: null,
    dsarClassifications: createDatabaseClassificationLookup(classifyDbColumn),
    // RTBF executor needs a real DB client — null in degraded mode so
    // the dsar router returns 503 RTBF_EXECUTOR_UNAVAILABLE rather
    // than silently no-op'ing the erasure (the prior stub bug).
    dsarRtbfExecutor: null,
    privacyBudgetComposer: createPrivacyBudgetComposerService(),
    llmRouter: null,
    buildBudgetGuardedAnthropicClient: null,
    // PO-port wave-5 wiring #2 — LLM budget governor is always wired.
    // Degraded mode falls back to the in-memory store (no DB to persist
    // to); P76 BUG-HI-3 closure: live mode swap to the Postgres-backed
    // store happens in the live registry below. Default caps: $50/day,
    // 5M tokens/day; downgrade at 85% of cap. Even when no real LLM
    // calls happen in degraded mode, the slot is non-null so consumer
    // routes can call `governor.snapshot(tenantId)` without null-guards.
    llmBudgetGovernor: createLLMBudgetGovernor({
      store: wireBudgetStore({
        db: null,
        logger: { warn: createPinoLikeLogger('llm-budget').warn },
      }),
    }),
    arrears: {
      service: null,
      repo: null,
      ledgerPort: null,
      entryLoader: null,
    },
    // REMOVED (borjie hard-fork): the `cases` degraded-mode slot.
    mcp: null,
    agentCertification: null,
    training: null,
    voice: null,
    orgAwareness: buildOrgAwareness(eventBus),
    autonomy: {
      // Degraded mode: in-memory repository so the endpoint still
      // returns a defaults-shaped policy. Never persists across
      // restarts — fine for local-dev / DB-down degraded mode.
      policyService: new AutonomyPolicyService({
        repository: new InMemoryAutonomyPolicyRepository(),
      }),
    },
    branding: {
      // Wave 27 Agent E — tenant branding. In-memory repo is fine in
      // degraded mode; overrides don't persist across restarts.
      service: new TenantBrandingService(new InMemoryTenantBrandingRepository()),
    },
    headBriefing: {
      // Wave 28 — head briefing composer with in-memory source stubs.
      // Degraded mode uses a fresh ExceptionInbox backed by an empty
      // in-memory repo so the escalations section returns zero instead
      // of throwing.
      composer: buildHeadBriefingComposer(
        new ExceptionInbox({ repository: new InMemoryExceptionRepository() }),
        // Degraded registry has no DB handle — sources stay shaped-but-empty.
        null,
      ),
    },
    juniorAI: {
      // Wave 28 — team-lead self-service junior-AI factory. In-memory
      // repo + a degraded autonomy-policy loader that returns a
      // permissive default (level 0, empty domain policies) so the
      // policy-subset check still runs and routes always shape.
      factoryService: new JuniorAIFactoryService({
        repository: new InMemoryJuniorAIRepository(),
        autonomyPolicyLoader: async (tenantId: string) => buildDefaultPolicy(tenantId),
      }),
    },
    graph: { queryService: buildGraphQueryService() },
    // PO-port wave-5 wiring #1 — six-layer cognitive memory v2 in degraded
    // mode runs entirely against in-memory adapters (no embedder, no
    // reflection brain). Sleep-pass orchestrators and reflection workers
    // tolerate `embedder === null` + `brain === null` by skipping the
    // vector-search and summarisation steps respectively.
    memoryV2: createInMemoryMemoryV2(),
    // PO-port wave-5 wiring #3 — OCSF emitter (secondary SIEM-egress sink).
    // Degraded mode: in-memory sink unless `OCSF_LOG_PATH` is set.
    ocsf: createOcsfBundle(),
    // PO-port wave-5 wiring #4 — cross-tenant denial recorder. Always
    // wired (in-memory sink in degraded mode). The recorder is fire-
    // and-forget; rate-limit + LRU-trim guarantee bounded memory.
    crossOrgDenialRecorder: createCrossOrgDenialRecorderBundle(),
    // Ported-utilities batch 1 — 5 pure-function utility namespaces. Always
    // wired (no I/O). Consumers (sleep-pass, probe cron, debate gate,
    // ACI calibrator) pull from this bundle via DI.
    portedUtilities: createPortedUtilitiesBundle(),
    // Ported-domain batch 2 — 5 domain bundles (mcp-cost-persistence,
    // fairness-eval, analytics, knowledge-graph, compliance-pack).
    // Always wired; in-memory facade for analytics + KG.
    portedDomain: createPortedDomainBundle(),
    // Ported-platform batch 3 — 5 platform bundles (security-hardening,
    // document-ai, progressive-intelligence, document-quality-guarantor,
    // audio-capture). Always wired; pre-wired facades with safe
    // defaults; namespaces exposed for follow-up port wiring.
    portedPlatform: createPortedPlatformBundle(),
    // Ported-agent-stack batch 4 — 6 agent-stack bundles (agent-runtime, mcp,
    // agent-orchestrator, open-coding-agent-patterns, openclaw-
    // operating-model, agentic-os). Always wired; brain-dependent
    // members are namespace-only; openclaw ships an async pre-wired
    // facade with auto-seeded shipped domains.
    portedAgentStack: createPortedAgentStackBundle(),
    // P75 follow-up — per-tenant brain-dependent agent-stack factory.
    // Degraded mode has no Anthropic key wiring, so the bundle hands
    // back a stack with `brain: null`. The factory still exposes the
    // bound `agentRuntimeFactory` so projects that only need filesystem
    // discovery (slash + sub-agents + skills) keep working.
    agentStack: createAgentStackBundle({
      buildBudgetGuardedAnthropicClient: null,
      logger: { warn: createPinoLikeLogger('agent-stack').warn },
    }),
    // Central Intelligence — no concrete LLM adapter ships here (it
    // lives in a separate service). In degraded mode we still wire the
    // in-memory memory so thread listing works locally.
    // Follow-up wave-30 (#33): replace with pgvector-backed ConversationMemory.
    centralIntelligence: (() => {
      const { sink, reader } = createInMemoryAuditSinkAndReader();
      return {
        agent: null,
        memory: createInMemoryConversationMemory(),
        auditReader: reader,
        auditRecorder: createConversationAuditRecorder({
          sink,
          modelVersion: 'degraded',
        }),
        // Wave-K T1 — no Anthropic key wired in degraded mode, so the
        // brain-kernel slot is null. Downstream consumers (voice agent
        // and future ops endpoints) fall back to their existing
        // degraded paths.
        brainKernel: null,
      };
    })(),
    assetGrading: null,
    creditRating: null,
    // Wave 29 — forecasting stays null in degraded mode; the router
    // returns 503 FORECAST_SERVICE_UNAVAILABLE. No mock data ever.
    forecasting: {
      forecaster: null,
      featureExtractor: null,
      repository: null,
    },
    // Wave 26 — Agent Z2 slots default to null in degraded mode. Each
    // router checks the slot and returns 503 with a clear reason when
    // DATABASE_URL is unset.
    sublease: { service: null, repo: null, tenantGroupRepo: null },
    damageDeductions: { service: null, repo: null },
    conditionalSurveys: { service: null, repo: null },
    far: { service: null, repo: null },
    // Wave WS-4 — platform billing null in degraded mode (no DB / provider).
    platformBilling: null,
    // Mining-domain Wave 5 — buyer / site / marketplace / ore repos.
    // All null in degraded mode (no DB to bind against).
    buyerFinancialProfile: null,
    buyerRiskReport: null,
    siteFar: null,
    bidNegotiation: null,
    oreGrading: null,
    oreWarehouse: null,
    // Mining hard-fork wave 6 — new mining-domain replacement slots.
    // All null in degraded mode; routers fall through to 503.
    offtakeQueue: null,
    workerIncentives: null,
    sitePreShiftInspection: null,
    oreGradingWeights: null,
    siteLiveMetrics: null,
    siteSupervisorCoverage: null,
    equipmentMaintenanceTaxonomy: null,
    // Wave 26 Z3 — move-out + approvals wiring.
    moveOut: { service: null },
    approvals: { service: null },
    // Drizzle-backed agent wirings — null in degraded mode (DATABASE_URL
    // unset). Each consumer router/scheduler tolerates the null slot.
    monthlyClose: null,
    voiceAgent: null,
    // AI-native — degraded mode has no DB + (typically) no Anthropic key,
    // so the wiring is an empty object: every capability is absent and the
    // `/ai-native` router returns its per-capability 503. The slot is a
    // (partial) object, never null, so the router reads members directly.
    aiNative: {},
    // Task-agents — null in degraded mode (no live services bag / ledger to
    // bind the executor against); the `/task-agents` router returns 503.
    taskAgentExecutor: null,
    predictiveInterventions: null,
    // K7 parity-litfin Gap H — wake-loop cron is null in degraded mode
    // (no DB means no tenants to iterate, no read ports to bind).
    wakeLoopCron: null,
    // Wave-K Tier-3 — sovereign-ledger verify cron is null in degraded
    // mode (no DB → no chain rows to walk).
    sovereignLedgerVerifyCron: null,
    // Phase D D2 — AI audit-chain verify cron is null in degraded mode
    // (no verifier wired). `index.ts` skips `.start()` accordingly.
    auditVerifyCron: null,
    // Wave-K parity-litfin Gap C — null in degraded mode; the router
    // surfaces a zeroed-but-shaped payload so mission-eval keeps loading.
    parityCapabilityDashboard: null,
    // Central Command Phase A C6 / Phase B B2 — cross-portal bus is
    // always wired. In degraded mode `REDIS_URL` is typically unset so
    // the factory returns the in-memory bus; subscribers + publishers
    // operate identically against either backend.
    crossPortalBus: degradedCrossPortalBus,
    // Idle-session emitter — needs DB-backed activity source + reflexion
    // writer; both are null in degraded mode so the slot stays null and
    // `index.ts` skips `.start()`.
    idleSessionEmitter: null,
    // Session-replay retention — degraded mode has no DB so nothing
    // to purge; `index.ts` skips `.start()`.
    sessionReplayRetention: null,
    // Central Command Phase C C2 — closes B1's killswitch fan-out +
    // announcement-dispatch + recipient-resolver ports. The publisher
    // and dispatcher are always wired (they bridge onto the always-
    // present bus + event-bus surfaces). The resolver is null because
    // it needs a DB to count active users; the announcement service
    // tolerates a null resolver by stamping `recipientCount = 0`.
    killswitchFanoutPublisher: createKillswitchFanoutPublisher({
      crossPortalBus: degradedCrossPortalBus,
    }),
    notificationDispatcherAdapter: createNotificationDispatcherAdapter({
      eventBus,
      crossPortalBus: degradedCrossPortalBus,
    }),
    recipientResolverAdapter: null,
    eventBus,
    db: null,
    isLive: false,
    // P38 — degraded mode: `db: null` forces the in-memory ports for
    // every store. The middleware reads the same shape either way.
    persistentStores: createPersistentStores({ db: null }),
    // P54 — degraded mode: no Supabase env => LocalStorageProvider falls
    // back. The wiring stays a real `DocumentStorageWiring` so consumers
    // can switch on `mode` without null-checks.
    documentStorage: createDocumentStorageWiring(),
    // Phase D D7 — persona registry is null in degraded mode (no DB to
    // read personas from). The router returns 503 NOT_IMPLEMENTED when
    // this slot is null. Async hydration in `buildServices` fills the
    // slot when a DB client is available.
    personaRegistry: null,
  };
}

// ---------------------------------------------------------------------------
// buildServices — composition root
// ---------------------------------------------------------------------------

export function buildServices(input: BuildServicesInput): ServiceRegistry {
  const registry = buildServicesInner(input);
  if (!registry.isLive) return registry;
  // MCP server is built after the registry because its handlers close
  // over the populated services. Patch the `mcp` slot — the rest of the
  // object remains effectively immutable from callers' perspective.
  (registry as { mcp: BorjieMcpServer | null }).mcp = buildMcpServer(
    registry,
    registry.agentCertification,
  );
  // Phase D D7 — Persona Registry. `createPersonaRegistry` is async
  // (hydrates from the store at construction) so it cannot be built
  // inside the synchronous object literal. Mirrors the `mcp` patch
  // pattern above: we start the hydration Promise here and patch the
  // slot when it resolves. The router tolerates null (returns 503
  // NOT_IMPLEMENTED) so the gateway is fully operable during the
  // brief window before the Promise settles.
  if (registry.db) {
    const db = registry.db;
    createPersonaRegistry({ store: createPersonaRegistryService(db) })
      .then((pr) => {
        (registry as { personaRegistry: typeof pr }).personaRegistry = pr;
      })
      .catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'persona-registry: async hydration failed — slot stays null',
        );
      });
  }
  return registry;
}

function buildServicesInner(input: BuildServicesInput): ServiceRegistry {
  const eventBus: EventBus = input.eventBus ?? new InMemoryEventBus();

  if (!input.db) return degradedRegistry(eventBus);

  const db = input.db;

  // Marketplace repos
  const listingRepo = new PostgresMarketplaceListingRepository(db);
  const tenderRepo = new PostgresTenderRepository(db);
  const bidRepo = new PostgresBidRepository(db);

  // Mining-domain Wave 5 — bid-negotiation repo over `bid_negotiations`.
  // Replaces the property-domain negotiation triad (policies/negotiations/
  // turns). The legacy NegotiationService still expects the old triad so
  // its live binding is deferred to a follow-up batch; the registry
  // exposes the mining `bidNegotiationRepo` for the new bid-thread
  // routes today.
  const bidNegotiationRepo = new PostgresBidNegotiationRepository(db);
  // Legacy NegotiationService is pending mining-equivalent rewrite — we
  // surface a null instance through the registry slot. EnquiryService
  // still requires a non-null collaborator for its `startNegotiation`
  // delegate; we hand it a thin throwing stub that mirrors the runtime
  // path the prior @ts-nocheck repos exhibited (any call surfaces a
  // clear "negotiation service pending" error rather than crashing on
  // an undefined method).
  const negotiationServicePending = {
    async startNegotiation(): Promise<never> {
      throw new Error(
        'NegotiationService pending mining-equivalent rewrite (bid-negotiation thread API replaces it).',
      );
    },
  } as unknown as NegotiationService;
  const negotiationService = negotiationServicePending;

  // Pre-insert unit-existence check for listing publish. Without this, a
  // bogus `unitId` lands in Postgres as a raw FK violation and the gateway
  // returns 500. We probe `units` with a tenant-scoped `SELECT 1` and
  // return a clean VALIDATION (400) when the unit is missing. Uses a
  // parameterised `sql` template so the unitId is bound safely even if
  // the caller forges the body.
  const unitExists = async (tenantId: string, unitId: string): Promise<boolean> => {
    try {
      const rows = await (db as any).execute(
        sql`SELECT 1 FROM units WHERE id = ${unitId} AND tenant_id = ${tenantId} LIMIT 1`
      );
      // postgres.js returns an array-like; drizzle `execute` yields `{ rows }`
      // depending on driver. Accept both shapes.
      const list = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
      return list.length > 0;
    } catch {
      // If the probe itself fails, fall back to letting the DB layer raise —
      // the FK violation will still be caught downstream.
      return true;
    }
  };

  const listingService = new ListingService({ repo: listingRepo, eventBus, unitExists });
  const enquiryService = new EnquiryService({
    listingRepo,
    negotiationService,
    eventBus,
  });
  const tenderService = new TenderService({
    tenderRepo,
    bidRepo,
    eventBus,
  });

  // Mining hard-fork wave 6 — the property-domain `PostgresWaitlistRepository`
  // + `PostgresWaitlistOutreachRepository` (over the dropped `unit_waitlists`
  // / `waitlist_outreach_events` tables) are retired. The mining-domain
  // replacement is the `offtake_queue` repo wired below as `offtakeQueueRepo`.
  // The legacy `WaitlistService` + `WaitlistVacancyHandler` slots stay null
  // in the live registry until downstream consumers migrate; their `service`
  // and `vacancyHandler` properties return null so router fallbacks hit
  // the existing 503 paths.
  const waitlistService: WaitlistService | null = null;
  const vacancyHandler: WaitlistVacancyHandler | null = null;

  // Mining hard-fork wave 6 — the property-domain
  // `PostgresGamificationRepository` is retired. The mining-domain
  // replacement (worker_incentives) is wired below as
  // `workerIncentivesRepo`. The legacy `gamification` slot stays null
  // in the live registry; `gamification.router` returns 503 cleanly.
  const gamificationService: ReturnType<typeof createGamificationService> | null = null;
  // `createGamificationService` stays imported so its types resolve for
  // legacy callers — referenced here to silence the unused-import lint.
  void createGamificationService;

  // Migration
  const migrationRepo = new PostgresMigrationRepository({ db });
  const migrationService = new MigrationService({
    repository: migrationRepo,
    eventBus: {
      emit: async (event) => {
        // Adapt the MigrationService's minimal EventBus to the platform
        // bus so downstream subscribers still see the events.
        await eventBus.publish({
          event: event as unknown as never,
          version: 1,
          aggregateId: (event as { runId?: string }).runId ?? 'unknown',
          aggregateType: 'MigrationRun',
        });
      },
    },
  });

  // Occupancy Timeline (NEW 22) — Postgres-backed service over leases/customers.
  const occupancyTimelineRepo = new PostgresOccupancyTimelineRepository(db);
  const occupancyTimelineService = new OccupancyTimelineService(
    occupancyTimelineRepo
  );

  // Mining hard-fork wave 6 — the property-domain
  // `PostgresStationMasterCoverageRepository` is retired (it persisted to
  // a `station_master_coverage` table that has no mining equivalent).
  // The mining-domain replacement is wired below as
  // `siteSupervisorCoverageRepo`. The `stationMasterRouter` slot stays
  // null because its repository contract is property-domain shaped.
  // Downstream consumers (`vacancy-pipeline.router.ts`) already check
  // for a null router.
  const stationMasterRouter: StationMasterRouter | null = null;
  // Suppress unused-import warning — `StationMasterRouter` still exports
  // pure types consumed elsewhere.
  void StationMasterRouter;

  // Mining hard-fork wave 6 — `PostgresRenewalRepository` is retired
  // (licence renewal is the mining-domain analogue and is already handled
  // by `services/api-gateway/src/routes/mining/licences.hono.ts`; see
  // issue #11). The `RenewalService` slot is bound to a stub repository
  // that throws on every call so the legacy `/renewals/*` routes return
  // a clear 501 instead of crashing or returning a fabricated 200.
  const renewalRepoStub: RenewalRepository = {
    async findById(): Promise<RenewalLeaseSnapshot | null> {
      throw new Error(
        'RenewalService.findById not implemented in v0.1.0 — see issue #11 (licence renewal is the mining-domain replacement, handled by mining/licences.hono.ts).',
      );
    },
    async update(): Promise<RenewalLeaseSnapshot> {
      throw new Error(
        'RenewalService.update not implemented in v0.1.0 — see issue #11.',
      );
    },
    async createRenewedLease(): Promise<RenewalLeaseSnapshot> {
      throw new Error(
        'RenewalService.createRenewedLease not implemented in v0.1.0 — see issue #11.',
      );
    },
    async nextLeaseSequence(): Promise<number> {
      throw new Error(
        'RenewalService.nextLeaseSequence not implemented in v0.1.0 — see issue #11.',
      );
    },
  };
  const renewalService = new RenewalService(renewalRepoStub, eventBus);

  // Mining-domain Wave 5 — buyer financial-profile + buyer risk-report
  // repos. These persist to the mining tables (`buyers` extension
  // columns + `buyer_risk_reports`) and replace the property-tenant
  // financial-statement / litigation / risk-report stack.
  //
  // The legacy FinancialProfileService / RiskReportService classes
  // still bind against the old interfaces — their slots stay null in
  // the live registry until the per-service rewrite lands. The new
  // repos are surfaced via dedicated `buyerFinancialProfile` /
  // `buyerRiskReport` slots so the new routes can reach them today.
  const buyerFinancialProfileRepo = new PostgresBuyerFinancialProfileRepository(
    db,
  );
  const buyerRiskReportRepo = new PostgresBuyerRiskReportRepository(db);
  // Mining-domain — the `/financial-profile` route now binds to the REAL
  // mining buyer financial-profile service over the two buyer repos above.
  // `riskReportService` stays null (its route is unmounted; the repo is
  // surfaced via the dedicated `buyerRiskReport` slot below).
  const financialProfileService = createMiningFinancialProfileService({
    financialProfileRepo: buyerFinancialProfileRepo,
    riskReportRepo: buyerRiskReportRepo,
    logger: createPinoLikeLogger('mining-financial-profile'),
  });
  const riskReportService = null;

  // Mining-domain Wave 5 — ore-stockpile warehouse + ore-grading repos.
  // Replace the property-inventory `DrizzleWarehouseRepository` (which
  // persisted to warehouse_items / warehouse_movements, both removed by
  // migration 0003). The mining warehouse service (REAL) is built over
  // both repos and backs the `/warehouse` route end-to-end.
  const oreStockpileRepo = new DrizzleOreWarehouseRepository(db);
  const oreGradingRepo = new DrizzleOreGradingRepository(db);
  const warehouseService: MiningWarehouseService = createMiningWarehouseService({
    stockpiles: oreStockpileRepo,
    grading: oreGradingRepo,
  });

  // Mining hard-fork wave 6 — property-domain `DrizzleMaintenanceTaxonomyRepository`
  // + `createMaintenanceTaxonomyService` are retired. The mining-domain
  // replacement service is constructed below, AFTER its repo
  // (`equipmentMaintenanceTaxonomyRepo`) lands, then bound to the
  // `maintenanceTaxonomy` slot. Downstream consumers that need the raw
  // catalog repo still reach `services.equipmentMaintenanceTaxonomy`.

  // Wave 8 — IoT (S3): sensor registry + observation ingest + anomaly store.
  // Service takes the drizzle client directly since all tables live under
  // the same client and queries are straight-through.
  const iotService = createIotService({ db });

  // Arrears Ledger (NEW 4) — Postgres repo + ledger-port + projection
  // loader. The repo persists line proposals + cases; the ledger port
  // appends adjustment rows into `transactions` on approval; the entry
  // loader powers `GET /arrears/cases/:id/projection` by pulling real
  // ledger rows out of Postgres (never mock).
  const arrearsRepo = new PostgresArrearsRepository(db);
  const arrearsLedgerPort = new PostgresLedgerPort(db);
  const arrearsService = createArrearsService({
    repo: arrearsRepo,
    ledger: arrearsLedgerPort,
  });
  const arrearsEntryLoader = createPostgresArrearsEntryLoader(db);

  // REMOVED (borjie hard-fork): the Cases domain service + Postgres repo —
  // residential-property residue; the `cases` table was dropped in
  // 0003_mining_domain.sql and mining uses the `grievances` subsystem.

  // Wave 9 — Feature flags (per-tenant gating of platform capabilities).
  const featureFlagsRepo = new DrizzleFeatureFlagsRepository(db);
  const featureFlagsService = createFeatureFlagsService({
    repo: featureFlagsRepo,
  });

  // Wave 9 — GDPR right-to-be-forgotten.
  const gdprRepo = new DrizzleGdprRepository(db);
  const gdprService = createGdprService({
    repo: gdprRepo,
    eventBus,
  });

  // Wave 9 — AI cost ledger + per-tenant monthly budget.
  const costLedgerRepo = new DrizzleCostLedgerRepository(db);
  const aiCostLedger = createCostLedger({ repo: costLedgerRepo });

  // Wave 26 Agent Z4 — multi-LLM router (Anthropic primary, OpenAI/DeepSeek
  // fallback when their keys are set). The router itself pulls from the
  // cost ledger for budget enforcement and usage recording. We build it
  // lazily so the gateway still boots when no Anthropic key is present
  // (the brain routes already return 503 BRAIN_NOT_CONFIGURED in that case).
  const llmRouter: MultiLLMRouter | null = process.env.ANTHROPIC_API_KEY
    ? (() => {
        try {
          return buildMultiLLMRouterFromEnv(aiCostLedger);
        } catch (err) {
          logger.warn('service-registry: buildMultiLLMRouterFromEnv failed — falling back to null', { value: err instanceof Error ? err.message : err });
          return null;
        }
      })()
    : null;

  // Wave 26 Agent Z4 — pre-built Anthropic client wrapped with withBudgetGuard.
  // Returned as a factory because the tenant context (used by the guard to
  // call `ledger.assertWithinBudget(tenantId)` before every HTTP call) is
  // only known at request time. Callers pass in the tenantId + optional
  // operation tag; the returned client is structurally identical to an
  // unguarded `AnthropicClient` so downstream services can't tell the
  // difference.
  const buildBudgetGuardedAnthropicClient = process.env.ANTHROPIC_API_KEY
    ? (tenantId: string, operation?: string): BudgetGuardedAnthropicClient => {
        const inner = createAnthropicClient({
          apiKey: process.env.ANTHROPIC_API_KEY as string,
          defaultModel: ModelTier.SONNET,
        });
        return withBudgetGuard(inner, {
          ledger: aiCostLedger,
          context: () =>
            operation !== undefined ? { tenantId, operation } : { tenantId },
          provider: 'anthropic',
        });
      }
    : null;

  // Wave 12 — Agent Certification (Postgres-backed). SigningSecret comes from
  // env; falls back to JWT_SECRET for operator convenience. In production,
  // refuse to boot if neither is set (no silent dev-default signing).
  const certSigningSecretFromEnv =
    process.env.AGENT_CERT_SIGNING_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';
  if (process.env.NODE_ENV === 'production' && certSigningSecretFromEnv.length < 32) {
    throw new Error(
      'AGENT_CERT_SIGNING_SECRET (or JWT_SECRET) must be set and >= 32 chars in production',
    );
  }
  const certSigningSecret =
    certSigningSecretFromEnv || 'dev-only-agent-cert-signing-secret-32chars';
  const certSqlRunner: CertSqlRunner = {
    async query<Row = Record<string, unknown>>(
      queryText: string,
      params?: readonly unknown[],
    ): Promise<{ rows: readonly Row[] }> {
      const rendered = sql.raw(
        interpolatePositionalSql(queryText, params ?? []),
      );
      const res = await (db as any).execute(rendered);
      const list = Array.isArray(res)
        ? (res as Row[])
        : ((res as { rows?: Row[] }).rows ?? []);
      return { rows: list };
    },
  };
  const certStore = new PostgresCertStore(certSqlRunner);
  const agentCertification = new AgentCertificationService(certStore, {
    signingSecret: certSigningSecret,
    issuerId: 'borjie-gateway',
  });

  // Adaptive Training — admin-driven, Mr. Mwikila-generated training paths.
  // Uses the in-memory repo for pilot (the Postgres adapter lives in the
  // training module and can be dropped in once the training tables are
  // migrated live). Mastery starts empty per process; the training delivery
  // service feeds progression back through its own BKT updates.
  const trainingRepo = createInMemoryTrainingRepository();
  const trainingGenerator = createTrainingGenerator({});
  const trainingMastery: MasteryPort = {
    async getMastery(_tenantId: string, _userId: string) {
      return {} as Record<string, number>;
    },
  };
  const trainingAssignmentService = createTrainingAssignmentService({
    repo: trainingRepo,
    eventBus: {
      async publish(evt) {
        await eventBus.publish({
          event: evt as unknown as never,
          version: 1,
          aggregateId: (evt.payload as { assignmentId?: string }).assignmentId ?? 'training',
          aggregateType: 'TrainingAssignment',
        });
      },
    },
    featureFlags: featureFlagsService
      ? {
          async isEnabled(tenantId: string, flag: string) {
            try {
              return await (featureFlagsService as unknown as {
                isEnabled(t: string, f: string): Promise<boolean>;
              }).isEnabled(tenantId, flag);
            } catch {
              return true;
            }
          },
        }
      : null,
  });
  const trainingDeliveryService = createTrainingDeliveryService({
    repo: trainingRepo,
    mastery: trainingMastery,
  });
  const training = createTrainingAdminEndpoints({
    generator: trainingGenerator,
    assignmentService: trainingAssignmentService,
    deliveryService: trainingDeliveryService,
    repo: trainingRepo,
  });

  // Wave 26 — Agent Z2: build the four newly-wired repos + services.
  // Every repo takes the shared drizzle client; services wrap the repos
  // and accept the shared event bus so emitted events flow through the
  // existing outbox/observability bridge.
  const subleaseRepo = new SubleaseNs.PostgresSubleaseRepository(
    db as unknown as SubleaseNs.PostgresSubleaseRepositoryClient,
  );
  const tenantGroupRepo = new SubleaseNs.PostgresTenantGroupRepository(
    db as unknown as SubleaseNs.PostgresTenantGroupRepositoryClient,
  );
  const subleaseService = new SubleaseNs.SubleaseService(
    subleaseRepo,
    tenantGroupRepo,
  );

  const damageDeductionRepo =
    new DamageDeductionNs.PostgresDamageDeductionRepository(
      db as unknown as DamageDeductionNs.PostgresDamageDeductionRepositoryClient,
    );
  // No evidence-bundle / AI-mediator gateway at this level — the service
  // falls back to a deterministic midpoint if ai-copilot isn't wired,
  // which matches the behaviour documented in the service itself.
  const damageDeductionService = new DamageDeductionNs.DamageDeductionService(
    damageDeductionRepo,
  );

  // Mining hard-fork wave 6 — property-domain
  // `PostgresConditionalSurveyRepository` is retired. The mining-domain
  // replacement (PostgresSitePreShiftInspectionRepository) is wired below.
  // The legacy `conditionalSurveyService` is built without a Postgres
  // adapter — its in-memory port is fine for the back-compat slot.
  // Downstream consumers that need persisted findings migrate to
  // `services.sitePreShiftInspection`.
  const conditionalSurveyRepo: PostgresConditionalSurveyRepository | null = null;
  const conditionalSurveyService: ConditionalSurveyService | null = null;

  // Mining-domain Wave 5 — site Field Asset Register persisting to
  // `assets` + `maintenance_events`. Replaces the property-domain
  // PostgresFarRepository (asset_components / far_assignments /
  // condition_check_events, all removed by migration 0003).
  //
  // The `/far` route now binds to the REAL mining FAR service over this
  // repo. The `far.repo` slot also carries the mining repo so the route's
  // root discoverability check + the repo-backed GET handlers
  // (`findAssetById` / `findDueScheduledMaintenance`) resolve against real
  // data rather than the retired property repo.
  const siteFarRepo = new PostgresSiteFarRepository(db);
  const farRepo = siteFarRepo;
  const farService = FarNs.createMiningFarService({
    repo: siteFarRepo,
    logger: createPinoLikeLogger('mining-far'),
  });

  // Mining hard-fork wave 6 — the seven mining-domain replacements for
  // the retired property-domain repositories. Each takes the shared
  // Drizzle client; their dedicated slots below let downstream routers
  // pull them via `services.<slot>`.
  const offtakeQueueRepo = new PostgresOfftakeQueueRepository(db);
  const workerIncentivesRepo = new PostgresWorkerIncentivesRepository(db);
  const sitePreShiftInspectionRepo =
    new PostgresSitePreShiftInspectionRepository(db);
  const oreGradingWeightsRepo = new DrizzleOreGradingWeightsRepository(db);
  const siteLiveMetricsSource = new DrizzleSiteLiveMetricsSource({ db });
  const siteSupervisorCoverageRepo =
    new PostgresSiteSupervisorCoverageRepository(db);
  const equipmentMaintenanceTaxonomyRepo =
    new DrizzleEquipmentMaintenanceTaxonomyRepository(db);
  // Mining maintenance-taxonomy service (REAL) — built over the repo just
  // constructed. Backs the `/maintenance-taxonomy` route; once this slot
  // is non-null the route's `if (!s) notImplemented` guard passes.
  const maintenanceTaxonomyService = createMiningMaintenanceTaxonomyService(
    equipmentMaintenanceTaxonomyRepo,
  );

  // Mining ADVISOR wave — stage-aware capability advisor (REAL) over the
  // Drizzle `StageAdvisorDb` adapter bound to the shared RLS-pinned client.
  // Reads org metrics + persisted hysteresis state from the `stage_advisor_*`
  // tables (migration 0295). Once this slot is non-null the `/api/v1/stage`
  // router resolves a live service. No trigger sink wired in this wave — the
  // route only generates/reads nudges; high-urgency fan-out is a follow-up.
  const stageAdvisor = createStageAdvisor({
    db: createDrizzleStageAdvisorDb(db),
  });

  // Wave 12 — Voice router. If neither ELEVENLABS_API_KEY nor OPENAI_API_KEY
  // is set, `voice` stays null and the HTTP router returns a clean 503
  // with a MISSING_KEY reason.
  const elevenKey = process.env.ELEVENLABS_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  let voice: VoiceRouter | null = null;
  if (elevenKey || openaiKey) {
    const providers: {
      elevenlabs?: ElevenLabsProvider;
      openai?: OpenAIVoiceProvider;
    } = {};
    if (elevenKey) {
      providers.elevenlabs = new ElevenLabsProvider({
        apiKey: elevenKey,
        defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? 'rachel',
      });
    }
    if (openaiKey) {
      providers.openai = new OpenAIVoiceProvider({ apiKey: openaiKey });
    }
    voice = createVoiceRouter({ providers, ledger: aiCostLedger });
  }

  // Central Command Phase A C6 / Phase B B2 — single cross-portal bus
  // instance reused across the registry. Captured here (before the
  // return) so the C2 adapters (killswitch fan-out, announcement
  // dispatcher) bind to the SAME bus instance the
  // `registry.crossPortalBus` slot exposes.
  const liveCrossPortalBus = createCrossPortalBus({
    redisUrl: process.env.REDIS_URL ?? null,
  });

  // Central Command Phase C C2 — wires B1's adapters (#2 + #3 + #4).
  // Each adapter is wired against the live cross-portal bus + the
  // shared in-process event bus + the Drizzle client.
  const killswitchFanoutPublisher = createKillswitchFanoutPublisher({
    crossPortalBus: liveCrossPortalBus,
    logger: createPinoLikeLogger('killswitch-fanout'),
  });
  const notificationDispatcherAdapter = createNotificationDispatcherAdapter({
    db,
    eventBus,
    crossPortalBus: liveCrossPortalBus,
    logger: {
      info: (obj, msg) =>
        logger.info('announcement-dispatcher', { arg0: msg ?? '', obj })
        ,
      warn: (obj, msg) =>
        logger.warn('announcement-dispatcher', { arg0: msg ?? '', obj })
        ,
    },
  });
  const recipientResolverAdapter = createRecipientResolverAdapter({
    db,
    logger: {
      warn: (obj, msg) =>
        logger.warn('recipient-resolver', { arg0: msg ?? '', obj })
        ,
    },
  });

  // Voice-agent wiring captured into a const (was an inline IIFE in the
  // returned object) so BOTH the `voiceAgent` slot AND the `aiNative`
  // wiring reuse the SAME agent instance — the voice capability the
  // `/ai-native` route exposes is identical to the `/voice-agent` one
  // (single brain-kernel, single VoiceTurnRepository).
  const voiceAgentWiring = (() => {
    const brainKernel = createBrainKernelWiring({
      buildBudgetGuardedAnthropicClient: buildBudgetGuardedAnthropicClient as unknown as Parameters<
        typeof createBrainKernelWiring
      >[0]['buildBudgetGuardedAnthropicClient'],
    });
    // Env-gated STT. `'null-port'` mode keeps the voice agent's graceful
    // VOICE_NOT_CONFIGURED path when no key is set (port stays null, same as
    // before); a configured key flips it onto real Whisper transcription.
    const sttPort = createSttProvider({
      unconfiguredMode: 'null-port',
      logger: {
        warn: (meta: object, msg: string) =>
          logger.warn('stt-provider', { arg0: msg, meta }),
      },
    }).port;
    return createVoiceAgentWiring({
      db,
      ...(brainKernel ? { kernelThink: brainKernel.think } : {}),
      ...(sttPort ? { stt: sttPort } : {}),
    });
  })();

  // TASK-AGENTS — bind the executor against the canonical registry + the
  // AI cost ledger + a curated bag of the real service instances that
  // exist as locals at this point. `AgentServicesBag` is
  // `Record<string, unknown>`; each agent reads its keys defensively and
  // the executor materialises a clean error outcome for any agent whose
  // helper deps are absent. Binding the executor turns on list/get/runs
  // immediately + every agent whose deps are present; the remaining
  // per-agent helper ports (notifications / exceptionInbox /
  // upcomingInvoicesLookup / inspection + arrears lookups / …) are a
  // documented follow-up wiring. The autonomy + budget guardrails still
  // run on every execution.
  const taskAgentServicesBag: Record<string, unknown> = {
    arrearsService,
    renewalService,
    migrationService,
    occupancyTimelineService,
    featureFlagsService,
    gdprService,
    aiCostLedger,
    eventBus,
  };
  const taskAgentExecutor = new TaskAgentExecutor({
    registry: TASK_AGENT_REGISTRY,
    services: taskAgentServicesBag,
    costLedger: aiCostLedger,
  });

  return {
    marketplace: {
      listing: listingService,
      enquiry: enquiryService,
      tender: tenderService,
    },
    // Mining-domain Wave 5 — legacy NegotiationService slot stays null
    // in the live registry (the mining bid-thread API is surfaced via
    // the dedicated `bidNegotiation` slot above). EnquiryService keeps
    // a transient throwing stub for back-compat.
    negotiation: null,
    waitlist: {
      service: waitlistService,
      vacancyHandler,
    },
    occupancyTimeline: occupancyTimelineService,
    stationMasterRouter,
    // Mining hard-fork wave 6 — coverage repo retired; replaced by
    // `siteSupervisorCoverage` slot.
    stationMasterCoverageRepo: null,
    renewal: renewalService,
    financialProfile: financialProfileService,
    riskReport: riskReportService,
    gamification: gamificationService,
    migration: migrationService,
    // R20 / KI-013 — null until prompt registry + provider registry +
    // review service are wired in the composition root (gated on
    // ANTHROPIC_API_KEY per OA-003). The migration router falls back to
    // the 501 / dev-flag path when this slot is null.
    migrationWizardCopilot: null,
    warehouse: warehouseService,
    maintenanceTaxonomy: maintenanceTaxonomyService,
    iot: iotService,
    featureFlags: featureFlagsService,
    gdpr: gdprService,
    aiCostLedger,
    // Mining ADVISOR wave — live stage-advisor (Drizzle-backed). Resolves
    // the `/api/v1/stage` route's `services.stageAdvisor`.
    stageAdvisor,
    // Wave-K W-Data — DSAR data source wired against the live Drizzle
    // client. The classification lookup is the same in-process registry
    // used by the scrubber middleware so RESTRICTED fields are tagged
    // consistently across log scrubbing + export annotations. Budget
    // composer is the in-memory adapter; swap to the Drizzle adapter
    // in a follow-up once the schema migration lands.
    dsarDataSource: createDsarDataSourceDrizzle({ db: db as unknown as never }),
    dsarClassifications: createDatabaseClassificationLookup(classifyDbColumn),
    // Wave-K Final Zero — RTBF executor wired against the same Drizzle
    // client. Replaces the prior {accepted: true} stub in the rtbf
    // handler. The executor walks every DSAR table inside a Drizzle
    // transaction and applies the per-table policy.
    dsarRtbfExecutor: createDsarRtbfExecutor({
      db: db as unknown as never,
    }),
    privacyBudgetComposer: createPrivacyBudgetComposerService(),
    llmRouter,
    buildBudgetGuardedAnthropicClient,
    // PO-port wave-5 wiring #2 — LLM budget governor. Live mode swaps
    // to the Postgres-backed store so per-tenant spend survives gateway
    // restarts (P76 BUG-HI-3 closure — was leaking the cap across
    // deploy / OOM / scale-down). Caps are seedable per-tenant via the
    // admin override helpers; the governor's `evaluateCall` is the
    // choke-point every llmRouter + Anthropic-client call must traverse
    // before reaching the provider.
    llmBudgetGovernor: createLLMBudgetGovernor({
      store: wireBudgetStore({ db }),
    }),
    arrears: {
      service: arrearsService,
      repo: arrearsRepo,
      ledgerPort: arrearsLedgerPort,
      entryLoader: arrearsEntryLoader,
    },
    // REMOVED (borjie hard-fork): the `cases` registry assignment.
    // `mcp` is filled in by `buildServices` after the registry is
    // constructed, because the MCP server takes the populated registry
    // as input. We place a `null` here and patch it post-return.
    mcp: null,
    agentCertification,
    training,
    voice,
    orgAwareness: buildOrgAwareness(eventBus),
    autonomy: {
      // Live mode: Postgres-backed repository so tenants' policies
      // survive restarts and every mutation is chained into the
      // audit table (Wave 11).
      policyService: new AutonomyPolicyService({
        repository: new PostgresAutonomyPolicyRepository(db),
      }),
    },
    branding: {
      // Wave 27 Agent E — tenant branding. In-memory repo for now;
      // Postgres-backed impl can replace this by matching the narrow
      // `TenantBrandingRepository` interface. Overrides are non-critical
      // (defaults resolve cleanly) so data loss on restart is acceptable.
      service: new TenantBrandingService(new InMemoryTenantBrandingRepository()),
    },
    headBriefing: {
      // Wave 28 — head briefing composer. Live mode still uses in-memory
      // sources for now; the composer's port-based design lets us swap
      // individual sources (AutonomousActionAudit, ApprovalGrantService,
      // StrategicAdvisor, KPI warehouse, ambient-brain anomaly miner)
      // in iteratively without touching the router or the endpoint
      // contract. ExceptionInbox is shared with the Wave-13 autonomy
      // escalation-inbox pattern — an empty in-memory repo here keeps
      // the section shaped even before the Postgres adapter lands.
      composer: buildHeadBriefingComposer(
        new ExceptionInbox({ repository: new InMemoryExceptionRepository() }),
        // LIVE mode — real Drizzle sources (overnight autonomy / pending
        // approvals / recent critical-incident anomalies).
        db,
      ),
    },
    juniorAI: (() => {
      // Wave 28 — junior-AI factory. In-memory repo; the autonomy-policy
      // loader delegates to the live PolicyService so provisioned
      // juniors inherit each tenant's actual policy, not a default.
      const livePolicyService = new AutonomyPolicyService({
        repository: new PostgresAutonomyPolicyRepository(db),
      });
      return {
        factoryService: new JuniorAIFactoryService({
          repository: new InMemoryJuniorAIRepository(),
          autonomyPolicyLoader: (tenantId: string) =>
            livePolicyService.getPolicy(tenantId),
        }),
      };
    })(),
    // Canonical Property Graph — Neo4j-backed. Builder returns null when
    // NEO4J_URI is unset; the graph router degrades to 503 so live-mode
    // gateways without a Neo4j upstream still boot cleanly.
    graph: { queryService: buildGraphQueryService() },
    // PO-port wave-5 wiring #1 / MEM-01 — six-layer cognitive memory v2. LIVE
    // mode now backs every layer with the Drizzle stores (migration 0312) when
    // a DB handle is present so episodes / arcs / skills / notes / topic shards
    // / cohort cache SURVIVE a process restart; the in-memory variant is the
    // no-DB fallback. The slot is always non-null so downstream consumers
    // (sleep-pass orchestrator, reflection workers) read shapes without
    // null-checks. Each Drizzle store implements the identical port, so no
    // consumer changes.
    memoryV2: buildMemoryV2(db),
    // PO-port wave-5 wiring #3 — OCSF emitter (secondary SIEM-egress
    // sink). Live mode picks up `OCSF_LOG_PATH` for the file-line sink;
    // syslog / HTTP forwarders land as follow-up sink adapters.
    ocsf: createOcsfBundle(),
    // PO-port wave-5 wiring #4 — cross-tenant denial recorder. Live mode
    // still uses the in-memory sink until a Drizzle-backed adapter lands
    // (follow-up wave-30 in #33). The recorder slot is
    // always non-null so `ensureTenantIsolation` and any other authz-
    // policy denial site can record without null-guards.
    crossOrgDenialRecorder: createCrossOrgDenialRecorderBundle(),
    // Ported-utilities batch 1 — 5 pure-function utility namespaces (same in
    // live mode; no I/O to swap to a Postgres adapter). Consumers pull
    // canonical surfaces via `registry.portedUtilities.<pkg>`.
    portedUtilities: createPortedUtilitiesBundle(),
    // Ported-domain batch 2 — 5 domain bundles (mcp-cost-persistence,
    // fairness-eval, analytics, knowledge-graph, compliance-pack).
    // Live mode is identical today; Neo4j-backed KG + per-tenant
    // compliance engines are follow-up wirings.
    portedDomain: createPortedDomainBundle(),
    // Ported-platform batch 3 — 5 platform bundles (security-hardening,
    // document-ai, progressive-intelligence, document-quality-guarantor,
    // audio-capture). Live mode is identical today; concrete OCR /
    // STT / WebAuthn ports land via follow-up wirings.
    portedPlatform: createPortedPlatformBundle(),
    // Ported-agent-stack batch 4 — 6 agent-stack bundles. Live mode identical
    // today; brain-dependent members instantiated per-tenant by their
    // consumers (brain port resolves at request time via the per-tenant
    // budget-guarded Anthropic client).
    portedAgentStack: createPortedAgentStackBundle(),
    // P75 follow-up — per-tenant brain-dependent agent-stack factory.
    // Live mode threads the budget-guarded Anthropic factory through
    // the bundle so every per-tenant brain call debits the right
    // tenant's cap. Cached LRU (100 tenants × 5 min TTL) so a single
    // assembly is reused across the brain's request lifetime.
    agentStack: createAgentStackBundle({
      buildBudgetGuardedAnthropicClient:
        (buildBudgetGuardedAnthropicClient as AgentStackBudgetGuardedAnthropicFactory | null),
      logger: { warn: createPinoLikeLogger('agent-stack').warn },
    }),
    // Central Intelligence — the concrete LLM adapter lives in a
    // separate service. `agent` is only populated when `CI_LLM_URL`
    // env var is set AND the adapter is wired (follow-up PR); until
    // then the router returns 503 INTELLIGENCE_SERVICE_UNAVAILABLE.
    // Memory uses the in-memory default so in-session threads work.
    // Follow-up wave-30 (#33): pgvector-backed ConversationMemory for prod.
    centralIntelligence: (() => {
      const memory = createInMemoryConversationMemory();
      const { sink, reader } = createInMemoryAuditSinkAndReader();
      const auditRecorder = createConversationAuditRecorder({
        sink,
        modelVersion: 'live-pending-llm',
      });
      // ProdFix-1 wires 4 + 5 — HQ tool registry composition.
      // Constructs the NIDA + e-Ardhi connectors (when env-configured)
      // and threads three lazy Temporal dispatchers in front of the
      // synchronously-built bundle promise. The brain-kernel wiring
      // below merges these tools into the kernel's tool registry so
      // every `platform.verify_nida` / `platform.suspend_licence` /
      // `platform.payout_owner` / `platform.file_kra_mri` call routes
      // through the real adapter when bound (and through the existing
      // deterministic placeholder refusal otherwise — see
      // NOT_YET_WIRED_REASON in @borjie/central-intelligence).
      // Wave-6 closure — thread the real in-process consolidation worker
      // into the HQ registry so `platform.run_consolidation_tick` STOPS
      // surfacing the `notYetWiredConsolidationRunner` refusal (which
      // THREW `NotYetWiredError` on the live brain path). The adapter
      // delegates to `runConsolidationForActiveTenants`, which is itself
      // resilient: when no Anthropic key is configured it returns a
      // zeroed summary rather than throwing — so the live tick degrades
      // to an honest no-op report instead of crashing. The `rollbackSnapshot`
      // path is intentionally left unsupported by the in-process runner
      // (it throws a clear "snapshot-capable worker" error which B1 maps
      // to executor-failed) — that is acceptable, not a live-crash.
      const consolidationWorker = createConsolidationWorkerAdapter({
        runner: {
          runForActiveTenants: (args) => {
            const targetTenantId: string | null = args.tenantId;
            const anthropic: ConsolidationAnthropicLike | null =
              buildBudgetGuardedAnthropicClient
                ? // Adapt the budget-guarded client's `.sdk.messages.create`
                  // surface onto the runner's flat `.messages.create` port.
                  (() => {
                    const guarded = buildBudgetGuardedAnthropicClient(
                      targetTenantId ?? '_platform',
                      'consolidation-tick',
                    );
                    return {
                      messages: {
                        create: (req) => guarded.sdk.messages.create(req as never),
                      },
                    } as ConsolidationAnthropicLike;
                  })()
                : null;
            return runConsolidationForActiveTenants(db, anthropic, {
              ...(targetTenantId
                ? {
                    // Tenant-scoped tick: restrict the active-scope
                    // discovery to (tenant, user) pairs that belong to
                    // this tenant. Null-tenant ticks fall through to the
                    // runner's default cross-tenant episodic discovery.
                    discoverScopes: () =>
                      discoverEpisodicScopesForTenant(db, targetTenantId, 14),
                  }
                : {}),
            });
          },
        },
        logger: {
          warn: (obj, msg) =>
            logger.warn('consolidation-worker-adapter', { arg0: msg ?? '', obj }),
        },
      });
      const hqPortBindings: HqToolPortBindings = createHqToolPortBindings({
        db,
        consolidationWorker,
        callerResolver: {
          // Placeholder resolver — real per-request principal binding
          // lives in the BFF router; the central-intelligence registry
          // boots with a service-level identity so the registry's
          // scope-aware caller checks succeed for ops endpoints. The
          // per-call principal is re-bound when the kernel dispatches
          // the tool (kernel-tool-pipeline overrides the caller ctx
          // with the in-flight request principal).
          resolve: () => ({
            callerId: 'api-gateway',
            scopes: ['platform:*'] as ReadonlyArray<string>,
          }),
        },
        logger: {
          info: (obj, msg) =>
            logger.info('hq-tool-port-bindings', { arg0: msg ?? '', obj })
            ,
          warn: (obj, msg) =>
            logger.warn('hq-tool-port-bindings', { arg0: msg ?? '', obj })
            ,
          error: (obj, msg) =>
            logger.error('hq-tool-port-bindings', { arg0: msg ?? '', obj })
            ,
        },
      });
      // Wave-K T1 — brain-kernel wiring with env-driven killswitch,
      // always-on decision-trace recorder, seeded tool registry, and
      // env-flagged uncertainty policy. Null when no Anthropic key
      // is configured — downstream wirings fall back to their
      // existing degraded paths transparently. On the LIVE path we
      // also thread the DB-backed approval-policy resolver + sensor-
      // routing service so the kernel's four-eye gate consults real
      // per-action policies and sensor adapters can later record per-
      // call telemetry to `sensor_call_log`.
      const brainKernel = createBrainKernelWiring({
        buildBudgetGuardedAnthropicClient: buildBudgetGuardedAnthropicClient as unknown as Parameters<
          typeof createBrainKernelWiring
        >[0]['buildBudgetGuardedAnthropicClient'],
        approvalPolicyResolver: createApprovalPolicyService(db),
        sensorRoutingService: createSensorRoutingService(db),
        hqToolRegistry: hqPortBindings.hqToolRegistry,
        // Phase F.3 — production-grade orchestrator hook chain. The
        // 9-hook PreToolUse / PostToolUse / Stop chain binds to real
        // Drizzle / `scrubPii` / approval-gate / sovereign-ledger
        // adapters so policy enforcement matches production posture
        // even before the LLM router + dispatcher adapter lands.
        orchestratorBindings: {
          db,
          tenantId: '_platform',
        },
      });
      // ── Multimodal Photo-Advisor Brain resolver injection ────────────────
      // Wire the per-tenant `BrainRegistry` into `routes/mining/brain-vision`
      // so `/api/v1/mining/brain/vision-turn` resolves a real multimodal Brain
      // instead of honest-503ing `BRAIN_NOT_CONFIGURED`. This reuses the EXACT
      // construction `routes/brain.hono.ts` uses (PostgresThreadStoreBackend +
      // createBrain + extra skills). Honest-degrade: `tryLoadBrainEnv` returns
      // null when Anthropic/Supabase creds are absent → we leave the resolver
      // unset and the route keeps its clean 503 (never a crash-on-boot). The
      // resolver's per-tenant `.for(...)` is lazy + wrapped so a tenant-level
      // construction fault surfaces as a null Brain → the route's own
      // `BRAIN_NOT_AVAILABLE` 503, not an unhandled throw.
      wireMultimodalBrainResolver(db);

      // ── Tier-2 Capability-Composition Engine injection ───────────────────
      // Wire the brain's self-architect into the owner chat-actions route so a
      // brain-generated unknown verb can be FULFILLED by a governed, composed
      // power-tool chain BEFORE deferring to a plain brain turn. Fire-and-forget
      // (async SDK load) — never blocks boot. CI-inert: when no Anthropic key is
      // present the engine slot stays unset and the deferToBrain path is
      // byte-for-byte unchanged. Any fault is swallowed internally.
      void wireCapabilityCompositionEngine();

      // CentralIntelligenceAgent slot — the `/intelligence/thread/:id/message`
      // surface (admin-web's "Talk to the industry" cross-tenant observer
      // chat) needs a concrete agent. The previous `CI_LLM_URL` env gate was
      // DEAD-CODED: both branches returned `agent: null`, so setting the env
      // var changed nothing and misled operators. We remove the misleading
      // gate. The slot stays an HONEST null — the router degrades cleanly with
      // a structured 503 INTELLIGENCE_SERVICE_UNAVAILABLE (never a crash or a
      // silent dead button) — and we WARN once so the degraded posture is
      // observable rather than hidden behind a never-true env check.
      //
      // Wiring the real local `createCentralIntelligenceAgent` needs four deps.
      // THREE are constructible in this scope today:
      //   - ConversationMemory   → `memory` above (createInMemoryConversationMemory)
      //   - VoiceResolver        → `createDefaultVoiceResolver()` (no required args)
      //   - agent-loop ToolRegistry → `createToolRegistry([...])`
      // The ONE genuinely-missing adapter is the streaming `LlmAdapter` (see
      // `@borjie/central-intelligence` agent-loop `AgentLoopDeps.llm`): it must
      // expose `stream({system,messages,tools,extendedThinking}) =>
      // AsyncIterable<LlmStreamChunk>` translating Anthropic's streaming +
      // tool-use protocol into the agent-loop chunk shape. NO concrete producer
      // of `LlmStreamChunk` exists anywhere in the repo (only the interface in
      // `types.ts`), so a correct adapter is a NEW non-trivial file that belongs
      // in `@borjie/central-intelligence` (NOT this composition root, and NOT
      // fabricatable from the kernel's single-shot sensor). We therefore keep
      // the HONEST null + 503 rather than ship a half-brain. See needsAttention.
      // This unblocks NO owner/MD chat — owner chat already works via
      // /mining/chat + /brain/teach and is unaffected by this slot.
      logger.warn(
        { wiring: 'central-intelligence-agent' },
        'central-intelligence: agent slot is intentionally null; ' +
          '/intelligence/thread message route degrades to 503 until the ' +
          'local CentralIntelligenceAgent (LlmAdapter+Voice+ToolRegistry) is wired',
      );
      return {
        agent: null,
        memory,
        auditReader: reader,
        auditRecorder,
        brainKernel,
      };
    })(),
    // Mining-domain Wave 5 — asset-grading adapters previously
    // bound to `tenant_grading_weights` + `asset_grade_snapshots`
    // (both removed by migration 0003). The mining ore-grading repo
    // (DrizzleOreGradingRepository) ships through the dedicated
    // `oreGrading` slot below; the legacy `assetGrading` slot stays
    // null in the live registry until follow-up batches retire it.
    assetGrading: null,
    // Tenant credit rating — FICO-scale 300-850 + CRB bands + portable
    // REMOVED (borjie hard-fork): credit-rating feature gone (router removed,
    // credit_rating_* tables dropped). Slot stays for null-guarded consumers.
    creditRating: null,
    // Wave 29 — forecasting (TGN + conformal). Only populated when
    // BOTH env vars are present. Otherwise the router returns 503
    // FORECAST_SERVICE_UNAVAILABLE. No mock / fallback forecaster
    // lives here — the package explicitly ships contracts, not
    // models.
    forecasting: (() => {
      const tgnUrl = process.env.TGN_INFERENCE_URL?.trim();
      const repoUrl = process.env.FORECASTING_REPO_URL?.trim();
      if (!tgnUrl || !repoUrl) {
        return { forecaster: null, featureExtractor: null, repository: null };
      }
      // The concrete TGN inference adapter, feature-extractor sources,
      // and repository adapter live in a follow-up deploy PR. We leave
      // the slot null even when env vars are set until those adapters
      // land, so the route still returns a clean 503 rather than a
      // partially-constructed forecaster. Flipping these to real
      // instances is an additive change only.
      return {
        forecaster: null,
        featureExtractor: null,
        repository: null,
      };
    })(),
    // Wave 26 — Agent Z2: four previously-unwired repos now live.
    sublease: {
      service: subleaseService,
      repo: subleaseRepo,
      tenantGroupRepo,
    },
    damageDeductions: {
      service: damageDeductionService,
      repo: damageDeductionRepo,
    },
    conditionalSurveys: {
      service: conditionalSurveyService,
      repo: conditionalSurveyRepo,
    },
    far: {
      service: farService,
      repo: farRepo,
    },
    // Wave WS-4 — platform billing (SaaS revenue). Non-null only when a
    // payment provider (STRIPE_SECRET_KEY) is configured; drives the platform
    // fee through the provider PORT + LedgerService.post(). Null otherwise.
    platformBilling: buildPlatformBilling(db),
    // Mining-domain Wave 5 — live bindings of the new mining repos
    // surfaced through dedicated slots. The corresponding legacy slots
    // (financialProfile / riskReport / negotiation / warehouse /
    // assetGrading / far) stay null until follow-up batches retire
    // their consumer surfaces.
    buyerFinancialProfile: buyerFinancialProfileRepo,
    buyerRiskReport: buyerRiskReportRepo,
    siteFar: siteFarRepo,
    bidNegotiation: bidNegotiationRepo,
    oreGrading: oreGradingRepo,
    oreWarehouse: oreStockpileRepo,
    // Mining hard-fork wave 6 — bindings of the seven new mining-domain
    // replacement repos. Their legacy slots (waitlist / gamification /
    // stationMasterCoverageRepo / maintenanceTaxonomy / conditionalSurveys /
    // renewal / assetGrading) stay null in the live registry; consumers
    // migrate to these slots.
    offtakeQueue: offtakeQueueRepo,
    workerIncentives: workerIncentivesRepo,
    sitePreShiftInspection: sitePreShiftInspectionRepo,
    oreGradingWeights: oreGradingWeightsRepo,
    siteLiveMetrics: siteLiveMetricsSource,
    siteSupervisorCoverage: siteSupervisorCoverageRepo,
    equipmentMaintenanceTaxonomy: equipmentMaintenanceTaxonomyRepo,
    // Wave 26 Z3 — Move-out checklist (step-based close-out workflow).
    // Postgres-backed via migration 0097. Null in degraded mode.
    moveOut: {
      service: new MoveOutChecklistService(new PostgresMoveOutRepository(db)),
    },
    // Wave 26 Z3 — Approval workflow. Request repo -> approval_requests (0097);
    // policy repo wraps approval_policies (0018) so per-tenant overrides kick
    // in transparently. Approver resolver left undefined for now — pending
    // user-directory port; service falls back gracefully.
    approvals: {
      service: new ApprovalWorkflowService(
        // Repo-interface pagination shape drifted (limit/offset vs
        // page/pageSize) across the domain-models upgrade. The service
        // itself is @ts-nocheck for the same reason; cast here to match.
        new PostgresApprovalRequestRepository(db) as unknown as never,
        new PostgresApprovalPolicyRepositoryAdapter(db) as unknown as never,
        eventBus,
      ),
    },
    // Drizzle-backed agent wirings — schemas + storage adapters shipped
    // in commits ea93ed6 / e33cebc; orchestrator + agents constructed
    // here against those adapters. External ports (LLM, MarketRate,
    // STT/TTS, reconciliation/statements/disbursement) are stub
    // adapters today so the registry is operable end-to-end without
    // external creds — concrete adapters land in follow-ups.
    monthlyClose: createMonthlyCloseWiring({
      db,
      eventBus,
      autonomyRepository: new PostgresAutonomyPolicyRepository(db),
    }),
    // Central-intelligence `BrainKernel` is constructed once per
    // gateway boot. When no Anthropic key is configured the wiring
    // returns null and the voice agent transparently falls back to
    // its degraded `VOICE_BRAIN_NOT_CONFIGURED` stub. When the kernel
    // is composed, every voice turn round-trips through the
    // disciplined 13-step pipeline (cache → inviolable → tier →
    // memory → cohort → persona → sensor failover → normalize →
    // judge → drift → policy → confidence → provenance).
    voiceAgent: voiceAgentWiring,
    // AINATIVE — `/ai-native` (4 PhL capabilities). REAL Anthropic compute
    // for dynamicPricing / docIntelligence / legalDrafter (present only
    // when an Anthropic key is configured via the budget-guarded client;
    // otherwise the route degrades per-capability to 503) + the durable
    // Drizzle voice agent reused from `voiceAgentWiring` above.
    aiNative: buildAiNativeServices({
      db,
      buildAnthropicClient: buildBudgetGuardedAnthropicClient,
      ledger: aiCostLedger,
      voiceAgentWiring,
    }),
    // TASK-AGENTS — the bound executor (registry + curated services bag +
    // cost ledger). Powers `/task-agents` list/get/run.
    taskAgentExecutor,
    // REMOVED (borjie hard-fork): marketSurveillance (property-era).
    predictiveInterventions: createPredictiveInterventionsWiring({ db }),
    // K7 parity-litfin Gap H — wake-loop cron supervisor. Inert until
    // `start()` is called in the gateway boot sequence; ticks the
    // kernel agency `runWakeCycle` every WAKE_LOOP_INTERVAL_MS (default
    // 15 minutes) under a cluster-wide pg advisory lock so replicas
    // never overlap.
    wakeLoopCron: createWakeLoopCronSupervisor({
      db,
      logger: createPinoLikeLogger('wake-loop-cron'),
      // Wave-K Tier-3 follow-up — bind the Drizzle-backed kernel-goals
      // service as the wake-loop's stall-scan repo. The service already
      // exposes `listStallScanTargets` + `markStalled`; the wake-loop's
      // port shape is structurally satisfied. When `db` is null the
      // supervisor degrades safely on its own.
      kernelGoalsRepo: createKernelGoalsService(db as never),
    }),
    // Wave-K Tier-3 — sovereign-ledger verify supervisor. Shares the
    // composition-root event bus so verdicts emit on the same channel
    // as the rest of the platform's observability events.
    sovereignLedgerVerifyCron: createSovereignLedgerVerifyCronSupervisor({
      db,
      eventBus: eventBus as unknown as NonNullable<
        Parameters<typeof createSovereignLedgerVerifyCronSupervisor>[0]['eventBus']
      >,
      logger: {
        info: (obj, msg) =>
          logger.info('sovereign-ledger-verify-cron', { arg0: msg ?? '', obj })
          ,
        warn: (obj, msg) =>
          logger.warn('sovereign-ledger-verify-cron', { arg0: msg ?? '', obj })
          ,
        error: (obj, msg) =>
          logger.error('sovereign-ledger-verify-cron', { arg0: msg ?? '', obj })
          ,
      },
    }),
    // Wave-K parity-litfin Gap C — capability dashboard wired against the
    // kernel-substrate tables (`kernel_provenance`, `kernel_cot_reservoir`).
    // Wave-6 closure: `rejudge` now threads a REAL budget-guarded judge
    // runner that scores the run's reasoning and persists the new
    // `judge_score` to `kernel_provenance`. When no Anthropic key is
    // configured the runner is null and `rejudge` returns an honest
    // `unavailable` outcome rather than a fake `queued: true` no-op.
    parityCapabilityDashboard: createParityCapabilityDashboard({
      db,
      judgeRunner: createParityJudgeRunner({
        // The budget-guarded client is structurally `{ defaultModel, sdk }`
        // — matching the wiring's `BudgetGuardedAnthropicLike`.
        buildBudgetGuardedAnthropicClient:
          buildBudgetGuardedAnthropicClient as unknown as Parameters<
            typeof createParityJudgeRunner
          >[0]['buildBudgetGuardedAnthropicClient'],
      }),
    }),
    // Central Command Phase A C6 / Phase B B2 — cross-portal bus. When
    // `REDIS_URL` is set the factory wires the Redis pubsub backend (two
    // ioredis connections — publisher + subscriber, per ioredis convention).
    // Otherwise the factory degrades to the in-memory bus so dev / pilot
    // continue to operate against the same `CrossPortalBus` surface.
    crossPortalBus: liveCrossPortalBus,
    // Idle-session emitter — DB-backed activity source bound to the
    // `sensorium_event_log` reader. Reflexion writes land on the
    // Drizzle-backed reflexion-buffer service. Inert until `.start()`.
    idleSessionEmitter: createIdleSessionEmitter({
      source: createSensoriumActiveSessionSource(db),
      reflexionWriter: createReflexionBufferService(db),
      logger: createPinoLikeLogger('idle-session-emitter'),
    }),
    // A2b-2 wires #8 + #9 — bind the AI audit-chain HMAC verifier
    // AND compose the full ai-copilot security suite. The supervisor's
    // verifier port expects `verifyRandomSample` + `verifyLedgerChain`;
    // the underlying `AuditHashChain` exposes `verifyRandomSample`
    // + `verifyChain`. We adapt the latter to the former so the chain
    // is the single source of truth for both this cron and any
    // downstream consumer (canary, cost breaker, observability).
    auditVerifyCron: (() => {
      const repo = createDrizzleAiAuditChainRepo(db);
      if (!repo) return null;
      const suite: SecuritySuite = createSecuritySuite({ auditRepo: repo });
      return createAuditVerifyCronSupervisor({
        verifier: {
          verifyRandomSample: (tenantId: string, p: number) =>
            suite.auditChain.verifyRandomSample(tenantId, p),
          verifyLedgerChain: (tenantId: string) =>
            suite.auditChain.verifyChain(tenantId),
        },
        db,
        eventBus: eventBus as unknown as NonNullable<
          Parameters<typeof createAuditVerifyCronSupervisor>[0]['eventBus']
        >,
        logger: createPinoLikeLogger('audit-verify-cron'),
      });
    })(),
    // Central Command Phase C C4 — session-replay retention purge.
    // Storage adapter slot is null at the registry level today (the
    // production `SessionReplayStoragePort` has no `delete()` yet — a
    // follow-up agent will wire it in). Worker degrades to DB-only
    // purge with a single-line WARN per process.
    sessionReplayRetention: createSessionReplayRetention({
      db: createDrizzlePurgeDb(db),
      storage: null,
      retentionDays: Number(
        process.env.SESSION_REPLAY_RETENTION_DAYS ?? '90',
      ) || 90,
      logger: {
        info: (obj, msg) =>
          logger.info('session-replay-retention', { arg0: msg ?? '', obj })
          ,
        warn: (obj, msg) =>
          logger.warn('session-replay-retention', { arg0: msg ?? '', obj })
          ,
      },
    }),
    // Central Command Phase C C2 — B1 wiring closures. The fan-out
    // publisher + dispatcher adapter bridge B1's optional `killswitch`
    // and `announcement` ports onto the live cross-portal bus + event
    // bus. The recipient resolver counts active users via Drizzle. All
    // three are read by `buildHqDepsFromDb` (see `hq-tool-registry.ts`)
    // so every `platform.set_killswitch` + `platform.send_announcement`
    // tool call fans out automatically.
    killswitchFanoutPublisher,
    notificationDispatcherAdapter,
    recipientResolverAdapter,
    eventBus,
    db,
    isLive: true,
    // P38 — live mode: Drizzle-backed adapters wired by default (each
    // port can be forced back to in-memory via its
    // `PERSISTENT_*_DISABLED` env flag). The middleware reads the same
    // shape as degraded mode so `c.set('lessonStore', ...)` is uniform.
    persistentStores: createPersistentStores({ db }),
    // P54 — live mode: production path picks up Supabase env when set,
    // otherwise falls back to LocalStorageProvider transparently.
    documentStorage: createDocumentStorageWiring(),
    // Phase D D7 — persona registry starts as null in the live object
    // literal; `buildServices` patches it asynchronously after
    // construction, mirroring the `mcp` post-construction patch pattern.
    personaRegistry: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/* eslint-disable-next-line no-secrets/no-secrets */
/**
 * Env-driven kill-switch for the agency executor's sovereign-tier
 * audit-write policy (W-FailClosed, wave-k-final-zero).
 *
 * - `SOVEREIGN_LEDGER_FAIL_CLOSED=true|1|yes|on` -> fail-closed.
 *   When the hash-chained sovereign action ledger cannot be written
 *   on a sovereign-tier action (tenant eviction, owner payout, KRA
 *   MRI, GePG control-number revocation, market-rate-band override,
 *   inspection-as-major-damage), the executor flips the step
 *   outcome to `failed` with reason `sovereign-audit-write-failed`.
 *   The tool's external side-effects are NOT un-executed — a
 *   compensating-action workflow (out of scope here; tracked in
 *   #33 — "Sovereign-ledger reconciliation") must
 *   reconcile them.
 * - Anything else (unset / `false` / `0` / `no` / `off` / empty) →
 *   fail-open (legacy W-Agency behaviour: log-and-continue).
 *
 * Exported so the agency-executor composition root
 * (`./sovereign.ts -> agencyKernel.createExecutor`) can read a
 * single canonical value rather than re-parsing the env at every
 * boot. The flag is read at composition time; restart required for
 * a value change to take effect.
 */
export const SOVEREIGN_LEDGER_FAIL_CLOSED_ENV =
  'SOVEREIGN_LEDGER_FAIL_CLOSED';

export function readSovereignLedgerFailClosedFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[SOVEREIGN_LEDGER_FAIL_CLOSED_ENV];
  if (raw === undefined || raw === null) return false;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return false;
  return (
    trimmed === 'true' ||
    trimmed === '1' ||
    trimmed === 'yes' ||
    trimmed === 'on'
  );
}

function interpolatePositionalSql(
  sqlText: string,
  params: readonly unknown[],
): string {
  return sqlText.replace(/\$(\d+)/g, (_m, idxStr: string) => {
    const v = params[Number(idxStr) - 1];
    return encodeLiteral(v);
  });
}

function encodeLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : 'NULL';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}
