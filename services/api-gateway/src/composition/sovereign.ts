/**
 * Sovereign composition root — wires the central-intelligence brain
 * kernel into a production-ready SovereignBrain singleton.
 *
 * Architecture overview — see `.planning/jarvis-architecture.md` for
 * the full Nyumba Mind reference: portal/persona/tier matrix, scope
 * lattice, grounding pyramid, per-user privacy guarantees, and the
 * 0114/0115 migration roster.
 *
 * Env-driven boot:
 *
 *   ANTHROPIC_API_KEY  → real Claude Opus/Sonnet/Haiku sensors via
 *                        @anthropic-ai/sdk; otherwise an in-process
 *                        stub sensor is used so dev / CI can still
 *                        boot without the SDK installed.
 *   DATABASE_URL       → Drizzle-backed kernel substrate sinks
 *                        (kernel_cot_reservoir, kernel_persona_drift_
 *                        events, kernel_provenance) and a
 *                        Postgres-backed sovereign_approvals store;
 *                        otherwise in-memory sinks. Also enables the
 *                        market_data_cache TTL store (migration 0120).
 *   MARKET_DATA_PROVIDER  → 'zillow' | 'airbnb' (etc.) — wires that
 *                        adapter as the platform's MarketDataPort. When
 *                        unset no adapter is wired; the kernel runs
 *                        without external market-data tools.
 *   ZILLOW_API_KEY     → real upstream credential for the Zillow
 *                        adapter. Without it the adapter resolves every
 *                        call to `{ kind: 'unconfigured' }` (it never
 *                        throws); the kernel tool surfaces a friendly
 *                        hint to the operator.
 *   AIRBNB_API_KEY     → ditto for the Airbnb adapter.
 *
 * This module is the single source of truth for how the api-gateway
 * boots the sovereign AI. It returns one cached SovereignBrain per
 * tenantId so each tenant's audit trail is isolated. Platform-tier
 * (no tenant) shares a separate cache key.
 */

import {
  agency as agencyKernel,
  composeSovereign,
  createDpCohortSource,
  tools as kernelTools,
  type AgencyKernelPort,
  type FeedbackMemoryPort,
  type MemoryHierarchy,
  type PersonaBrandingOverride,
  type PersonaBrandingResolver,
  type SovereignBrain,
  type Sensor,
  type SubstrateSinks,
} from '@borjie/central-intelligence';
import {
  createDpAggregator,
  createCryptoNoiseSource,
} from '@borjie/graph-privacy';
import {
  createKernelSubstrateService,
  createKernelMemoryService,
  createKernelGroundingProvider,
  createMarketDataCacheService,
  createPersonaBrandingService,
  createPgApprovalStore,
  createPgAutonomyPolicyService,
  createPgTenantAggregateSource,
  createPgPlatformBudgetLedger,
  createEpisodicMemoryService,
  createSemanticMemoryService,
  createProceduralMemoryService,
  createReflectiveMemoryService,
  createFeedbackService,
  createKernelGoalsService,
  createKernelActionAuditService,
  createSensoriumEventLogService,
} from '@borjie/database';
// Central Command Phase A C4 / Phase B B2 — Behaviour signal source.
// Surfaces derived brain-mind-state signals (engagement.high,
// frustration.detected, task.completed-without-AI, dwell.deep) into
// step 4 of the kernel's 13-step pipeline. Bound to the Drizzle-backed
// sensorium-event-log service so the kernel reads real user behaviour
// instead of a static stub.
import { createBehaviorSignalSource } from '@borjie/ai-copilot/ambient-brain';
// TODO(borjie-hard-fork): `@borjie/market-intelligence` was a property-
// vertical package (Zillow / Airbnb rental comps). Mining equivalents
// (LME spot prices, Argus DRC tin index, etc.) will live under a new
// `@borjie/commodity-intelligence` package. Until that lands the
// MarketDataPort is stubbed and `buildMarketDataPort` always returns
// null so the kernel tools singleton becomes a no-op.
type MarketDataPort = unknown;
function createAirbnbMarketDataAdapter(_opts: unknown): MarketDataPort | null {
  return null;
}
function createZillowMarketDataAdapter(_opts: unknown): MarketDataPort | null {
  return null;
}
import { logger } from '../utils/logger.js';

// Visibility role — mirrored locally so this composition root doesn't
// need a type-only barrel export from `@borjie/database` (TS
// NodeNext + isolatedModules + cross-package source-types resolution
// can be picky about transitive `type` re-exports). Keep the union in
// lock-step with `GroundingViewRole` in
// `packages/database/src/services/kernel-grounding.service.ts`.
type SovereignRole = 'tenant' | 'manager' | 'owner' | 'org-admin' | 'sovereign';
import { getDb } from './db-client';
import { readSovereignLedgerFailClosedFromEnv } from './service-registry';
import { wrapAnthropicWithCircuitBreaker } from './anthropic-circuit-breaker';
import {
  createBoundActionToolDeps,
  createBoundWakeReadDeps,
} from './agency-port-bindings';
// Central Command Phase C C1 — counter-model production wiring. The
// factory returns null when the Anthropic client is null (degraded
// mode); the executor treats `counterModel: null` as "skip the second-
// LLM sanity check and fall through to the legacy approval flow".
import { createProductionCounterModel } from './critics/counter-model-wiring.js';

// ---------------------------------------------------------------------------
// Anthropic SDK loader — optional. We only require the SDK when the
// caller actually wants real sensors (ANTHROPIC_API_KEY set). The
// import is dynamic so the gateway can boot in environments without
// the SDK installed.
// ---------------------------------------------------------------------------

type AnthropicMessagesClient = Parameters<
  (typeof import('@borjie/central-intelligence'))['createAnthropicSensor']
>[0];

let anthropicSingleton: AnthropicMessagesClient | null | undefined;

async function loadAnthropicClient(): Promise<AnthropicMessagesClient | null> {
  if (anthropicSingleton !== undefined) return anthropicSingleton;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    anthropicSingleton = null;
    return null;
  }
  try {
    const mod = await import('@anthropic-ai/sdk');
    const Anthropic = (mod.default ?? mod) as unknown as new (cfg: {
      apiKey: string;
    }) => AnthropicMessagesClient;
    anthropicSingleton = new Anthropic({ apiKey: key });
    return anthropicSingleton;
  } catch (err) {
    // SDK not installed — log once and fall back.
    logger.warn('sovereign-composition: @anthropic-ai/sdk not loadable; falling back to stub sensor', { value: err instanceof Error ? err.message : err });
    anthropicSingleton = null;
    return null;
  }
}

function createStubSensor(): Sensor {
  return {
    id: 'stub-sensor',
    modelId: 'stub-model',
    priority: 99,
    capabilities: ['fast'],
    async call(args) {
      return {
        text: `[stub sensor — set ANTHROPIC_API_KEY for live AI] You said: ${args.userMessage.slice(0, 200)}`,
        thought: null,
        toolCalls: [],
        latencyMs: 0,
        modelId: 'stub-model',
        sensorId: 'stub-sensor',
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Per-(tenant, user) cache. Each Borjie user gets their own
// personalised Nyumba Mind: the kernel is stateless except for the 60s
// thought cache, but the grounding provider's role-aware filters are
// baked in at composition time, so we MUST key the SovereignBrain
// cache by both tenantId and userId (and role, conservatively) — not
// just tenantId. Keying only by tenant would let an org-admin and a
// resident in the same tenant accidentally share each other's brains.
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<SovereignBrain>>();

export interface SovereignScope {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly role?: SovereignRole;
}

function scopeKey(scope: SovereignScope): string {
  const t = scope.tenantId ?? '__platform__';
  const u = scope.userId ?? '__nouser__';
  const r = scope.role ?? '__norole__';
  return `${t}::${u}::${r}`;
}

export async function getSovereignBrain(
  scope: SovereignScope,
): Promise<SovereignBrain> {
  const key = scopeKey(scope);
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = build(scope);
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}

/** Test-only / hot-reload escape hatch. */
export function resetSovereignBrainCache(): void {
  cache.clear();
  anthropicSingleton = undefined;
  marketDataKernelToolsSingleton = undefined;
}

async function build(scope: SovereignScope): Promise<SovereignBrain> {
  const db = getDb();

  // Sensors — Anthropic when key is set; otherwise a clearly-marked stub.
  // The raw client is wrapped in a process-wide circuit breaker so the
  // sensor-failover layer sees a typed `AnthropicCircuitOpenError` and
  // can fail-over to the next sensor instead of retrying every turn
  // against an upstream that is already known to be down.
  //
  // Central Command Phase C C1 — hoisted ABOVE both `createExecutor`
  // call sites so the counter-model adapter (built off the wrapped
  // Anthropic client) is in scope for both the early-stub executor
  // branch and the realAgencyExecutor branch. Previously this load
  // lived after the agency block, which forced the COORD ZONE notes
  // requesting a reorganisation pass — that pass is this commit.
  const anthropicRaw = await loadAnthropicClient();
  const anthropic = anthropicRaw
    ? wrapAnthropicWithCircuitBreaker(anthropicRaw, {
        failureThreshold: 5,
        recoveryTimeoutMs: 30_000,
      })
    : null;

  // Substrate sinks — Drizzle-backed when DB is up; otherwise the
  // composeSovereign default (in-memory) is used.
  let substrateSinks: SubstrateSinks | undefined;
  let approvalStore: ReturnType<typeof createPgApprovalStore> | undefined;
  let priorTurnsLoader: ((threadId: string) => Promise<ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>>) | undefined;
  let recentTurnCounter: ((threadId: string) => Promise<number>) | undefined;
  let groundingFacts:
    | { fetch: (a: { userMessage: string; tier: string; limit: number }) => Promise<ReadonlyArray<unknown>> }
    | undefined;
  let cohortSource: ReturnType<typeof createDpCohortSource> | undefined;
  let brandingResolver: PersonaBrandingResolver | undefined;
  let memoryHierarchy: MemoryHierarchy | undefined;
  let feedbackPort: FeedbackMemoryPort | undefined;
  let agencyPort: AgencyKernelPort | undefined;
  // Real wake triggers (arrears.30d-threshold, lease.expiring-30d,
  // vacancy.30d-vacant) — stored on the SovereignBrain's mutable bag
  // for a future scheduler composition root to consume. Empty array
  // when DB is unavailable (no real reader to query).
  let realWakeTriggers:
    | ReturnType<typeof agencyKernel.createRealWakeTriggers>
    | undefined;
  // Behaviour-signal source (Central Command C4 / B2). Bound to the
  // Drizzle-backed sensorium-event-log service so step 4 (memory
  // recall) can mix derived brain-mind-state signals into the system
  // prompt. Undefined when DB is unavailable — the kernel skips this
  // channel cleanly when the port is missing.
  let behaviorSignalSource:
    | ReturnType<typeof createBehaviorSignalSource>
    | undefined;
  if (db) {
    const svc = createKernelSubstrateService(db, { tenantId: scope.tenantId });
    substrateSinks = {
      cot: svc.cot,
      drift: svc.drift,
      provenance: svc.provenance,
    };
    approvalStore = createPgApprovalStore(db, { tenantId: scope.tenantId });
    const memory = createKernelMemoryService(db, { tenantId: scope.tenantId });
    priorTurnsLoader = (threadId) => memory.loadPriorTurns(threadId);
    recentTurnCounter = (threadId) => memory.countRecentUserTurns(threadId);
    // Role-scoped grounding facts (occupancy, work-orders, leases).
    // The provider applies the role's visibility filter (resident →
    // own lease; manager → assigned properties; owner → owned
    // properties; org-admin → tenant-wide; sovereign → empty).
    // Platform-tier (no tenantId) gets nothing from this source —
    // industry-tier grounding rides on the DP cohort source instead.
    groundingFacts = createKernelGroundingProvider(db, {
      tenantId: scope.tenantId,
      userId: scope.userId,
      role: scope.role,
    });

    // Persona branding resolver — Drizzle-backed override lookup
    // keyed by (tenantId, surface). The persistence service returns
    // the persisted shape; we adapt it to the kernel port's narrower
    // PersonaBrandingOverride view (only the fields the kernel cares
    // about). Lookups for null tenantId (platform-tier) are short-
    // circuited to null inside the resolver.
    const brandingService = createPersonaBrandingService(db);
    brandingResolver = {
      async resolve({ tenantId, surface }) {
        if (!tenantId) return null;
        const row = await brandingService.get(tenantId, surface).catch(() => null);
        if (!row) return null;
        const override: PersonaBrandingOverride = {
          ...(row.displayName ? { displayName: row.displayName } : {}),
          ...(row.openingPreamble ? { openingPreamble: row.openingPreamble } : {}),
          ...(row.voiceProfileId ? { voiceProfileId: row.voiceProfileId } : {}),
        };
        // If the row exists but every field is null/empty, treat as
        // no-override so the kernel keeps the surface default verbatim.
        if (!override.displayName && !override.openingPreamble && !override.voiceProfileId) {
          return null;
        }
        return override;
      },
    };

    // LITFIN-style four-tier memory hierarchy (migration 0121).
    // Drizzle-backed services for episodic / semantic / procedural /
    // reflective memory; the kernel reads semantic + reflective at
    // step 4 and writes episodic at step 13. Each port is tenant-
    // scoped at the call-site through the args the kernel passes; the
    // services themselves are stateless factories.
    memoryHierarchy = {
      episodic: createEpisodicMemoryService(db),
      semantic: createSemanticMemoryService(db),
      procedural: createProceduralMemoryService(db),
      reflective: createReflectiveMemoryService(db),
    };

    // Online-learning feedback port (migration 0122). The kernel
    // reads the user's last 10 feedback entries at step 4 and mixes
    // recent verbatim corrections + per-category negative-rate into
    // the system prompt so the next turn can apologise / learn /
    // bias toward conservative output. The Drizzle service exposes
    // `recallForUser`; we adapt that to the kernel port's
    // `recallRecent` shape (the methods are structurally compatible
    // — same args, same return shape — so the adapter is a thin
    // rename).
    const feedbackService = createFeedbackService(db);
    feedbackPort = {
      async recallRecent(args) {
        return feedbackService.recallForUser({
          tenantId: args.tenantId,
          userId: args.userId,
          limit: args.limit,
        });
      },
    };

    // Agency layer (migration 0123) — persistent objectives the brain
    // works on across days, the typed-write tool registry (5 stubs;
    // composition root replaces with real domain-service adapters
    // later), the autonomous executor (four-eye-gated on high-stakes),
    // and the wake-loop. The kernel itself only consumes the goals
    // reader for prompt mix-in; the executor + wake-loop live above
    // the kernel and are scheduled separately.
    //
    // No real autonomy-policy adapter is wired yet — the executor
    // falls back to the in-process default-allow-low-stakes policy
    // which routes every medium+ stake through the four-eye gate. A
    // future wiring will read per-tenant policies from migration
    // 0080 (`autonomy_policies`) here.
    const goalsService = createKernelGoalsService(db);
    const auditSink = createKernelActionAuditService(db);
    const toolRegistry = agencyKernel.createActionToolRegistry();
    for (const stub of agencyKernel.DEFAULT_ACTION_TOOL_STUBS) {
      toolRegistry.register(stub);
    }
    // Central Command Phase C C1 — counter-model sanity check wired
    // into both executor branches. When `anthropic` is null (no
    // ANTHROPIC_API_KEY) the factory returns null and the executor
    // skips the second-LLM check, falling through to the legacy
    // approval flow. The check only fires on sovereign-tier tools
    // (see `isSovereignTier` in the kernel), so its latency cost is
    // bounded to that narrow surface.
    const agencyExecutor = agencyKernel.createExecutor({
      goals: goalsService,
      tools: toolRegistry,
      auditSink,
      autonomyPolicy: agencyKernel.createDefaultAllowLowStakesPolicy(),
      counterModel: createProductionCounterModel(anthropic),
      sovereignLedgerFailClosed: readSovereignLedgerFailClosedFromEnv(),
    });
    agencyPort = {
      goals: goalsService,
      executor: agencyExecutor,
      planDecomposer: agencyKernel.decomposePlan,
    };

    // DP cohort source — only when a privacy-budget envelope is
    // configured. Activation is gated by PRIVACY_BUDGET_EPSILON; an
    // unset/zero/non-numeric value disables the channel and the
    // kernel falls back to skipping cohort signals.
    const dpAggregator = maybeBuildDpAggregator(db);
    if (dpAggregator) {
      cohortSource = createDpCohortSource({
        // The kernel's `DpAggregator` is a narrow duck of the
        // production aggregator (which keeps strict types like
        // `DpAggregateOutcome`); the bridge below preserves the
        // runtime contract. Cast at the boundary.
        aggregator: dpAggregator as Parameters<typeof createDpCohortSource>[0]['aggregator'],
        authContext: {
          actorUserId: scope.userId ?? 'unknown',
          actorRoles: scope.role ? [scope.role] : [],
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // Real-adapter upgrade pass (additive). When the DB is up we:
    //   1. Read the per-tenant autonomy policy from migration 0080
    //      (`autonomy_policies`) instead of the default-allow-low-
    //      stakes stub. Falls back to default-allow when row missing /
    //      autonomous mode disabled / policy_json malformed / DB error.
    //   2. Register the FIVE real action-tool adapters on top of the
    //      stubs. Real-name registrations overwrite stub-name
    //      registrations in the in-process map, so the executor
    //      invokes the real adapter when present. Each real adapter
    //      itself returns `{ ok:false, message:'service not yet wired:
    //      ...' }` when the underlying domain port isn't available —
    //      no faked successes.
    //   3. Build the real wake-trigger detectors (arrears, lease-
    //      expiring, vacancy). When their read ports aren't wired the
    //      detectors emit empty arrays so the wake-loop's count stays
    //      accurate. Stored on a module-local for the scheduler-
    //      composition root to pick up — the kernel itself does not
    //      run the wake-loop synchronously here.
    // ─────────────────────────────────────────────────────────────────
    const realPolicyService = createPgAutonomyPolicyService(db);
    const realAutonomyPolicy = {
      decide: (args: {
        readonly tenantId: string;
        readonly userId: string;
        readonly toolName: string;
        readonly stakes: 'low' | 'medium' | 'high' | 'critical';
      }) => realPolicyService.decide(args),
    };
    // Bind the FIVE real action-tool ports to live Drizzle write paths
    // (notifications.dispatch_log, repos.workOrders.create equivalent,
    // repos.inspections.create equivalent, arrears_cases ladder
    // promotion, marketplace_listings publish). The kernel adapters
    // own the honest-error contract — when a port itself rejects
    // (e.g. unit not found) the adapter surfaces a structured
    // `service not yet wired: <reason>` to the executor. See
    // `./agency-port-bindings.ts` for the per-port query shapes.
    const boundActionToolDeps = createBoundActionToolDeps(db);
    for (const realTool of agencyKernel.createRealActionTools(boundActionToolDeps)) {
      toolRegistry.register(realTool);
    }
    // Central Command Phase C C1 — same counter-model wire-in as the
    // early-stub executor above. The wrapped `anthropic` client was
    // hoisted to the top of `build()` so it is in scope for BOTH
    // executor branches; the factory itself is null-safe.
    const realAgencyExecutor = agencyKernel.createExecutor({
      goals: goalsService,
      tools: toolRegistry,
      auditSink,
      autonomyPolicy: realAutonomyPolicy,
      counterModel: createProductionCounterModel(anthropic),
      sovereignLedgerFailClosed: readSovereignLedgerFailClosedFromEnv(),
    });
    agencyPort = {
      goals: goalsService,
      executor: realAgencyExecutor,
      planDecomposer: agencyKernel.decomposePlan,
    };
    // Real wake triggers — bound to Drizzle read ports (arrears_cases,
    // leases, units). Held on the cached SovereignBrain's `mutable`
    // bag below so a future scheduler composition root can pick them
    // up without re-reading the DB.
    const boundWakeReadDeps = createBoundWakeReadDeps(db);
    realWakeTriggers = agencyKernel.createRealWakeTriggers({
      arrears: boundWakeReadDeps.arrearsRead,
      leases: boundWakeReadDeps.leaseRead,
      vacancy: boundWakeReadDeps.vacancyRead,
    });

    // Behaviour-signal source — derive brain-mind-state signals
    // (engagement.high, frustration.detected, task.completed-without-AI,
    // dwell.deep) from the live sensorium event ribbon. Kernel step 4
    // reads these and mixes them into the system prompt so the brain
    // can adapt to the user's current state. The factory duck-types
    // against the Drizzle service so the ai-copilot package stays
    // dep-free of @borjie/database.
    const sensoriumEventLogService = createSensoriumEventLogService(db);
    behaviorSignalSource = createBehaviorSignalSource(sensoriumEventLogService);
  }

  // The wrapped `anthropic` client was constructed at the top of
  // `build()` (Phase C C1 hoist). Reuse it here for the sensor +
  // mutable-state composition step.
  const mutable: Record<string, unknown> = {};
  if (anthropic) mutable.anthropicClient = anthropic;
  else mutable.extraSensors = [createStubSensor()];
  if (substrateSinks) mutable.substrateSinks = substrateSinks;
  if (approvalStore) mutable.approvalStore = approvalStore;
  if (priorTurnsLoader) mutable.priorTurnsLoader = priorTurnsLoader;
  if (recentTurnCounter) mutable.recentTurnCounter = recentTurnCounter;
  if (groundingFacts) mutable.groundingFacts = groundingFacts;
  if (cohortSource) mutable.cohortSource = cohortSource;
  if (brandingResolver) mutable.brandingResolver = brandingResolver;
  if (memoryHierarchy) mutable.memory = memoryHierarchy;
  if (feedbackPort) mutable.feedback = feedbackPort;
  if (agencyPort) mutable.agency = agencyPort;
  if (realWakeTriggers && realWakeTriggers.length > 0) {
    mutable.realWakeTriggers = realWakeTriggers;
  }
  if (behaviorSignalSource) {
    // The kernel's `BehaviorSignalSourcePort` is structurally duck-typed
    // (see `kernel-types.ts#BehaviorSignalSourcePort`). The ai-copilot
    // factory returns a richer `BehaviorSignalSource` that satisfies it;
    // assign-by-key keeps the type-narrowing happy.
    mutable.behaviorSignalSource = behaviorSignalSource;
  }
  // autoHaikuJudge defaults to true in compose; we leave it unset.

  return composeSovereign(mutable as Parameters<typeof composeSovereign>[0]);
}

// ---------------------------------------------------------------------------
// DP aggregator builder — gated on PRIVACY_BUDGET_EPSILON. The kernel's
// `createDpCohortSource` ducks the aggregator's auth shape down to
// `{ actorUserId, actorRoles }`; the production aggregator expects
// `{ kind: 'platform', actorUserId, roles }`. We bridge the two with a
// thin wrapper so the kernel can keep its contract narrow while the
// aggregator stays strict.
// ---------------------------------------------------------------------------

interface KernelAuthContext {
  readonly actorUserId: string;
  readonly actorRoles: ReadonlyArray<string>;
}

function maybeBuildDpAggregator(
  db: NonNullable<ReturnType<typeof getDb>>,
): { aggregate: (q: unknown, ctx: KernelAuthContext) => Promise<unknown> } | undefined {
  const raw = process.env.PRIVACY_BUDGET_EPSILON?.trim();
  if (!raw) return undefined;
  const totalEpsilon = Number(raw);
  if (!Number.isFinite(totalEpsilon) || totalEpsilon <= 0) return undefined;

  const tenantSource = createPgTenantAggregateSource(db);
  // Postgres-backed ledger so cohort DP-aggregator budget consumption
  // survives api-gateway restarts (migration 0116). The in-memory
  // ledger remains the fallback when `db` is null — see the wider
  // build() guard on `if (db) { ... }`. The PgBudgetLedgerShape is
  // duck-compatible with the graph-privacy `PlatformBudgetLedger`
  // port; cast at the boundary so this composition root doesn't pull
  // in a transitive type-only re-export from @borjie/database.
  const ledger = createPgPlatformBudgetLedger(db, {
    totalEpsilon,
    totalDelta: 1e-6,
  }) as unknown as Parameters<typeof createDpAggregator>[0]['ledger'];
  const noise = createCryptoNoiseSource();
  const aggregator = createDpAggregator({ tenantSource, ledger, noise });

  // Bridge: kernel feeds `{ actorUserId, actorRoles }`; the strict
  // aggregator wants `{ kind: 'platform', actorUserId, roles }`.
  return {
    aggregate(q, ctx) {
      return aggregator.aggregate(q as Parameters<typeof aggregator.aggregate>[0], {
        kind: 'platform',
        actorUserId: ctx.actorUserId,
        roles: ctx.actorRoles,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// External market-data adapter wiring (env-gated).
//
// `MARKET_DATA_PROVIDER` selects which adapter is wired:
//   - 'zillow'  → Zillow listings + Bridge-RESO vacancy
//   - 'airbnb'  → Airbnb market-insights (short-let, coerced monthly)
//
// Without `MARKET_DATA_PROVIDER` no adapter is wired and the kernel has
// no market-data tools (calls to market.* surface as 'unknown tool').
// Without the corresponding `*_API_KEY` the adapter is wired but every
// call resolves to `{ kind: 'unconfigured' }` — the kernel tool surfaces
// a friendly operator hint instead of failing.
//
// The kernel itself does NOT execute tools (it's single-shot). The
// streaming agent-loop is the right place to register these. The
// composition root for the agent-loop is not yet wired into the api-
// gateway; until it is, this factory is exposed via
// `getMarketDataKernelTools()` for the future agent-loop wiring to
// pick up. See the inline follow-up note below.
//
// Follow-up agent-loop (Docs/TODO_BACKLOG.md): when the api-gateway grows an agent-loop
// composition root (parallel to this sovereign one), thread the bundle
// returned by `getMarketDataKernelTools()` into its `createToolRegistry`
// input. The registry surface is documented in
// `packages/central-intelligence/src/tools/registry.ts`.
// ---------------------------------------------------------------------------

let marketDataKernelToolsSingleton:
  | ReturnType<typeof kernelTools.createMarketDataKernelTools>
  | null
  | undefined;

/**
 * Build the env-gated market-data adapter + kernel-tool bundle.
 *
 * Returns the bundle when `MARKET_DATA_PROVIDER` selects a known
 * adapter; returns `null` when no provider is configured (callers
 * should treat this as "no market-data tools available" — NOT an
 * error). Cached so multiple agent-loop builds share one adapter.
 */
export function getMarketDataKernelTools():
  | ReturnType<typeof kernelTools.createMarketDataKernelTools>
  | null {
  if (marketDataKernelToolsSingleton !== undefined) {
    return marketDataKernelToolsSingleton;
  }

  const provider = (process.env.MARKET_DATA_PROVIDER ?? '').trim().toLowerCase();
  if (!provider) {
    marketDataKernelToolsSingleton = null;
    return null;
  }

  const port = buildMarketDataPort(provider);
  if (!port) {
    logger.warn(`sovereign-composition: unknown MARKET_DATA_PROVIDER='${provider}'; ignoring`);
    marketDataKernelToolsSingleton = null;
    return null;
  }

  // Cast: market-data port shape was provided by @borjie/market-intelligence
  // (deleted in the hard-fork). The runtime path is unreachable because the
  // stubbed factories above always return null, so coerce to the kernel-tools
  // port shape to keep the typecheck happy.
  marketDataKernelToolsSingleton = kernelTools.createMarketDataKernelTools(
    port as Parameters<typeof kernelTools.createMarketDataKernelTools>[0],
  );
  return marketDataKernelToolsSingleton;
}

function buildMarketDataPort(provider: string): MarketDataPort | null {
  // Cache layer is only available when the DB is up. Without it the
  // adapter still works — it just hits the upstream every call and
  // serves whatever the upstream returns.
  const db = getDb();
  const cache = db ? createMarketDataCacheService(db) : undefined;

  switch (provider) {
    case 'zillow':
      return createZillowMarketDataAdapter({
        ...(process.env.ZILLOW_API_KEY?.trim()
          ? { apiKey: process.env.ZILLOW_API_KEY.trim() }
          : {}),
        ...(cache ? { cache } : {}),
      });
    case 'airbnb':
      return createAirbnbMarketDataAdapter({
        ...(process.env.AIRBNB_API_KEY?.trim()
          ? { apiKey: process.env.AIRBNB_API_KEY.trim() }
          : {}),
        ...(cache ? { cache } : {}),
      });
    default:
      return null;
  }
}
