/**
 * Orchestrator main loop — Claude-Code-level while-loop that replaces
 * the kernel's flat 13-step pipeline.
 *
 *   await hookChain.runSessionStart(...)
 *   await hookChain.runUserPromptSubmit(...)
 *   while (budget.remaining() && !plan.isComplete()) {
 *     const tools    = await toolSearch.searchRelevant(plan.currentGoal(), 8)
 *     const memory   = await memoryTool.recall({ scope })
 *     await hookChain.runPreCompact(...)
 *     const recent   = await contextBudget.compactIfOver(session.transcript, 0.8)
 *     await hookChain.runPostCompact(...)
 *     const decision = await router.call({ system, tools, messages: recent })
 *     // Permission-mode short-circuit (plan / bypass / dont-ask)
 *     const pmEval   = await evaluatePermissionMode(...)
 *     const preChain = await hookChain.runPreToolUse(decision, ctx)
 *     // deny → record rejection + continue
 *     // ask-owner → return askForApproval()
 *     // sandbox  → return runSpeculative()
 *     // transform / updated-input → swap the decision and proceed
 *     // additional-context → fold into next router.call
 *     // defer → return ack-defer
 *     // stop → return immediately
 *     const result   = await dispatch(decision, deps)
 *     await hookChain.runPostToolUse(decision, result, ctx)
 *     // For spawn_sub_md decisions:
 *     await hookChain.runSubagentStart(...)
 *     await hookChain.runSubagentStop(...)
 *     await sessionStore.checkpoint(session, decision, result, plan, budget)
 *     plan = plan.advance({ goalId, newStatus: 'complete' })
 *     budget = budget.consume(result)
 *     if (decision.kind === 'respond_to_owner') return text
 *     if (decision.kind === 'schedule_wake')    return ack
 *   }
 *   await hookChain.runStop(session, ctx)
 *   return budget.exhausted() ? handoffToHuman() : plan.completedResponse()
 *
 * Both this orchestrator AND the legacy `kernel.ts` coexist on the same
 * package; callers opt into one or the other at the composition root.
 */

import type { ScopeContext, Citation, Artifact } from '../../types.js';
import type { AwarenessTier } from '../kernel-types.js';
import type { RiskTier } from '../risk-tier.js';
import { Budget, type BudgetLimits } from './budget.js';
import type { Decision, DispatchResult } from './decision.js';
import { isBackgroundSpawn } from './decision.js';
import type {
  HookChain,
  HookContext,
  HookResult,
  ChatMessage,
  PreToolUseChainResult,
} from './hook-chain.js';
import type { Plan, PlanStore } from './plan.js';
import type { SessionStore, Session } from './checkpoint.js';
import type { MemoryTool } from './memory-tool.js';
import type { ContextBudget, ToolSearch, ToolDescriptor } from './context-budget.js';
import {
  evaluatePermissionMode,
  renderPlanModePreview,
  type PermissionMode,
} from './permission-mode.js';

// ─────────────────────────────────────────────────────────────────────
// Public request / response shapes
// ─────────────────────────────────────────────────────────────────────

export interface OrchestratorRequest {
  readonly threadId: string;
  readonly userMessage: string;
  readonly scope: ScopeContext;
  readonly tier: AwarenessTier;
  readonly persona: string;
  readonly grantedScopes?: ReadonlyArray<string>;
  readonly budget?: Partial<BudgetLimits>;
  /** Optional Claude-Code-style permission mode. Defaults to `default`. */
  readonly permissionMode?: PermissionMode;
  /** Optional tenant-scoped permission-mode override. */
  readonly tenantPermissionModeOverride?: PermissionMode;
  /**
   * H6 — Sub-MD risk-tier ceiling. When a parent sub-MD spawns a child
   * orchestrator (`think()` for a sub-MD instance), the parent passes
   * its own declared `riskTier` here. The main-loop denies any tool
   * call whose risk tier is STRICTER than this ceiling — so a
   * `riskTier:'read'` sub-MD cannot run a `mutate` tool even if its
   * tool-belt happens to list one.
   *
   * Tier ordering: `read` < `mutate` < `external-comm` < `destroy` <
   * `billing`. A ceiling of `read` allows only `read`-tier tools; a
   * ceiling of `mutate` allows `read` + `mutate`; etc.
   */
  readonly subMdRiskTierCeiling?: RiskTier;
}

/**
 * Phase-E.1 legacy response variants. Kernel.ts and other callers that
 * pattern-match exhaustively on this union still compile after Phase E.6
 * extensions because the new variants live in `OrchestratorResponseExtended`.
 */
export type OrchestratorResponse =
  | {
      readonly kind: 'answer';
      readonly text: string;
      readonly turnsUsed: number;
      readonly citations: ReadonlyArray<Citation>;
      readonly artifacts: ReadonlyArray<Artifact>;
    }
  | {
      readonly kind: 'ask-approval';
      readonly prompt: string;
      readonly channel: 'inline' | 'inbox';
      readonly pendingDecision: Decision;
    }
  | {
      readonly kind: 'speculative';
      readonly sandboxId: string;
      readonly pendingDecision: Decision;
    }
  | {
      readonly kind: 'ack-schedule';
      readonly resumeToken: string;
    }
  | {
      readonly kind: 'budget-exhausted';
      readonly axis: 'turns' | 'tokens' | 'tool-calls' | 'wall-ms';
      readonly partialText: string;
    };

/**
 * Phase-E.6 extensions to the orchestrator response surface. Returned
 * only when the caller opts in via `think()` with a configuration that
 * surfaces defer / stop / plan-preview outcomes. Legacy callers receive
 * a narrowed `OrchestratorResponse` via `narrowToLegacyResponse`.
 */
export type OrchestratorResponseExtended =
  | OrchestratorResponse
  | {
      readonly kind: 'ack-defer';
      readonly resumeAfterMs: number;
      readonly reason: string;
      readonly pendingDecision: Decision;
    }
  | {
      readonly kind: 'stopped';
      readonly reason: string;
      readonly partialText: string;
    }
  | {
      readonly kind: 'plan-preview';
      readonly preview: string;
      readonly pendingDecision: Decision;
    };

// ─────────────────────────────────────────────────────────────────────
// LLM router port — the orchestrator does NOT couple to a specific
// SDK. Composition root binds either the Anthropic adapter or the
// existing kernel sensors.
// ─────────────────────────────────────────────────────────────────────

export interface LLMRouterCall {
  readonly system: string;
  readonly tools: ReadonlyArray<ToolDescriptor>;
  readonly messages: ReadonlyArray<{ role: 'user' | 'assistant' | 'tool' | 'system'; content: string }>;
}

export interface LLMRouter {
  call(args: LLMRouterCall): Promise<Decision>;
}

// ─────────────────────────────────────────────────────────────────────
// Dispatcher port — actuates each Decision variant.
// ─────────────────────────────────────────────────────────────────────

export interface Dispatcher {
  dispatch(decision: Decision, ctx: HookContext): Promise<DispatchResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator deps
// ─────────────────────────────────────────────────────────────────────

/**
 * C2 — bypass-permissions audit port.
 *
 * Whenever `permissionMode` resolves to `bypass-permissions`, the
 * main-loop emits a structured warning AND writes a sovereign-ledger row
 * so an external SIEM can alert on `mode=bypass-permissions`. The module
 * docstring at `permission-mode.ts:23-26` promised both of these; the
 * port lets the composition root wire the production ledger sink while
 * tests inject an in-memory recorder.
 *
 * The audit row is emitted EXACTLY ONCE per `think()` call (not once per
 * tool decision) so the noise stays bounded — a `bypass-permissions`
 * session is a single sovereign event, regardless of how many tools it
 * invokes.
 */
export interface BypassPermissionsAuditPort {
  recordBypassActive(args: {
    readonly threadId: string;
    readonly tenantId: string | null;
    readonly mode: PermissionMode;
    readonly tenantOverride: boolean;
    readonly grantedScopes: ReadonlyArray<string>;
    readonly startedAtMs: number;
  }): Promise<void>;
}

export interface OrchestratorDeps {
  readonly router: LLMRouter;
  readonly toolSearch: ToolSearch;
  readonly hookChain: HookChain;
  readonly planStore: PlanStore;
  readonly sessionStore: SessionStore;
  readonly memoryTool: MemoryTool;
  readonly contextBudget: ContextBudget;
  readonly dispatcher: Dispatcher;
  /**
   * Optional risk-tier resolver. The permission-mode evaluator needs the
   * tier of a tool to decide allow/ask/deny/plan-preview. When omitted,
   * the orchestrator defaults to `mutate` for any tool_call — safe
   * conservative fallback.
   */
  readonly toolRiskTier?: (toolName: string) => RiskTier;
  /**
   * C2 — sovereign-ledger sink for `bypass-permissions` audit rows.
   * When omitted the loop still emits the warning via `logger.warn`,
   * but the audit row is dropped. Production composition MUST wire
   * this port.
   */
  readonly bypassPermissionsAudit?: BypassPermissionsAuditPort;
  /**
   * H1 — cap on the number of consecutive `permission-mode: deny`
   * retries before the loop surfaces a terminal `stopped` outcome.
   * Default 2. A value of 0 disables retries entirely (one deny ⇒
   * stop). A value of `Infinity` restores the legacy spinning
   * behaviour (NOT recommended).
   */
  readonly maxPermissionDenyRetries?: number;
  readonly clock?: () => number;
  readonly logger?: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point — the orchestrator's `think()`.
// ─────────────────────────────────────────────────────────────────────

/**
 * Narrow a Phase-E.6 extended response down to the legacy
 * `OrchestratorResponse` shape. Callers that pattern-match on the
 * five-variant union (kernel.ts, the streaming bridge) can use this
 * to fold the three new variants onto compatible legacy shapes:
 *
 *   - `ack-defer`    → `ack-schedule` (defer is a short-term schedule)
 *   - `stopped`      → `budget-exhausted` (axis=`wall-ms`, partialText=reason)
 *   - `plan-preview` → `answer` (the preview IS the answer the MD returns)
 */
export function narrowToLegacyResponse(
  response: OrchestratorResponseExtended,
): OrchestratorResponse {
  switch (response.kind) {
    case 'ack-defer':
      return {
        kind: 'ack-schedule',
        resumeToken: `defer:${response.resumeAfterMs}`,
      };
    case 'stopped':
      return {
        kind: 'budget-exhausted',
        axis: 'wall-ms',
        partialText: response.partialText || response.reason,
      };
    case 'plan-preview':
      return {
        kind: 'answer',
        text: response.preview,
        turnsUsed: 0,
        citations: [],
        artifacts: [],
      };
    default:
      return response;
  }
}

/**
 * Legacy entry point — returns the five-variant `OrchestratorResponse`.
 * Phase-E.6 extension variants are automatically narrowed via
 * `narrowToLegacyResponse`. Callers that need the full extended surface
 * (defer / stop / plan-preview as first-class outcomes) should call
 * `thinkExtended()` instead.
 */
export async function think(
  req: OrchestratorRequest,
  deps: OrchestratorDeps,
): Promise<OrchestratorResponse> {
  const ext = await thinkExtended(req, deps);
  return narrowToLegacyResponse(ext);
}

/**
 * Extended entry point — returns the full eight-variant
 * `OrchestratorResponseExtended` shape. Used by Phase-E.6+ surfaces
 * that need to distinguish `ack-defer`, `stopped`, and `plan-preview`
 * from the legacy variants.
 */
export async function thinkExtended(
  req: OrchestratorRequest,
  deps: OrchestratorDeps,
): Promise<OrchestratorResponseExtended> {
  const clock = deps.clock ?? Date.now;
  const session = await deps.sessionStore.resumeOrCreate(req.threadId);
  let plan = await deps.planStore.load(req.threadId);
  let budget = Budget.of(req.budget ?? {}, clock);
  let lastText = '';
  const pendingContextInjections: ChatMessage[] = [];

  const ctx: HookContext = {
    threadId: req.threadId,
    scope: req.scope,
    tier: req.tier,
    userMessage: req.userMessage,
    tickStartedAt: clock(),
    ...(req.grantedScopes ? { grantedScopes: req.grantedScopes } : {}),
  };

  // H4 — Centralised helper. Whenever a lifecycle hook (session-start,
  // user-prompt-submit, pre/post-compact, subagent-*) returns a non-
  // allow result that the caller maps to a terminal response, we MUST
  // run the stop chain first so the ledger-seal hook (and any other
  // stop-stage hook) can seal the per-thread hash chain. Without this,
  // a PII-scrub deny or hostile-prompt deny would leave a dangling
  // unsealed chain — exactly the failure mode the ledger-seal hook was
  // introduced to close.
  async function sealAndReturn(
    terminal: OrchestratorResponseExtended,
  ): Promise<OrchestratorResponseExtended> {
    await deps.hookChain.runStop(
      {
        threadId: req.threadId,
        turnCount: budget.snapshot().usage.turns,
        finalText: lastText,
        exhaustedAxis: null,
      },
      ctx,
    );
    return terminal;
  }

  // session-start — fires once. A registered hook can seed system
  // context, set permission mode, etc. Any non-allow outcome short
  // circuits the whole turn.
  const sessionStartResult = await deps.hookChain.runSessionStart(
    {
      threadId: req.threadId,
      tier: req.tier,
      resumed: session.latestCheckpoint !== null,
    },
    ctx,
  );
  const sessionStartTerminal = terminalFromHook(sessionStartResult);
  if (sessionStartTerminal) return sealAndReturn(sessionStartTerminal);

  // user-prompt-submit — fired once for the inbound user message. Hooks
  // can scrub PII or reject hostile prompts here.
  const promptResult = await deps.hookChain.runUserPromptSubmit(
    { text: req.userMessage },
    ctx,
  );
  const promptTerminal = terminalFromHook(promptResult);
  if (promptTerminal) return sealAndReturn(promptTerminal);

  const permissionMode: PermissionMode = req.permissionMode ?? 'default';

  // C2 — when `bypass-permissions` resolves as the effective mode (either
  // via tenant override or the request itself), emit a structured warning
  // AND push a sovereign-ledger row so the post-mortem can see the bypass
  // was active. Done EXACTLY ONCE per think() call.
  const effectiveModeForAudit: PermissionMode =
    req.tenantPermissionModeOverride ?? permissionMode;
  if (effectiveModeForAudit === 'bypass-permissions') {
    deps.logger?.warn?.('permission-mode bypass-permissions active', {
      threadId: req.threadId,
      tenantId:
        req.scope.kind === 'platform' ? null : req.scope.tenantId,
      tenantOverride: req.tenantPermissionModeOverride !== undefined,
      grantedScopes: req.grantedScopes ?? [],
    });
    if (deps.bypassPermissionsAudit) {
      try {
        await deps.bypassPermissionsAudit.recordBypassActive({
          threadId: req.threadId,
          tenantId:
            req.scope.kind === 'platform' ? null : req.scope.tenantId,
          mode: effectiveModeForAudit,
          tenantOverride: req.tenantPermissionModeOverride !== undefined,
          grantedScopes: req.grantedScopes ?? [],
          startedAtMs: clock(),
        });
      } catch (err) {
        // The audit sink itself is degraded — log loudly but continue.
        // A broken audit sink must NOT silently drop the think() call;
        // the warning above already provides operator-visible signal.
        const message =
          err instanceof Error ? err.message : 'non-Error thrown';
        deps.logger?.error?.(
          'bypass-permissions audit-sink failure',
          { threadId: req.threadId, reason: message },
        );
      }
    }
  }

  // H1 — counter for consecutive permission-mode `deny` outcomes. After
  // `maxPermissionDenyRetries` retries the loop emits a terminal
  // `stopped` outcome rather than burning the entire turn budget.
  const denyRetryLimit =
    deps.maxPermissionDenyRetries ?? DEFAULT_PERMISSION_DENY_RETRIES;
  let consecutivePermissionDenies = 0;

  while (budget.remaining() && !plan.isComplete()) {
    const goal = plan.currentGoal();
    const tools = await deps.toolSearch.searchRelevant(
      goal?.description ?? req.userMessage,
      8,
    );
    const memory = await deps.memoryTool.recall({ scope: req.scope });

    // pre-compact — runs before the context window is folded. A hook
    // can deny / defer to skip compaction altogether.
    const originalTokens = approxTokens(session.transcript);
    const preCompact = await deps.hookChain.runPreCompact(
      {
        currentTokens: originalTokens,
        windowTokens: 200_000,
        ratio: 0.8,
      },
      ctx,
    );
    const preCompactTerminal = terminalFromHook(preCompact);
    if (preCompactTerminal) return sealAndReturn(preCompactTerminal);

    const compaction = await deps.contextBudget.compactIfOver(
      session.transcript,
      0.8,
    );

    // post-compact — audit what was dropped.
    if (compaction.compacted) {
      const postCompact = await deps.hookChain.runPostCompact(
        {
          originalTokens: compaction.originalTokens,
          finalTokens: compaction.finalTokens,
          droppedTurnCount: Math.max(
            session.transcript.length - compaction.turns.length,
            0,
          ),
        },
        ctx,
      );
      const postCompactTerminal = terminalFromHook(postCompact);
      if (postCompactTerminal) return sealAndReturn(postCompactTerminal);
    }

    // Fold any pending additional-context injections from previous
    // iterations into the next router.call payload.
    const messages = [
      ...pendingContextInjections.map((m) => ({ role: m.role, content: m.content })),
      ...compaction.turns.map((t) => ({ role: t.role, content: t.content })),
    ];
    pendingContextInjections.length = 0;

    let decision: Decision = await deps.router.call({
      system: assembleSystem(req.persona, plan, memory.totalBytes),
      tools,
      messages,
    });

    // Permission-mode pre-check for tool_call decisions. Plan mode
    // short-circuits BEFORE the hook chain runs so destructive tools
    // never even reach the dispatcher.
    if (decision.kind === 'tool_call') {
      const riskTier = (deps.toolRiskTier ?? defaultRiskTier)(
        decision.call.toolName,
      );
      // H6 — Sub-MD risk-tier ceiling enforcement. When the parent
      // passed a `subMdRiskTierCeiling`, deny any tool whose tier is
      // STRICTER than the ceiling. A `read`-tier sub-MD must not be
      // able to emit a `mutate`-tier tool even if its toolBelt happens
      // to list one. The audit's H6 requirement: transitivity of the
      // sub-MD's declared tier into the child orchestrator.
      if (
        req.subMdRiskTierCeiling &&
        exceedsRiskTierCeiling(riskTier, req.subMdRiskTierCeiling)
      ) {
        consecutivePermissionDenies += 1;
        const reason = `sub-md riskTier ceiling '${req.subMdRiskTierCeiling}' exceeded by tool ${decision.call.toolName} (tier '${riskTier}')`;
        budget = budget.consume({
          kind: 'tool_error',
          callId: decision.call.callId,
          message: reason,
          latencyMs: 0,
        });
        if (consecutivePermissionDenies > denyRetryLimit) {
          return sealAndReturn({
            kind: 'stopped',
            reason: `sub-md-tier-ceiling: ${reason}`,
            partialText: lastText,
          });
        }
        pendingContextInjections.push({
          role: 'system',
          content: `[sub-md-ceiling] ${reason}. Pick a tool whose tier is ${req.subMdRiskTierCeiling} or lower.`,
        });
        continue;
      }
      const pmEval = evaluatePermissionMode(
        {
          currentMode: permissionMode,
          ...(req.tenantPermissionModeOverride
            ? { tenantOverride: req.tenantPermissionModeOverride }
            : {}),
          callerScopes: req.grantedScopes ?? [],
        },
        { riskTier },
      );
      if (pmEval.decision === 'plan-preview') {
        const preview = renderPlanModePreview({
          toolName: decision.call.toolName,
          inputs: decision.call.input,
          riskTier,
        });
        return {
          kind: 'plan-preview',
          preview,
          pendingDecision: decision,
        };
      }
      if (pmEval.decision === 'deny') {
        // H1 — Cap consecutive deny retries. The router will likely
        // return the SAME decision next tick because the plan hasn't
        // advanced; without a cap the loop burns its entire turn
        // budget on a single permission-deny.
        consecutivePermissionDenies += 1;
        budget = budget.consume({
          kind: 'tool_error',
          callId: decision.call.callId,
          message: pmEval.reason ?? 'permission-mode deny',
          latencyMs: 0,
        });
        if (consecutivePermissionDenies > denyRetryLimit) {
          await deps.hookChain.runStop(
            {
              threadId: req.threadId,
              turnCount: budget.snapshot().usage.turns,
              finalText: lastText,
              exhaustedAxis: null,
            },
            ctx,
          );
          return {
            kind: 'stopped',
            reason: `permission-mode-deny (${pmEval.reason ?? 'permission-mode deny'}); exceeded ${denyRetryLimit} retries`,
            partialText: lastText,
          };
        }
        // Inject a context message so the next router.call sees the
        // deny reason and can plan around it.
        pendingContextInjections.push({
          role: 'system',
          content: `[permission-mode] tool ${decision.call.toolName} was denied (${pmEval.reason ?? 'permission-mode deny'}); pick a different approach.`,
        });
        continue;
      }
      // `ask` falls through to the hook chain, which may also turn this
      // into an ask-owner via the four-eye hook.
      // `allow` falls through too — hooks still run for audit.
    }

    // CRITICAL #3 — Plan-mode propagation to spawn_sub_md.
    //
    // Without this branch, a parent in plan-mode could spawn a sub-MD
    // that executes mutates the parent's plan-mode promised would be
    // previewed. We treat any spawn as a mutate-tier action (spawning
    // a child sub-MD IS a mutate of the parent's task graph), so
    // plan-mode short-circuits to a preview and the child is NEVER
    // spawned. For non-plan modes, we ALSO thread the parent's
    // permissionMode into the spawn payload so the child orchestrator
    // inherits the policy — transitivity across the spawn tree.
    if (decision.kind === 'spawn_sub_md') {
      const spawnPmEval = evaluatePermissionMode(
        {
          currentMode: permissionMode,
          ...(req.tenantPermissionModeOverride
            ? { tenantOverride: req.tenantPermissionModeOverride }
            : {}),
          callerScopes: req.grantedScopes ?? [],
        },
        { riskTier: 'mutate' },
      );
      if (spawnPmEval.decision === 'plan-preview') {
        const preview = renderPlanModePreview({
          toolName: `spawn_sub_md:${decision.spawn.subMdId}`,
          inputs: {
            persona: decision.spawn.persona ?? req.persona,
            description: decision.spawn.description ?? '',
            prompt: decision.spawn.prompt ?? '',
            tools: decision.spawn.tools ?? [],
            background: decision.spawn.background ?? decision.spawn.fireAndForget ?? false,
          },
          riskTier: 'mutate',
        });
        return {
          kind: 'plan-preview',
          preview,
          pendingDecision: decision,
        };
      }
      if (spawnPmEval.decision === 'deny') {
        // H1 — same retry cap applies to spawn denies.
        consecutivePermissionDenies += 1;
        budget = budget.consume({
          kind: 'tool_error',
          callId: `spawn:${decision.spawn.subMdId}`,
          message: spawnPmEval.reason ?? 'permission-mode deny (spawn)',
          latencyMs: 0,
        });
        if (consecutivePermissionDenies > denyRetryLimit) {
          await deps.hookChain.runStop(
            {
              threadId: req.threadId,
              turnCount: budget.snapshot().usage.turns,
              finalText: lastText,
              exhaustedAxis: null,
            },
            ctx,
          );
          return {
            kind: 'stopped',
            reason: `permission-mode-deny (${spawnPmEval.reason ?? 'permission-mode deny (spawn)'}); exceeded ${denyRetryLimit} retries`,
            partialText: lastText,
          };
        }
        pendingContextInjections.push({
          role: 'system',
          content: `[permission-mode] spawn ${decision.spawn.subMdId} was denied (${spawnPmEval.reason ?? 'permission-mode deny (spawn)'}); pick a different approach.`,
        });
        continue;
      }
      // Transitivity — overwrite the spawn payload's permissionMode with
      // the parent's effective mode unless the spawn explicitly carries
      // one (a child overriding is allowed but the override starts from
      // the parent's policy, not from `default`).
      if (decision.spawn.permissionMode === undefined) {
        decision = {
          kind: 'spawn_sub_md',
          spawn: { ...decision.spawn, permissionMode },
        };
      }
    }

    const preChain: PreToolUseChainResult =
      await deps.hookChain.runPreToolUse(decision, ctx);

    // Fold any chain-level additional-context emissions into the next
    // iteration's router.call payload.
    if (preChain.contextInjections.length > 0) {
      pendingContextInjections.push(...preChain.contextInjections);
    }

    const preOutcome = preChain.outcome;
    if (preOutcome.kind === 'deny') {
      budget = budget.consume({
        kind: 'tool_error',
        callId: 'denied',
        message: 'pre-hook denied',
        latencyMs: 0,
      });
      continue;
    }
    if (preOutcome.kind === 'ask-owner') {
      return {
        kind: 'ask-approval',
        prompt: preOutcome.prompt,
        channel: preOutcome.channel,
        pendingDecision: decision,
      };
    }
    if (preOutcome.kind === 'sandbox') {
      return {
        kind: 'speculative',
        sandboxId: preOutcome.sandboxId,
        pendingDecision: decision,
      };
    }
    if (preOutcome.kind === 'defer') {
      return {
        kind: 'ack-defer',
        resumeAfterMs: preOutcome.resumeAfterMs,
        reason: preOutcome.reason,
        pendingDecision: decision,
      };
    }
    if (preOutcome.kind === 'stop') {
      await deps.hookChain.runStop(
        {
          threadId: req.threadId,
          turnCount: budget.snapshot().usage.turns,
          finalText: lastText,
          exhaustedAxis: null,
        },
        ctx,
      );
      return {
        kind: 'stopped',
        reason: preOutcome.reason,
        partialText: lastText,
      };
    }

    // Resolve the Decision that the dispatcher actually runs. `transform`
    // and `updated-input` both rewrite — the chain has already folded
    // `updated-input` into `effectiveDecision`.
    const toRun: Decision =
      preOutcome.kind === 'transform'
        ? preOutcome.replacement
        : preChain.effectiveDecision ?? decision;

    // H1 — successful dispatch (or a dispatch attempt that reached the
    // dispatcher) resets the permission-deny retry counter.
    consecutivePermissionDenies = 0;

    const result = await deps.dispatcher.dispatch(toRun, ctx);

    // subagent lifecycle hooks for spawn_sub_md decisions.
    if (toRun.kind === 'spawn_sub_md') {
      const subStart = await deps.hookChain.runSubagentStart(
        {
          subMdId: toRun.spawn.subMdId,
          persona: toRun.spawn.persona ?? req.persona,
          parentThreadId: req.threadId,
        },
        ctx,
      );
      const subStartTerminal = terminalFromHook(subStart);
      if (subStartTerminal) return sealAndReturn(subStartTerminal);

      // Background spawns fire-and-forget: the parent continues
      // immediately; the stop hook fires when the child completes
      // (simulated synchronously here since the in-memory dispatcher
      // returns a spawn_ack synchronously).
      const subStop = await deps.hookChain.runSubagentStop(
        {
          subMdId: toRun.spawn.subMdId,
          persona: toRun.spawn.persona ?? req.persona,
          parentThreadId: req.threadId,
          outcome: result,
        },
        ctx,
      );
      const subStopTerminal = terminalFromHook(subStop);
      if (subStopTerminal) return sealAndReturn(subStopTerminal);
    }

    // C3 — consume the post-tool-use chain's return value. A deny from
    // the post-chain means an audit hook (or any other post hook) threw
    // OR explicitly refused. The dispatch already happened so we can't
    // un-execute it, but we MUST emit a loud operator-visible signal so
    // an audit-pipeline outage doesn't go unnoticed.
    const postChainOutcome = await deps.hookChain.runPostToolUse(
      toRun,
      result,
      ctx,
    );
    if (postChainOutcome.kind !== 'allow') {
      const reason =
        postChainOutcome.kind === 'deny'
          ? postChainOutcome.reason
          : `post-hook returned ${postChainOutcome.kind}`;
      deps.logger?.error?.('post-tool-use audit-pipeline failure', {
        threadId: req.threadId,
        toolName:
          toRun.kind === 'tool_call' ? toRun.call.toolName : toRun.kind,
        reason,
      });
      deps.logger?.warn?.('post-tool-use audit-pipeline failure', {
        threadId: req.threadId,
        toolName:
          toRun.kind === 'tool_call' ? toRun.call.toolName : toRun.kind,
        reason,
      });
    }
    await deps.sessionStore.checkpoint(
      session,
      toRun,
      result,
      plan.state(),
      budget.snapshot(),
    );

    if (goal) {
      plan = plan.advance({ goalId: goal.id, newStatus: 'complete' });
    }
    budget = budget.consume(result);

    if (result.kind === 'response') {
      lastText = result.text;
    }

    if (toRun.kind === 'respond_to_owner' || toRun.kind === 'final') {
      await deps.hookChain.runStop(
        {
          threadId: req.threadId,
          turnCount: budget.snapshot().usage.turns,
          finalText: toRun.text,
          exhaustedAxis: null,
        },
        ctx,
      );
      return {
        kind: 'answer',
        text: toRun.text,
        turnsUsed: budget.snapshot().usage.turns,
        citations: [],
        artifacts: [],
      };
    }
    if (toRun.kind === 'schedule_wake') {
      return {
        kind: 'ack-schedule',
        resumeToken: toRun.wake.resumeToken ?? toRun.wake.wakeAt,
      };
    }
    // HIGH-A — `Decision.kind === 'monitor'` was previously unhandled.
    // The dispatcher returned `monitor_ack` and the loop kept going,
    // contradicting `decision.ts:18` ("install a watcher and yield").
    // The orchestrator now yields an ack-schedule keyed by the watcher
    // id so the wake-loop can re-enter when the predicate fires.
    if (toRun.kind === 'monitor') {
      return {
        kind: 'ack-schedule',
        resumeToken: `monitor:${toRun.watch.watchId}`,
      };
    }
    // For spawn_sub_md fire-and-forget, the parent continues looping.
    if (toRun.kind === 'spawn_sub_md' && isBackgroundSpawn(toRun.spawn)) {
      continue;
    }
  }

  const snapshot = budget.snapshot();
  await deps.hookChain.runStop(
    {
      threadId: req.threadId,
      turnCount: snapshot.usage.turns,
      finalText: lastText,
      exhaustedAxis: snapshot.exhaustionAxis,
    },
    ctx,
  );

  if (snapshot.exhausted && snapshot.exhaustionAxis) {
    return {
      kind: 'budget-exhausted',
      axis: snapshot.exhaustionAxis,
      partialText: lastText,
    };
  }

  return {
    kind: 'answer',
    text: lastText,
    turnsUsed: snapshot.usage.turns,
    citations: [],
    artifacts: [],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Map a hook-stage non-allow outcome onto an OrchestratorResponse. Used
 * by the lifecycle stages (session-start, user-prompt-submit,
 * pre-compact, post-compact, subagent-*) which all return a raw
 * HookResult. Returns `null` when the outcome is `allow` or a
 * pre-tool-use-only variant that doesn't apply to lifecycle stages.
 */
function terminalFromHook(
  result: HookResult,
): OrchestratorResponseExtended | null {
  switch (result.kind) {
    case 'allow':
    case 'updated-input':
    case 'additional-context':
    case 'transform':
    case 'sandbox':
      return null;
    case 'deny':
      return {
        kind: 'stopped',
        reason: `denied: ${result.reason}`,
        partialText: '',
      };
    case 'ask-owner':
      return {
        kind: 'ask-approval',
        prompt: result.prompt,
        channel: result.channel,
        pendingDecision: { kind: 'final', text: '' },
      };
    case 'defer':
      return {
        kind: 'ack-defer',
        resumeAfterMs: result.resumeAfterMs,
        reason: result.reason,
        pendingDecision: { kind: 'final', text: '' },
      };
    case 'stop':
      return {
        kind: 'stopped',
        reason: result.reason,
        partialText: '',
      };
  }
}

function assembleSystem(persona: string, plan: Plan, memoryBytes: number): string {
  const goal = plan.currentGoal();
  return [
    `Persona: ${persona}`,
    goal ? `Current goal: ${goal.description}` : 'No active goal.',
    `Memory bytes loaded: ${memoryBytes}`,
  ].join('\n');
}

function approxTokens(
  transcript: ReadonlyArray<{ content: string }>,
): number {
  // Cheap heuristic so the pre-compact hook gets a non-zero signal
  // without importing the full token counter. Real counts come from
  // contextBudget.compactIfOver.
  let words = 0;
  for (const t of transcript) {
    if (!t.content) continue;
    words += t.content.trim().split(/\s+/).length;
  }
  return Math.ceil(words / 0.75);
}

function defaultRiskTier(_toolName: string): RiskTier {
  // Conservative fallback — assume the tool mutates state. The plan-mode
  // short-circuit will preview rather than execute, which is the safe
  // behaviour for an unknown tool.
  return 'mutate';
}

/**
 * H1 — default cap on consecutive permission-mode `deny` retries before
 * the loop surfaces a terminal `stopped` outcome. Keeps the budget burn
 * bounded: after 2 retries the model has seen the deny twice and has
 * had a chance to reroute; if it still emits the same decision the
 * caller almost certainly wants a stop, not silent exhaustion.
 */
const DEFAULT_PERMISSION_DENY_RETRIES = 2;

/**
 * H6 — Risk-tier ordering used to enforce a sub-MD's declared `riskTier`
 * as a ceiling on every tool_call its child orchestrator emits. Tiers
 * are ordered by destructiveness; a tier exceeds the ceiling when its
 * ordinal is greater than the ceiling's ordinal.
 *
 * The ordering covers every value of `RiskTier`. New tiers added to
 * `risk-tier.ts` MUST extend this map; the function defensively treats
 * any unmapped tier as exceeding any ceiling (fail closed).
 */
const RISK_TIER_ORDINAL: Readonly<Record<string, number>> = Object.freeze({
  read: 0,
  mutate: 1,
  'external-comm': 2,
  destroy: 3,
  billing: 4,
});

function exceedsRiskTierCeiling(
  candidate: RiskTier,
  ceiling: RiskTier,
): boolean {
  const candidateOrd = RISK_TIER_ORDINAL[candidate];
  const ceilingOrd = RISK_TIER_ORDINAL[ceiling];
  // Fail closed: unknown tiers are treated as exceeding any ceiling.
  if (candidateOrd === undefined || ceilingOrd === undefined) return true;
  return candidateOrd > ceilingOrd;
}

// Re-export the Session type for callers wiring custom dispatchers.
export type { Session };
