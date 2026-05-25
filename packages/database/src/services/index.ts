/**
 * Service-level orchestration on top of repositories.
 */

export {
  MigrationWriterService,
  type ExtractedBundle,
  type WriterReport,
  type WriterRowOutcome,
  type WriterOptions,
  type PropertyDraft,
  type UnitDraft,
  type TenantDraft,
  type EmployeeDraft,
  type DepartmentDraft,
  type TeamDraft,
} from './migration-writer.service.js';

// Brain kernel substrate — Drizzle-backed sinks for the central
// intelligence kernel's CoT reservoir, persona drift, and provenance.
export {
  createKernelSubstrateService,
  type KernelSubstrateService,
  type KernelSinkScope,
  type CotSampleShape,
  type PersonaDriftShape,
  type ProvenanceShape,
} from './kernel-substrate.service.js';

// Kernel memory — Drizzle-backed prior-turns loader and recent-user-
// turn counter for the central intelligence kernel. Reads thread_events
// (the brain's existing conversation log) — read-only, never mutates.
export {
  createKernelMemoryService,
  type KernelMemoryService,
  type KernelMemoryDeps,
  type KernelPriorTurn,
} from './kernel-prior-turns.service.js';

// Kernel grounding — Drizzle-backed GroundingFactsProvider that reads
// occupancy, active leases, open work-orders, and lease-expiry counts.
// Triggered by user-message keywords; produces tenant-scoped facts the
// kernel mixes into the system prompt as grounding evidence.
export {
  createKernelGroundingProvider,
  type GroundingFactShape,
  type GroundingFactsProviderShape,
  type GroundingViewRole,
  type KernelGroundingDeps,
} from './kernel-grounding.service.js';

// Kernel cohort — Drizzle-backed TenantAggregateSource for the
// graph-privacy DP aggregator. Composed at the api-gateway sovereign
// composition root; reads cross-tenant arrears / collections /
// renewals / maintenance-TTC. Returns per-tenant per-statistic
// contributions; missing data ⇒ empty array (the aggregator handles
// that path safely). Port shape duck-typed locally so this package
// does not compile-time-depend on @borjie/graph-privacy.
export {
  createPgTenantAggregateSource,
  type TenantAggregateSourceShape,
  type ContributionsArgs,
  type PlatformSliceShape,
} from './kernel-cohort.service.js';

// Platform privacy-budget ledger — Drizzle-backed PlatformBudgetLedger
// (port duck-typed locally; see platform-budget-ledger.service.ts).
// Composed at the api-gateway sovereign composition root in place of
// the in-memory ledger so cohort DP-aggregator budget consumption
// survives api-gateway restarts. Backed by migration 0116.
export {
  createPgPlatformBudgetLedger,
  PrivacyBudgetExhaustedError,
  type PlatformBudgetLedgerShape,
  type PgBudgetLedgerDeps,
} from './platform-budget-ledger.service.js';

// Currency rates — Drizzle-backed FX normaliser used by the
// platform-overview HQ KPI router. Loads ISO-4217 → USD snapshots
// from `currency_rates` (migration 0117) and converts mixed-currency
// payment sums into a single USD total. Unknown codes contribute 0
// with a soft warn — never throws on lookup misses.
export {
  createCurrencyRatesService,
  type CurrencyRate,
  type CurrencySum,
  type CurrencyRatesService,
} from './currency-rates.service.js';

// Persona branding — Drizzle-backed persistence for per-tenant
// kernel-persona overrides (displayName / openingPreamble / voice
// profile id). Adapts to the kernel's PersonaBrandingResolver port at
// the api-gateway sovereign composition root. Migration 0118.
export {
  createPersonaBrandingService,
  type PersonaBrandingShape,
  type PersonaBrandingService,
} from './persona-branding.service.js';

// Currency preferences — per-user / per-tenant / platform-default
// display-currency choice. Resolution chain: user → tenant → platform.
// Built for the world, starting with TZ — operators add new currencies
// via the table without code changes. Migration 0119.
export {
  createCurrencyPreferencesService,
  type CurrencyPreferenceRow,
  type CurrencyPreferenceScopeKind,
  type CurrencyPreferencesService,
  type ResolvePreferenceArgs,
  type ResolvedCurrency,
} from './currency-preferences.service.js';

// Market data cache — Drizzle-backed TTL cache for external market-
// data adapter responses (Zillow, Airbnb, Rentometer, etc.). Composed
// at the api-gateway sovereign composition root and handed to the
// adapter factories so repeated kernel queries within the TTL window
// don't hammer the upstream provider. Migration 0120.
export {
  createMarketDataCacheService,
  type MarketDataCacheEntry,
  type MarketDataCacheService,
} from './market-data-cache.service.js';

// Kernel memory hierarchy — LITFIN-style four-tier memory ABOVE the
// existing thread_events transport. The kernel reads semantic facts +
// the latest reflective digest at step 4 (memory recall) and writes
// episodic rows at step 13 (provenance write). Migration 0121.
//
// NB: this set of services exposes ONLY the read+write surface. Fact
// extraction (semantic), pattern observation (procedural), and digest
// generation (reflective) are the consolidation cycle agent's
// responsibility — that runs in a separate composition root.
export {
  createEpisodicMemoryService,
  type EpisodicEntry,
  type EpisodicKind,
  type EpisodicMemoryService,
  type EpisodicRecallArgs,
  type EpisodicRecordArgs,
} from './kernel-memory-episodic.service.js';
export {
  createSemanticMemoryService,
  DeclaredFactsCapExceededError,
  DECLARED_FACTS_PER_USER_CAP,
  type DecayArgs,
  type LookupArgs,
  type SearchArgs,
  type SemanticFact,
  type SemanticMemoryService,
  type SemanticSource,
  type UpsertFactArgs,
} from './kernel-memory-semantic.service.js';
export {
  createProceduralMemoryService,
  type MatchArgs,
  type ProceduralMemoryService,
  type ProceduralPattern,
  type RecordArgs as ProceduralRecordArgs,
} from './kernel-memory-procedural.service.js';
export {
  createReflectiveMemoryService,
  type LatestArgs,
  type ReflectiveDigest,
  type ReflectiveDigestInput,
  type ReflectiveMemoryService,
  type ReflectivePeriodKind,
  type ReflectiveTopicCount,
} from './kernel-memory-reflective.service.js';

// Kernel feedback (migration 0122) — online-learning signal store.
// Captures thumbs / corrections / flags per kernel turn so the kernel
// can read its own per-user rollup at step 4 (memory recall) and bias
// the next turn toward conservative, citation-heavy output when the
// recent negative-rate is elevated. Closes the "stock LLMs are STATIC"
// assessment gap.
export {
  createFeedbackService,
  type FeedbackEntry,
  type FeedbackRollup,
  type FeedbackService,
  type FeedbackSignal,
  type RecallArgs as FeedbackRecallArgs,
  type RollupArgs as FeedbackRollupArgs,
} from './kernel-feedback.service.js';

// Kernel agency (migration 0123) — Drizzle-backed GoalsPort +
// ActionAuditSink. The kernel reads ACTIVE goals at step 4 (memory
// recall) and the wake-loop opens new goals through the same service.
// The audit sink is append-only.
export {
  createKernelGoalsService,
  type Goal as KernelGoal,
  type GoalListArgs as KernelGoalListArgs,
  type GoalMetrics as KernelGoalMetrics,
  type GoalOpenArgs as KernelGoalOpenArgs,
  type GoalPriority as KernelGoalPriority,
  type GoalStatus as KernelGoalStatus,
  type GoalStep as KernelGoalStep,
  type GoalStepDraft as KernelGoalStepDraft,
  type GoalStepStatus as KernelGoalStepStatus,
  type GoalUpdateStepArgs as KernelGoalUpdateStepArgs,
  type KernelGoalsService,
} from './kernel-goals.service.js';
export {
  createKernelActionAuditService,
  type ActionAuditDecision as KernelActionAuditDecision,
  type ActionAuditEntry as KernelActionAuditEntry,
  type KernelActionAuditService,
} from './kernel-action-audit.service.js';

// Sovereign action ledger (migration 0129) — hash-chained agency-side
// audit ledger of EXECUTED sovereign-tier actions. Append-only +
// tamper-evident; verifyLedgerChain re-derives every row's hash.
// Closes LITFIN parity Gap C in .planning/parity-litfin/07-agency.md.
export {
  createSovereignActionLedgerService,
  computeRowHash as computeSovereignLedgerRowHash,
  hashPayload as hashSovereignLedgerPayload,
  GENESIS_HASH as SOVEREIGN_LEDGER_GENESIS_HASH,
  type SovereignActionLedgerService,
  type SovereignLedgerAppendArgs,
  type SovereignLedgerAppendResult,
  type SovereignLedgerRow,
  type SovereignLedgerVerifyResult,
} from './sovereign-action-ledger.service.js';

// Per-tenant autonomy policy reader (migration 0080 — autonomy_policies).
// Adapts to the kernel-agency `AutonomyPolicyPort` shape; falls back to
// default-allow-low-stakes whenever the row is missing, autonomous mode
// is disabled, the policy_json is malformed, or the DB query throws.
export {
  createPgAutonomyPolicyService,
  defaultAllowLowStakes as defaultAllowLowStakesAutonomy,
  type AutonomyPolicyDecideArgs,
  type AutonomyPolicyDecision,
  type AutonomyStakes,
  type PgAutonomyPolicyService,
} from './autonomy-policy.service.js';

// Voice-turn log (migration 0110) — Drizzle-backed adapter for the
// voice-agent's `VoiceTurnRepository` shape. Duck-typed so the database
// package does not compile-time-depend on `@borjie/ai-copilot`.
export {
  createVoiceTurnsService,
  type VoiceToolCallShape,
  type VoiceTurnRowShape,
  type VoiceTurnsService,
} from './voice-turns.service.js';

// Market-rate snapshots (migration 0103) — Drizzle-backed adapter for
// the market-surveillance agent's snapshot persistence. `listActiveUnits`
// is composed elsewhere from the occupancy/units repository.
export {
  createMarketRateSnapshotsService,
  type DriftFlag,
  type ListRecentArgs as MarketRateListRecentArgs,
  type MarketRateSnapshotShape,
  type MarketRateSnapshotsService,
} from './market-rate-snapshots.service.js';

// Tenant predictions + intervention opportunities (migration 0106) —
// Drizzle-backed adapter for the predictive-interventions agent.
// `listActiveTenants` is composed elsewhere from occupancy/lease repos.
export {
  createTenantPredictionsService,
  type InterventionOpportunityShape,
  type InterventionStatus,
  type PredictionHorizonDays,
  type TenantPredictionShape,
  type TenantPredictionsService,
} from './tenant-predictions.service.js';

// Monthly close runs + steps (migration 0099 — Wave 28 PhA2) —
// Drizzle-backed adapter for the MonthlyCloseOrchestrator's RunStorePort.
// (tenantId, period_year, period_month) uniqueness is enforced at the
// schema layer; recordStep idempotency on (run_id, step_name).
export {
  createMonthlyCloseRunsService,
  type CreateRunArgs as MonthlyCloseCreateRunArgs,
  type Decision as MonthlyCloseDecision,
  type MonthlyCloseRunsService,
  type RecordStepArgs as MonthlyCloseRecordStepArgs,
  type RunPatch as MonthlyCloseRunPatch,
  type RunStateShape as MonthlyCloseRunStateShape,
  type RunStatus as MonthlyCloseRunStatus,
  type StepRecordShape as MonthlyCloseStepRecordShape,
  type Trigger as MonthlyCloseTrigger,
} from './monthly-close-runs.service.js';

// Sensor routing control plane (migration 0126, LITFIN-parity Wave K) —
// Drizzle-backed adapter for the multi-LLM router. Records every sensor
// attempt to `sensor_call_log` with the outcome enum so dashboards can
// split availability / cost / refusal failure modes; debits the matching
// period envelope in `tenant_budget_envelopes`. `selectSensorChain`
// returns the builtin (task, tenant-tier) → ordered chain — stays
// read-only by default so wiring into the live router is a follow-up.
export {
  createSensorRoutingService,
  type SensorRoutingService,
  type RecordSensorCallArgs,
  type BudgetStatus,
  type SensorChainVerdict,
  type SensorChoice,
  type TenantTier,
} from './sensor-routing.service.js';

// Approval policy (migration 0128, K5 parity) — declarative four-eye policy
// table for sovereign-tier kernel tools. Per-tenant rows override the
// platform-default row; both fall back to the kernel baseline. Carries
// role-group quorum, max-stale-minutes, recall-window, and re-auth
// requirements. Adapts to the kernel's `ApprovalPolicyPort` shape; the
// kernel's `four-eye-approval.ts` hands `resolve()` to the gate so each
// proposed action loads its declarative policy at propose-time.
export {
  createApprovalPolicyService,
  defaultBaseline as defaultApprovalPolicyBaseline,
  type ApprovalPolicyResolveArgs,
  type ApprovalPolicyService,
  type ApprovalPolicyUpsertArgs,
  type ResolvedApprovalPolicy,
} from './approval-policy.service.js';

// Privacy-budget composer (migration 0130, parity K6.2) — unified
// (ε, δ) refusal gate that sums per-tenant + platform DP spend over a
// 30-day rolling window. Closes parity-gap G2 (alternating-surface
// attack against the two independent ledgers). Hard caps: platform
// (5.0, 1e-5), pro (10.0, 1e-5), enterprise (50.0, 1e-5). The default
// repository is in-memory; production composition roots wire a
// Drizzle-backed adapter against privacy_budget_ledger.
export {
  createPrivacyBudgetComposerService,
  InMemoryPrivacyBudgetRepository as InMemoryPrivacyBudgetComposerRepository,
  PrivacyBudgetExceededError,
  PRIVACY_BUDGET_TIER_CAPS,
  PRIVACY_BUDGET_WINDOW_DAYS,
  type BudgetAvailability,
  type CheckBudgetArgs,
  type PrivacyBudgetComposerConfig,
  type PrivacyBudgetComposerService,
  type PrivacyBudgetRepository as PrivacyBudgetComposerRepository,
  type PrivacyBudgetTier,
  type PrivacyBudgetWindow,
  type RecordSpendArgs,
  type RemainingBudget,
} from './privacy-budget-composer.service.js';

// Voyager skill registry (migration 0133 — C5 Phase A). Adapter for the
// kernel's `SkillRetrieverPort` (in `@borjie/central-intelligence`).
// Production composition wires this; tests pass in-memory fakes.
export {
  createSkillRegistryService,
  type ListByTenantArgs as SkillListByTenantArgs,
  type RecordOutcomeArgs as SkillRecordOutcomeArgs,
  type SearchByEmbeddingArgs as SkillSearchByEmbeddingArgs,
  type SkillRegistryService,
  type SkillRow,
  type SkillRowWithSimilarity,
  type SkillStatus,
  type UpsertSkillArgs as SkillUpsertArgs,
} from './skill-registry.service.js';

// Reflexion buffer (migration 0134 — C5 Phase A). Adapter for the
// kernel's `ReflexionBufferPort`. Reads the last N reflections at
// session start, writes one row at session end.
export {
  createReflexionBufferService,
  type RecallReflexionsArgs,
  type RecordReflexionArgs,
  type ReflexionBufferService,
  type ReflexionEntry,
  type ReflexionOutcome,
} from './reflexion-buffer.service.js';

// Implicit feedback signals (migration 0135 — C5 Phase A). Adapter for
// the sensorium's downstream signal store. Joined to traces by
// `(trace_id, agent_action_id, tenant_id, user_id, surface, role)`.
export {
  createImplicitFeedbackSignalsService,
  type ImplicitFeedbackRollup,
  type ImplicitFeedbackSignalsService,
  type ImplicitSignal,
  type ImplicitSignalType,
  type ListByTraceArgs as ImplicitFeedbackListByTraceArgs,
  type ListForUserArgs as ImplicitFeedbackListForUserArgs,
  type RecordSignalArgs as ImplicitFeedbackRecordArgs,
  type RollupForTenantArgs as ImplicitFeedbackRollupArgs,
} from './implicit-feedback-signals.service.js';

// Sensorium event log (migration 0132 — C4 Phase A, Central Command).
// Drizzle-backed append-only store for the 14-event sensory taxonomy
// emitted by the client-side sensory bus in admin-web.
// The server-side `BehaviorObserver` (packages/ai-copilot) aggregates
// rolling-window event histograms here into signals the brain consumes
// at memory-recall time.
export {
  createSensoriumEventLogService,
  type CountByTypeArgs as SensoriumCountByTypeArgs,
  type ListForSessionArgs as SensoriumListForSessionArgs,
  type SensoriumEventInput,
  type SensoriumEventLogService,
  type SensoriumEventRow,
} from './sensorium-event-log.service.js';

// Agency run checkpoints (migration 0136, C6 Phase A — Central Command).
// Durable substrate for the agency executor. The durable runner (api-
// gateway composition) writes one checkpoint row per (run_id, step_index)
// so retries + crash-recovery + operator-resumable goals work without a
// third-party orchestrator. Phase A in-tree implementation; Phase B may
// promote to a real Inngest dashboard.
export {
  createAgencyRunCheckpointsService,
  type AgencyCheckpointRow,
  type AgencyCheckpointState,
  type AgencyRunCheckpointsService,
  type ListStuckRunningArgs as AgencyCheckpointListStuckArgs,
  type RecordPendingArgs as AgencyCheckpointRecordPendingArgs,
} from './agency-run-checkpoints.service.js';

// ─────────────────────────────────────────────────────────────────────
// Central Command Phase B — HQ-tier platform.* tool adapters (B1).
// One adapter per HQ port (12 tools total). Composition root wires
// these onto `seedHqBrainTools` deps in the C2 hq-tool-registry.
// Tier 1 (must-ship): tenants, users, feature-flags, killswitch.
// Tier 2 (ship-if-time): heartbeat, decision-trace, consolidation,
// invoice, announcement.
// ─────────────────────────────────────────────────────────────────────

export {
  createPlatformTenantsService,
  type PlatformTenantsService,
  type ListTenantsArgs as PlatformTenantsListArgs,
  type ListTenantsResult as PlatformTenantsListResult,
  type ListTenantsRow as PlatformTenantsListRow,
  type CreateTenantArgs as PlatformTenantsCreateArgs,
  type CreateTenantResult as PlatformTenantsCreateResult,
  type RollbackTenantArgs as PlatformTenantsRollbackArgs,
} from './platform/tenants.platform.service.js';

export {
  createPlatformUsersService,
  type PlatformUsersService,
  type ListUsersArgs as PlatformUsersListArgs,
  type ListUsersResult as PlatformUsersListResult,
  type ListUsersRow as PlatformUsersListRow,
  type CreateUserArgs as PlatformUsersCreateArgs,
  type CreateUserResult as PlatformUsersCreateResult,
  type HqUserRole as PlatformUsersHqRole,
  type HqUserStatus as PlatformUsersHqStatus,
} from './platform/users.platform.service.js';

export {
  createPlatformFeatureFlagsService,
  type PlatformFeatureFlagsService,
  type FeatureFlagValue as PlatformFeatureFlagValue,
  type FeatureFlagsDeps as PlatformFeatureFlagsDeps,
  type ReadFeatureFlagResult as PlatformReadFeatureFlagResult,
  type SetFeatureFlagArgs as PlatformSetFeatureFlagArgs,
  type SetFeatureFlagResult as PlatformSetFeatureFlagResult,
  type RestoreFlagArgs as PlatformRestoreFlagArgs,
} from './platform/feature-flags.service.js';

export {
  createPlatformKillswitchWriteService,
  type PlatformKillswitchWriteService,
  type KillswitchDeps as PlatformKillswitchDeps,
  type KillswitchLevel as PlatformKillswitchLevel,
  type KillswitchReasonCode as PlatformKillswitchReasonCode,
  type WriteKillswitchArgs as PlatformWriteKillswitchArgs,
  type SetKillswitchResult as PlatformSetKillswitchResult,
  type RestoreKillswitchArgs as PlatformRestoreKillswitchArgs,
} from './platform/killswitch-write.service.js';

export {
  createServiceHeartbeatService,
  type ServiceHealthRow as PlatformServiceHealthRow,
  type ServiceHealthState as PlatformServiceHealthState,
  type ServiceHeartbeatDeps as PlatformServiceHeartbeatDeps,
  type ServiceHeartbeatService as PlatformServiceHeartbeatService,
} from './platform/service-heartbeat.service.js';

export {
  createDecisionTraceQueryService,
  type DecisionTraceQueryArgs as PlatformDecisionTraceQueryArgs,
  type DecisionTraceQueryService as PlatformDecisionTraceQueryService,
  type DecisionTraceRecorderLike as PlatformDecisionTraceRecorderLike,
  type DecisionTraceRow as PlatformDecisionTraceRow,
} from './platform/decision-trace-query.service.js';

export {
  createConsolidationRunnerService,
  type ConsolidationRunArgs as PlatformConsolidationRunArgs,
  type ConsolidationRunnerService as PlatformConsolidationRunnerService,
  type ConsolidationTickReport as PlatformConsolidationTickReport,
  type ConsolidationWorkerLike as PlatformConsolidationWorkerLike,
} from './platform/consolidation-runner.service.js';

export {
  createPlatformInvoiceAdjustmentService,
  type AdjustmentResult as PlatformInvoiceAdjustmentResult,
  type ApplyAdjustmentArgs as PlatformApplyInvoiceAdjustmentArgs,
  type InvoiceAdjustmentCategory as PlatformInvoiceAdjustmentCategory,
  type InvoiceSnapshot as PlatformInvoiceSnapshot,
  type PlatformInvoiceAdjustmentService,
  type ReverseAdjustmentArgs as PlatformReverseInvoiceAdjustmentArgs,
} from './platform/invoice-adjustment.service.js';

export {
  createPlatformAnnouncementService,
  type AnnouncementChannel as PlatformAnnouncementChannel,
  type AnnouncementDeps as PlatformAnnouncementDeps,
  type NotificationDispatcherLike as PlatformNotificationDispatcherLike,
  type PlatformAnnouncementService,
  type RecallAnnouncementArgs as PlatformRecallAnnouncementArgs,
  type RecipientResolverLike as PlatformRecipientResolverLike,
  type SendAnnouncementArgs as PlatformSendAnnouncementArgs,
  type SendAnnouncementResult as PlatformSendAnnouncementResult,
} from './platform/announcement.service.js';

// Temporal entity graph (migration 0140, B4 Phase B — Central Command).
// Zep / Graphiti-style bi-temporal knowledge graph plus Louvain
// community detection (arxiv 0803.0476). Powers the consolidation
// worker's stage 06 — merges duplicate entities, partitions the
// tenant subgraph into communities, and back-references the
// community_id on every entity + relationship for retrieval-time
// summarisation.
export {
  createTemporalEntityGraphService,
  type ConsolidateForTenantArgs as TemporalGraphConsolidateArgs,
  type ConsolidateMergeReport as TemporalGraphConsolidateReport,
  type InvalidateEntityArgs as TemporalGraphInvalidateEntityArgs,
  type ListEntitiesArgs as TemporalGraphListEntitiesArgs,
  type ListRelationshipsArgs as TemporalGraphListRelationshipsArgs,
  type TemporalEntityGraphService,
  type TemporalEntityRow,
  type TemporalRelationshipRow,
  type UpsertEntityArgs as TemporalGraphUpsertEntityArgs,
  type UpsertRelationshipArgs as TemporalGraphUpsertRelationshipArgs,
} from './temporal-entity-graph.service.js';
export {
  detectCommunitiesLouvain,
  type LouvainEdge,
  type LouvainInput,
  type LouvainNode,
  type LouvainPartition,
} from './temporal-entity-graph.louvain.js';

// Semantic bulk re-embedder (migration 0141, B4 Phase B — Central
// Command). Powers the consolidation worker's stage 07 — iterates
// `kernel_memory_semantic` in chunks, re-embeds rows whose
// `last_embedded_at` is older than the active model version, and
// stamps the column so a crash + restart resumes where the previous
// run left off.
export {
  createSemanticBulkReEmbedService,
  type BulkReEmbedder,
  type ReEmbedForTenantArgs as SemanticBulkReEmbedArgs,
  type ReEmbedReport as SemanticBulkReEmbedReport,
  type SemanticBulkReEmbedService,
} from './semantic-bulk-reembed.service.js';

// Core memory blocks (migration 0151, D8 — Letta-style self-summary).
export {
  createCoreMemoryBlocksService,
  renderCoreMemoryBlocks,
  type CoreMemoryBlock,
  type CoreMemoryBlockKind,
  type CoreMemoryBlocksService,
  type UpsertCoreMemoryBlockArgs,
  type ListActiveCoreMemoryBlocksArgs,
} from './core-memory-blocks.service.js';

// Consolidation emissions (migration 0152, D8 — morning digest publish).
export {
  createConsolidationEmissionsService,
  type ConsolidationEmission,
  type ConsolidationEmissionsService,
  type RecordConsolidationEmissionArgs,
  type ListConsolidationEmissionsArgs,
} from './consolidation-emissions.service.js';

// ─────────────────────────────────────────────────────────────────────
// Persistent adapters for the 5 in-memory ports (migrations 0165-0168).
// Each adapter is opt-in at the api-gateway / agent-platform composition
// root; in-memory ports stay the default for dev / tests.
// ─────────────────────────────────────────────────────────────────────

// WORM audit log (migration 0165) — Drizzle-backed `WormAuditStore`
// from `packages/document-studio/src/signing/worm-audit.ts`. Hash-chained
// per-tenant, append-only — SOC 2 / GDPR Art. 30 audit substrate for
// every document leaving `@borjie/document-studio`.
export {
  createWormAuditLogService,
  type WormAuditEntry,
  type WormAuditStore,
  type WormAuditStoreService,
} from './worm-audit-log.service.js';

// Reflexion lessons (migration 0166) — Drizzle-backed `LessonStore`
// from `packages/ai-copilot/src/reflexion/types.ts`. Per-(tenant, task_tag)
// bucketed teaching material; dedupe-bump path is a single ON CONFLICT
// DO UPDATE.
export {
  createLessonStoreService,
  type Lesson as LessonStoreLesson,
  type LessonStore as LessonStorePort,
} from './lesson-store.service.js';

// Skill-registry writer — Drizzle-backed `SkillRegistryWriter` from
// `packages/ai-copilot/src/skill-promotion/types.ts`. Wraps the existing
// `skill_registry` table (migration 0133). Idempotent upsert with
// counter-bump on re-promote.
export {
  createSkillRegistryWriterService,
  type PromotionRecord as SkillPromotionRecord,
  type SkillRegistryWriter as SkillRegistryWriterPort,
} from './skill-registry-writer.service.js';

// AOP registry (migration 0167) — Drizzle-backed `AOPRegistryStore`
// from `packages/central-intelligence/src/agent/aops/aop-registry.ts`.
// Append-only specs, overwrite-on-id regression sets, flippable active
// versions. Optional scopeTenantId for multi-tenant deployments.
export {
  createAopRegistryStoreService,
  type AopSpecLike,
  type AopRegistryStore as AopRegistryStorePort,
  type AopRegistryStoreOpts,
  type RegressionSetLike,
} from './aop-registry-store.service.js';

// A2A v1.0 task store (migration 0168) — Drizzle-backed `TaskStore`
// from `packages/agent-platform/src/a2a/task-lifecycle.ts`. Idempotent
// put-by-id; tenant-scoped (mandatory tenantId at construction time).
export {
  createA2aTaskStoreService,
  type A2aTaskStoreOpts,
  type A2ATask as A2aTaskRecord,
  type A2ATaskMessage as A2aTaskMessage,
  type A2ATaskPart as A2aTaskPart,
  type A2ATaskStatus as A2aTaskStatus,
  type TaskStore as A2aTaskStorePort,
} from './a2a-task-store.service.js';

// Carbon-market book (migration 0170) — Drizzle-backed
// `BookEntryRepository` from `packages/carbon-market/src/types.ts`.
// Widens the P6 port (save/findById/findByTenant) with operational
// state-transition methods (findOpenByTenant, findBySymbol, markSettled,
// cancel). The in-memory port stays the default; this adapter is
// opt-in at the api-gateway composition root.
export {
  createCarbonMarketBookService,
  type BookEntryShape as CarbonMarketBookEntryShape,
  type BookEntrySide as CarbonMarketBookEntrySide,
  type BookEntryStatus as CarbonMarketBookEntryStatus,
  type BookEntryRepositoryExtended as CarbonMarketBookRepository,
  type CarbonMarketBookService,
  type CreateCarbonMarketBookServiceOpts,
} from './carbon-market-book-service.js';
