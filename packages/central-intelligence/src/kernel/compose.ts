/**
 * Composition root — wires the kernel from a small high-level config
 * into a fully-configured BrainKernel + ApprovalGate + briefing
 * composer + nudge router.
 *
 * Most consumers only need:
 *
 *   const sov = composeSovereign({
 *     anthropicClient,
 *     substrateSinks,                  // from @borjie/database
 *     cohortSource,                    // optional
 *     approvalStore,                   // optional, defaults in-memory
 *     priorTurnsLoader,                // optional
 *   });
 *   sov.kernel.think(...);
 *   sov.briefing.compose(...);
 *   sov.nudges.route(...);
 *   sov.approvals.propose(...) / sign(...);
 *
 * Provider-agnostic at the Sensor port; you can pass any Sensor[] if
 * you don't have an Anthropic client (e.g. tests).
 */

import { createBrainKernel, type BrainKernel } from './kernel.js';
import { createBrainCache } from './brain-cache.js';
// Phase E.5.1 — orchestrator wire-up. The composition root builds the
// 9-hook PreToolUse / PostToolUse / Stop chain from the same ports that
// already flow through `composeSovereign(...)`. Callers that don't
// supply the new orchestrator config keep the legacy 13-step pipeline
// verbatim; callers that do get the Claude-Code-style main-loop as
// the primary code path.
import {
  createHookChain,
  type Hook,
  type HookChain,
} from './orchestrator/hook-chain.js';
import {
  createPiiScrubHook,
  type PiiScrubberPort,
} from './orchestrator/hooks/pre-tool-use/pii-scrub-hook.js';
import {
  createPermissionHook,
  type ToolScopePort,
} from './orchestrator/hooks/pre-tool-use/permission-hook.js';
import {
  createFourEyeHook,
  type ToolApprovalPolicyPort,
} from './orchestrator/hooks/pre-tool-use/four-eye-hook.js';
import {
  createToolDenylistHook,
  type ToolDenylistPort,
} from './orchestrator/hooks/pre-tool-use/tool-denylist-hook.js';
import {
  createRateLimitHook,
  createInMemoryRateLimitCounter,
  type RateLimitCounter,
} from './orchestrator/hooks/pre-tool-use/rate-limit-hook.js';
import {
  createCostCircuitHook,
  type CostCircuitPort,
} from './orchestrator/hooks/pre-tool-use/cost-circuit-hook.js';
import {
  createSandboxDivertHook,
  type SandboxResolverPort,
} from './orchestrator/hooks/pre-tool-use/sandbox-divert-hook.js';
import {
  createAuditEmissionHook,
  createInMemoryAuditEmissionSink,
  type AuditEmissionSink,
} from './orchestrator/hooks/post-tool-use/audit-emission-hook.js';
import {
  createLedgerSealHook,
  createInMemoryLedgerSeal,
  type LedgerSealPort,
} from './orchestrator/hooks/stop/ledger-seal-hook.js';
import {
  createInMemoryPlanStore,
  type PlanStore,
} from './orchestrator/plan.js';
import {
  createInMemorySessionStore,
  type SessionStore,
} from './orchestrator/checkpoint.js';
import {
  createContextBudget,
  createInMemoryToolSearch,
  type ContextBudget,
  type ToolSearch,
} from './orchestrator/context-budget.js';
import {
  createInMemoryMemoryTool,
  type MemoryTool,
} from './orchestrator/memory-tool.js';
import type {
  Dispatcher,
  LLMRouter,
  OrchestratorDeps,
} from './orchestrator/main-loop.js';
import type { PersonaBrandingResolver } from './branding.js';
import { createSensorRouter, type SensorRouter } from './sensor-failover.js';
import {
  createCotReservoir,
  createInMemoryCotReservoirSink,
  createInMemoryPersonaDriftSink,
  createInMemoryProvenanceSink,
} from './cot-reservoir.js';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  type ApprovalGate,
  type ApprovalPolicyResolver,
  type ApprovalStore,
} from './four-eye-approval.js';
import { createBriefingComposer } from './briefing.js';
import { createNudgeRouter, createInMemoryNudgeDedupe, type NudgeDedupeStore } from './proactive-nudge.js';
import {
  ANTHROPIC_SENSOR_PRESETS,
  type AnthropicMessagesClient,
} from './sensors/anthropic-sensor.js';
import type {
  AgencyKernelPort,
  CotReservoirSink,
  FeedbackMemoryPort,
  GroundingFactsProvider,
  MemoryHierarchy,
  MultiLLMSynthesizerPort,
  PersonaDriftSink,
  ProvenanceSink,
  Sensor,
} from './kernel-types.js';
import type { CohortSource } from './cohort-signal.js';
import { createAnthropicJudge } from './sensors/anthropic-judge.js';
import type { KillswitchPort } from './killswitch.js';
import type { DecisionTraceRecorder } from './decision-trace.js';
import {
  createAffectiveAccumulator,
  type AffectiveAccumulator,
} from './theory-of-mind.js';
import {
  createCognitiveLoadAccumulator,
  type CognitiveLoadAccumulator,
} from './cognitive-load.js';
import type { BrainToolRegistry } from './tool-spec.js';
import type { TextEmbedder } from './kernel-types.js';
// A2b-2 wire #7 — boot-time Ed25519 registry signature gate.
import {
  enforceToolRegistrySignatureAtBoot,
  serializeRegistry,
  type SignableSpec,
} from './tool-spec/tool-registry-signing.js';

export interface SubstrateSinks {
  readonly cot: CotReservoirSink;
  readonly drift: PersonaDriftSink;
  readonly provenance: ProvenanceSink;
}

export interface ComposeSovereignConfig {
  readonly anthropicClient?: AnthropicMessagesClient;
  readonly extraSensors?: ReadonlyArray<Sensor>;
  readonly substrateSinks?: SubstrateSinks;
  readonly cohortSource?: CohortSource;
  readonly groundingFacts?: GroundingFactsProvider;
  readonly approvalStore?: ApprovalStore;
  readonly nudgeDedupe?: NudgeDedupeStore;
  /**
   * Optional per-tenant persona-branding resolver. The kernel calls
   * this before rendering the identity preamble so an agency can
   * re-skin the AI's displayName / openingPreamble / voice profile id
   * without touching the surface-default personas.
   */
  readonly brandingResolver?: PersonaBrandingResolver;
  /**
   * Optional LITFIN-style four-tier memory hierarchy. When provided,
   * the kernel reads semantic facts + the latest reflective digest at
   * step 4 and writes episodic rows at step 13. Composition roots in
   * the api-gateway pass the Drizzle-backed services from
   * `@borjie/database`; tests pass in-memory fakes.
   */
  readonly memory?: MemoryHierarchy;
  /**
   * Optional online-learning feedback port. When provided, the kernel
   * fetches the user's last 10 feedback entries at step 4 (memory
   * recall) and mixes the verbatim corrections + per-category
   * negative-rate into the system prompt. Adapters live in
   * `@borjie/database` (Drizzle service `createFeedbackService`);
   * tests pass in-memory fakes.
   */
  readonly feedback?: FeedbackMemoryPort;
  /**
   * Optional agency port — the brain's "acts in full control" stack.
   * When provided the kernel mixes ACTIVE goals into its system prompt
   * at step 4, so the next turn references the persistent objective
   * stack. The full executor + wake-loop live above the kernel.
   */
  readonly agency?: AgencyKernelPort;
  readonly priorTurnsLoader?: (
    threadId: string,
  ) => Promise<ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>>;
  readonly recentTurnCounter?: (threadId: string) => Promise<number>;
  /**
   * Custom judge override. When omitted and `anthropicClient` is
   * provided, compose wires a Haiku-backed judge automatically.
   */
  readonly judge?: (text: string) => Promise<{
    readonly score: number;
    readonly reasonText?: string;
    readonly suggestedFix?: string;
  }>;
  /**
   * Set false to disable the auto-Haiku judge even when the
   * Anthropic client is present (e.g. cost-sensitive surfaces).
   * Default: true.
   */
  readonly autoHaikuJudge?: boolean;
  readonly clock?: () => Date;
  readonly rng?: () => number;
  /**
   * Optional administrative killswitch. When wired, the kernel runs a
   * Step 0 short-circuit before any sensor / memory / cohort work. The
   * api-gateway composition root constructs an env-backed port via
   * `createEnvKillswitchPort(process.env)`.
   */
  readonly killswitch?: KillswitchPort;
  /**
   * Optional decision-trace recorder. When wired, every `think()` call
   * captures the ordered step breadcrumb (durations, summaries, errors)
   * for ops audit. Failures are swallowed.
   */
  readonly traceRecorder?: DecisionTraceRecorder;
  /**
   * Uncertainty-policy switch. Default: `'off'` for back-compat. When
   * `'on'`, step 11a runs after confidence scoring and may caveat /
   * ask-back / escalate based on confidence and stakes. The api-
   * gateway wiring resolves this from the `BORJIE_UNCERTAINTY_POLICY`
   * env var.
   */
  readonly uncertaintyPolicy?: 'off' | 'on';
  /**
   * Optional resolver for per-action role-group approval policies.
   * Passed through to `createApprovalGate` so high-stakes write
   * actions (eviction.propose, owner_payout.disburse, etc.) consult
   * a DB-backed policy table at propose-time instead of the legacy
   * "any 2 distinct admins" default.
   */
  readonly approvalPolicyResolver?: ApprovalPolicyResolver;
  /**
   * Optional per-(tenant, user) cognitive-load accumulator. When
   * supplied, the kernel observes each turn's per-turn score against
   * the accumulator and renders a cross-turn directive
   * (`renderLoadDirectiveWithProfile`) instead of the per-turn one.
   * Defaults to a fresh in-memory accumulator when omitted.
   */
  readonly cognitiveLoadAccumulator?: CognitiveLoadAccumulator;
  /**
   * Optional per-(tenant, user) affective (theory-of-mind)
   * accumulator. When supplied, the kernel observes each turn's
   * per-turn MindState against the accumulator and renders a
   * cross-turn behavioural directive
   * (`renderMindStateDirectiveWithProfile`). Defaults to a fresh
   * in-memory accumulator when omitted.
   */
  readonly affectiveAccumulator?: AffectiveAccumulator;
  /**
   * Optional brain-tool registry. When supplied and the kernel
   * decides to invoke one of the 5 PM seed tools, the registry runs
   * the deterministic executor and the kernel mixes the result into
   * the prompt context for the next sensor call.
   */
  readonly toolRegistry?: BrainToolRegistry;
  /**
   * Optional text embedder. When wired, the memory-recall step
   * produces a query embedding from the user message (when the
   * caller did not supply one) and prefers `searchByEmbedding`.
   */
  readonly embedder?: TextEmbedder;
  // ── C5 (Progressive Intelligence) coordination zone ────────────────
  /**
   * Optional Voyager-style skill retriever. Wired by the api-gateway
   * composition root from the Drizzle-backed `skill_registry` table.
   */
  readonly skillRetriever?: import('./skill-library/skill-retriever.js').SkillRetriever;
  /**
   * Optional Reflexion retriever (read-at-session-start). Wired by the
   * api-gateway composition root from the Drizzle-backed
   * `reflexion_buffer` table.
   */
  readonly reflexionRetriever?: import('./reflexion/reflexion-retriever.js').ReflexionRetriever;
  /**
   * Optional Reflexion writer (write-at-session-end). Same composition
   * source as the retriever.
   */
  readonly reflexionWriter?: import('./reflexion/reflexion-writer.js').ReflexionWriterPort;
  /**
   * Optional Self-RAG critic. When wired, the kernel runs IsREL /
   * IsSUP / IsUSE reflection tokens after the sensor result is
   * normalised. Same shape as the legacy judge port.
   */
  readonly selfRagJudge?: import('./self-rag/self-rag.js').SelfRagJudge;
  // ── C4 (Sensorium / Brain Skin) coordination zone ──────────────────
  /**
   * Optional behaviour-signal source. When wired (production: by the
   * api-gateway composition root, backed by the Drizzle sensorium-
   * event-log service via `createBehaviorSignalSource(...)` in
   * `@borjie/ai-copilot`), step 4 (memory recall) reads recent
   * derived signals (`engagement.high`, `frustration.detected`,
   * `task.completed-without-AI`, `dwell.deep`) and mixes them into
   * the system prompt as the brain's mind-state inference channel.
   * Failures are swallowed — the brain-skin is a side-channel.
   */
  readonly behaviorSignalSource?: import('./kernel-types.js').BehaviorSignalSourcePort;
  /**
   * Optional multi-LLM synthesizer port. When wired, turns carrying
   * `req.requireSynthesis === true` route through a mixture-of-agents
   * fan-out (Anthropic + OpenAI + DeepSeek by default) plus a Claude
   * Opus synthesis pass. Default OFF (per-turn opt-in) so the cost
   * profile of existing single-shot callers is unchanged. The
   * api-gateway composition root constructs the port via
   * `createBrainSynthesizerPort(...)` in
   * `services/api-gateway/src/composition/multi-llm-synthesizer-wiring.ts`.
   */
  readonly synthesizer?: MultiLLMSynthesizerPort;
  /**
   * Phase E.5.1 — orchestrator wire-up.
   *
   * When supplied, the kernel's `think()` / `thinkStream()` calls
   * delegate to the Claude-Code-style main-loop orchestrator (the
   * PreToolUse / PostToolUse / Stop hook substrate + Plan tree +
   * Budget + Memory tool). The 9 built-in hooks fire in order:
   *
   *   1. `pii-scrub`        — transforms tool inputs to strip PII
   *   2. `permission`       — denies on missing granted scopes
   *   3. `four-eye-approval`— asks owner when an action requires sign-off
   *   4. `tool-denylist`    — denies killswitched / banned tool names
   *   5. `rate-limit`       — denies on per-thread/per-tool quota breach
   *   6. `cost-circuit`     — denies on per-tenant USD ceiling breach
   *   7. `sandbox-divert`   — routes shadow-mode calls to a sandbox
   *   8. `audit-emission`   — emits an audit row per dispatch (PostToolUse)
   *   9. `ledger-seal`      — seals the per-session chain at Stop
   *
   * Every port is optional — when omitted the composition root binds
   * an in-memory / no-op stand-in so the kernel still constructs. The
   * `router` + `dispatcher` are required (the orchestrator delegates
   * sensor + tool-execution to them) and the composition root throws
   * when the block is supplied without those two fields.
   *
   * Setting `useByDefault: false` (or env `KERNEL_USE_ORCHESTRATOR=false`)
   * runs the legacy 13-step pipeline despite the wire — useful for an
   * incident-time canary rollback.
   */
  readonly orchestrator?: {
    /** Sensor call router — converts (system, tools, messages) → Decision. */
    readonly router: LLMRouter;
    /** Tool / response actuator — runs the Decision and returns DispatchResult. */
    readonly dispatcher: Dispatcher;
    /** Defaults to TRUE — flip to FALSE to revert per-instance. */
    readonly useByDefault?: boolean;
    // Hook ports — every port is optional; sensible defaults bind.
    readonly piiScrubber?: PiiScrubberPort;
    readonly toolScopes?: ToolScopePort;
    readonly approvalPolicy?: ToolApprovalPolicyPort;
    readonly toolDenylist?: {
      readonly globalDenylist?: ReadonlyArray<string>;
      readonly dynamic?: ToolDenylistPort;
    };
    readonly rateLimit?: {
      readonly counter?: RateLimitCounter;
      readonly maxCallsPerWindow?: number;
      readonly windowMs?: number;
    };
    readonly costCircuit?: CostCircuitPort;
    readonly sandboxResolver?: SandboxResolverPort;
    readonly auditSink?: AuditEmissionSink;
    readonly ledgerSeal?: LedgerSealPort;
    // Orchestrator-side stores — all optional, in-memory defaults bind.
    readonly planStore?: PlanStore;
    readonly sessionStore?: SessionStore;
    readonly contextBudget?: ContextBudget;
    readonly toolSearch?: ToolSearch;
    readonly memoryTool?: MemoryTool;
  };
}

export interface SovereignBrain {
  readonly kernel: BrainKernel;
  readonly approvals: ApprovalGate;
  readonly briefing: ReturnType<typeof createBriefingComposer>;
  readonly nudges: ReturnType<typeof createNudgeRouter>;
  readonly router: SensorRouter;
}

export function composeSovereign(config: ComposeSovereignConfig): SovereignBrain {
  const sensors: Sensor[] = [];
  if (config.anthropicClient) {
    sensors.push(
      ANTHROPIC_SENSOR_PRESETS.opus47(config.anthropicClient),
      ANTHROPIC_SENSOR_PRESETS.sonnet46(config.anthropicClient),
      ANTHROPIC_SENSOR_PRESETS.haiku45(config.anthropicClient),
    );
  }
  if (config.extraSensors) sensors.push(...config.extraSensors);
  if (sensors.length === 0) {
    throw new Error('composeSovereign requires at least one sensor (anthropicClient or extraSensors)');
  }

  const clock = config.clock ?? (() => new Date());
  const router = createSensorRouter({ sensors, clock: () => clock().getTime() });
  const cache = createBrainCache({ clock: () => clock().getTime() });

  const sinks: SubstrateSinks =
    config.substrateSinks ?? {
      cot: createInMemoryCotReservoirSink(),
      drift: createInMemoryPersonaDriftSink(),
      provenance: createInMemoryProvenanceSink(),
    };

  const reservoirDeps: { sink: typeof sinks.cot; rng?: () => number } = { sink: sinks.cot };
  if (config.rng) reservoirDeps.rng = config.rng;
  const reservoir = createCotReservoir(reservoirDeps);

  // Auto-Haiku judge when Anthropic client present and no override.
  let resolvedJudge = config.judge;
  if (!resolvedJudge && config.anthropicClient && config.autoHaikuJudge !== false) {
    resolvedJudge = createAnthropicJudge(config.anthropicClient);
  }

  const kernelDeps: Parameters<typeof createBrainKernel>[0] = {
    sensors,
    router,
    cache,
    cotReservoir: reservoir,
    driftSink: sinks.drift,
    provenanceSink: sinks.provenance,
    clock,
  };
  if (config.cohortSource)      (kernelDeps as any).cohort = config.cohortSource;
  if (config.groundingFacts)    (kernelDeps as any).groundingFacts = config.groundingFacts;
  if (config.priorTurnsLoader)  (kernelDeps as any).priorTurnsLoader = config.priorTurnsLoader;
  if (config.recentTurnCounter) (kernelDeps as any).recentTurnCounter = config.recentTurnCounter;
  if (resolvedJudge)            (kernelDeps as any).judge = resolvedJudge;
  if (config.rng)               (kernelDeps as any).rng = config.rng;
  if (config.brandingResolver)  (kernelDeps as any).brandingResolver = config.brandingResolver;
  if (config.memory)            (kernelDeps as any).memory = config.memory;
  if (config.feedback)          (kernelDeps as any).feedback = config.feedback;
  if (config.agency)            (kernelDeps as any).agency = config.agency;
  if (config.killswitch)        (kernelDeps as any).killswitch = config.killswitch;
  if (config.traceRecorder)     (kernelDeps as any).traceRecorder = config.traceRecorder;
  if (config.uncertaintyPolicy) (kernelDeps as any).uncertaintyPolicy = config.uncertaintyPolicy;
  if (config.toolRegistry) {
    // A2b-2 wire #7 — Ed25519 boot-time registry signature gate.
    // When TOOL_REGISTRY_SIGNATURE_HEX + TOOL_REGISTRY_PUBKEY_HEX
    // env vars are set, verify the registry's declarative shape
    // (name, tier, requiresApproval, schema sigs) against the
    // signature. Mismatch throws so the kernel refuses to start.
    // Both env vars unset → warning + boot (dev mode).
    const declarative: ReadonlyArray<SignableSpec> = config.toolRegistry
      .list()
      .map((spec) => {
        const s = spec as unknown as Record<string, unknown>;
        const result: SignableSpec = {
          name: typeof s.name === 'string' ? s.name : '',
          description:
            typeof s.description === 'string' ? s.description : '',
          tier: typeof s.tier === 'string' ? s.tier : 'unknown',
          requiresApproval:
            typeof s.requiresApproval === 'boolean'
              ? s.requiresApproval
              : false,
        };
        if (typeof s.schemaInSig === 'string') {
          (result as { schemaInSig?: string }).schemaInSig = s.schemaInSig;
        }
        if (typeof s.schemaOutSig === 'string') {
          (result as { schemaOutSig?: string }).schemaOutSig = s.schemaOutSig;
        }
        return result;
      });
    enforceToolRegistrySignatureAtBoot({
      canonical: serializeRegistry(declarative),
    });
    (kernelDeps as any).toolRegistry = config.toolRegistry;
  }
  if (config.embedder)          (kernelDeps as any).embedder = config.embedder;
  if (config.synthesizer)       (kernelDeps as any).synthesizer = config.synthesizer;
  // C5 — Progressive Intelligence.
  if (config.skillRetriever)    (kernelDeps as any).skillRetriever = config.skillRetriever;
  if (config.reflexionRetriever) (kernelDeps as any).reflexionRetriever = config.reflexionRetriever;
  if (config.reflexionWriter)   (kernelDeps as any).reflexionWriter = config.reflexionWriter;
  if (config.selfRagJudge)      (kernelDeps as any).selfRagJudge = config.selfRagJudge;
  // C4 — Sensorium / Brain Skin.
  if (config.behaviorSignalSource) (kernelDeps as any).behaviorSignalSource = config.behaviorSignalSource;
  // Cognitive-load + affective accumulators are always wired so the
  // kernel can render cross-turn directives. Callers that pass their
  // own instance (e.g. tests asserting cross-call state) win;
  // otherwise we mint a fresh in-memory accumulator per kernel.
  (kernelDeps as any).cognitiveLoadAccumulator =
    config.cognitiveLoadAccumulator ?? createCognitiveLoadAccumulator();
  (kernelDeps as any).affectiveAccumulator =
    config.affectiveAccumulator ?? createAffectiveAccumulator();

  // Phase E.5.1 — orchestrator wire-up.
  // When the caller supplies the orchestrator block, build the 9-hook
  // chain + the 5 orchestrator-side stores and pass the assembled
  // OrchestratorDeps into the kernel. The kernel's `think()` then
  // delegates the whole turn to the main loop (unless useByDefault is
  // explicitly false).
  if (config.orchestrator) {
    const orchestratorDeps = buildOrchestratorDeps(config.orchestrator);
    const orchestratorWire: {
      deps: OrchestratorDeps;
      useByDefault?: boolean;
    } = { deps: orchestratorDeps };
    if (typeof config.orchestrator.useByDefault === 'boolean') {
      orchestratorWire.useByDefault = config.orchestrator.useByDefault;
    }
    (kernelDeps as any).orchestrator = orchestratorWire;
  }

  const kernel = createBrainKernel(kernelDeps);

  const approvalGateDeps: Parameters<typeof createApprovalGate>[0] = {
    store: config.approvalStore ?? createInMemoryApprovalStore(),
    clock,
  };
  if (config.approvalPolicyResolver) {
    (approvalGateDeps as { policyResolver?: ApprovalPolicyResolver }).policyResolver =
      config.approvalPolicyResolver;
  }
  const approvals = createApprovalGate(approvalGateDeps);

  const briefing = createBriefingComposer({ kernel });

  const nudges = createNudgeRouter({
    kernel,
    dedupe: config.nudgeDedupe ?? createInMemoryNudgeDedupe(),
    clock,
  });

  return { kernel, approvals, briefing, nudges, router };
}

// ─────────────────────────────────────────────────────────────────────
// Phase E.5.1 — orchestrator deps builder.
//
// Constructs the 9-hook chain + the 5 orchestrator-side stores from the
// caller-supplied ports. Every port has a no-op / in-memory default so
// callers that opt into the orchestrator without wiring all 9 hooks
// (e.g. early development, tests) still get a working main loop.
// ─────────────────────────────────────────────────────────────────────

type OrchestratorConfig = NonNullable<ComposeSovereignConfig['orchestrator']>;

function buildOrchestratorDeps(cfg: OrchestratorConfig): OrchestratorDeps {
  const hookChain = buildHookChain(cfg);
  const planStore: PlanStore = cfg.planStore ?? createInMemoryPlanStore();
  const sessionStore: SessionStore =
    cfg.sessionStore ?? createInMemorySessionStore();
  const contextBudget: ContextBudget =
    cfg.contextBudget ?? createContextBudget();
  const toolSearch: ToolSearch =
    cfg.toolSearch ?? createInMemoryToolSearch([]);
  const memoryTool: MemoryTool =
    cfg.memoryTool ?? createInMemoryMemoryTool();

  return {
    router: cfg.router,
    toolSearch,
    hookChain,
    planStore,
    sessionStore,
    memoryTool,
    contextBudget,
    dispatcher: cfg.dispatcher,
  };
}

/**
 * Assemble the 9-hook PreToolUse / PostToolUse / Stop chain.
 *
 * Pre-tool-use (executed in declared order; first non-allow short-
 * circuits the chain):
 *   1. pii-scrub          (always wired — defaults to a no-op scrubber)
 *   2. permission         (always wired — empty scope map is a no-op)
 *   3. four-eye-approval  (always wired — default policy says nothing
 *                          requires approval)
 *   4. tool-denylist      (always wired — empty list is a no-op)
 *   5. rate-limit         (always wired — in-memory counter + a high
 *                          per-window ceiling so off-the-shelf use
 *                          doesn't trip the gate)
 *   6. cost-circuit       (always wired — default port reports $0
 *                          projected so nothing trips the ceiling)
 *   7. sandbox-divert     (always wired — default resolver returns null
 *                          so production tooling executes)
 *
 * Post-tool-use:
 *   8. audit-emission     (always wired — defaults to in-memory sink)
 *
 * Stop:
 *   9. ledger-seal        (always wired — defaults to in-memory ledger)
 */
function buildHookChain(cfg: OrchestratorConfig): HookChain {
  const hooks: Hook[] = [];

  // 1. PII scrub — pure-text transform that strips PII from tool input.
  const piiScrubber: PiiScrubberPort = cfg.piiScrubber ?? {
    scrub(text: string): { scrubbed: string; hasPii: boolean } {
      return { scrubbed: text, hasPii: false };
    },
  };
  hooks.push(createPiiScrubHook({ scrubber: piiScrubber }));

  // 2. Permission — denies when caller is missing a required scope.
  const toolScopes: ToolScopePort = cfg.toolScopes ?? {
    requiredScopes(): ReadonlyArray<string> {
      return [];
    },
  };
  hooks.push(createPermissionHook({ scopes: toolScopes }));

  // 3. Four-eye approval — defaults to "no tool requires approval" so
  // back-compat is preserved for callers who don't wire the policy port.
  const approvalPolicy: ToolApprovalPolicyPort = cfg.approvalPolicy ?? {
    requiresApproval(): boolean {
      return false;
    },
    async approvalStatus(): Promise<
      'none' | 'pending' | 'approved' | 'rejected'
    > {
      return 'approved';
    },
  };
  hooks.push(createFourEyeHook({ policy: approvalPolicy }));

  // 4. Tool denylist — globalDenylist + optional dynamic port.
  const denylistDeps: {
    globalDenylist?: ReadonlyArray<string>;
    dynamic?: ToolDenylistPort;
  } = {};
  if (cfg.toolDenylist?.globalDenylist) {
    denylistDeps.globalDenylist = cfg.toolDenylist.globalDenylist;
  }
  if (cfg.toolDenylist?.dynamic) {
    denylistDeps.dynamic = cfg.toolDenylist.dynamic;
  }
  hooks.push(createToolDenylistHook(denylistDeps));

  // 5. Rate limit — defaults to a permissive 10_000 / min ceiling so
  // tests + back-compat callers never trip it.
  const rateLimitCounter: RateLimitCounter =
    cfg.rateLimit?.counter ?? createInMemoryRateLimitCounter();
  hooks.push(
    createRateLimitHook({
      counter: rateLimitCounter,
      maxCallsPerWindow: cfg.rateLimit?.maxCallsPerWindow ?? 10_000,
      windowMs: cfg.rateLimit?.windowMs ?? 60_000,
    }),
  );

  // 6. Cost circuit — defaults to a port that reports $0 / $∞ so the
  // hook never trips when no breaker is wired.
  const costCircuit: CostCircuitPort = cfg.costCircuit ?? {
    async project(): Promise<{ projectedUsd: number; ceilingUsd: number }> {
      return { projectedUsd: 0, ceilingUsd: Number.POSITIVE_INFINITY };
    },
  };
  hooks.push(createCostCircuitHook({ breaker: costCircuit }));

  // 7. Sandbox divert — defaults to "no divert" so production tooling
  // executes verbatim.
  const sandboxResolver: SandboxResolverPort = cfg.sandboxResolver ?? {
    async resolve(): Promise<string | null> {
      return null;
    },
  };
  hooks.push(createSandboxDivertHook({ resolver: sandboxResolver }));

  // 8. Audit emission (PostToolUse) — every successful or failed
  // dispatch lays down a row.
  const auditSink: AuditEmissionSink =
    cfg.auditSink ?? createInMemoryAuditEmissionSink();
  hooks.push(createAuditEmissionHook({ sink: auditSink }));

  // 9. Ledger seal (Stop) — closes the per-session chain.
  const ledger: LedgerSealPort = cfg.ledgerSeal ?? createInMemoryLedgerSeal();
  hooks.push(createLedgerSealHook({ ledger }));

  return createHookChain(hooks);
}
