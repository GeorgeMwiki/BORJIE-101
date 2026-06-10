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
  createAffectiveAccumulator,
  createApprovalGate,
  createBrainToolRegistry,
  createDpCohortSource,
  createInMemoryApprovalStore,
  createNullEmbedder,
  createOpenAiEmbedder,
  createSkillRetriever,
  reflexion as kernelReflexion,
  registerSeedBrainTools,
  situationalModel as situationalModelKernel,
  tools as kernelTools,
  type AffectiveAccumulator,
  type AgencyKernelPort,
  type BrainToolRegistry,
  type EmbedderPort,
  type FeedbackMemoryPort,
  type MemoryHierarchy,
  type PersonaBrandingOverride,
  type PersonaBrandingResolver,
  type SeedBrainToolDeps,
  type SkillRetriever,
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
  createSkillRegistryService,
  createReflexionBufferService,
  createDrizzleReflexionLoader,
} from '@borjie/database';
// Central Command Phase A C4 / Phase B B2 — Behaviour signal source.
// Surfaces derived brain-mind-state signals (engagement.high,
// frustration.detected, task.completed-without-AI, dwell.deep) into
// step 4 of the kernel's 13-step pipeline. Bound to the Drizzle-backed
// sensorium-event-log service so the kernel reads real user behaviour
// instead of a static stub.
import { createBehaviorSignalSource } from '@borjie/ai-copilot/ambient-brain';
// Cross-session Theory-of-Mind (owner model) — DURABLE per-owner
// communication-style posterior. The kernel reads `getStyleHint(...)` at
// step 6 (beside the per-turn affective directive) and folds one
// observation back via `refine(...)` post-turn. Backed by the Drizzle
// `owner_style_profiles` store so the bias survives across sessions.
//
// WIRING PREREQUISITE (flagged in the manifest — NEITHER file is owned by
// this agent): the orphaned `OwnerStyleService` is NOT currently reachable
// from `@borjie/ai-copilot`. Its barrel lives at
// `packages/ai-copilot/src/personas/owner-style/index.ts` but is not
// re-exported from the package root. Add ONE line to
// `packages/ai-copilot/src/personas/index.ts`:
//     export * from './owner-style/index.js';
// (or the package root `src/index.ts`) so this import resolves. AND add
// the `ownerStyleReader` passthrough to `compose.ts`'s
// `SovereignComposeConfig` (mirror `behaviorSignalSource`) so the bound
// reader actually reaches the kernel — otherwise it is silently dropped.
import {
  createOwnerStyleService,
  type OwnerStyleProfileStore,
} from '@borjie/ai-copilot';
import { createPgOwnerStyleProfileStore } from '@borjie/database/repositories';
// LP-30 — composition-root activation of the kernel's semantic-cache (LP-03)
// and intent-verifier (LP-04) seams. Both ports are constructed fail-safe and
// threaded into `composeSovereign(...)` so the kernel's `think()` pipeline
// reads them. Semantic cache default ENABLED (miss -> normal sensor path);
// intent verifier default ENABLED in ADVISORY posture (logs, never blocks)
// with `BORJIE_INTENT_VERIFY_STRICT=1` to enforce.
import {
  buildSemanticCachePort,
  buildIntentVerifierPort,
} from './lp30-kernel-ports-wiring.js';
// Wave-3 DARK-ORGAN closure (Docs/research/MASTER_WIRING_CLOSURE_PLAN.md) —
// the kernel's normal-turn multi-voice debate detour. The kernel ALREADY
// consumes `deps.debate` at high/critical stakes, but no composition root
// ever populated it, so the detour never fired. This binds a real
// stakes-gated DebatePort (N voices × R rounds over the same Anthropic
// sensor) behind `BORJIE_KERNEL_DEBATE_ENABLED` (default OFF) + a wall-clock
// budget so a slow debate can never stall a turn (fail-safe → single-shot).
import { buildDebateKernelPort } from './debate-kernel-port-wiring.js';
// See gh-issue #29: `@borjie/market-intelligence` was a property-vertical
// package (Zillow / Airbnb rental comps). Mining equivalents (LME spot
// prices, Argus DRC tin index, etc.) will live under a new
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
import { wrapAnthropicWithOtelSpans } from './anthropic-otel-spans';
import {
  createBoundActionToolDeps,
  createBoundWakeReadDeps,
} from './agency-port-bindings';
// Central Command Phase C C1 — counter-model production wiring. The
// factory returns null when the Anthropic client is null (degraded
// mode); the executor treats `counterModel: null` as "skip the second-
// LLM sanity check and fall through to the legacy approval flow".
import { createProductionCounterModel } from './critics/counter-model-wiring.js';
// Stage 1 — orchestrator main-loop wire onto the LIVE kernel. Reuses the
// EXACT proven construction from `brain-kernel-wiring.ts`
// (`buildOrchestratorComposeBlock` = router + dispatcher + memory tool +
// 9 production hook ports) and the 9-hook production bindings
// (`buildOrchestratorBindings`). The block's `useByDefault` stays UNSET so
// the kernel's `resolveOrchestratorRoutingEnabled` (DEFAULT-ON) governs
// routing, with `KERNEL_USE_ORCHESTRATOR=false` (hard-kill) +
// `BORJIE_ORCHESTRATOR_MAINLOOP=0/false/off` (soft-disable) as the instant
// reverts to the proven persona / master-brain stack.
import { buildOrchestratorComposeBlock } from './brain-kernel-wiring.js';
import { buildOrchestratorBindings } from './orchestrator-bindings.js';
// Durable orchestrator working-memory — the Drizzle-backed MemoryTool
// (agent_memory, migration 0302, FORCE RLS). Same persisted backend the
// mwikila.memory.* persona tools use, so the main-loop's notebook survives
// restarts. Only wired when the DB is up.
import { createDrizzleMemoryTool } from './memory/drizzle-memory-tool.js';
// FULL-POWERS parity — the proven persona tool catalog (40+ mwikila.* /
// memory / data-analysis / org-admin / damage-settlement / jurisdiction
// tools) + the per-scope persona gate (loopback http client + Pino audit
// sink + kill-switch + role→persona-slug resolution). Bridged onto the
// orchestrator's kernel `BrainToolRegistry` so the main-loop discovers
// (toolSearch) and executes (dispatcher, 9-hook chain) the SAME catalog the
// persona path uses — closing the degraded-catalog gap.
import {
  buildPersonaToolHandlers,
  type PersonaToolGate,
} from './brain-tools/index.js';
import { createLoopbackHttpClient } from './brain-tools/loopback-http-client.js';
import { createPinoAuditSink } from './brain-tools/audit-sink.js';
import {
  registerPersonaToolsOnRegistry,
  type BridgeSovereignRole,
} from './brain-tools/persona-kernel-bridge.js';
// Wave-C SALIENCE ARENA (C1 win #3) — the two slow-loop READ ports that light
// up the arena's drive + ACT-R activation sub-bidders. Both are built from the
// SAME durable situational-model store + gated proactive_nudge contract the
// resident EstateMind loop already writes (estate-mind-wiring.ts):
//   - situationalSnapshotReader: createSituationalModel({ store }).snapshot
//     over `createDrizzleSituationalModelStore(db)` — the ACT-R-activated
//     estate entities the arena min-maxes into activation bids.
//   - pendingProposalReader: a read over the persisted `tab_event_log`
//     proactive_nudge rows the slow loop surfaces (one per breached standing
//     drive, carrying driveId + breachSeverity + urgency) — the drive bids.
// Both fail-safe: a store fault resolves to null/[] so the arena simply has
// fewer bidders (it still competes affect bids via behaviorSignalSource).
import { createDrizzleSituationalModelStore } from './estate-mind-wiring.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
import { sql as drizzleSql } from 'drizzle-orm';

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
// EVERY-POWER-ON default-flip helper.
//
// Several capability ports (semantic cache, kernel debate) resolve their
// master flag with a "default-OFF" reader (`raw === '1'|'true'|'on'`). To turn
// the CAPABILITY on by default WITHOUT weakening the operator's revert lever,
// we hand those builders a derived env in which the flag reads `'true'` UNLESS
// the operator has explicitly pinned an off value (`'0'|'false'|'off'|'no'`).
// The result: unset → ON (power on by default); explicit-off → still OFF
// (instant operator revert). We NEVER apply this to a governance/safety flag
// (kill-switch, four-eye, intent-verify STRICT, payout rails, …) — those keep
// their built-in defaults verbatim. Pure: returns a shallow copy, never
// mutates `process.env`.
// ---------------------------------------------------------------------------

const ENV_OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

function defaultOnEnv(
  base: Readonly<Record<string, string | undefined>>,
  key: string,
): Record<string, string | undefined> {
  const raw = base[key]?.trim().toLowerCase();
  // Operator explicitly disabled → preserve verbatim (revert wins).
  if (raw !== undefined && ENV_OFF_VALUES.has(raw)) {
    return { ...base };
  }
  // Unset / any non-off value → default the capability ON.
  return { ...base, [key]: 'true' };
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
  // G-FIX-3 — wrap the breaker output with OTel spans so the LLM
  // call (the dominant contributor to brain.turn p99) is visible on
  // the trace. Composition order: raw → breaker → OTel → sensor.
  // The OTel wrapper sits outermost so its span timing also covers
  // breaker short-circuits, which is what operators want on a
  // dashboard ("LLM rejected fast" still counts as a measured event).
  const anthropicRaw = await loadAnthropicClient();
  const anthropic = anthropicRaw
    ? wrapAnthropicWithOtelSpans(
        wrapAnthropicWithCircuitBreaker(anthropicRaw, {
          failureThreshold: 5,
          recoveryTimeoutMs: 30_000,
        }),
      )
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
  // Cross-session ToM (owner model). When the DB is up we back the
  // durable owner-style posterior with the Drizzle `owner_style_profiles`
  // store so `getStyleHint(...)` / `refine(...)` round-trip across
  // sessions; when DB is down the service degrades to an in-memory
  // neutral default (honest-degrade — never throws out of a turn).
  let ownerStyleReader:
    | ReturnType<typeof createOwnerStyleService>
    | undefined;
  // C5 — Voyager skill retriever (READ side of the SKILLS loop). When
  // the DB is up we point the retriever at the Drizzle-backed,
  // pgvector-keyed `skill_registry` (the same table the consolidation
  // worker's stage 04-promote writes) and at the resolved text embedder.
  // The kernel renders the top-K matches into its "Available learned
  // skills:" system-prompt fragment (kernel.ts step 4f). Retrieval is an
  // ADDITIVE, optional kernel dep: when the embedder is the always-
  // rejects null sentinel (no OpenAI key) the retriever degrades to an
  // empty fragment and the kernel/Jarvis path is unchanged.
  let skillRetriever: SkillRetriever | undefined;
  // Wave-12 DARK-ORGAN closure — the Reflexion verbal-RL loop. The kernel
  // ALREADY guards on `deps.reflexionRetriever` (step 4e/4f, read-at-start)
  // and `deps.reflexionWriter` (step 13, write-at-session-end), but no
  // composition root ever populated them, so the MD never learned from past
  // mistakes. We back both with the Drizzle `reflexion_buffer` service:
  //   - writer = the buffer service directly (its `record` matches the
  //     kernel's ReflexionWriterPort `record` shape exactly).
  //   - retriever = createReflexionRetriever({ port }) where `port.recall`
  //     is the buffer's `recall` (same shape) — the retriever adds the
  //     prompt-fragment renderer the kernel reads.
  // Both degrade gracefully (the buffer service swallows DB faults), so a
  // reflexion store fault never breaks a turn.
  let reflexionRetriever:
    | ReturnType<typeof kernelReflexion.createReflexionRetriever>
    | undefined;
  let reflexionWriter:
    | ReturnType<typeof createReflexionBufferService>
    | undefined;
  // iq-reflexion-dark-3 (CLOSED) — the THIRD reflexion seam: the task-scoped
  // READ-back loader. This is the read side of the compounding loop: the
  // kernel writes reflexions on surprise + the nightly sleep consolidates
  // them into `reflexion_guidelines`; the loader reads the consolidated
  // lessons BACK at session start (kernel step F11). It is a DISTINCT
  // contract from the retriever — TENANT-WIDE, userId OPTIONAL,
  // `pruned_at IS NULL`, and it ALSO reads the separate
  // `reflexion_guidelines` table — so it gets its own Drizzle service.
  let reflexionLoader:
    | ReturnType<typeof createDrizzleReflexionLoader>
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
    const counterModel = createProductionCounterModel(anthropic);
    const agencyExecutor = agencyKernel.createExecutor({
      goals: goalsService,
      tools: toolRegistry,
      auditSink,
      autonomyPolicy: agencyKernel.createDefaultAllowLowStakesPolicy(),
      ...(counterModel !== null ? { counterModel } : {}),
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
    const realCounterModel = createProductionCounterModel(anthropic);
    const realAgencyExecutor = agencyKernel.createExecutor({
      goals: goalsService,
      tools: toolRegistry,
      auditSink,
      autonomyPolicy: realAutonomyPolicy,
      ...(realCounterModel !== null ? { counterModel: realCounterModel } : {}),
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

    // Cross-session ToM — durable owner-style service over the Drizzle
    // `owner_style_profiles` store. The DB store's `OwnerStyleProfile`
    // is a structural duck-type of the service's; the persistence-port
    // shape ({ fetch, upsert }) matches exactly. Cast at the boundary so
    // the two independently-declared profile types reconcile.
    ownerStyleReader = createOwnerStyleService({
      // The DB repo's `OwnerStyleProfile` is an independently-declared
      // structural twin of the service's; the persistence-port surface
      // ({ fetch, upsert }) matches exactly. Cast through `unknown` at
      // the package boundary so the two nominal profile types reconcile.
      store: createPgOwnerStyleProfileStore(db) as unknown as OwnerStyleProfileStore,
    });

    // C5 — wire the Voyager skill retriever. The registry service is the
    // pgvector-backed `skill_registry` reader; tenant scope is applied
    // per-call inside `retrieve({ tenantId })` from the kernel (the kernel
    // passes the active turn's tenant). The embedder is resolved from the
    // OpenAI embedding/API key — when absent, `createNullEmbedder()` is
    // threaded and the retriever returns no skills (the kernel skips the
    // addendum). This is purely additive: `deps.skillRetriever` becomes
    // live without changing any other kernel construction path.
    const skillEmbedder = resolveSkillEmbedder();
    skillRetriever = createSkillRetriever({
      port: createSkillRegistryService(db),
      embedder: skillEmbedder.modelId === 'null' ? null : skillEmbedder,
    });

    // Wave-12 — Reflexion verbal-RL loop. The buffer service satisfies BOTH
    // the writer port (`record`) and the retriever's underlying read port
    // (`recall`); we wrap the latter in `createReflexionRetriever` so the
    // kernel gets the `retrieve` + `renderPromptFragment` surface it reads.
    const reflexionBuffer = createReflexionBufferService(db);
    reflexionWriter = reflexionBuffer;
    reflexionRetriever = kernelReflexion.createReflexionRetriever({
      port: { recall: (args) => reflexionBuffer.recall(args) },
    });
    // Compounding loop READ-back — the task-scoped loader. Structurally
    // satisfies the kernel's `ReflexionLoaderPort` (recentReflexions +
    // recentGuidelines): tenant-wide, userId optional, `pruned_at IS NULL`,
    // and reads the consolidated `reflexion_guidelines`. Degrades to [] on
    // any DB fault so the read-back side never breaks a turn.
    reflexionLoader = createDrizzleReflexionLoader(db);
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
  if (ownerStyleReader) {
    // Cross-session ToM — the kernel's `OwnerStyleReaderPort`
    // (kernel-types.ts) is the { getStyleHint, refine } slice of the
    // richer `OwnerStyleService`. Assign-by-key keeps the duck-type
    // narrowing happy. NOTE: this reaches the kernel ONLY once
    // `composeSovereign`'s config forwards `ownerStyleReader` — that
    // passthrough is the one non-owned wiring seam flagged in the
    // manifest; until then this binding is inert (silently dropped).
    mutable.ownerStyleReader = ownerStyleReader;
  }
  // C5 — Voyager skill retriever (READ side). Threaded onto the kernel
  // deps via `composeSovereign({ skillRetriever })` so kernel step 4f
  // renders the "Available learned skills:" fragment. Optional/additive:
  // only set when the DB is up (the retriever needs the registry reader).
  if (skillRetriever) mutable.skillRetriever = skillRetriever;
  // autoHaikuJudge defaults to true in compose; we leave it unset.

  // Wave-C C4 follow-up (affectReader) — inject the SHARED per-tenant affective
  // accumulator so this tenant's turns `observe(...)` into the SAME instance the
  // proactive worker reads via `getAffectAccumulator(tenantId)`. Without this,
  // compose mints a fresh per-brain accumulator and the worker's earned-trust
  // resolver would read an always-empty posterior. `composeSovereign` honours a
  // caller-supplied accumulator (config.affectiveAccumulator ?? fresh), so this
  // wins. The accumulator is pure in-memory + TTL-evicting — never throws.
  mutable.affectiveAccumulator = getAffectAccumulator(scope.tenantId);

  // Wave-C SALIENCE ARENA (C1 win #3) — bind the slow-loop READ ports that
  // light up the arena's DRIVE + ACT-R ACTIVATION sub-bidders. `composeSovereign`
  // ALREADY forwards both (compose.ts:576 situationalSnapshotReader, :580
  // pendingProposalReader), so these reach kernel step 6's `buildActivationBids`
  // / `buildDriveBids` and join the live affect path. Only wired when the DB is
  // up (both readers are durable reads); arena degrades to affect-only without.
  if (db) {
    mutable.situationalSnapshotReader = buildSituationalSnapshotReader(db);
    mutable.pendingProposalReader = buildPendingProposalReader(
      db as unknown as DbExecLike,
    );
    // Conflict-monitored effort recruitment (C1) defaults ON inside the kernel
    // when its inputs exist; we leave `conflictRecruitmentEnabled` UNSET so the
    // kernel's safe default governs (an explicit env lever is a future seam).
  }

  // Wave-12 — thread the Reflexion ports onto the kernel deps. `composeSovereign`
  // forwards both verbatim (compose.ts:541-542) so the kernel's read-at-start
  // (step 4e/4f) and write-at-session-end (step 13) reflexion steps go live.
  if (reflexionRetriever) mutable.reflexionRetriever = reflexionRetriever;
  if (reflexionWriter) mutable.reflexionWriter = reflexionWriter;

  // iq-reflexion-dark-3 (CLOSED) — the THIRD reflexion seam, the task-scoped
  // `reflexionLoader` (kernel.ts step F11 ~1429, `ReflexionLoaderPort`), is now
  // LIVE. This is the read-back side of the compounding loop. Both blockers the
  // prior deferral noted are resolved:
  //   1. compose.ts NOW declares a `reflexionLoader` field on
  //      `SovereignComposeConfig` and copies it onto `kernelDeps`, so the
  //      binding below actually reaches the kernel guard (no longer dropped).
  //   2. `@borjie/database` NOW ships `createDrizzleReflexionLoader(db)` — the
  //      correct adapter (TENANT-WIDE, userId OPTIONAL, `pruned_at IS NULL`,
  //      surfacing importance/cluster/taskId AND reading the consolidated
  //      `reflexion_guidelines`). It degrades to [] on any DB fault.
  // With both wired the loop closes end-to-end: write-on-surprise →
  // nightly-sleep consolidate → read-back-at-session-start.
  if (reflexionLoader) mutable.reflexionLoader = reflexionLoader;

  // Wave-12/EP-3 — Self-RAG grounding judge. The kernel's self-rag step
  // (kernel.ts step ~1732, guarded by `if (deps.selfRagJudge)`) tags each
  // retrieved chunk with IsREL/IsSUP/IsUSE tokens and fail-closes a
  // financial/contractual claim whose support is low. No composition root
  // populated `selfRagJudge`, so the gate was inert. We build a Haiku-backed
  // judge (single critic call returning the tokens in `reasonText`) ONLY when
  // a real Anthropic client is present, mirroring the debate-port pattern.
  if (anthropic) {
    mutable.selfRagJudge = buildSelfRagJudge(anthropic);
  }

  // LP-30 — wire the semantic-cache (LP-03) + intent-verifier (LP-04) ports
  // onto the `composeSovereign` config. The kernel CONSUMES both
  // (`BrainKernelDeps.semanticCache` / `.intentVerifier` + their `*Enabled`
  // flags — see `packages/central-intelligence/src/kernel/kernel.ts`). These
  // four keys ride the `composeSovereign` config object below, which is the
  // canonical composition-root seam for kernel deps.
  //
  // Both ports are fail-safe:
  //   - semantic cache: embedding-keyed read-through/write-through scoped per
  //     (tenant, surface, persona). Reuses the SAME embedder the skill
  //     retriever uses; with no OpenAI key the embedder is the null sentinel
  //     and every lookup skips (cache inert, never wrong). Default ENABLED.
  //   - intent verifier: adapts autonomy-governance `verifyIntent`. ADVISORY
  //     by default (logs what WOULD block; never blocks). Flip
  //     `BORJIE_INTENT_VERIFY_STRICT=1` for fail-closed enforcement.
  const lp30Logger = {
    info: (meta: object, msg: string) => logger.info(meta as Record<string, unknown>, msg),
    warn: (meta: object, msg: string) => logger.warn(meta as Record<string, unknown>, msg),
  };
  // EVERY-POWER-ON — semantic-cache (LP-03) is a WIRED, fail-safe capability
  // (embedding-keyed read-through; a null embedder or a miss falls through to
  // the normal sensor path; it only ever stores `answer` decisions — never a
  // refusal/softened reply). Its wiring resolves the master flag via
  // `flagDefaultOff(BORJIE_SEMANTIC_CACHE_ENABLED)`, so we flip the DEFAULT to
  // ON by passing a derived env where the flag reads `'true'` UNLESS the
  // operator explicitly set an off value. The operator force-OFF revert
  // (`BORJIE_SEMANTIC_CACHE_ENABLED=0|false|off`) is preserved verbatim.
  const semanticCache = buildSemanticCachePort({
    embedder: resolveSkillEmbedder(),
    env: defaultOnEnv(process.env, 'BORJIE_SEMANTIC_CACHE_ENABLED'),
    logger: lp30Logger,
  });
  mutable.semanticCache = semanticCache.port;
  mutable.semanticCacheEnabled = semanticCache.enabled;

  const intentVerifier = buildIntentVerifierPort({ logger: lp30Logger });
  mutable.intentVerifier = intentVerifier.port;
  mutable.intentVerificationEnabled = intentVerifier.enabled;

  logger.info(
    {
      wiring: 'lp30',
      semanticCacheEnabled: semanticCache.enabled,
      intentVerifierEnabled: intentVerifier.enabled,
      intentVerifierPosture: intentVerifier.posture,
    },
    'lp30: semantic-cache + intent-verifier ports wired into kernel deps',
  );

  // Wave-3 — bind the kernel debate port onto the MAIN kernel deps. The
  // kernel reads `deps.debate` at step 7 and (only at high/critical stakes
  // AND when `shouldDebate(req)` returns true) replaces the single sensor
  // call with an N-voice debate. Only wired when a real Anthropic sensor is
  // present — a debate needs a live model. Default OFF via
  // `BORJIE_KERNEL_DEBATE_ENABLED`; the wall-clock budget + empty-outcome
  // fail-safe mean a slow debate falls back to the single-shot sensor and
  // never stalls a turn. Propose-only: debate shapes the answer text, never
  // actuates the sovereign rail.
  if (anthropic) {
    // EVERY-POWER-ON — the stakes-gated multi-voice debate detour is a WIRED
    // capability that only fires at high/critical stakes AND when the kernel's
    // own `debateEligible` agrees, behind a wall-clock + token budget whose
    // overrun fails SAFE to the single-shot sensor. It needs a live model, so
    // it is only built when a real (circuit-breaker + OTel wrapped) Anthropic
    // client is present (the stub-sensor CI/eval path never constructs it →
    // zero behaviour change there). Its wiring resolves the master flag via
    // `organFlagDefaultOff(BORJIE_KERNEL_DEBATE_ENABLED)`, so we flip the
    // DEFAULT to ON via a derived env (operator force-OFF
    // `BORJIE_KERNEL_DEBATE_ENABLED=0|false|off` still wins). Propose-only:
    // debate shapes answer text, never actuates the sovereign rail.
    const debate = buildDebateKernelPort({
      anthropic,
      env: defaultOnEnv(process.env, 'BORJIE_KERNEL_DEBATE_ENABLED'),
      logger: lp30Logger,
    });
    mutable.debate = debate.port;
    logger.info(
      { wiring: 'kernel-debate', debateEnabled: debate.enabled },
      'kernel-debate: stakes-gated multi-voice debate port wired into kernel deps',
    );
  }

  // Stage 1 — orchestrator main-loop wire onto the LIVE kernel. Build the
  // router + dispatcher + durable memory tool + the 9 production hook
  // ports and set `mutable.orchestrator` BEFORE composeSovereign so the
  // kernel constructs with the wire in place. `useByDefault` is LEFT UNSET
  // so the kernel's `resolveOrchestratorRoutingEnabled` controls routing
  // (DEFAULT-ON; `KERNEL_USE_ORCHESTRATOR=false` hard-kill +
  // `BORJIE_ORCHESTRATOR_MAINLOOP=0/false/off` soft-disable revert to the
  // proven persona / master-brain stack). Only wired when BOTH the
  // (sensor-wrapped) Anthropic client AND the DB are present — the router
  // needs the `.messages.create` SDK shape, and the durable memory tool +
  // the DB-backed hook ports (denylist / cost-circuit / audit / ledger-
  // seal) need a live Drizzle handle. When either is absent the kernel
  // keeps the legacy persona pipeline exactly as before.
  if (anthropic && db) {
    maybeWireOrchestratorBlock({
      mutable,
      anthropic,
      db,
      scope,
    });
  }

  return composeSovereign(mutable as Parameters<typeof composeSovereign>[0]);
}

// ---------------------------------------------------------------------------
// Stage 1 — orchestrator main-loop block builder (LIVE kernel).
//
// Mirrors how `brain-kernel-wiring.ts::createBrainKernelWiring` constructs
// the orchestrator wire, but for the production `getSovereignBrain` path:
//
//   (a) `KernelAnthropicSdkLike` — the sensor-wrapped `anthropic` client
//       already exposes `.messages.create` (circuit-breaker + OTel +
//       cost-ledger), so the router inherits all three for free.
//   (b) a BRAIN tool registry built via `createBrainToolRegistry` +
//       `registerSeedBrainTools` (NOT the agency executor registry) — this
//       is the catalog the main-loop searches + dispatches over.
//   (c) `createDrizzleMemoryTool(db)` — durable working memory.
//   (d) the 9 production hook ports via `buildOrchestratorBindings`.
//
// Fail-safe: any construction fault logs a warning and leaves
// `mutable.orchestrator` UNSET so the kernel falls back to the legacy
// persona pipeline. The orchestrator wire must never break kernel boot.
// ---------------------------------------------------------------------------

/**
 * Placeholder seed-tool deps — mirrors `brain-kernel-wiring.ts`. The three
 * read-side executors (`lookupTenantArrears`, `checkComplianceCertificate`,
 * `getMarketRateBand`) surface a structured "not yet wired" error so the
 * brain-tool registry boots end-to-end; the two PURE PM tools registered by
 * `registerSeedBrainTools` (`computeKraMri`, `triageMaintenanceTicket`) are
 * real deterministic functions. The FULL persona catalog is bridged on top of
 * these (see `buildPersonaCatalogForScope`), so the orchestrator's live
 * capability is the persona catalog, not these seeds.
 */
function buildOrchestratorSeedToolDeps(): SeedBrainToolDeps {
  const notWired = async (_input: unknown): Promise<never> => {
    throw new Error(
      'sovereign-orchestrator: seed tool executor is not yet wired to a domain adapter',
    );
  };
  return {
    lookupTenantArrears: notWired as never,
    checkComplianceCertificate: notWired as never,
    getMarketRateBand: notWired as never,
  };
}

/**
 * Read the kill-switch open state from env, fail-CLOSED on any ambiguity.
 * Mirrors the CLAUDE.md hard rule ("Kill-switch fail-closed. Never catch +
 * ignore its errors."): `KILLSWITCH_STATE=HALT` (or `OPEN`) opens the switch;
 * any read fault is treated as OPEN so the catalog returns empty. The persona
 * path resolves this from the service-registry's kill-switch port; the
 * sovereign composition root has no registry handle, so it reads the same env
 * lever the kernel's `createEnvKillswitchPort` reads.
 */
function resolveKillSwitchOpenFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  try {
    const raw = env.KILLSWITCH_STATE?.trim().toUpperCase();
    return raw === 'HALT' || raw === 'OPEN';
  } catch {
    // Fail closed — any read fault means we must assume the switch is open.
    return true;
  }
}

/**
 * Map the composition root's `SovereignScope.role` (SovereignRole) to the
 * RBAC role the persona-gate's `resolvePersonaSlug` consumes. Returns the
 * literal RBAC tokens the index.ts gate switches on so the SAME slug
 * resolution applies on the orchestrator path.
 */
function rbacRoleForSovereignRole(
  role: SovereignRole | undefined,
): string {
  switch (role) {
    case 'owner':
      return 'OWNER';
    case 'org-admin':
    case 'sovereign':
      return 'PLATFORM_ADMIN';
    case 'manager':
      return 'MANAGER';
    case 'tenant':
    default:
      // Brain-chat default surface — matches the index.ts persona-gate
      // fallback (T1 owner strategist).
      return 'OWNER';
  }
}

/**
 * Build the per-scope persona gate (kill-switch + loopback http client + Pino
 * audit sink + role→persona-slug resolution) EXACTLY as `index.ts` does, then
 * the FULL persona tool-handler catalog bound to the durable Drizzle
 * MemoryTool. The gate's `resolvePersonaSlug` keys off the scope's role (a
 * cached-brain constant) rather than per-call actor metadata, so the
 * orchestrator dispatches the right per-persona ceiling.
 *
 * The loopback client requires `JWT_SECRET` (≥32 chars) to mint a per-call
 * service token; absent it, handlers fall back to their defensive non-claiming
 * branches (never a fabricated row) — identical to the persona path's degraded
 * behaviour.
 */
function buildPersonaCatalogForScope(args: {
  readonly db: NonNullable<ReturnType<typeof getDb>>;
  readonly scope: SovereignScope;
}): ReturnType<typeof buildPersonaToolHandlers> {
  const env = process.env;
  const jwtSecret = env.JWT_SECRET ?? '';
  const gatewayPort = Number(env.PORT ?? '4001') || 4001;
  const personaLoopbackClient =
    jwtSecret.length >= 32
      ? createLoopbackHttpClient({
          origin: `http://127.0.0.1:${gatewayPort}`,
          apiPrefix: '/api/v1',
          jwtSecret,
          logger: {
            warn: (ctx, msg): void =>
              logger.warn(ctx as Record<string, unknown>, msg),
          },
        })
      : undefined;
  if (!personaLoopbackClient) {
    logger.warn(
      { jwtSecretLen: jwtSecret.length },
      'sovereign-orchestrator: persona-tool loopback HTTP client unbound — JWT_SECRET missing or <32 chars; handlers will use defensive fallbacks',
    );
  }

  const rbacRole = rbacRoleForSovereignRole(args.scope.role);
  const gate: PersonaToolGate = {
    killSwitchOpen: resolveKillSwitchOpenFromEnv(env),
    // The persona slug is fixed by the cached brain's scope role (not by
    // per-call actor metadata, which the orchestrator dispatcher does not
    // thread into the kernel `BrainToolSpec.executor`). This is the SAME
    // role-derived slug the index.ts gate resolves from `actor.role`.
    resolvePersonaSlug(): string {
      if (rbacRole === 'OWNER') return 'T1_owner_strategist';
      if (rbacRole === 'PLATFORM_ADMIN') return 'T2_admin_strategist';
      if (rbacRole === 'MANAGER') return 'T3_module_manager';
      return 'T1_owner_strategist';
    },
    auditSink: createPinoAuditSink(logger),
    ...(personaLoopbackClient && { httpClient: personaLoopbackClient }),
  };

  return buildPersonaToolHandlers(gate, {
    onDuplicate: (toolId) =>
      logger.warn({ toolId }, 'sovereign-orchestrator: duplicate persona descriptor ignored'),
    // Durable brain memory — the SAME Drizzle backend (agent_memory) the
    // kernel scratchpad + the persona path's mwikila.memory.* tools use.
    memoryTool: createDrizzleMemoryTool(args.db),
  });
}

function maybeWireOrchestratorBlock(args: {
  readonly mutable: Record<string, unknown>;
  readonly anthropic: NonNullable<AnthropicMessagesClient>;
  readonly db: NonNullable<ReturnType<typeof getDb>>;
  readonly scope: SovereignScope;
}): void {
  try {
    // (b) BRAIN tool registry — the catalog the main-loop searches +
    // dispatches over. Seeded with the PM tools (placeholder executors)
    // exactly as brain-kernel-wiring builds it; the deterministic registry
    // layer enforces every tool's Zod schema regardless of executor state.
    const toolRegistry: BrainToolRegistry = createBrainToolRegistry();
    registerSeedBrainTools(toolRegistry, buildOrchestratorSeedToolDeps());

    // FULL-POWERS parity — bridge the proven persona catalog onto the SAME
    // registry so the orchestrator's toolSearch + dispatcher + 9-hook chain
    // see the complete mwikila.* / memory / data-analysis / org-admin /
    // damage-settlement / jurisdiction tool set. Registration is per-tool
    // defensive (a name collision is logged + skipped). The persona handlers
    // are REAL (the loopback client makes mwikila.* actions actually execute).
    const personaHandlers = buildPersonaCatalogForScope({
      db: args.db,
      scope: args.scope,
    });
    const bridgeRole = args.scope.role as BridgeSovereignRole | undefined;
    const personaRegistered = registerPersonaToolsOnRegistry({
      registry: toolRegistry,
      handlers: personaHandlers,
      scope: {
        tenantId: args.scope.tenantId,
        userId: args.scope.userId,
        ...(bridgeRole ? { role: bridgeRole } : {}),
      },
      // Stable per-brain thread id for tool provenance. The orchestrator's
      // per-turn thread id is not threaded into the kernel BrainToolSpec
      // executor, so we use a scope-stable id; WRITE-tool provenance still
      // carries tenant + actor for the "via Mr. Mwikila" pill.
      threadId: `sovereign-orchestrator:${args.scope.tenantId ?? '__platform__'}:${args.scope.userId ?? '__nouser__'}`,
      logger: {
        warn: (meta, msg) => logger.warn(meta, msg),
      },
    });

    // (d) 9 production hook ports — PII scrub / permission / four-eye /
    // denylist / rate-limit / cost-circuit / sandbox-divert / audit /
    // ledger-seal. The hook chain is scoped to THIS brain's tenant (the cache
    // key already isolates per tenant); platform-tier brains fall back to the
    // '_platform' sentinel. Per-turn tenant scope also rides on `req.scope`.
    const approvalGate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const bindings = buildOrchestratorBindings({
      db: args.db,
      approvalGate,
      toolRegistry,
      tenantId: args.scope.tenantId ?? '_platform',
      env: process.env,
      logger: {
        info: (meta: object, msg: string) =>
          logger.info(meta as Record<string, unknown>, msg),
        warn: (meta: object, msg: string) =>
          logger.warn(meta as Record<string, unknown>, msg),
      },
    });

    // (a)+(c) Assemble the block: REAL Anthropic router over the sensor-
    // wrapped `.messages.create` client, REAL dispatcher over the brain
    // tool registry, durable Drizzle memory tool, + the 9 hook ports.
    // `useByDefault` is UNSET inside the builder so the kernel's resolver
    // governs routing (DEFAULT-ON with the env reverts).
    //
    // COG-07/AUT-14 — `buildOrchestratorComposeBlock` ALSO constructs the
    // modality arbiter (the 7-way output head) + binds its skill/modality
    // dispatcher handlers when `BORJIE_MODALITY_ARBITER` is on (read from the
    // `envSource` below). DEFAULT-OFF: the arbiter is not constructed and this
    // sovereign path behaves byte-identically to today (chat/action only). The
    // arbiter can route to an action but it still hits the policy-gate + 9-hook
    // chain — money/licence/deletion stay dual-control HITL; no rail bypassed.
    args.mutable.orchestrator = buildOrchestratorComposeBlock({
      // The sensor-wrapped client structurally satisfies `KernelAnthropicSdkLike`
      // (`.messages.create`); cast at the boundary to the builder's narrow shape.
      anthropicMessagesClient:
        args.anthropic as unknown as Parameters<
          typeof buildOrchestratorComposeBlock
        >[0]['anthropicMessagesClient'],
      toolRegistry,
      bindings,
      envSource: process.env,
      db: args.db,
      logger: {
        info: (meta: object, msg: string) =>
          logger.info(meta as Record<string, unknown>, msg),
        warn: (meta: object, msg: string) =>
          logger.warn(meta as Record<string, unknown>, msg),
      },
    });

    logger.info(
      {
        wiring: 'sovereign-orchestrator',
        mainLoopThreaded: true,
        defaultOn: true,
        hardKillFlag: 'KERNEL_USE_ORCHESTRATOR=false',
        softDisableFlag: 'BORJIE_ORCHESTRATOR_MAINLOOP=0|false|off',
        hooks: bindings.hookChain.list().map((h) => `${h.name}:${h.stage}`),
        // FULL-POWERS parity proof — the orchestrator's live catalog size.
        // Seed PM tools (5) + the bridged persona catalog. A non-trivial
        // count is the at-boot signal that the orchestrator is no longer
        // running the degraded 5-tool seed catalog.
        personaToolsRegistered: personaRegistered,
        totalToolsRegistered: toolRegistry.list().length,
      },
      'sovereign-orchestrator: main-loop wired onto LIVE kernel (router + dispatcher + durable memory + 9 hooks + FULL persona catalog); DEFAULT-ON',
    );
  } catch (err) {
    // Fail-safe — never break kernel boot. Leaving `mutable.orchestrator`
    // unset keeps the kernel on the proven legacy persona pipeline.
    logger.warn(
      { value: err instanceof Error ? err.message : err },
      'sovereign-orchestrator: orchestrator-block construction failed; kernel keeps the legacy persona pipeline',
    );
  }
}

// ---------------------------------------------------------------------------
// Skill-retriever embedder resolver (C5 READ side).
//
// Mirrors `brain-kernel-wiring.ts::resolveEmbedder`: prefer a dedicated
// `OPENAI_EMBEDDING_API_KEY` (operators can split embedding + generation
// keys), fall back to `OPENAI_API_KEY`. When neither is set we return the
// always-rejects `createNullEmbedder()` sentinel; the caller passes
// `embedder: null` into `createSkillRetriever` so retrieval degrades to
// an empty fragment without an extra branch. Never throws — a malformed
// construction falls back to the null embedder so kernel boot is uniform.
//
// The retriever's `description_embedding` column is pgvector(1536), which
// matches `createOpenAiEmbedder`'s default `text-embedding-3-small`
// (1536 dims); the registry's `sanitizeEmbedding` drops any off-dim
// vector defensively, so a mismatch degrades to a keyless-but-safe write.
// ---------------------------------------------------------------------------

export function resolveSkillEmbedder(): EmbedderPort {
  const apiKey =
    (process.env.OPENAI_EMBEDDING_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim()) ??
    '';
  if (!apiKey) return createNullEmbedder();
  try {
    return createOpenAiEmbedder({ apiKey });
  } catch (err) {
    logger.warn('sovereign-composition: skill embedder construction failed; using null embedder', { value: err instanceof Error ? err.message : err });
    return createNullEmbedder();
  }
}

// ---------------------------------------------------------------------------
// Wave-C SALIENCE ARENA readers (C1 win #3) — built from existing services.
//
// `buildSituationalSnapshotReader` wraps the SAME durable situational-model
// store the resident EstateMind loop writes (createDrizzleSituationalModelStore)
// in the kernel's pure `createSituationalModel(...)` so the arena's ACT-R
// activation sub-bidder reads the per-tenant snapshot the slow loop persists.
//
// `buildPendingProposalReader` reads back the gated `tab_event_log`
// proactive_nudge rows the slow loop's `createTabEventLogProposalSink` writes
// (one per breached standing drive, carrying driveId + breachSeverity + urgency
// in the snapshot jsonb) and projects each into the kernel's `EstateProposal`
// shape so the arena's DRIVE sub-bidder competes them.
//
// Both fail-safe: any read fault degrades to null / [] so the arena simply has
// fewer bidders (it never throws out of a turn; affect bids still compete).
// ---------------------------------------------------------------------------

/** Read port the kernel's `situationalSnapshotReader` dep consumes. */
function buildSituationalSnapshotReader(
  db: NonNullable<ReturnType<typeof getDb>>,
): { read(tenantId: string): Promise<situationalModelKernel.SituationalSnapshot | null> } {
  const arenaLogger = createPinoLikeLogger('salience-arena-snapshot');
  const store = createDrizzleSituationalModelStore(
    db as unknown as Parameters<typeof createDrizzleSituationalModelStore>[0],
    arenaLogger,
  );
  const model = situationalModelKernel.createSituationalModel({
    store,
    logger: {
      warn: (msg, meta) => arenaLogger.warn(meta ?? {}, msg),
    },
  });
  return {
    async read(tenantId: string) {
      try {
        return await model.snapshot(tenantId);
      } catch (err) {
        arenaLogger.warn(
          { tenantId, err: err instanceof Error ? err.message : String(err) },
          'salience-arena: snapshot read failed — arena drops activation bids this turn',
        );
        return null;
      }
    },
  };
}

interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

function nudgeRowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Read port the kernel's `pendingProposalReader` dep consumes — projects the
 * persisted, undelivered `proactive_nudge` rows into `EstateProposal`s. The
 * snapshot jsonb (written by `createTabEventLogProposalSink`) carries the
 * driveId / urgency / breachSeverity / evidence the arena's drive bidder reads.
 */
function buildPendingProposalReader(
  db: DbExecLike,
): import('@borjie/central-intelligence').estateMind.PendingProposalReader {
  const readerLogger = createPinoLikeLogger('salience-arena-pending');
  return {
    async read({ tenantId, limit }) {
      try {
        const result = await db.execute(sqlForPendingNudges(tenantId, limit));
        return nudgeRowsOf(result)
          .map((row) => projectNudgeToProposal(row, tenantId))
          .filter((p): p is NonNullable<typeof p> => p !== null);
      } catch (err) {
        readerLogger.warn(
          { tenantId, err: err instanceof Error ? err.message : String(err) },
          'salience-arena: pending-proposal read failed — arena drops drive bids this turn',
        );
        return [];
      }
    },
  };
}

/** Parameterised SELECT for the tenant's undelivered proactive_nudge rows. */
function sqlForPendingNudges(tenantId: string, limit: number): unknown {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(50, Math.floor(limit)) : 3;
  return drizzleSql`
    SELECT proposal_id, snapshot, notes, created_at
      FROM tab_event_log
     WHERE tenant_id  = ${tenantId}
       AND event_kind = 'proactive_nudge'
       AND COALESCE((snapshot ->> 'delivered')::boolean, false) = false
     ORDER BY created_at DESC
     LIMIT ${safeLimit}
  `;
}

/** Project one persisted nudge row into the kernel's `EstateProposal` shape. */
function projectNudgeToProposal(
  row: Record<string, unknown>,
  tenantId: string,
):
  | import('@borjie/central-intelligence').estateMind.EstateProposal
  | null {
  const proposalId = typeof row.proposal_id === 'string' ? row.proposal_id : '';
  if (!proposalId) return null;
  const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
  const driveId = typeof snapshot.driveId === 'string' ? snapshot.driveId : 'estate-visibility';
  const breachSeverity =
    typeof snapshot.breachSeverity === 'number' && Number.isFinite(snapshot.breachSeverity)
      ? Math.min(1, Math.max(0, snapshot.breachSeverity))
      : 0.5;
  const urgencyRaw = typeof snapshot.urgency === 'string' ? snapshot.urgency : 'high';
  const urgency = (['low', 'medium', 'high', 'critical'].includes(urgencyRaw)
    ? urgencyRaw
    : 'high') as import('@borjie/central-intelligence').estateMind.EstateProposal['urgency'];
  const evidenceEntityIds = Array.isArray(snapshot.evidenceEntityIds)
    ? (snapshot.evidenceEntityIds.filter((e) => typeof e === 'string') as string[])
    : [];
  const proposedAtMs =
    typeof snapshot.proposedAtMs === 'number' && Number.isFinite(snapshot.proposedAtMs)
      ? snapshot.proposedAtMs
      : row.created_at instanceof Date
        ? row.created_at.getTime()
        : Date.now();
  const headline = typeof row.notes === 'string' ? row.notes : proposalId;
  return Object.freeze({
    tenantId,
    id: proposalId,
    driveId: driveId as import('@borjie/central-intelligence').estateMind.EstateProposal['driveId'],
    title: headline.slice(0, 200),
    rationale: headline,
    urgency,
    breachSeverity,
    evidenceEntityIds,
    proposedAtMs,
  });
}

// ---------------------------------------------------------------------------
// Wave-C C4 follow-up (affectReader) — per-TENANT affective accumulator.
//
// The kernel's ToM affective accumulator carries the per-(tenant,user) trust
// posterior the proactive worker's earned-trust resolver reads. Previously the
// accumulator was minted fresh inside `composeSovereign(...)` per cached brain,
// so the proactive worker (which is tenant-scoped, constructed in index.ts) had
// no way to read what the turn wrote — its `affectReader` was left unwired and
// earned-trust de-escalation stayed conservative-neutral.
//
// We now construct ONE accumulator PER TENANT here, inject the SAME instance
// into every cached brain for that tenant via `mutable.affectiveAccumulator`
// (so all of a tenant's turns `observe(...)` into it), and expose it to the
// worker via `getAffectAccumulator(tenantId)`. The accumulator discriminates
// per-(tenant,user) internally (`read(tenantId, userId)`), so a single per-
// tenant instance is correct: each user's posterior stays isolated by key.
//
// Pure in-memory + TTL-evicting (24h) — no DB dependency, so this is always
// available (honest-degrade is N/A: the accumulator simply starts empty and
// `read(...)` returns null → the worker treats trust as neutral, exactly the
// pre-wiring posture, until the first turn populates it).
// ---------------------------------------------------------------------------

const affectAccumulatorByTenant = new Map<string, AffectiveAccumulator>();

/**
 * Return the shared per-tenant affective accumulator. The SAME instance is
 * injected into that tenant's brains (so turns write to it) and read by the
 * proactive worker's earned-trust resolver (so it reads what the turns wrote).
 * Lazily minted; the platform-tier (null tenant) shares the `__platform__` key.
 */
export function getAffectAccumulator(
  tenantId: string | null,
): AffectiveAccumulator {
  const key = tenantId ?? '__platform__';
  const existing = affectAccumulatorByTenant.get(key);
  if (existing) return existing;
  const fresh = createAffectiveAccumulator();
  affectAccumulatorByTenant.set(key, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Wave-C C4 — expose the live behaviour-signal source to the proactive-intel
// worker (constructed in index.ts). The source is built per-(tenant,user)-scope
// inside `build()` over the Drizzle sensorium-event-log; for the worker (which
// is tenant-scoped, not request-scoped) we expose a STANDALONE platform-scoped
// instance over the same service so `signalsForUser(...)` reads the same ribbon.
// Lazy-built + cached; null when the DB is down (worker honest-degrades).
// ---------------------------------------------------------------------------

let behaviorSignalSourceSingleton:
  | ReturnType<typeof createBehaviorSignalSource>
  | null
  | undefined;

/**
 * Return the live ambient behaviour-signal source for the proactive worker's
 * affect gate. Built from the SAME `createSensoriumEventLogService(db)` +
 * `createBehaviorSignalSource(...)` the kernel turn already uses, so the worker
 * reads the identical derived-signal ribbon. Returns null when the DB is down.
 */
export function getProactiveBehaviorSignalSource():
  | ReturnType<typeof createBehaviorSignalSource>
  | null {
  if (behaviorSignalSourceSingleton !== undefined) {
    return behaviorSignalSourceSingleton;
  }
  const db = getDb();
  if (!db) {
    behaviorSignalSourceSingleton = null;
    return null;
  }
  try {
    behaviorSignalSourceSingleton = createBehaviorSignalSource(
      createSensoriumEventLogService(db),
    );
  } catch (err) {
    logger.warn(
      { value: err instanceof Error ? err.message : err },
      'sovereign-composition: behaviour-signal source for proactive worker unbuildable — affect gate stays dormant',
    );
    behaviorSignalSourceSingleton = null;
  }
  return behaviorSignalSourceSingleton;
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
// Follow-up agent-loop (#33): when the api-gateway grows an agent-loop
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

// ---------------------------------------------------------------------------
// Self-RAG grounding judge (Wave-12 / EP-3 dark-organ closure).
//
// The kernel's `SelfRagJudge` is a SINGLE critic call:
//   (text: string) => Promise<{ score; reasonText?; suggestedFix? }>
// `runSelfRag` composes the probe + parses IsREL/IsSUP/IsUSE tokens from
// `reasonText`. We back it with a Haiku completion over the wrapped
// (circuit-breaker + OTel) Anthropic client. The judge NEVER throws — on any
// fault it returns a neutral score so the kernel's EP-3 fail-closed policy
// (inside runSelfRag, stakes-gated) decides whether to block, not us.
// ---------------------------------------------------------------------------

const SELF_RAG_JUDGE_MODEL = 'claude-haiku-4-5';

const SELF_RAG_JUDGE_SYSTEM =
  'You are a grounding auditor. Given an AI response plus its retrieved ' +
  'evidence, emit ONLY three tokens on one line in the exact form ' +
  '`REL=<high|partial|low> SUP=<high|partial|low> USE=<high|partial|low>` ' +
  'where REL=relevance of evidence to the claim, SUP=whether each claim is ' +
  'actually supported by the evidence, USE=whether the response solves the ' +
  "user's task. Output nothing else.";

function buildSelfRagJudge(
  anthropic: AnthropicMessagesClient,
): (text: string) => Promise<{
  score: number;
  reasonText?: string;
  suggestedFix?: string;
}> {
  return async (text: string) => {
    try {
      const response = (await anthropic.messages.create({
        model: SELF_RAG_JUDGE_MODEL,
        max_tokens: 64,
        system: SELF_RAG_JUDGE_SYSTEM,
        messages: [{ role: 'user', content: text.slice(0, 8_000) }],
      })) as {
        content?: ReadonlyArray<{ type?: string; text?: string }>;
      };
      const reasonText = (response.content ?? [])
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
        .trim();
      // A coarse numeric score from the tokens — high support reads as
      // grounded. `runSelfRag` re-parses the tokens itself; the score is a
      // secondary signal only.
      const score = scoreFromTokens(reasonText);
      return { score, reasonText };
    } catch {
      // Side-channel — never bubble. Neutral score; runSelfRag's stakes-gated
      // EP-3 policy handles the high-stakes fail-closed path.
      return { score: 0.5, reasonText: '' };
    }
  };
}

/** Map the IsSUP token in the judge text to a coarse 0..1 grounding score. */
function scoreFromTokens(reasonText: string): number {
  const sup = /SUP\s*=\s*(high|partial|low)/i.exec(reasonText)?.[1]?.toLowerCase();
  if (sup === 'high') return 0.9;
  if (sup === 'partial') return 0.6;
  if (sup === 'low') return 0.2;
  return 0.5;
}
