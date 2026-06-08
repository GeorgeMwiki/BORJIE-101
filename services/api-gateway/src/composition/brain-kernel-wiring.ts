/**
 * AUTONOMOUS-MD CHARTER (read first):
 *   This kernel is the engine of Mr. Mwikila — Borjie's AI Mining Operations
 *   Manager. The 5 operating principles in
 *   `docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md` are the DNA every wiring
 *   below must honour. Map of principle → kernel section:
 *
 *     - "Always Hungry"            -> decision-trace recorder (every turn
 *                                     ends with a 1%-better candidate;
 *                                     trace recorder is the breadcrumb).
 *     - "Never Sleeps"             -> separate processes: see
 *                                     services/sleep-pass-orchestrator and
 *                                     services/proactive-triggers-worker;
 *                                     this kernel is the read-path they
 *                                     converge into when the owner returns.
 *     - "Anticipatory, not        -> brain-tool registry (tab_spawn +
 *        Reactive"                   pre-fill tools) + persona mode router
 *                                     (Build/Strategy modes pre-stage the
 *                                     next-three-moves).
 *     - "Cite or Stay Silent"      -> uncertainty-policy gate + corpus
 *                                     lookup tool; the persona's
 *                                     EVIDENCE_RULES block enforces it at
 *                                     the prompt boundary.
 *     - "Owner-Aligned Authority"  -> approval-gate port + killswitch port;
 *                                     Tier 2 actions short-circuit through
 *                                     these before reaching any executor.
 *
 *   Any new kernel feature MUST declare which principle it serves.
 *
 * Brain-kernel wiring — composes the central-intelligence `BrainKernel`
 * at the api-gateway composition root so consuming wirings (today: the
 * voice agent; later: every AI-native surface) can route turns through
 * the disciplined 13-step pipeline instead of bespoke per-surface LLM
 * calls.
 *
 * Wave-K Tier-2 T1 wired the optional governance + cognition ports
 * onto the kernel:
 *
 *   - Env-driven killswitch (`createEnvKillswitchPort`) reads HALT /
 *     DEGRADED state from `KILLSWITCH_STATE` and per-tenant
 *     `KILLSWITCH_TENANT_<id>` env vars. The kernel runs a step 0
 *     short-circuit before any sensor work.
 *   - Always-on decision-trace recorder
 *     (`createDecisionTraceRecorder` over the in-memory store with a
 *     200-trace per-tenant cap) emits a per-thought breadcrumb of every
 *     step traversed. Exposed on the wiring slot so future admin routes
 *     can pull recent traces for an ops UI.
 *   - Uncertainty-policy gate, opt-in via the
 *     `BORJIE_UNCERTAINTY_POLICY=on` env var. Default `'off'` to
 *     preserve baseline test contracts (the heuristic confidence
 *     scorer is permissive against synthetic short replies and would
 *     trip the caveat / escalate paths if turned on indiscriminately).
 *   - Brain-tool registry seeded with the 5 PM tools
 *     (`registerSeedBrainTools`). The default seed-deps surface a
 *     "not yet wired" error; concrete Drizzle adapters land in a
 *     follow-up via the `seedToolDeps` deps slot.
 *
 * When no Anthropic client is available (no `ANTHROPIC_API_KEY` at boot)
 * `createBrainKernelWiring` returns `null` so the registry can fall
 * back to the polite degraded stub the voice agent already ships
 * (`VOICE_BRAIN_NOT_CONFIGURED`). This mirrors the same null-fallback
 * pattern used by `predictive-interventions-wiring` and
 * `market-surveillance-wiring`.
 *
 * Tenant isolation: kernel construction is per-deployment. Every
 * `kernel.think(req)` call carries the calling tenant on
 * `req.scope` (kind: 'tenant') so memory recall, cohort signals, and
 * provenance writes scope correctly. The kernel never fans tenant
 * data across the composition surface.
 *
 * Type-safety: `BrainKernel` is derived via `ReturnType<typeof
 * createBrainKernel>` to dodge the package-barrel namespace drift
 * (TS2709) the rest of this composition layer also works around — see
 * `voice-agent-wiring.ts` for the same pattern.
 */

import {
  composeSovereign,
  createApprovalGate,
  createBrainKernel,
  createBrainToolRegistry,
  createDecisionTraceRecorder,
  createEnvKillswitchPort,
  createInMemoryApprovalStore,
  createInMemoryDecisionTraceStore,
  createNullEmbedder,
  createOpenAiEmbedder,
  orchestrator,
  registerSeedBrainTools,
  type ApprovalGate,
  type BrainToolRegistry,
  type BrainToolSpec,
  type DecisionTraceRecorder,
  type EmbedderPort,
  type KillswitchPort,
  type MultiLLMSynthesizerPort,
  type SeedBrainToolDeps,
} from '@borjie/central-intelligence';
import {
  miningCeoPersona,
  type MiningCeoPersona,
} from '@borjie/ai-copilot';
import {
  buildOrchestratorBindings,
  type OrchestratorBindings,
  // COG-07/AUT-14 — modality arbiter port builders (default-OFF rollout).
  buildSkillRetriever,
  buildFlowRetriever,
  buildModalityDescriptors,
  buildFlowPosturePort,
  buildAutonomyDecider,
  buildBodyChangePort,
  createLoopRunnerAdapter,
} from './orchestrator-bindings.js';
import {
  createSubMdSpawnHandler,
  type SpawnParentContext,
} from './sub-md-spawn-handler.js';
import {
  MINING_TOOL_NAMES,
  registerMiningGovernmentTools,
} from './mining-government-tools-pending.js';
// Durable orchestrator memory — the Drizzle-backed MemoryTool (agent_memory,
// migration 0302, FORCE RLS). When the kernel runs the orchestrator main-loop,
// recall()/persist key off the SAME persisted backend the mwikila.memory.*
// persona tools use, so the brain's working notebook survives restarts. Falls
// back to the bounded in-memory tool only when no db handle is present.
import { createDrizzleMemoryTool } from './memory/drizzle-memory-tool.js';

/**
 * Default on-disk path for the mining intelligence corpus (Docs/, GIS
 * polygons, regulation snapshots) consumed by the Master Brain's
 * `corpus.lookup` tool and by every mode's evidence-citation surface.
 *
 * Operators flip this via `MINING_CORPUS_PATH` env var at boot. Kept as
 * a module-level constant so wirings, doc tooling, and ops dashboards
 * agree on the default without hardcoding the literal path twice.
 */
export const DEFAULT_MINING_CORPUS_PATH =
  '/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/Boji project/Docs/';

/**
 * Concrete `BrainKernel` shape derived from the factory. Keeping the
 * derivation local sidesteps the namespace-vs-type drift the rest of
 * the composition layer also routes around (TS2709).
 */
export type BrainKernel = ReturnType<typeof createBrainKernel>;

/**
 * Structural duck-shape of the Anthropic Messages client the kernel
 * sensors expect. Mirrors `AnthropicMessagesClient` in
 * `@borjie/central-intelligence/kernel/sensors/anthropic-sensor`
 * but kept local so we can pass either an unguarded `AnthropicClient`'s
 * `.sdk` or a budget-guarded client's `.sdk` interchangeably.
 */
export interface KernelAnthropicSdkLike {
  readonly messages: {
    readonly create: (args: unknown) => Promise<unknown>;
  };
}

/**
 * Factory shape used at the composition root: the api-gateway constructs
 * a per-tenant `BudgetGuardedAnthropicClient` on demand. Voice-agent
 * turns currently do not flow through this guard at the kernel layer
 * (the kernel does not surface tenantId to its sensor calls); a follow-
 * up will lift tenant context into the sensor call args so the guard
 * can re-enter the loop. For now we accept the factory and pull a
 * single shared `.sdk` reference once at boot — usage is still tracked
 * by the voice-turns Drizzle adapter and the AI cost ledger sees the
 * downstream Anthropic SDK calls.
 */
export type BudgetGuardedAnthropicFactory = (
  tenantId: string,
  operation?: string,
) => { readonly sdk: KernelAnthropicSdkLike };

/**
 * Tenant id passed when we need to construct the budget-guarded client
 * once at boot to extract its `.sdk`. The actual per-tenant guarding
 * does not flow through the kernel's sensor calls today, so this id is
 * only used to satisfy the factory's `(tenantId, operation)` signature
 * and is never written to the cost ledger by the kernel itself.
 */
const KERNEL_BOOTSTRAP_TENANT_ID = '__kernel_bootstrap__';
const KERNEL_BOOTSTRAP_OPERATION = 'kernel.compose';

export interface BrainKernelWiringDeps {
  /**
   * Per-tenant Anthropic client factory built by the registry from
   * `ANTHROPIC_API_KEY`. When `null`, the wiring returns `null` so the
   * voice agent (and any future kernel consumer) drops to its degraded
   * fallback. The wiring deliberately does NOT throw here — the
   * gateway must boot end-to-end without external creds.
   */
  readonly buildBudgetGuardedAnthropicClient:
    | BudgetGuardedAnthropicFactory
    | null;
  /**
   * Optional structured logger. When provided, the wiring emits a
   * single info-level entry on successful kernel construction so
   * operators can confirm at boot that the central-intelligence brain
   * is online (vs. running with the degraded stub).
   */
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
  /**
   * Optional environment source for the killswitch port and the
   * uncertainty-policy flag. Defaults to `process.env` so production
   * reads the env-driven HALT / DEGRADED flags. Test rigs override
   * this with a plain object to exercise the kill-state and policy-
   * flag behaviours deterministically.
   */
  readonly envSource?: Readonly<Record<string, string | undefined>>;
  /**
   * Optional override of the tool-registry seed deps. Defaults to a
   * conservative stub set so the registry boots even when concrete
   * domain services have not yet been wired into the kernel. The
   * api-gateway will replace this with real Drizzle adapters in a
   * follow-up.
   */
  readonly seedToolDeps?: SeedBrainToolDeps;
  /**
   * Optional approval-policy resolver. When wired, the kernel's
   * four-eye-approval gate consults per-action role-group policies
   * at propose-time. The api-gateway composition root constructs
   * `createApprovalPolicyService(db)` and threads it in on the LIVE
   * path; the null-path keeps using the legacy default.
   *
   * Typed as `unknown` so this wiring file does not pick up a hard
   * type dependency on `@borjie/database`. The structural shape
   * already matches `ApprovalPolicyResolver` from the kernel; the
   * cast happens at the `composeSovereign` boundary.
   */
  readonly approvalPolicyResolver?: unknown;
  /**
   * Optional sensor-routing service (DB-backed `sensor_call_log`
   * writer + budget-envelope debiter). When wired, the wiring
   * surfaces it via the return slot so downstream consumers
   * (sensor adapters, ops endpoints) can record per-call telemetry
   * to the `sensor_call_log` table. Not consumed inside this
   * wiring itself — kernel-side sensor calls do not yet flow
   * through the routing service; an opt-in adapter lands as a
   * follow-up.
   */
  readonly sensorRoutingService?: SensorRoutingServicePort;
  /**
   * Optional HQ-tier tool registry — when wired, the wiring merges
   * its 12 `platform.*` BrainTools into the kernel's tool registry
   * alongside the 5 PM seed tools (K9). The Central Command admin
   * chat can then invoke them through the same disciplined pipeline
   * (Zod gates, audit-trail, four-eye approval for sovereign tiers).
   *
   * Typed as `unknown` so this file does not pick up a hard dependency
   * on the HQ-tool composition file's structural exports — the merge
   * loop only relies on the `.list()` + `.register()` shape of a
   * BrainToolRegistry.
   */
  readonly hqToolRegistry?: {
    readonly registry: BrainToolRegistry;
    readonly toolNames: ReadonlyArray<`platform.${string}`>;
  };
  /**
   * Phase F.3 — production-grade orchestrator hook-chain bindings.
   *
   * When provided, the wiring constructs the 9-hook PreToolUse /
   * PostToolUse / Stop chain via `buildOrchestratorBindings(...)` and
   * surfaces the assembled HookChain on the return value
   * (`wiring.orchestratorBindings`). The chain is NOT yet threaded into
   * `composeSovereign({ orchestrator: ... })` because the LLM router +
   * dispatcher adapters ship in a separate PR (see service-registry
   * comments on the `agent: null` slot). Once those land, the wiring
   * threads them in along with `bindings.deps` and the kernel's
   * `think()` route flips to the Claude-Code-style main-loop.
   *
   * Typed as `unknown` for the db slot to dodge the namespace-vs-type
   * drift (TS2709) the rest of this composition layer routes around.
   * The structural shape matches `DrizzleLike` in
   * `orchestrator-bindings.ts`.
   */
  readonly orchestratorBindings?: {
    /** Drizzle client (null in degraded mode). */
    readonly db: unknown | null;
    /** Optional caller-supplied tenant id (defaults to platform). */
    readonly tenantId?: string;
    /** Optional global denylist (always-banned tools). */
    readonly globalDenylist?: ReadonlyArray<string>;
    /** Optional approval gate override (defaults to in-memory store). */
    readonly approvalGate?: ApprovalGate;
    /** Optional proposer id for ledger writes. */
    readonly proposer?: string;
  };
  /**
   * Optional multi-LLM synthesizer port for the kernel's deep-reasoning
   * path. When wired, turns carrying `req.requireSynthesis === true` are
   * routed through a mixture-of-agents fan-out (Anthropic + OpenAI +
   * DeepSeek) plus a Claude-Opus synthesis pass. Null when no viable
   * synthesizer can be built — the kernel keeps the single-shot sensor
   * path with no behavioural change. Built by
   * `createMultiLLMSynthesizerWiring` (see multi-llm-synthesizer-wiring.ts).
   */
  readonly synthesizer?: MultiLLMSynthesizerPort | null;
  /**
   * Optional override for the on-disk path to the mining intelligence
   * corpus (regulations, GIS polygons, prior owner docs). When omitted,
   * the wiring reads `MINING_CORPUS_PATH` from `envSource` and falls
   * back to `DEFAULT_MINING_CORPUS_PATH`. Surfaced on the wiring's
   * return value so corpus readers (Document mode, Compliance mode) can
   * source documents from a single canonical location.
   */
  readonly miningCorpusPath?: string;
  /**
   * Optional override for the default Master Brain persona. Defaults to
   * `miningCeoPersona` (the 8-mode mining CEO persona). Tests may swap
   * in a fixture persona to exercise mode-routing edge cases without
   * dragging in the production mode catalogue.
   */
  readonly masterPersona?: MiningCeoPersona;
}

/**
 * Structural duck-shape of the `SensorRoutingService` from
 * `@borjie/database`. Kept local so this wiring file does not pick
 * up a hard type dependency on the database package. The real
 * `createSensorRoutingService(db)` returns an object matching this
 * shape and is wired by the api-gateway service-registry.
 */
export interface SensorRoutingServicePort {
  recordSensorCall(args: unknown): Promise<{ readonly id: string }>;
  getBudgetStatus(args: unknown): Promise<unknown>;
  selectSensorChain(task: string, tier?: unknown): unknown;
}

export interface BrainKernelWiring {
  readonly kernel: BrainKernel;
  /** Bound `kernel.think` reference safe to pass to other wirings. */
  readonly think: BrainKernel['think'];
  /**
   * Decision-trace recorder constructed at boot. Exposed so the
   * service-registry can surface it to ops UIs / admin routes
   * without re-constructing.
   */
  readonly decisionTraceRecorder: DecisionTraceRecorder;
  /** Env-backed killswitch port the kernel is using. */
  readonly killswitch: KillswitchPort;
  /** Seeded brain-tool registry the kernel is using. */
  readonly toolRegistry: BrainToolRegistry;
  /**
   * Resolved uncertainty-policy mode (`'on'` or `'off'`). Operators
   * flip this via `BORJIE_UNCERTAINTY_POLICY=on` once their
   * grounding-facts + judge wiring is in place. Default `'off'` to
   * preserve baseline test contracts.
   */
  readonly uncertaintyPolicy: 'on' | 'off';
  /**
   * Sensor-routing service exposed to downstream consumers when
   * the caller passed one in via `deps.sensorRoutingService`. Null
   * when no DB-backed service was wired.
   */
  readonly sensorRoutingService: SensorRoutingServicePort | null;
  /**
   * Embedder the kernel was composed with. When an OpenAI key was
   * present at boot this is a `createOpenAiEmbedder` instance;
   * otherwise it is `createNullEmbedder()` (always-rejects sentinel
   * the kernel catches and falls back to key-based recall).
   */
  readonly embedder: EmbedderPort;
  /**
   * Phase F.3 — production-grade orchestrator hook-chain bindings.
   * Null when the caller did not pass `deps.orchestratorBindings`.
   * Surfaces `{ hookChain, deps }` so a future composition extension
   * (LLM router + dispatcher adapter) can thread the chain into
   * `composeSovereign({ orchestrator: ... })` and flip kernel.think()
   * onto the Claude-Code-style main loop.
   */
  readonly orchestratorBindings: OrchestratorBindings | null;
  /**
   * Resolved on-disk path for the mining intelligence corpus. Reads
   * `MINING_CORPUS_PATH` from the env source, falls back to
   * `DEFAULT_MINING_CORPUS_PATH`. Downstream corpus readers source
   * documents from this path.
   */
  readonly miningCorpusPath: string;
  /**
   * Default Master Brain persona — the mining CEO persona (8 modes)
   * unless overridden via `deps.masterPersona`. Surfaced so route-side
   * mode routers can read `persona.modes` without re-importing the
   * persona module.
   */
  readonly masterPersona: MiningCeoPersona;
}

/**
 * Resolve the uncertainty-policy mode from the env var
 * `BORJIE_UNCERTAINTY_POLICY`. Default `'off'`.
 */
function resolveUncertaintyPolicyMode(
  env: Readonly<Record<string, string | undefined>>,
): 'on' | 'off' {
  const raw = env['BORJIE_UNCERTAINTY_POLICY'];
  if (!raw) return 'off';
  return raw.trim().toLowerCase() === 'on' ? 'on' : 'off';
}

/**
 * COG-07/AUT-14 — resolve whether the modality arbiter is enabled from
 * `BORJIE_MODALITY_ARBITER`. DEFAULT-OFF: only an explicit
 * `on`/`1`/`true`/`enabled` turns it on, so an unset / typo'd value keeps
 * today's chat/action-only behaviour (the safe default). Mirrors the
 * `BORJIE_ORCHESTRATOR_MAINLOOP` canary lever.
 */
function resolveModalityArbiterEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env['BORJIE_MODALITY_ARBITER'];
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'enabled';
}

/**
 * Default seed-tool deps — every executor returns a "not configured"
 * error so the registry boots end-to-end even when no concrete
 * adapter has been wired. The real Drizzle adapters land in a
 * follow-up; until then, the kernel knows the tool exists, the
 * deterministic registry layer enforces the input/output schema,
 * and the executor surfaces a structured failure rather than an
 * undefined return.
 */
function buildPlaceholderSeedToolDeps(): SeedBrainToolDeps {
  const notWired = async (_input: unknown): Promise<never> => {
    throw new Error(
      'brain-kernel: seed tool executor is not yet wired to a domain adapter',
    );
  };
  return {
    lookupTenantArrears: notWired as never,
    checkComplianceCertificate: notWired as never,
    getMarketRateBand: notWired as never,
  };
}

/**
 * Compose the central-intelligence `BrainKernel`. Returns `null` when
 * no LLM provider is wired so the registry can transparently fall back
 * to the voice agent's degraded stub (`VOICE_BRAIN_NOT_CONFIGURED`).
 *
 * The wiring is deliberately defensive:
 *   - if the factory call throws (network-init failure, malformed key),
 *     the wiring returns `null` after logging a warning rather than
 *     killing the gateway boot;
 *   - if `composeSovereign` itself throws (would happen only if no
 *     sensors were wired, which we guarantee by passing the Anthropic
 *     client), the wiring also returns `null` for the same reason.
 *
 * Side-effect-free for callers — every error is captured, never
 * propagated past the wiring boundary.
 */
export function createBrainKernelWiring(
  deps: BrainKernelWiringDeps,
): BrainKernelWiring | null {
  if (!deps.buildBudgetGuardedAnthropicClient) {
    return null;
  }

  let anthropicMessagesClient: KernelAnthropicSdkLike;
  try {
    const guarded = deps.buildBudgetGuardedAnthropicClient(
      KERNEL_BOOTSTRAP_TENANT_ID,
      KERNEL_BOOTSTRAP_OPERATION,
    );
    anthropicMessagesClient = guarded.sdk;
  } catch (err) {
    if (deps.logger?.warn) {
      deps.logger.warn(
        {
          wiring: 'brain-kernel',
          error: err instanceof Error ? err.message : String(err),
        },
        'brain-kernel: anthropic client construction failed; degrading',
      );
    }
    return null;
  }

  // Wave-K T1 — env-driven killswitch + always-on decision-trace
  // recorder. Both are constructed BEFORE composeSovereign so we can
  // forward them into the kernel deps and surface them on the wiring
  // return value for the service-registry's ops slots.
  const envSource = deps.envSource ?? process.env;
  const killswitch = createEnvKillswitchPort(envSource);
  const decisionTraceRecorder = createDecisionTraceRecorder({
    store: createInMemoryDecisionTraceStore({ capacity: 200 }),
  });

  // K9 — seed the brain-tool registry. The default seed-deps surface
  // a clear "not yet wired" error; concrete Drizzle adapters land in
  // a follow-up via `deps.seedToolDeps`.
  const toolRegistry = createBrainToolRegistry();
  try {
    registerSeedBrainTools(
      toolRegistry,
      deps.seedToolDeps ?? buildPlaceholderSeedToolDeps(),
    );
  } catch (err) {
    if (deps.logger?.warn) {
      deps.logger.warn(
        {
          wiring: 'brain-kernel',
          error: err instanceof Error ? err.message : String(err),
        },
        'brain-kernel: tool-registry seed failed; continuing with empty registry',
      );
    }
  }

  // C2 — merge the HQ-tier tool registry (12 `platform.*` tools) into
  // the kernel's tool registry. The HQ composition root already
  // registered each tool on a separate registry; here we re-register
  // each adapted spec on the kernel's registry so the kernel's tool-
  // execution loop sees them as a single catalog.
  if (deps.hqToolRegistry) {
    let mergedCount = 0;
    for (const spec of deps.hqToolRegistry.registry.list()) {
      try {
        toolRegistry.register(spec as BrainToolSpec);
        mergedCount += 1;
      } catch (err) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            {
              wiring: 'brain-kernel',
              tool: spec.name,
              error: err instanceof Error ? err.message : String(err),
            },
            'brain-kernel: failed to merge HQ tool into kernel registry',
          );
        }
      }
    }
    if (deps.logger?.info) {
      deps.logger.info(
        {
          wiring: 'brain-kernel',
          hqTools: mergedCount,
          hqToolNames: deps.hqToolRegistry.toolNames,
        },
        'brain-kernel: HQ tools merged into registry',
      );
    }
  }

  // Mining domain — register the three Tanzanian government API stubs
  // (BoT gold window, NEMC permit portal, GePG control numbers) on the
  // kernel's tool registry so the Master Brain can call them from any
  // mode without bespoke per-mode wiring. Stubs return deterministic
  // mock payloads carrying a `_stub: true` discriminator until the real
  // HTTP adapters land in MVP3+. Registration is idempotent — re-runs
  // during test wiring are no-ops.
  try {
    const registeredMiningTools = registerMiningGovernmentTools(toolRegistry);
    if (deps.logger?.info && registeredMiningTools.length > 0) {
      deps.logger.info(
        {
          wiring: 'brain-kernel',
          miningTools: registeredMiningTools,
          stub: true,
        },
        'brain-kernel: mining-domain TZ government tool stubs registered',
      );
    }
  } catch (err) {
    if (deps.logger?.warn) {
      deps.logger.warn(
        {
          wiring: 'brain-kernel',
          error: err instanceof Error ? err.message : String(err),
        },
        'brain-kernel: mining-tool registration failed; continuing',
      );
    }
  }

  // Operators flip this to `'on'` once their grounding-facts + judge
  // wiring is in place. Default `'off'` preserves baseline test
  // contracts in this and consuming wirings.
  const uncertaintyPolicy = resolveUncertaintyPolicyMode(envSource);

  // Mining intelligence corpus path. Operators flip `MINING_CORPUS_PATH`
  // when relocating Docs/ to a different mount; the default points at
  // the canonical build-time location.
  const miningCorpusPath = resolveMiningCorpusPath(envSource, deps);

  // Default Master Brain persona — the mining CEO persona (8 modes).
  // Tests can swap a fixture persona via `deps.masterPersona`.
  const masterPersona = deps.masterPersona ?? miningCeoPersona;

  // Wave-K Tier-3 follow-up — resolve the text embedder port. The
  // kernel's memory-recall step prefers `searchByEmbedding` when an
  // embedder is wired; failures collapse to the legacy key-based
  // search inside the kernel. We always thread a port (null-embedder
  // fallback) so the kernel branch is uniform.
  const embedder = resolveEmbedder(envSource, deps.logger);

  // Item-5 — build the production orchestrator bindings (9-hook chain
  // deps) BEFORE composeSovereign so the orchestrator block can be
  // threaded into the kernel. Constructed only when the caller passed
  // `deps.orchestratorBindings`; otherwise the orchestrator stays unwired
  // and the kernel runs the legacy persona path exactly as before.
  let orchestratorBindings: OrchestratorBindings | null = null;
  if (deps.orchestratorBindings) {
    try {
      const approvalGate =
        deps.orchestratorBindings.approvalGate ??
        createApprovalGate({ store: createInMemoryApprovalStore() });
      const bindingsArgs: Parameters<typeof buildOrchestratorBindings>[0] = {
        db: deps.orchestratorBindings.db,
        approvalGate,
        toolRegistry,
        tenantId: deps.orchestratorBindings.tenantId ?? '_platform',
        env: envSource,
        ...(deps.logger ? { logger: deps.logger } : {}),
        ...(deps.orchestratorBindings.globalDenylist
          ? { globalDenylist: deps.orchestratorBindings.globalDenylist }
          : {}),
        ...(deps.orchestratorBindings.proposer
          ? { proposer: deps.orchestratorBindings.proposer }
          : {}),
      };
      orchestratorBindings = buildOrchestratorBindings(bindingsArgs);
    } catch (err) {
      if (deps.logger?.warn) {
        deps.logger.warn(
          {
            wiring: 'brain-kernel',
            error: err instanceof Error ? err.message : String(err),
          },
          'brain-kernel: orchestrator hook-chain bindings failed; continuing without',
        );
      }
    }
  }

  // Item-5 — assemble the orchestrator block (router + dispatcher +
  // memory tool + the 9 production hook ports) ONLY when the bindings
  // built. The REAL Anthropic router wraps the same budget-guarded `.sdk`
  // the sensors use; the REAL dispatcher executes the kernel's tool
  // registry. `useByDefault` is left UNSET here so the kernel's
  // `resolveOrchestratorRoutingEnabled` keeps the main loop DEFAULT-OFF
  // (gated behind `BORJIE_ORCHESTRATOR_MAINLOOP`) — the live persona path
  // is unchanged until a monitored canary flips the env flag.
  const orchestratorBlock = orchestratorBindings
    ? buildOrchestratorComposeBlock({
        anthropicMessagesClient,
        toolRegistry,
        bindings: orchestratorBindings,
        envSource,
        // Raw Drizzle handle for the durable MemoryTool (agent_memory).
        // Same db the hook chain binds; null in degraded/test boots.
        db: deps.orchestratorBindings?.db ?? null,
        ...(deps.logger ? { logger: deps.logger } : {}),
      })
    : null;

  let kernel: BrainKernel;
  try {
    const composeArgs: Parameters<typeof composeSovereign>[0] = {
      anthropicClient: anthropicMessagesClient as NonNullable<Parameters<
        typeof composeSovereign
      >[0]['anthropicClient']>,
      killswitch,
      traceRecorder: decisionTraceRecorder,
      uncertaintyPolicy,
      toolRegistry,
      embedder,
    };
    if (orchestratorBlock) {
      // readonly on ComposeSovereignConfig — cast through a mutable view
      // to thread the orchestrator wire while keeping the public surface
      // immutable (same pattern as `synthesizer` below).
      (
        composeArgs as {
          orchestrator?: NonNullable<
            Parameters<typeof composeSovereign>[0]['orchestrator']
          >;
        }
      ).orchestrator = orchestratorBlock;
    }
    if (deps.synthesizer) {
      // readonly on ComposeSovereignConfig — re-cast through a
      // mutable view to preserve the immutable type on the public
      // surface while still passing the wire in. Mirrors the pattern
      // used by `approvalPolicyResolver` above.
      (composeArgs as { synthesizer?: MultiLLMSynthesizerPort }).synthesizer =
        deps.synthesizer;
    }
    if (deps.approvalPolicyResolver) {
      // Structural duck-cast: the database service's
      // `ApprovalPolicyResolver` shape already matches the kernel's
      // duck-typed port.
      (
        composeArgs as { approvalPolicyResolver?: unknown }
      ).approvalPolicyResolver = deps.approvalPolicyResolver;
    }
    const sovereign = composeSovereign(composeArgs);
    kernel = sovereign.kernel;
  } catch (err) {
    if (deps.logger?.warn) {
      deps.logger.warn(
        {
          wiring: 'brain-kernel',
          error: err instanceof Error ? err.message : String(err),
        },
        'brain-kernel: composeSovereign failed; degrading',
      );
    }
    return null;
  }

  // Item-5 — the orchestrator main-loop is now fully threaded into the
  // kernel via `composeSovereign({ orchestrator: orchestratorBlock })`
  // above (router + dispatcher + memory tool + the 9 production hook
  // ports). The bindings + block were built BEFORE composeSovereign so
  // the kernel constructs with the wire in place. The main loop stays
  // DEFAULT-OFF (UNSET `useByDefault` → kernel reads
  // `BORJIE_ORCHESTRATOR_MAINLOOP`, default off) so the live `/brain/turn`
  // generation is unchanged: the persona path + the kernel pre-flight in
  // `routes/brain.hono.ts::kernelPreflight` remain the live default until
  // a monitored canary flips the env flag.
  if (orchestratorBindings && deps.logger?.info) {
    deps.logger.info(
      {
        wiring: 'brain-kernel',
        hooks: orchestratorBindings.hookChain
          .list()
          .map((h) => `${h.name}:${h.stage}`),
        dbBacked: deps.orchestratorBindings?.db != null,
        mainLoopThreaded: orchestratorBlock !== null,
        mainLoopDefaultOn: false,
        canaryEnvFlag: 'BORJIE_ORCHESTRATOR_MAINLOOP',
      },
      'brain-kernel: orchestrator main-loop threaded (9 ports + router/dispatcher); DEFAULT-OFF canary',
    );
  }

  if (deps.logger?.info) {
    deps.logger.info(
      {
        wiring: 'brain-kernel',
        sensors: ['opus47', 'sonnet46', 'haiku45'],
        autoHaikuJudge: true,
        uncertaintyPolicy,
        killswitch: killswitch.readPlatform().level,
        embedder: embedder.modelId,
        miningCorpusPath,
        masterPersona: masterPersona.name,
        masterPersonaModes: masterPersona.modes.map((m) => m.id),
        miningToolNames: Object.values(MINING_TOOL_NAMES),
      },
      'brain-kernel: composed (real-brain path active)',
    );
  }

  return {
    kernel,
    // Bind so callers can pass `wiring.think` as a free function value
    // without losing the `this` reference.
    think: kernel.think.bind(kernel),
    decisionTraceRecorder,
    killswitch,
    toolRegistry,
    uncertaintyPolicy,
    sensorRoutingService: deps.sensorRoutingService ?? null,
    embedder,
    orchestratorBindings,
    miningCorpusPath,
    masterPersona,
  };
}

/**
 * Resolve the on-disk mining-corpus path. Reads `MINING_CORPUS_PATH`
 * from the env source, falls back to `DEFAULT_MINING_CORPUS_PATH`. The
 * caller may also pass `deps.miningCorpusPath` to short-circuit env
 * resolution (used by tests).
 *
 * Trims whitespace, drops empty values. Never throws — corpus readers
 * surface their own "not found" errors when the resolved path does not
 * exist on disk.
 */
function resolveMiningCorpusPath(
  envSource: Readonly<Record<string, string | undefined>>,
  deps: BrainKernelWiringDeps,
): string {
  const overridden = deps.miningCorpusPath?.trim();
  if (overridden) return overridden;
  const fromEnv = envSource['MINING_CORPUS_PATH']?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_MINING_CORPUS_PATH;
}

/**
 * Resolve the kernel's text-embedder port. Reads
 * `OPENAI_EMBEDDING_API_KEY` first (operators can split embedding +
 * generation keys), falling back to `OPENAI_API_KEY`. When neither is
 * set we thread the always-rejects `createNullEmbedder()` so the
 * kernel's memory-recall step has a uniform port and its `try/catch`
 * collapses to the legacy key-based search path.
 *
 * Defensive: if `createOpenAiEmbedder` itself throws at construction
 * (e.g. a future regression that requires more config) we log a
 * warning and fall back to the null embedder rather than killing the
 * gateway boot.
 */
function resolveEmbedder(
  envSource: Readonly<Record<string, string | undefined>>,
  logger: BrainKernelWiringDeps['logger'],
): EmbedderPort {
  const apiKey =
    (envSource['OPENAI_EMBEDDING_API_KEY']?.trim() ||
      envSource['OPENAI_API_KEY']?.trim()) ??
    '';
  if (!apiKey) {
    return createNullEmbedder();
  }
  try {
    return createOpenAiEmbedder({ apiKey });
  } catch (err) {
    if (logger?.warn) {
      logger.warn(
        {
          wiring: 'brain-kernel',
          error: err instanceof Error ? err.message : String(err),
        },
        'brain-kernel: embedder construction failed; using null embedder',
      );
    }
    return createNullEmbedder();
  }
}

/**
 * Default Anthropic model id for the orchestrator router. Operators can
 * override via `BORJIE_ORCHESTRATOR_MODEL`. Kept as a string constant so
 * this wiring does not pick up a hard import on the ai-copilot provider
 * model catalogue just to name one model.
 */
const DEFAULT_ORCHESTRATOR_MODEL = 'claude-opus-4-8';

/**
 * Item-5 — assemble the `composeSovereign({ orchestrator })` block.
 *
 * Wires the REAL Anthropic router (over the same budget-guarded `.sdk`
 * the sensors use), the REAL tool dispatcher (over the kernel's tool
 * registry), an end-of-turn-persisting memory tool, and the 9 production
 * hook ports from `buildOrchestratorBindings(...)`. The block's
 * `useByDefault` is intentionally LEFT UNSET so the kernel's
 * `resolveOrchestratorRoutingEnabled` keeps the main loop DEFAULT-OFF
 * (gated behind `BORJIE_ORCHESTRATOR_MAINLOOP`).
 *
 * Memory adapter note: the bounded in-memory `/memories` tool is wired
 * here (it IS a real bounded adapter). A Drizzle-backed adapter that
 * survives process restarts is a follow-up — the orchestrator path is
 * default-OFF, so this is non-blocking for production.
 *
 * EXPORTED (Stage 1) so the sovereign composition root (`sovereign.ts
 * build()`) can reuse the EXACT same orchestrator-block construction —
 * the router/dispatcher/memory-tool/9-hook-port assembly — to wire the
 * main-loop onto the LIVE `getSovereignBrain` kernel without replicating
 * it. The live path leaves `useByDefault` UNSET, so the kernel's
 * `resolveOrchestratorRoutingEnabled` controls routing (DEFAULT-ON with
 * the `KERNEL_USE_ORCHESTRATOR=false` hard-kill + `BORJIE_ORCHESTRATOR_
 * MAINLOOP=0/false/off` soft-disable levers).
 */
export function buildOrchestratorComposeBlock(args: {
  readonly anthropicMessagesClient: KernelAnthropicSdkLike;
  readonly toolRegistry: BrainToolRegistry;
  readonly bindings: OrchestratorBindings;
  readonly envSource: Readonly<Record<string, string | undefined>>;
  readonly db: unknown | null;
  readonly logger?: BrainKernelWiringDeps['logger'];
}): NonNullable<Parameters<typeof composeSovereign>[0]['orchestrator']> {
  const model =
    args.envSource['BORJIE_ORCHESTRATOR_MODEL']?.trim() ||
    DEFAULT_ORCHESTRATOR_MODEL;

  // The duck-typed `.sdk` matches the orchestrator router's expected
  // `AnthropicMessagesClient` shape (same shape the sensors consume).
  const router = orchestrator.createAnthropicRouter(
    args.anthropicMessagesClient as unknown as Parameters<
      typeof orchestrator.createAnthropicRouter
    >[0],
    {
      model,
      ...(args.logger?.warn
        ? {
            logger: {
              warn: (msg: string, meta?: Record<string, unknown>): void => {
                args.logger?.warn?.({ wiring: 'orchestrator-router', ...meta }, msg);
              },
            },
          }
        : {}),
    },
  );

  // Durable working-memory when a db handle is present: the orchestrator
  // main-loop's recall()/persist bind to the agent_memory table (FORCE RLS,
  // migration 0302) — the SAME backend the mwikila.memory.* persona tools use,
  // so the brain's notebook survives restarts. Honest fallback to the bounded
  // in-memory tool only when no db is wired (degraded boot / tests).
  //
  // Built BEFORE the dispatcher because the sub-MD spawnHandler folds each
  // child's result back into the PARENT working notebook via this SAME tool —
  // the parent's next loop tick recalls it and reasons over the child's work.
  const memoryTool = args.db
    ? createDrizzleMemoryTool(args.db)
    : orchestrator.createInMemoryMemoryTool();

  // Wave-23 EX-5 unblock — REAL mid-turn sub-MD spawn. When the brain emits a
  // `spawn_sub_md` Decision, this handler runs + executes the child sub-MD as
  // a real child orchestrator turn (the brain port) inheriting the parent's
  // permission-mode + risk-tier ceiling, then folds the child's result back
  // into the parent turn via the shared memory tool. Replaces the prior no-op
  // breadcrumb ack that let any spawn-dependent answer complete WITHOUT the
  // sub-agent's work (borjie-execution-architecture-audit.md EX-5).
  //
  // The root parent context is a platform-scoped fallback; the dispatcher
  // hands the handler the LIVE parent `HookContext` per dispatch, so the child
  // always inherits the CURRENT parent thread/scope/tier.
  const rootParentContext: SpawnParentContext = {
    threadId: '_kernel_orchestrator_root',
    scope: {
      kind: 'platform',
      actorUserId: 'kernel-orchestrator',
      roles: [],
      personaId: 'industry-observer',
    },
    tier: 'industry',
  };
  const spawnHandler = createSubMdSpawnHandler(
    {
      toolRegistry: args.toolRegistry,
      // Fresh router per child turn (own callId counter) over the SAME
      // budget-guarded Anthropic client + model the parent loop uses.
      buildRouter: (): ReturnType<typeof orchestrator.createAnthropicRouter> =>
        orchestrator.createAnthropicRouter(
          args.anthropicMessagesClient as unknown as Parameters<
            typeof orchestrator.createAnthropicRouter
          >[0],
          { model },
        ),
      // Reuse the production 9-hook chain so the child's tool calls hit the
      // same PII-scrub / denylist / four-eye / rate-limit / cost-circuit /
      // sandbox-divert / audit / ledger-seal rails the parent uses.
      hookChain: args.bindings.hookChain,
      memoryTool,
      ...(args.logger
        ? {
            logger: {
              ...(args.logger.info ? { info: args.logger.info } : {}),
              ...(args.logger.warn ? { warn: args.logger.warn } : {}),
            },
          }
        : {}),
    },
    rootParentContext,
  );

  // ───────────────────────────────────────────────────────────────────
  // COG-07/AUT-14 — the modality arbiter (the 7-way output head).
  //
  // Default-OFF behind `BORJIE_MODALITY_ARBITER` (mirrors
  // `BORJIE_ORCHESTRATOR_MAINLOOP`). When the flag is OFF the arbiter is
  // NOT constructed → zero added latency and today's chat/action-only
  // behaviour. When ON, it is constructed from the SAME `resolveEmbedder`
  // the kernel already uses + Drizzle-backed skill/flow/posture retrievers
  // (RLS via the canonical GUC) + the rail-composed autonomy decider
  // (composeWithRail(decideAutonomy(...))) + the EA-04 body-change syscall
  // + the loop-runner adapter. Its skill/modality HANDLERS are bound onto
  // the dispatcher below so a lifted `run_skill`/`run_modality` Decision has
  // a real runtime path. The arbiter can ROUTE to an action but the action
  // still hits the policy-gate + 9-hook chain — NO rail is bypassed; money/
  // licence/deletion stay dual-control HITL.
  const modalityArbiterEnabled = resolveModalityArbiterEnabled(args.envSource);
  // Resolve the SAME text-embedder the kernel uses (OPENAI_EMBEDDING_API_KEY
  // → OPENAI_API_KEY → null embedder) so Tier-1 nearest-neighbour shares the
  // kernel's embedding space. Only constructed when the arbiter is enabled.
  const arbiterEmbedder = modalityArbiterEnabled
    ? resolveEmbedder(args.envSource, args.logger)
    : undefined;
  const modalityArbiter = modalityArbiterEnabled && arbiterEmbedder
    ? orchestrator.createModalityArbiter({
        embedder: arbiterEmbedder,
        skillRetriever: buildSkillRetriever(args.db),
        flowRetriever: buildFlowRetriever(args.db),
        recipeDescriptors: buildModalityDescriptors(),
        autonomyDecider: buildAutonomyDecider(),
        flowPosturePort: buildFlowPosturePort(args.db),
        bodyChangePort: buildBodyChangePort(),
        loopRunner: createLoopRunnerAdapter(args.db, args.toolRegistry),
        ...(args.logger?.warn
          ? {
              logger: {
                warn: (msg: string, meta?: Record<string, unknown>): void => {
                  args.logger?.warn?.({ wiring: 'modality-arbiter', ...meta }, msg);
                },
              },
            }
          : {}),
      })
    : undefined;

  if (modalityArbiter) {
    args.logger?.info?.(
      { wiring: 'modality-arbiter', canaryEnvFlag: 'BORJIE_MODALITY_ARBITER' },
      'brain-kernel: modality arbiter constructed (7-way output head); handlers bound to dispatcher; DEFAULT-OFF canary',
    );
  }

  // The loop-runner adapter (reused by the modality handler's loop branch).
  const loopRunner = createLoopRunnerAdapter(args.db, args.toolRegistry);

  const dispatcher = orchestrator.createToolDispatcher({
    registry: args.toolRegistry,
    spawnHandler,
    // COG-07/AUT-14 — modality handlers. Only bound when the arbiter is
    // enabled (default-OFF leaves these undefined → the dispatcher falls
    // closed to a structured ack breadcrumb, exactly as before).
    ...(modalityArbiterEnabled
      ? {
          modalityHandler: async (a: {
            readonly modality: 'tab' | 'document' | 'media' | 'workflow' | 'loop';
            readonly payload: Readonly<Record<string, unknown>>;
          }): Promise<{ readonly output?: unknown }> => {
            // A standing/recurring loop routes to the (now-reachable)
            // loop-runner; bounded modalities ack a breadcrumb until their
            // render/compose dispatchers are bound at this seam.
            if (a.modality === 'loop' || a.modality === 'workflow') {
              const flowId = String(a.payload.flowId ?? 'adhoc');
              const loopKind = String(a.payload.loopKind ?? 'reactive');
              const { loopRunId } = await loopRunner.runLoop({
                flowId,
                loopKind: loopKind as Parameters<typeof loopRunner.runLoop>[0]['loopKind'],
                tenantId: null,
                payload: a.payload,
              });
              return { output: { modality: a.modality, loopRunId } };
            }
            return { output: { modality: a.modality, acked: true } };
          },
        }
      : {}),
    ...(args.logger?.warn
      ? {
          logger: {
            warn: (msg: string, meta?: Record<string, unknown>): void => {
              args.logger?.warn?.({ wiring: 'orchestrator-dispatcher', ...meta }, msg);
            },
          },
        }
      : {}),
  });

  const { deps: hookDeps } = args.bindings;
  return {
    router,
    dispatcher,
    memoryTool,
    // Item-3 — project the SAME tool registry into the loop's toolSearch.
    toolRegistry: args.toolRegistry,
    // The 9 production hook ports (PreToolUse / PostToolUse / Stop).
    piiScrubber: hookDeps.piiScrubber,
    toolScopes: hookDeps.toolScopes,
    approvalPolicy: hookDeps.approvalPolicy,
    toolDenylist: {
      dynamic: hookDeps.toolDenylist,
      ...(hookDeps.globalDenylist
        ? { globalDenylist: hookDeps.globalDenylist }
        : {}),
    },
    rateLimit: {
      counter: hookDeps.rateLimitCounter,
      maxCallsPerWindow: hookDeps.rateLimitConfig.maxCallsPerWindow,
      windowMs: hookDeps.rateLimitConfig.windowMs,
    },
    costCircuit: hookDeps.costCircuit,
    sandboxResolver: hookDeps.sandboxResolver,
    auditSink: hookDeps.auditSink,
    ledgerSeal: hookDeps.ledgerSeal,
    // `useByDefault` is intentionally UNSET. `resolveOrchestratorRoutingEnabled`
    // (kernel.ts) treats a wired orchestrator with no explicit flag as
    // DEFAULT-ON (the "full powers" live generation path), while leaving the
    // env rollback levers functional: `KERNEL_USE_ORCHESTRATOR=false` (hard
    // kill) and `BORJIE_ORCHESTRATOR_MAINLOOP` in {0,false,off} (soft disable).
    // Setting a boolean here would WIN over env and silently disable those
    // incident-rollback levers — so we deliberately leave it unset.
  };
}
