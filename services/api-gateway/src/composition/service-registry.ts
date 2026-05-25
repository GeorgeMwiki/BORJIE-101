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
/**
 * The `DatabaseClient` type alias from `@borjie/database` resolves
 * as a namespace when pulled through the package barrel (TS2709) due
 * to `export *` chains widening the symbol space after the Wave 7
 * Drizzle 0.36 upgrade. We derive the type directly from the factory
 * function instead so composition-root callers never have to reach
 * for the alias.
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
import { sql } from 'drizzle-orm';
import {
  ListingService,
  EnquiryService,
  TenderService,
  PostgresMarketplaceListingRepository,
  PostgresTenderRepository,
  PostgresBidRepository,
} from '@borjie/domain-services/marketplace';
import {
  NegotiationService,
  PostgresNegotiationPolicyRepository,
  PostgresNegotiationRepository,
  PostgresNegotiationTurnRepository,
} from '@borjie/domain-services/negotiation';
import {
  WaitlistService,
  WaitlistVacancyHandler,
  PostgresWaitlistRepository,
  PostgresWaitlistOutreachRepository,
} from '@borjie/domain-services/waitlist';
import {
  OccupancyTimelineService,
  PostgresOccupancyTimelineRepository,
} from '@borjie/domain-services/occupancy';
import {
  StationMasterRouter,
  PostgresStationMasterCoverageRepository,
} from '@borjie/domain-services/routing';
import {
  RenewalService,
  PostgresRenewalRepository,
  MoveOutChecklistService,
} from '@borjie/domain-services/lease';
// Wave 26 Z3 — rich ApprovalWorkflowService + Postgres adapters for
// move-out checklists and approval requests. Pairs with migration 0097.
import { ApprovalWorkflowService } from '@borjie/domain-services/approvals';
import { PostgresMoveOutRepository } from './move-out-repository.js';
import {
  PostgresApprovalRequestRepository,
  PostgresApprovalPolicyRepositoryAdapter,
} from './approval-request-repository.js';
import {
  FinancialProfileService,
  PostgresFinancialStatementRepository,
  PostgresLitigationRepository,
  RiskReportService,
  PostgresRiskReportRepository,
  PostgresRiskReportInputsProvider,
  DeterministicRiskNarrator,
} from '@borjie/domain-services/customer';
import {
  createGamificationService,
  PostgresGamificationRepository,
} from '@borjie/domain-services/gamification';
import {
  MigrationService,
  PostgresMigrationRepository,
} from '@borjie/domain-services/migration';
import {
  CaseService,
  PostgresCaseRepository,
} from '@borjie/domain-services/cases';
import { InMemoryEventBus, type EventBus } from '@borjie/domain-services';

// Wave 8 — Warehouse inventory (S7), Maintenance taxonomy (S7), IoT (S3).
import {
  createWarehouseService,
  DrizzleWarehouseRepository,
  type WarehouseService,
} from '@borjie/domain-services/warehouse';
import {
  createMaintenanceTaxonomyService,
  DrizzleMaintenanceTaxonomyRepository,
  type MaintenanceTaxonomyService,
} from '@borjie/domain-services/maintenance-taxonomy';
import {
  createIotService,
  type IotService,
} from '@borjie/domain-services/iot';
import { createPropertyGradingAdapters } from '@borjie/domain-services/property-grading';
// Wave 29 — forecasting package (TGN + conformal). The concrete
// inference / repository adapters live in external services; the slot
// below stays null until their env vars are set, and the router
// returns 503 FORECAST_SERVICE_UNAVAILABLE in that case.
import type {
  Forecaster,
  FeatureExtractor,
  ForecastRepository,
} from '@borjie/forecasting';
import { PropertyGrading } from '@borjie/ai-copilot';
type PropertyGradingService = import('@borjie/ai-copilot').PropertyGrading.PropertyGradingService;
import {
  createCreditRatingService,
  type CreditRatingService,
} from '@borjie/ai-copilot';
import { PostgresCreditRatingRepository } from './credit-rating-repository.js';
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
} from '@borjie/database';
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
import type { BossnyumbaMcpServer } from '@borjie/mcp-server';
import { buildMcpServer } from './mcp-wiring.js';
import {
  createClassroomService,
  type ClassroomService,
} from './classroom-wiring.js';
import {
  createMonthlyCloseWiring,
  type MonthlyCloseWiring,
} from './monthly-close-wiring.js';
import {
  createVoiceAgentWiring,
  type VoiceAgentWiring,
} from './voice-agent-wiring.js';
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
import {
  createMarketSurveillanceWiring,
  type MarketSurveillanceWiring,
} from './market-surveillance-wiring.js';
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
// Follow-up wave-30 (Docs/TODO_BACKLOG.md): swap in pgvector-backed ConversationMemory for prod.
import {
  createInMemoryConversationMemory,
  createInMemoryAuditSinkAndReader,
  createConversationAuditRecorder,
  type CentralIntelligenceAgent,
  type ConversationMemory,
  type ConversationAuditReader,
  type ConversationAuditRecorder,
} from '@borjie/central-intelligence';
// PO-port wave-5 wiring #1 — six-layer cognitive memory (episodic, narrative,
// procedural, reflective, topic-files, cohort cache). Lives ALONGSIDE the
// existing single-layer `ConversationMemory` (which the streaming kernel
// still consumes). MemoryV2 surfaces the richer cognitive substrate that
// future sleep-pass orchestrators + reflection jobs will read/write.
// In-memory variant ships in degraded mode + as the live-mode default until
// pgvector-backed adapters land.
import {
  createInMemoryMemoryV2,
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
// LITFIN-port wave wiring (Batch 1 — 5 utility namespaces).
// Bundles audit-hash-chain + memory-tool-wire-adapter + probe-runners +
// property-voices-debate + conformal-calibration-online so consumers
// can pull canonical pure-function surfaces via DI rather than reaching
// for the raw packages from arbitrary callsites.
import {
  createLitfinUtilitiesBundle,
  type LitfinUtilitiesBundle,
} from './litfin-utilities-wiring.js';
// LITFIN-port wave wiring (Batch 2 — 5 domain bundles).
// Bundles mcp-cost-persistence + fairness-eval + analytics +
// knowledge-graph + compliance-pack. Analytics + KG ship pre-wired
// in-memory instances; the others are DI-exposed namespaces (their
// instantiation needs per-tenant brain / collectors which the
// composition root cannot bind statically).
import {
  createLitfinDomainBundle,
  type LitfinDomainBundle,
} from './litfin-domain-wiring.js';
// LITFIN-port wave wiring (Batch 3 — 5 platform bundles).
// Bundles security-hardening + document-ai + progressive-intelligence +
// document-quality-guarantor + audio-capture. Each ships a pre-wired
// facade with safe defaults (in-memory stores / mock ports) plus the
// raw namespace export so consumers can swap in concrete adapters.
import {
  createLitfinPlatformBundle,
  type LitfinPlatformBundle,
} from './litfin-platform-wiring.js';
// LITFIN-port wave wiring (Batch 4 — 6 agent-stack bundles).
// Bundles agent-runtime + mcp + agent-orchestrator + open-coding-agent-
// patterns + openclaw-operating-model + agentic-os. Brain-dependent
// members are namespace-only (no safe defaults without an LLM key);
// the OpenClaw operating-model facade is pre-wired async via a
// Promise slot (same pattern as cross-portal bus).
import {
  createLitfinAgentStackBundle,
  type LitfinAgentStackBundle,
} from './litfin-agent-stack-wiring.js';
// P75 follow-up — per-tenant brain-dependent agent-stack assembly. The
// LITFIN bundle exposes namespaces only because the brain port must be
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
type PostgresConditionalSurveyRepository = InstanceType<
  typeof ConditionalSurveyNs.PostgresConditionalSurveyRepository
>;
type ConditionalSurveyService = InstanceType<
  typeof ConditionalSurveyNs.ConditionalSurveyService
>;
type PostgresFarRepository = InstanceType<typeof FarNs.PostgresFarRepository>;
type FarService = InstanceType<typeof FarNs.FarService>;

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
  readonly stationMasterCoverageRepo: PostgresStationMasterCoverageRepository | null;
  readonly renewal: RenewalService | null;
  readonly financialProfile: FinancialProfileService | null;
  readonly riskReport: RiskReportService | null;
  readonly gamification: ReturnType<typeof createGamificationService> | null;
  readonly migration: MigrationService | null;

  /** Wave 8 additions — all three are pure-DB. */
  readonly warehouse: WarehouseService | null;
  readonly maintenanceTaxonomy: MaintenanceTaxonomyService | null;
  readonly iot: IotService | null;

  /** Wave 9 enterprise polish — feature flags, GDPR, AI cost ledger. */
  readonly featureFlags: FeatureFlagsService | null;
  readonly gdpr: GdprService | null;
  readonly aiCostLedger: CostLedger | null;

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

  /** Cases — dispute / legal / maintenance case lifecycle. Wave 26 wiring
   *  of the previously-dark PostgresCaseRepository + CaseService +
   *  CaseSLAWorker triad. `service` is the domain service (used by
   *  routers + SLA worker); `repo` is the Postgres adapter (exposed for
   *  routers that need raw reads without the service overhead). Both
   *  null in degraded mode. */
  readonly cases: {
    readonly service: CaseService | null;
    readonly repo: PostgresCaseRepository | null;
  };

  /** Wave 12 — AI copilot subsystems wired into the composition root. */
  readonly mcp: BossnyumbaMcpServer | null;
  readonly agentCertification: AgentCertificationService | null;
  readonly classroom: ClassroomService | null;
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

  /** Property grading — A–F report card scoring + portfolio rollup.
   *  Postgres-backed in live mode, null when DATABASE_URL is unset. */
  readonly propertyGrading: PropertyGradingService | null;

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
   *  Follow-up wave-30 (Docs/TODO_BACKLOG.md): swap `memory` to pgvector-backed adapter.
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
   * LITFIN-port batch 1 — 5 utility namespaces exposed via DI.
   *
   * Always non-null in both degraded + live modes (every member is a
   * pure-function surface). Consumers reach for `litfinUtilities.<pkg>.<fn>`
   * to avoid scattering raw package imports across the codebase. The
   * downstream consumers per package:
   *   - `auditHashChain` — sovereign + tenant + decision audit
   *     streams (cron verifier, sleep-pass governance audit)
   *   - `memoryToolWireAdapter` — Anthropic Memory Tool envelope for
   *     the BrainKernel ↔ topic-files memory boundary
   *   - `probeRunners` — sycophancy + defection probe schedulers (eval
   *     workers + CI gate)
   *   - `propertyVoicesDebate` — three-voice debate preset for
   *     contested decisions (pricing, eviction, deposit deductions)
   *   - `conformalCalibrationOnline` — adaptive α-update for the
   *     forecasting confidence interval calibrator
   */
  readonly litfinUtilities: LitfinUtilitiesBundle;

  /**
   * LITFIN-port batch 2 — 5 domain bundles exposed via DI.
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
  readonly litfinDomain: LitfinDomainBundle;

  /**
   * LITFIN-port batch 3 — 5 platform-domain bundles exposed via DI.
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
  readonly litfinPlatform: LitfinPlatformBundle;

  /**
   * LITFIN-port batch 4 — 6 agent-stack bundles exposed via DI.
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
  readonly litfinAgentStack: LitfinAgentStackBundle;

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

  /** Wave 26 — Fitness-for-Assessment Review (FAR): asset components,
   *  monitoring assignments, and condition-check events. */
  readonly far: {
    readonly service: FarService | null;
    readonly repo: PostgresFarRepository | null;
  };

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

  /** Market-rate surveillance agent — Drizzle-backed snapshot
   *  persistence + stub MarketRatePort. `listActiveUnits` returns []
   *  until the units adapter lands (the surveillance loop no-ops
   *  cleanly). */
  readonly marketSurveillance: MarketSurveillanceWiring | null;

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

/**
 * Build a head-briefing composer backed by in-memory stub sources.
 *
 * Wave 28 ships the composer + its source-port contract only. The real
 * adapters (AutonomousActionAudit, ApprovalGrantService.listActive,
 * ExceptionInbox.listOpen, KPI warehouse, StrategicAdvisor, anomaly
 * pattern-miner) can be swapped in iteratively by overriding individual
 * dependencies on the returned composer deps shape. Until then every
 * request returns a shaped-but-empty BriefingDocument, which is the
 * pilot-acceptable behaviour for a brand-new endpoint.
 */
function buildHeadBriefingComposer(
  exceptionInbox: ExceptionInbox | null,
): HeadBriefing.BriefingComposer {
  const overnightSource: HeadBriefing.OvernightSource = {
    async summarize() {
      return {
        totalAutonomousActions: 0,
        byDomain: {},
        notableActions: [],
      };
    },
  };
  const pendingApprovalsSource: HeadBriefing.PendingApprovalsSource = {
    async list() {
      return { count: 0, items: [] };
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
    async list() {
      return [];
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
    warehouse: null,
    maintenanceTaxonomy: null,
    iot: null,
    featureFlags: null,
    gdpr: null,
    aiCostLedger: null,
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
        logger: { warn: (meta, msg) => console.warn('llm-budget:', msg ?? '', meta) },
      }),
    }),
    arrears: {
      service: null,
      repo: null,
      ledgerPort: null,
      entryLoader: null,
    },
    cases: {
      service: null,
      repo: null,
    },
    mcp: null,
    agentCertification: null,
    classroom: null,
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
    // LITFIN-port batch 1 — 5 pure-function utility namespaces. Always
    // wired (no I/O). Consumers (sleep-pass, probe cron, debate gate,
    // ACI calibrator) pull from this bundle via DI.
    litfinUtilities: createLitfinUtilitiesBundle(),
    // LITFIN-port batch 2 — 5 domain bundles (mcp-cost-persistence,
    // fairness-eval, analytics, knowledge-graph, compliance-pack).
    // Always wired; in-memory facade for analytics + KG.
    litfinDomain: createLitfinDomainBundle(),
    // LITFIN-port batch 3 — 5 platform bundles (security-hardening,
    // document-ai, progressive-intelligence, document-quality-guarantor,
    // audio-capture). Always wired; pre-wired facades with safe
    // defaults; namespaces exposed for follow-up port wiring.
    litfinPlatform: createLitfinPlatformBundle(),
    // LITFIN-port batch 4 — 6 agent-stack bundles (agent-runtime, mcp,
    // agent-orchestrator, open-coding-agent-patterns, openclaw-
    // operating-model, agentic-os). Always wired; brain-dependent
    // members are namespace-only; openclaw ships an async pre-wired
    // facade with auto-seeded shipped domains.
    litfinAgentStack: createLitfinAgentStackBundle(),
    // P75 follow-up — per-tenant brain-dependent agent-stack factory.
    // Degraded mode has no Anthropic key wiring, so the bundle hands
    // back a stack with `brain: null`. The factory still exposes the
    // bound `agentRuntimeFactory` so projects that only need filesystem
    // discovery (slash + sub-agents + skills) keep working.
    agentStack: createAgentStackBundle({
      buildBudgetGuardedAnthropicClient: null,
      logger: { warn: (meta, msg) => console.warn('agent-stack:', msg ?? '', meta) },
    }),
    // Central Intelligence — no concrete LLM adapter ships here (it
    // lives in a separate service). In degraded mode we still wire the
    // in-memory memory so thread listing works locally.
    // Follow-up wave-30 (Docs/TODO_BACKLOG.md): replace with pgvector-backed ConversationMemory.
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
    propertyGrading: null,
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
    // Wave 26 Z3 — move-out + approvals wiring.
    moveOut: { service: null },
    approvals: { service: null },
    // Drizzle-backed agent wirings — null in degraded mode (DATABASE_URL
    // unset). Each consumer router/scheduler tolerates the null slot.
    monthlyClose: null,
    voiceAgent: null,
    marketSurveillance: null,
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
  (registry as { mcp: BossnyumbaMcpServer | null }).mcp = buildMcpServer(
    registry,
    registry.agentCertification,
  );
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

  // Negotiation repos
  const policyRepo = new PostgresNegotiationPolicyRepository(db);
  const negotiationRepo = new PostgresNegotiationRepository(db);
  const turnRepo = new PostgresNegotiationTurnRepository(db);

  // Negotiation service (shared by marketplace enquiry + tenders/bids)
  const negotiationService = new NegotiationService({
    policyRepo,
    negotiationRepo,
    turnRepo,
    eventBus,
  });

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

  // Waitlist
  const waitlistRepo = new PostgresWaitlistRepository(db);
  const outreachRepo = new PostgresWaitlistOutreachRepository(db);
  const waitlistService = new WaitlistService({ repo: waitlistRepo, eventBus });
  // Vacancy handler requires an OutreachDispatcher; for pilot we inject a
  // no-op dispatcher so GET endpoints work and the POST trigger-outreach
  // endpoint succeeds without actually sending. Wire to the real NBA
  // queue in a follow-up.
  const noopDispatcher = {
    async dispatch() {
      return null;
    },
  };
  const vacancyHandler = new WaitlistVacancyHandler({
    repo: waitlistRepo,
    outreachRepo,
    eventBus,
    dispatcher: noopDispatcher,
  });

  // Gamification
  const gamificationRepo = new PostgresGamificationRepository(db);
  const gamificationService = createGamificationService({
    repo: gamificationRepo,
  });

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

  // Station Master Coverage (NEW 18) — router + coverage repo for applications.
  const stationMasterCoverageRepo = new PostgresStationMasterCoverageRepository(
    db
  );
  const stationMasterRouter = new StationMasterRouter({
    repository: stationMasterCoverageRepo,
  });

  // Lease Renewal workflow — Postgres-backed over leases table.
  const renewalRepo = new PostgresRenewalRepository(db);
  const renewalService = new RenewalService(renewalRepo, eventBus);

  // Financial Profile + Risk Reports (SCAFFOLDED-5, NEW-13).
  const financialStatementRepo = new PostgresFinancialStatementRepository(db);
  const litigationRepo = new PostgresLitigationRepository(db);
  const financialProfileService = new FinancialProfileService(
    financialStatementRepo,
    litigationRepo,
    eventBus,
    null // no bank-reference provider wired yet — service returns a structured
         // PROVIDER_ERROR instead of crashing on verify-bank-reference
  );
  const riskReportRepo = new PostgresRiskReportRepository(db);
  const riskReportInputsProvider = new PostgresRiskReportInputsProvider(db);
  const riskReportService = new RiskReportService(
    riskReportRepo,
    riskReportInputsProvider,
    new DeterministicRiskNarrator()
  );

  // Wave 8 — Warehouse (S7): stock + movements.
  const warehouseRepo = new DrizzleWarehouseRepository(db);
  const warehouseService = createWarehouseService({ repo: warehouseRepo });

  // Wave 8 — Maintenance Taxonomy (S7): platform defaults + tenant overrides.
  const taxonomyRepo = new DrizzleMaintenanceTaxonomyRepository(db);
  const maintenanceTaxonomyService = createMaintenanceTaxonomyService({
    repo: taxonomyRepo,
  });

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

  // Wave 26 — Cases domain service + Postgres repo. The repo implements
  // `Partial<CaseRepository>` with the surface the SLA worker + service
  // need (createCase/findById/update/findOverdue/appendTimelineEvent)
  // backed by the real `cases` table. The service publishes the
  // CaseCreated/Escalated/Resolved event stream through the shared
  // composition-root bus so downstream subscribers (notifications,
  // autonomy audit) see them without any extra wiring.
  //
  // The Postgres adapter advertises `Partial<CaseRepository>` but
  // implements every method actually invoked by the service + worker
  // (verified in postgres-case-repository.test.ts). We cast to the
  // full interface at the composition-root boundary only.
  const caseRepo = new PostgresCaseRepository(db as unknown as never);
  const caseService = new CaseService(
    caseRepo as unknown as Parameters<typeof CaseService['prototype']['attachRepository']>[0],
    eventBus,
  );

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
          context: () => ({ tenantId, operation }),
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

  // Wave 12 — Classroom (BKT-backed with Postgres persistence).
  const classroom = createClassroomService(db);

  // Adaptive Training — sits on top of classroom BKT and uses the in-memory
  // repo for pilot (the Postgres adapter lives in the training module and
  // can be dropped in once the training tables are migrated live).
  const trainingRepo = createInMemoryTrainingRepository();
  const trainingGenerator = createTrainingGenerator({});
  const trainingMastery: MasteryPort = {
    async getMastery(tenantId: string, userId: string) {
      const rows = (await classroom.getMastery(tenantId, userId)) ?? [];
      const map: Record<string, number> = {};
      for (const r of rows as ReadonlyArray<{ conceptId: string; pKnow: number }>) {
        map[r.conceptId] = r.pKnow;
      }
      return map;
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

  const conditionalSurveyRepo =
    new ConditionalSurveyNs.PostgresConditionalSurveyRepository(
      db as unknown as ConditionalSurveyNs.PostgresConditionalSurveyRepositoryClient,
    );
  const conditionalSurveyService =
    new ConditionalSurveyNs.ConditionalSurveyService(
      conditionalSurveyRepo,
      eventBus,
    );

  const farRepo = new FarNs.PostgresFarRepository(
    db as unknown as FarNs.PostgresFarRepositoryClient,
  );
  const farService = new FarNs.FarService(farRepo, eventBus);

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
    logger: {
      info: (obj, msg) => console.info('killswitch-fanout:', msg ?? '', obj),
      warn: (obj, msg) => console.warn('killswitch-fanout:', msg ?? '', obj),
    },
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

  return {
    marketplace: {
      listing: listingService,
      enquiry: enquiryService,
      tender: tenderService,
    },
    negotiation: negotiationService,
    waitlist: {
      service: waitlistService,
      vacancyHandler,
    },
    occupancyTimeline: occupancyTimelineService,
    stationMasterRouter,
    stationMasterCoverageRepo,
    renewal: renewalService,
    financialProfile: financialProfileService,
    riskReport: riskReportService,
    gamification: gamificationService,
    migration: migrationService,
    warehouse: warehouseService,
    maintenanceTaxonomy: maintenanceTaxonomyService,
    iot: iotService,
    featureFlags: featureFlagsService,
    gdpr: gdprService,
    aiCostLedger,
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
    cases: {
      service: caseService,
      repo: caseRepo,
    },
    // `mcp` is filled in by `buildServices` after the registry is
    // constructed, because the MCP server takes the populated registry
    // as input. We place a `null` here and patch it post-return.
    mcp: null,
    agentCertification,
    classroom,
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
    // PO-port wave-5 wiring #1 — six-layer cognitive memory v2. Live mode
    // also runs in-memory until pgvector / Drizzle store adapters land
    // (follow-up). The slot is always non-null so downstream consumers
    // (sleep-pass orchestrator, reflection workers) can read shapes
    // without null-checks.
    memoryV2: createInMemoryMemoryV2(),
    // PO-port wave-5 wiring #3 — OCSF emitter (secondary SIEM-egress
    // sink). Live mode picks up `OCSF_LOG_PATH` for the file-line sink;
    // syslog / HTTP forwarders land as follow-up sink adapters.
    ocsf: createOcsfBundle(),
    // PO-port wave-5 wiring #4 — cross-tenant denial recorder. Live mode
    // still uses the in-memory sink until a Drizzle-backed adapter lands
    // (follow-up wave-30 in Docs/TODO_BACKLOG.md). The recorder slot is
    // always non-null so `ensureTenantIsolation` and any other authz-
    // policy denial site can record without null-guards.
    crossOrgDenialRecorder: createCrossOrgDenialRecorderBundle(),
    // LITFIN-port batch 1 — 5 pure-function utility namespaces (same in
    // live mode; no I/O to swap to a Postgres adapter). Consumers pull
    // canonical surfaces via `registry.litfinUtilities.<pkg>`.
    litfinUtilities: createLitfinUtilitiesBundle(),
    // LITFIN-port batch 2 — 5 domain bundles (mcp-cost-persistence,
    // fairness-eval, analytics, knowledge-graph, compliance-pack).
    // Live mode is identical today; Neo4j-backed KG + per-tenant
    // compliance engines are follow-up wirings.
    litfinDomain: createLitfinDomainBundle(),
    // LITFIN-port batch 3 — 5 platform bundles (security-hardening,
    // document-ai, progressive-intelligence, document-quality-guarantor,
    // audio-capture). Live mode is identical today; concrete OCR /
    // STT / WebAuthn ports land via follow-up wirings.
    litfinPlatform: createLitfinPlatformBundle(),
    // LITFIN-port batch 4 — 6 agent-stack bundles. Live mode identical
    // today; brain-dependent members instantiated per-tenant by their
    // consumers (brain port resolves at request time via the per-tenant
    // budget-guarded Anthropic client).
    litfinAgentStack: createLitfinAgentStackBundle(),
    // P75 follow-up — per-tenant brain-dependent agent-stack factory.
    // Live mode threads the budget-guarded Anthropic factory through
    // the bundle so every per-tenant brain call debits the right
    // tenant's cap. Cached LRU (100 tenants × 5 min TTL) so a single
    // assembly is reused across the brain's request lifetime.
    agentStack: createAgentStackBundle({
      buildBudgetGuardedAnthropicClient:
        (buildBudgetGuardedAnthropicClient as AgentStackBudgetGuardedAnthropicFactory | null),
      logger: { warn: (meta, msg) => console.warn('agent-stack:', msg ?? '', meta) },
    }),
    // Central Intelligence — the concrete LLM adapter lives in a
    // separate service. `agent` is only populated when `CI_LLM_URL`
    // env var is set AND the adapter is wired (follow-up PR); until
    // then the router returns 503 INTELLIGENCE_SERVICE_UNAVAILABLE.
    // Memory uses the in-memory default so in-session threads work.
    // Follow-up wave-30 (Docs/TODO_BACKLOG.md): pgvector-backed ConversationMemory for prod.
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
      // every `platform.verify_nida` / `platform.evict_tenant` /
      // `platform.payout_owner` / `platform.file_kra_mri` call routes
      // through the real adapter when bound (and through the existing
      // deterministic placeholder refusal otherwise — see
      // NOT_YET_WIRED_REASON in @borjie/central-intelligence).
      const hqPortBindings: HqToolPortBindings = createHqToolPortBindings({
        db,
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
        buildBudgetGuardedAnthropicClient,
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
      const llmUrl = process.env.CI_LLM_URL?.trim();
      if (!llmUrl) {
        return {
          agent: null,
          memory,
          auditReader: reader,
          auditRecorder,
          brainKernel,
        };
      }
      // Adapter not shipped in-tree — the gateway consumes it over
      // HTTP from a dedicated service. Slot stays null until the
      // adapter lands; router keeps returning 503 cleanly.
      return {
        agent: null,
        memory,
        auditReader: reader,
        auditRecorder,
        brainKernel,
      };
    })(),
    // Property grading — Mr. Mwikila's A–F report card system.
    // Adapters live in domain-services (Postgres wiring); the service
    // class lives in ai-copilot (pure business logic). We compose here.
    propertyGrading: (() => {
      const adapters = createPropertyGradingAdapters(db);
      return new PropertyGrading.PropertyGradingService({
        metricsSource: adapters.metricsSource,
        weightsRepo: adapters.weightsRepo,
        snapshotRepo: adapters.snapshotRepo,
      });
    })(),
    // Tenant credit rating — FICO-scale 300-850 + CRB bands + portable
    // certificate. Postgres-backed repository pulls real invoice /
    // payment / tenancy data — zero mocks.
    creditRating: createCreditRatingService({
      repo: new PostgresCreditRatingRepository(db),
    }),
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
    voiceAgent: (() => {
      const brainKernel = createBrainKernelWiring({
        buildBudgetGuardedAnthropicClient,
      });
      return createVoiceAgentWiring({
        db,
        ...(brainKernel ? { kernelThink: brainKernel.think } : {}),
      });
    })(),
    marketSurveillance: createMarketSurveillanceWiring({ db }),
    predictiveInterventions: createPredictiveInterventionsWiring({ db }),
    // K7 parity-litfin Gap H — wake-loop cron supervisor. Inert until
    // `start()` is called in the gateway boot sequence; ticks the
    // kernel agency `runWakeCycle` every WAKE_LOOP_INTERVAL_MS (default
    // 15 minutes) under a cluster-wide pg advisory lock so replicas
    // never overlap.
    wakeLoopCron: createWakeLoopCronSupervisor({
      db,
      logger: {
        info: (obj, msg) => console.info('wake-loop-cron:', msg ?? '', obj),
        warn: (obj, msg) => console.warn('wake-loop-cron:', msg ?? '', obj),
        error: (obj, msg) => console.error('wake-loop-cron:', msg ?? '', obj),
      },
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
      eventBus,
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
    // Reads only; rejudge is a tier-3 stub that returns a queued verdict.
    parityCapabilityDashboard: createParityCapabilityDashboard({ db }),
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
      logger: {
        info: (obj, msg) => console.info('idle-session-emitter:', msg ?? '', obj),
        warn: (obj, msg) => console.warn('idle-session-emitter:', msg ?? '', obj),
      },
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
        eventBus,
        logger: {
          info: (obj, msg) => console.info('audit-verify-cron:', msg ?? '', obj),
          warn: (obj, msg) => console.warn('audit-verify-cron:', msg ?? '', obj),
          error: (obj, msg) => console.error('audit-verify-cron:', msg ?? '', obj),
        },
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
 *   Docs/TODO_BACKLOG.md — "Sovereign-ledger reconciliation") must
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
