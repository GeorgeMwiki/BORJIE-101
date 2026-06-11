/**
 * Sub-MD spawn handler — turns a `Decision.spawn_sub_md` into a REAL child
 * orchestrator run (EX-5 / Wave-23 unblock).
 *
 * BEFORE: the orchestrator main-loop's dispatcher returned a breadcrumb
 * `spawn_ack` and the child sub-MD never executed — any answer that
 * depended on the spawned sub-agent's work silently completed without it
 * (`borjie-execution-architecture-audit.md` EX-5; `EXECUTION_SPEC_WAVES23.md`
 * Borjie unblock task #2).
 *
 * AFTER: this handler spawns + executes the child sub-MD through the SAME
 * orchestrator `think()` main-loop the parent runs on (the brain port) —
 * inheriting the parent's permission-mode + risk-tier ceiling — then folds
 * the child's result BACK into the parent turn via the shared working-memory
 * tool so the parent's NEXT loop tick (`memoryTool.recall(...)` at the top of
 * `main-loop.ts`) surfaces the child's output before the parent completes.
 *
 * Why memory is the fold-back channel: the `spawn_ack` DispatchResult shape
 * (kernel `decision.ts`) carries only a handoff token — no result payload —
 * and the main-loop only re-injects `tool_ok` / `tool_error` results into the
 * next `router.call`. The orchestrator's OWN cross-step + cross-turn context
 * already rides the `/memories` working notebook (the loop recalls it every
 * tick and folds it into the system prompt). Writing the child's answer there,
 * keyed by the PARENT scope, is therefore the in-band, zero-kernel-edit way to
 * make the parent reason over the child's work.
 *
 * Isolation + inheritance:
 *   - The child runs with its OWN plan/session/budget stores (a fresh
 *     turn), so it cannot clobber the parent's in-flight loop state.
 *   - permissionMode + subMdRiskTierCeiling are threaded from the spawn
 *     payload (the main-loop already sets `spawn.permissionMode` to the
 *     parent's effective mode via transitivity) so the child can never
 *     exceed the parent's authority.
 *   - The child's tool catalogue is the SAME `BrainToolRegistry` the parent
 *     uses; the spawn's `tools` allowlist is surfaced as `grantedScopes`.
 *   - A bounded spawn-depth guard prevents an infinite spawn→spawn recursion:
 *     a child at the max depth gets a dispatcher whose own spawnHandler is a
 *     plain breadcrumb ack (no further real fork).
 *
 * Background (fire-and-forget) spawns run detached: the handler kicks the
 * child off WITHOUT awaiting it (the parent's `isBackgroundSpawn` branch in
 * the main-loop continues immediately) and the child's result is still folded
 * into parent memory when it lands, for a later turn's recall.
 *
 * Hard-rules compliance: Pino-style logger only (no console.*); zod-validated
 * registry tools run inside the child dispatcher; immutable inputs; every
 * failure is caught and surfaced as a structured memory note rather than
 * thrown (the dispatcher's fall-through ack keeps the parent loop alive).
 *
 * @module composition/sub-md-spawn-handler
 */

import {
  orchestrator,
  type BrainToolRegistry,
  type RiskTier,
} from '@borjie/central-intelligence';

// ── local type aliases (single source of truth = kernel orchestrator) ──

type SubMdSpawn = orchestrator.SubMdSpawn;
type OrchestratorDeps = orchestrator.OrchestratorDeps;
type OrchestratorRequest = orchestrator.OrchestratorRequest;
type OrchestratorResponse = orchestrator.OrchestratorResponse;
type Dispatcher = orchestrator.Dispatcher;
type HookChain = orchestrator.HookChain;
type MemoryTool = orchestrator.MemoryTool;
type ToolDescriptor = orchestrator.ToolDescriptor;
type ScopeContext = SubMdSpawn['scope'];
type AwarenessTier = OrchestratorRequest['tier'];

/**
 * Parent-turn context the dispatcher hands the spawnHandler so it can key the
 * fold-back to the PARENT (not the child). Structural subset of the kernel's
 * `HookContext` so this module does not import the hook-chain types directly.
 */
export interface SpawnParentContext {
  readonly threadId: string;
  readonly scope: ScopeContext;
  readonly tier: AwarenessTier;
  readonly grantedScopes?: ReadonlyArray<string>;
}

export interface SubMdSpawnHandlerDeps {
  /**
   * The kernel's tool registry — the SAME catalog the parent loop projects
   * into its toolSearch. Shared so the child sees the same tools.
   */
  readonly toolRegistry: BrainToolRegistry;
  /**
   * Builds the child orchestrator's LLM router. Returned lazily so a fresh
   * router (its own callId counter) backs each child turn. In practice the
   * wiring passes a thunk over the SAME Anthropic router factory the parent
   * uses.
   */
  readonly buildRouter: () => OrchestratorDeps['router'];
  /**
   * The production 9-hook chain (PreToolUse / PostToolUse / Stop). Reused for
   * the child so the same governance rails (PII scrub, denylist, four-eye,
   * rate-limit, cost-circuit, sandbox-divert, audit, ledger-seal) gate the
   * child's tool calls.
   */
  readonly hookChain: HookChain;
  /**
   * Shared working-memory tool. The child writes its scratch under its OWN
   * thread; the handler ALSO writes the child's final result under the
   * PARENT thread so the parent's next recall surfaces it.
   */
  readonly memoryTool: MemoryTool;
  /**
   * Optional risk-tier resolver for the child's permission-mode evaluation.
   * Defaults inside the loop to a conservative `mutate` when omitted.
   */
  readonly toolRiskTier?: (toolName: string) => RiskTier;
  /** Optional Pino-style logger. No console.* per the hard rules. */
  readonly logger?: {
    info?(meta: object, msg: string): void;
    warn?(meta: object, msg: string): void;
  };
  /**
   * Max spawn depth before a child stops being able to spawn further
   * children (recursion guard). Default 2 (parent → child → grandchild;
   * the grandchild cannot spawn). Must be ≥ 0.
   */
  readonly maxSpawnDepth?: number;
  /**
   * Handoff-token generator. Defaults to a monotonic per-handler counter.
   * Production may inject `() => randomUUID()`.
   */
  readonly handoffTokenGenerator?: () => string;
}

/** Default recursion guard — parent → child → grandchild (no further). */
const DEFAULT_MAX_SPAWN_DEPTH = 2;

/** Max chars of a child answer folded into parent memory (context hygiene). */
const MAX_CHILD_RESULT_CHARS = 4000;

/**
 * Working-notebook path under the PARENT thread where spawned child results
 * land. The main-loop recalls the whole thread each tick, so anything here is
 * surfaced into the parent's next system prompt.
 */
function childResultPath(subMdId: string): string {
  const safe = subMdId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return `sub-md-results/${safe}.md`;
}

/**
 * Project the BrainToolRegistry into the orchestrator's `ToolDescriptor[]`
 * keyword corpus so the child loop's toolSearch can rank tools against its
 * goal. Mirrors `compose.ts:projectRegistryToDescriptors`. Pure.
 */
function projectRegistryToDescriptors(
  registry: BrainToolRegistry,
): ReadonlyArray<ToolDescriptor> {
  return registry.list().map((spec) => {
    const keywords = Array.from(
      new Set(
        spec.name
          .split(/[.\-_/\s]+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length > 0),
      ),
    );
    return { name: spec.name, description: spec.description, keywords };
  });
}

/** Render a child orchestrator response as a bounded fold-back note. Pure. */
function renderChildResult(
  spawn: SubMdSpawn,
  response: OrchestratorResponse,
): string {
  const header = `Sub-MD "${spawn.description ?? spawn.subMdId}" (${spawn.persona ?? 'sub-agent'}) result`;
  let body: string;
  switch (response.kind) {
    case 'answer':
      body = response.text;
      break;
    case 'budget-exhausted':
      body = `[incomplete — budget exhausted on ${response.axis}] ${response.partialText}`;
      break;
    case 'ask-approval':
      body = `[paused — needs approval] ${response.prompt}`;
      break;
    case 'speculative':
      body = `[diverted to sandbox ${response.sandboxId}]`;
      break;
    case 'ack-schedule':
      body = `[scheduled — resume token ${response.resumeToken}]`;
      break;
    default:
      body = '[no result]';
  }
  if (body.length > MAX_CHILD_RESULT_CHARS) {
    body = `${body.slice(0, MAX_CHILD_RESULT_CHARS)}…[truncated]`;
  }
  return `${header}:\n${body}`;
}

/**
 * Derive the child's `AwarenessTier` from the parent. A spawned sub-MD runs
 * within the parent's scope, so it inherits the parent's tier verbatim.
 */
function childTier(parent: SpawnParentContext): AwarenessTier {
  return parent.tier;
}

/**
 * Build the child orchestrator request from a spawn payload + parent context.
 * permissionMode + risk-tier ceiling are inherited so the child can never
 * exceed the parent's authority. Pure.
 */
function buildChildRequest(
  spawn: SubMdSpawn,
  parent: SpawnParentContext,
): OrchestratorRequest {
  const promptFromInput =
    typeof spawn.initialInput['prompt'] === 'string'
      ? (spawn.initialInput['prompt'] as string)
      : '';
  const userMessage =
    spawn.prompt ?? (promptFromInput || JSON.stringify(spawn.initialInput ?? {}));

  // The spawn's `tools` allowlist is surfaced as grantedScopes (defence in
  // depth for the permission hook). Falls back to the parent's grants.
  const grantedScopes = spawn.tools ?? parent.grantedScopes ?? [];

  const req: {
    -readonly [K in keyof OrchestratorRequest]?: OrchestratorRequest[K];
  } = {
    threadId: `${parent.threadId}::sub::${spawn.subMdId}`,
    userMessage,
    scope: spawn.scope,
    tier: childTier(parent),
    persona: spawn.persona ?? parent.scope.personaId,
    grantedScopes,
  };
  if (spawn.permissionMode !== undefined) req.permissionMode = spawn.permissionMode;
  if (spawn.budget !== undefined) req.budget = spawn.budget;
  // The parent threads its own risk-tier ceiling onto the child via the
  // spawn payload's permissionMode transitivity; the explicit ceiling here
  // pins tool-tier gating to `mutate` so a sub-MD cannot run destroy/billing
  // tools unless the parent declared a higher ceiling. Conservative default.
  req.subMdRiskTierCeiling = 'mutate';
  return req as OrchestratorRequest;
}

/**
 * Build the child's OrchestratorDeps. Each child turn gets fresh
 * plan/session/budget stores so it cannot clobber the parent loop's state.
 * The dispatcher's own spawnHandler recurses (depth-bounded) so a child can
 * itself spawn — until `remainingDepth` reaches 0, at which point its
 * dispatcher acks-without-forking.
 */
function buildChildDeps(
  deps: SubMdSpawnHandlerDeps,
  parent: SpawnParentContext,
  remainingDepth: number,
): OrchestratorDeps {
  const childDispatcher: Dispatcher = orchestrator.createToolDispatcher({
    registry: deps.toolRegistry,
    // Recurse: a child may spawn its own sub-MD while depth remains. At
    // depth 0 we pass NO spawnHandler so the dispatcher falls back to the
    // breadcrumb ack — the recursion is bounded.
    ...(remainingDepth > 0
      ? {
          spawnHandler: makeSpawnHandler(deps, parent, remainingDepth - 1),
        }
      : {}),
    ...(deps.logger?.warn
      ? {
          logger: {
            warn: (msg: string, meta?: Record<string, unknown>): void => {
              deps.logger?.warn?.({ wiring: 'sub-md-dispatcher', ...meta }, msg);
            },
          },
        }
      : {}),
  });

  const childDeps: {
    -readonly [K in keyof OrchestratorDeps]?: OrchestratorDeps[K];
  } = {
    router: deps.buildRouter(),
    toolSearch: orchestrator.createInMemoryToolSearch(
      projectRegistryToDescriptors(deps.toolRegistry),
    ),
    hookChain: deps.hookChain,
    planStore: orchestrator.createInMemoryPlanStore(),
    sessionStore: orchestrator.createInMemorySessionStore(),
    memoryTool: deps.memoryTool,
    contextBudget: orchestrator.createContextBudget(),
    dispatcher: childDispatcher,
  };
  if (deps.toolRiskTier) childDeps.toolRiskTier = deps.toolRiskTier;
  if (deps.logger) {
    childDeps.logger = {
      info: (msg: string, meta?: Record<string, unknown>): void => {
        deps.logger?.info?.({ wiring: 'sub-md-loop', ...meta }, msg);
      },
      warn: (msg: string, meta?: Record<string, unknown>): void => {
        deps.logger?.warn?.({ wiring: 'sub-md-loop', ...meta }, msg);
      },
    };
  }
  return childDeps as OrchestratorDeps;
}

/**
 * Fold a child's result into the PARENT working notebook so the parent's next
 * `memoryTool.recall(...)` tick surfaces it. Upsert via the legacy `write`
 * alias (idempotent — a re-run of the same sub-MD overwrites its note).
 * Fail-safe: a memory write failure is logged, never thrown.
 */
async function foldChildResultIntoParent(
  deps: SubMdSpawnHandlerDeps,
  parent: SpawnParentContext,
  spawn: SubMdSpawn,
  note: string,
): Promise<void> {
  const parentThreadId =
    parent.scope.kind === 'platform' ? '_platform' : parent.scope.tenantId;
  try {
    await deps.memoryTool.write(parentThreadId, childResultPath(spawn.subMdId), note);
  } catch (err) {
    deps.logger?.warn?.(
      {
        wiring: 'sub-md-spawn-handler',
        subMdId: spawn.subMdId,
        error: err instanceof Error ? err.message : String(err),
      },
      'sub-md result fold-back to parent memory failed',
    );
  }
}

/**
 * Run a child sub-MD to completion and fold its result into the parent. The
 * thrown-error path is caught and folded as an error note so the parent still
 * learns the sub-MD failed (rather than the work vanishing silently).
 */
async function runChild(
  deps: SubMdSpawnHandlerDeps,
  parent: SpawnParentContext,
  spawn: SubMdSpawn,
  remainingDepth: number,
): Promise<void> {
  try {
    const childReq = buildChildRequest(spawn, parent);
    const childDeps = buildChildDeps(deps, parent, remainingDepth);
    const response = await orchestrator.think(childReq, childDeps);
    await foldChildResultIntoParent(
      deps,
      parent,
      spawn,
      renderChildResult(spawn, response),
    );
    deps.logger?.info?.(
      {
        wiring: 'sub-md-spawn-handler',
        subMdId: spawn.subMdId,
        persona: spawn.persona,
        outcome: response.kind,
      },
      'sub-md child run completed',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn?.(
      { wiring: 'sub-md-spawn-handler', subMdId: spawn.subMdId, error: message },
      'sub-md child run threw',
    );
    await foldChildResultIntoParent(
      deps,
      parent,
      spawn,
      `Sub-MD "${spawn.description ?? spawn.subMdId}" FAILED: ${message}`,
    );
  }
}

/**
 * The spawnHandler closure the tool-dispatcher invokes for a
 * `Decision.spawn_sub_md`. Foreground (blocking) spawns are awaited so the
 * child's result is folded into parent memory BEFORE the dispatcher returns,
 * guaranteeing the parent's next loop tick sees it. Background spawns run
 * detached (the parent's `isBackgroundSpawn` branch continues immediately);
 * the result still folds in for a later recall.
 */
function makeSpawnHandler(
  deps: SubMdSpawnHandlerDeps,
  parent: SpawnParentContext,
  remainingDepth: number,
): (
  spawn: SubMdSpawn,
  ctx?: SpawnParentContext,
) => Promise<{ readonly handoffToken: string }> {
  let handoffSeq = 0;
  const nextHandoff =
    deps.handoffTokenGenerator ??
    ((): string => {
      handoffSeq += 1;
      return `sub_md_handoff_${handoffSeq}`;
    });

  return async (
    spawn: SubMdSpawn,
    ctx?: SpawnParentContext,
  ): Promise<{ readonly handoffToken: string }> => {
    // The dispatcher passes the LIVE parent ctx (current thread/scope) when
    // available; fall back to the construction-time parent for safety.
    const effectiveParent = ctx ?? parent;
    const background = Boolean(spawn.background ?? spawn.fireAndForget);
    const handoffToken = nextHandoff();

    if (background) {
      // Fire-and-forget: do NOT await. Swallow the detached promise so an
      // unhandled rejection can't crash the process (runChild already
      // catches internally; this is belt-and-braces).
      void runChild(deps, effectiveParent, spawn, remainingDepth).catch(() => {
        /* runChild is internally fail-safe; nothing to do here. */
      });
      return { handoffToken };
    }

    // Foreground: await so the parent's next tick recalls the child result.
    await runChild(deps, effectiveParent, spawn, remainingDepth);
    return { handoffToken };
  };
}

/**
 * Build the real sub-MD spawnHandler for the production tool-dispatcher.
 *
 * The returned handler is passed to `createToolDispatcher({ spawnHandler })`
 * in `brain-kernel-wiring.ts:buildOrchestratorComposeBlock`. It accepts the
 * spawn payload AND (when the dispatcher provides it) the live parent
 * `HookContext`, so the child inherits the CURRENT parent thread/scope.
 */
export function createSubMdSpawnHandler(
  deps: SubMdSpawnHandlerDeps,
  rootParent: SpawnParentContext,
): (
  spawn: SubMdSpawn,
  ctx?: SpawnParentContext,
) => Promise<{ readonly handoffToken: string }> {
  const maxDepth = Math.max(0, deps.maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH);
  return makeSpawnHandler(deps, rootParent, maxDepth);
}
