/**
 * Tool dispatcher adapter (Item-5).
 *
 * Implements the orchestrator's `Dispatcher` port over the kernel's real
 * `BrainToolRegistry`. The main loop hands it a `Decision` (already gated
 * by the 9-hook PreToolUse chain) and expects a closed `DispatchResult`.
 *
 * Mapping (Decision → DispatchResult):
 *   - `tool_call`        → run the registry tool via `runTool(...)`; a
 *                          `BrainToolOutcome` is mapped onto `tool_ok` /
 *                          `tool_error`.
 *   - `respond_to_owner` → `response` (the model's final text).
 *   - `final`            → `response` (graceful close).
 *   - `schedule_wake`    → `wake_ack`.
 *   - `monitor`          → `monitor_ack`.
 *   - `spawn_sub_md`     → `spawn_ack`. Inline sub-MD execution is a
 *                          separate subsystem; the dispatcher acks the
 *                          spawn (preserving the parent's fire-and-forget
 *                          contract) and an optional injected
 *                          `spawnHandler` can perform the real fork.
 *
 * Pure-async; never throws out of `dispatch` — a registry/executor
 * failure surfaces as a `tool_error` so the main loop can re-plan rather
 * than crash the turn.
 *
 * @module kernel/orchestrator/tool-dispatcher
 */

import type { BrainToolRegistry } from '../tool-spec.js';
import type { Decision, DispatchResult, SubMdSpawn } from './decision.js';
import type { Dispatcher } from './main-loop.js';
import type { HookContext } from './hook-chain.js';
import { isSovereignGapSource } from './gap-sovereign-classifier.js';

/**
 * The Capability-Gap DETECTION SEAM (Loop A, P0;
 * `Docs/research/THE_METACOGNITIVE_SELF_MODEL.md` §3.2). When a tool resolves to
 * a NOT_YET_WIRED organ (`executor-failed`) or cannot be found
 * (`not-found`), the dispatcher records a typed capability gap keyed on the
 * MISSING tool/organ as the blocker — BEFORE returning the (still-failing)
 * `tool_error`. The request keeps failing honestly (no faked success); the gap
 * is now durable so the `GapRegistryWatcher` can auto-complete it once the tool
 * registers.
 *
 * The kernel does NOT own the gap store. The composition root wires this port
 * over the `MdCommitmentRepository.createGap`, deriving the tenant from `ctx`.
 * Fire-and-forget + fail-safe: a detector fault NEVER changes the dispatch
 * result (the tool error is returned regardless).
 */
export interface GapDetectorPort {
  recordUnwiredOrganGap(input: {
    /** The tool/organ the brain tried to call and could not. */
    readonly toolName: string;
    /** Why it was blocked — 'unwired_organ' (stub) or 'missing_tool' (absent). */
    readonly gapKind: 'unwired_organ' | 'missing_tool';
    /** The intent that was blocked (e.g. the executor-failed message). */
    readonly intent: string;
    /**
     * Derived sovereign flag (FIX 2). True when the blocked tool/intent is a
     * SOVEREIGN / HIGH-risk surface (money / licence-suspension / deletion /
     * four-eye + the sovereign policy prefixes), classified by the SAME rail
     * the policy gate uses (`isSovereignGapSource` → `isHighRiskLiteralOnly`).
     * A sovereign-born gap MUST be persisted with `sovereign=true` so the
     * auto-completer PARKS it (never auto-actuates when the blocker clears).
     */
    readonly sovereign: boolean;
    /** The live hook context (tenant scope, thread) for the gap row. */
    readonly ctx: HookContext;
  }): Promise<void>;
}

export interface ToolDispatcherConfig {
  /** The kernel's tool registry — the SAME catalog projected into toolSearch. */
  readonly registry: BrainToolRegistry;
  /** Monotonic clock for latency measurement. Defaults to `Date.now`. */
  readonly clock?: () => number;
  /**
   * Optional handoff token generator for spawn acks. Defaults to a
   * monotonic per-dispatcher counter. Production may inject
   * `() => randomUUID()`.
   */
  readonly handoffTokenGenerator?: () => string;
  /**
   * Optional real sub-MD spawn handler. When wired, a `spawn_sub_md`
   * decision invokes it; when omitted, the dispatcher returns a
   * structured `spawn_ack` breadcrumb (the Phase-E placeholder behaviour)
   * so the parent loop's fire-and-forget contract still holds.
   *
   * The handler receives the spawn payload AND the live parent
   * `HookContext` (current thread/scope/tier/grantedScopes) so a real
   * handler can run the child sub-MD inside the parent's scope and fold
   * the child's result back into the parent turn (see
   * `composition/sub-md-spawn-handler.ts`). The `ctx` arg is optional so
   * existing handlers (and the tests) that ignore it still type-check.
   */
  readonly spawnHandler?: (
    spawn: SubMdSpawn,
    ctx?: HookContext,
  ) => Promise<{ readonly handoffToken: string }>;
  /**
   * Modality arbiter (COG-07/AUT-14) — optional learned-skill handler.
   * When wired, a `run_skill` decision invokes it; when omitted the
   * dispatcher returns a structured `skill_ack` breadcrumb (same
   * fall-closed pattern as `spawnHandler`) so the loop continues.
   */
  readonly skillHandler?: (
    args: {
      readonly skillId: string;
      readonly params: Readonly<Record<string, unknown>>;
    },
    ctx?: HookContext,
  ) => Promise<{ readonly output?: unknown }>;
  /**
   * Modality arbiter — optional higher-order modality handler
   * (tab/document/media/forecast/workflow/loop). When wired, a `run_modality`
   * decision invokes it; when omitted the dispatcher returns a
   * `modality_ack` breadcrumb. `forecast` is a generative ARTIFACT modality
   * routed to the forecast engine + surfaced as a proposal. Money/licence
   * actions never reach here as a modality — they remain
   * `tool_call`/`spawn_sub_md` gated by the rails.
   */
  readonly modalityHandler?: (
    args: {
      readonly modality:
        | 'tab'
        | 'document'
        | 'media'
        | 'forecast'
        | 'workflow'
        | 'loop';
      readonly payload: Readonly<Record<string, unknown>>;
    },
    ctx?: HookContext,
  ) => Promise<{ readonly output?: unknown }>;
  /**
   * Capability-Gap DETECTION SEAM (Loop A, P0). When wired, a tool that
   * resolves to a NOT_YET_WIRED organ (`executor-failed`) or is not found
   * (`not-found`) records a durable `unwired_organ` / `missing_tool` gap keyed
   * on the missing tool — BEFORE the (still-failing) `tool_error` is returned.
   * When omitted the dispatcher behaves exactly as before (the seam is purely
   * additive). Fail-safe: a detector fault never changes the dispatch result.
   */
  readonly gapDetector?: GapDetectorPort;
  /** Optional logger (Pino-style). No console.* per the hard rules. */
  readonly logger?: {
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Build a real `Dispatcher` that actuates each `Decision` variant.
 */
export function createToolDispatcher(config: ToolDispatcherConfig): Dispatcher {
  const clock = config.clock ?? Date.now;
  let handoffSeq = 0;
  const nextHandoff =
    config.handoffTokenGenerator ??
    ((): string => {
      handoffSeq += 1;
      return `handoff_${handoffSeq}`;
    });

  /**
   * Record a capability gap at the detection seam — fire-and-forget + fail-safe.
   * A detector fault is swallowed (logged) so it can NEVER change the dispatch
   * result: the tool keeps failing honestly while the gap is durably filed.
   */
  async function recordGap(
    toolName: string,
    gapKind: 'unwired_organ' | 'missing_tool',
    intent: string,
    ctx: HookContext,
  ): Promise<void> {
    if (!config.gapDetector) return;
    try {
      // FIX 2 — derive sovereign from the SAME rail the policy gate uses, so a
      // sovereign tool/intent is born `sovereign=true` and the auto-completer
      // parks it (never auto-actuates when the blocker clears).
      const sovereign = isSovereignGapSource({ toolName, intent });
      await config.gapDetector.recordUnwiredOrganGap({
        toolName,
        gapKind,
        intent,
        sovereign,
        ctx,
      });
    } catch (err) {
      config.logger?.warn('tool-dispatcher gapDetector threw', {
        toolName,
        reason: err instanceof Error ? err.message : 'gap-detector error',
      });
    }
  }

  async function dispatchToolCall(
    decision: Extract<Decision, { kind: 'tool_call' }>,
    ctx: HookContext,
  ): Promise<DispatchResult> {
    const started = clock();
    const { toolName, input, callId } = decision.call;
    try {
      const outcome = await config.registry.runTool(toolName, input);
      const latencyMs = clock() - started;
      switch (outcome.kind) {
        case 'ok':
          return {
            kind: 'tool_ok',
            callId,
            output: outcome.output,
            latencyMs,
            // The deterministic BrainTool layer is not token-metered;
            // token/cost accounting rides the sensor/router seam. Report
            // zeros so the budget's tool-call axis still advances.
            tokensIn: 0,
            tokensOut: 0,
            usdCost: 0,
          };
        case 'not-found':
          // DETECTION SEAM — a dispatch miss is a `missing_tool` gap. File it,
          // then STILL fail the request (no faked success).
          await recordGap(
            toolName,
            'missing_tool',
            `tool not found: ${toolName}`,
            ctx,
          );
          return {
            kind: 'tool_error',
            callId,
            message: `tool not found: ${toolName}`,
            latencyMs,
          };
        case 'input-invalid':
          return {
            kind: 'tool_error',
            callId,
            message: `input-invalid: ${outcome.issue}`,
            latencyMs,
          };
        case 'output-invalid':
          return {
            kind: 'tool_error',
            callId,
            message: `output-invalid: ${outcome.issue}`,
            latencyMs,
          };
        case 'executor-failed':
          // DETECTION SEAM — a NOT_YET_WIRED organ surfaces here. File an
          // `unwired_organ` gap keyed on the organ, then STILL fail the request.
          await recordGap(
            toolName,
            'unwired_organ',
            `executor-failed: ${outcome.message}`,
            ctx,
          );
          return {
            kind: 'tool_error',
            callId,
            message: `executor-failed: ${outcome.message}`,
            latencyMs,
          };
        default:
          // Fail closed on any future BrainToolOutcome variant. The
          // explicit cases above cover the current union; a new variant
          // surfaces here as a tool_error rather than silently passing.
          return {
            kind: 'tool_error',
            callId,
            message: 'unknown tool outcome',
            latencyMs,
          };
      }
    } catch (err) {
      const latencyMs = clock() - started;
      const message =
        err instanceof Error ? err.message : 'tool dispatch error';
      config.logger?.warn('tool-dispatcher runTool threw', {
        toolName,
        reason: message,
      });
      return { kind: 'tool_error', callId, message, latencyMs };
    }
  }

  async function dispatchSpawn(
    decision: Extract<Decision, { kind: 'spawn_sub_md' }>,
    ctx: HookContext,
  ): Promise<DispatchResult> {
    const { spawn } = decision;
    const background = Boolean(spawn.background ?? spawn.fireAndForget);
    if (config.spawnHandler) {
      try {
        // Pass the LIVE parent context so a real handler can run the child
        // sub-MD inside the parent's current thread/scope and fold the
        // child's result back into the parent turn before completion.
        const { handoffToken } = await config.spawnHandler(spawn, ctx);
        return {
          kind: 'spawn_ack',
          subMdId: spawn.subMdId,
          handoffToken,
          ...(background ? { background: true } : {}),
        };
      } catch (err) {
        config.logger?.warn('tool-dispatcher spawnHandler threw', {
          subMdId: spawn.subMdId,
          reason: err instanceof Error ? err.message : 'spawn error',
        });
        // Fall through to the breadcrumb ack so the parent loop continues.
      }
    }
    return {
      kind: 'spawn_ack',
      subMdId: spawn.subMdId,
      handoffToken: nextHandoff(),
      ...(background ? { background: true } : {}),
    };
  }

  async function dispatchSkill(
    decision: Extract<Decision, { kind: 'run_skill' }>,
    ctx: HookContext,
  ): Promise<DispatchResult> {
    if (config.skillHandler) {
      try {
        const { output } = await config.skillHandler(
          { skillId: decision.skillId, params: decision.params },
          ctx,
        );
        return { kind: 'skill_ack', skillId: decision.skillId, output };
      } catch (err) {
        config.logger?.warn('tool-dispatcher skillHandler threw', {
          skillId: decision.skillId,
          reason: err instanceof Error ? err.message : 'skill error',
        });
        // Fall through to the breadcrumb ack so the parent loop continues.
      }
    }
    return { kind: 'skill_ack', skillId: decision.skillId };
  }

  async function dispatchModality(
    decision: Extract<Decision, { kind: 'run_modality' }>,
    ctx: HookContext,
  ): Promise<DispatchResult> {
    if (config.modalityHandler) {
      try {
        const { output } = await config.modalityHandler(
          { modality: decision.modality, payload: decision.payload },
          ctx,
        );
        return { kind: 'modality_ack', modality: decision.modality, output };
      } catch (err) {
        config.logger?.warn('tool-dispatcher modalityHandler threw', {
          modality: decision.modality,
          reason: err instanceof Error ? err.message : 'modality error',
        });
        // Fall through to the breadcrumb ack so the parent loop continues.
      }
    }
    return { kind: 'modality_ack', modality: decision.modality };
  }

  return {
    async dispatch(
      decision: Decision,
      ctx: HookContext,
    ): Promise<DispatchResult> {
      switch (decision.kind) {
        case 'tool_call':
          return dispatchToolCall(decision, ctx);
        case 'respond_to_owner':
        case 'final':
          return {
            kind: 'response',
            text: decision.text,
            tokensIn: 0,
            tokensOut: 0,
            usdCost: 0,
          };
        case 'schedule_wake':
          return {
            kind: 'wake_ack',
            resumeToken: decision.wake.resumeToken ?? decision.wake.wakeAt,
          };
        case 'monitor':
          return { kind: 'monitor_ack', watchId: decision.watch.watchId };
        case 'spawn_sub_md':
          return dispatchSpawn(decision, ctx);
        case 'run_skill':
          return dispatchSkill(decision, ctx);
        case 'run_modality':
          return dispatchModality(decision, ctx);
        default:
          // Fail closed over the closed Decision union. Every current
          // variant is handled above; a new one surfaces as a tool_error.
          return {
            kind: 'tool_error',
            callId: 'unknown',
            message: 'unknown decision kind',
            latencyMs: 0,
          };
      }
    },
  };
}
