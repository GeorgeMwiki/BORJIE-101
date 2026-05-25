/**
 * Decision ADT — the closed shape the orchestrator's LLM router returns at
 * each tick of the main loop. Mirrors the Claude-Code-level
 * "what does the model want to do next?" surface.
 *
 * Six terminal/transitional variants:
 *   - `respond_to_owner`   final natural-language reply to the caller
 *   - `tool_call`          invoke a registered BrainTool / HQ tool
 *   - `spawn_sub_md`       fork a sub-MD (maintenance-dispatch, complaint-
 *                          triage, etc.) with a scoped sub-budget. The
 *                          payload mirrors Claude Code's Agent tool full
 *                          contract — tools whitelist/blacklist, model
 *                          class, effort hint, permission mode,
 *                          fire-and-forget background mode, isolation
 *                          (inline vs simulated-worktree), parent
 *                          breadcrumb id, per-sub-MD budget.
 *   - `schedule_wake`      ask the wake-loop to revive this thread later
 *   - `monitor`            install a watcher (event predicate) and yield
 *   - `final`              graceful close — plan reached its goal
 *
 * Pure data — no executor coupling. The orchestrator's `dispatch()` is the
 * only thing that knows how to actuate each variant.
 */

import type { ScopeContext } from '../../types.js';
import type { ScopeFilter } from './hook-chain.js';
import type { PermissionMode } from './permission-mode.js';
import type { BudgetLimits } from './budget.js';

// ─────────────────────────────────────────────────────────────────────
// Tool-call payload — orchestrator-side, intentionally distinct from
// the sensor-emitted `SensorCallResult.toolCalls` shape so the
// orchestrator can carry richer routing context (cost ceiling, four-eye
// override, sandbox preference) the sensor adapter does not see.
// ─────────────────────────────────────────────────────────────────────

export interface DecisionToolCall {
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** Caller-supplied unique id so dispatch + hook layers can correlate. */
  readonly callId: string;
  /** Optional estimate so the cost-circuit hook can short-circuit early. */
  readonly estimatedCostUsd?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Sub-MD spawn payload — handoff descriptor for the autonomy-governance
// layer. Mirrors Claude Code's Agent tool full contract.
// ─────────────────────────────────────────────────────────────────────

export type SubMdModelClass = 'haiku' | 'sonnet' | 'opus';
export type SubMdEffort = 'low' | 'medium' | 'high';
export type SubMdIsolation = 'inline' | 'worktree' | 'simulated-worktree';

export interface SubMdSpawn {
  readonly subMdId: string;
  readonly scope: ScopeContext;
  readonly initialInput: Readonly<Record<string, unknown>>;
  /** Caller-supplied SLO id so the parent can read the sub-MD's bench. */
  readonly sloId?: string;
  /**
   * Short description shown to the owner UI alongside the sub-MD's
   * persona name. Helps disambiguate multiple in-flight sub-MDs.
   */
  readonly description?: string;
  /** Persona id the sub-MD should adopt — mirrors Agent's `persona`. */
  readonly persona?: string;
  /** Free-form prompt the sub-MD ingests as its opening user turn. */
  readonly prompt?: string;
  /** Optional scope filter that restricts which tools the sub-MD can use. */
  readonly toolScope?: ScopeFilter;
  /** Allowed tool subset (mirrors Agent's `tools` whitelist). */
  readonly tools?: ReadonlyArray<string>;
  /** Tools the sub-MD is forbidden to call (overrides `tools` allowlist). */
  readonly disallowedTools?: ReadonlyArray<string>;
  /** Model class override (haiku/sonnet/opus). */
  readonly model?: SubMdModelClass;
  /** Extended-thinking budget hint. */
  readonly effort?: SubMdEffort;
  /** Permission-mode override scoped to the sub-MD. */
  readonly permissionMode?: PermissionMode;
  /**
   * Fire-and-forget mode. When `true`, the parent returns a handle and
   * the SubagentStart hook fires synchronously; SubagentStop fires
   * asynchronously when the child completes.
   */
  readonly background?: boolean;
  /** Alias for `background:true`. Both supported for caller convenience. */
  readonly fireAndForget?: boolean;
  /**
   * Isolation level. `inline` runs in the parent thread; `worktree`
   * clones a sandbox DB schema (Phase F wire); `simulated-worktree` is
   * the Phase E placeholder that emits a structured breadcrumb but
   * shares the parent's DB.
   */
  readonly isolation?: SubMdIsolation;
  /** Parent tool-use id so nested spawn chains can be reconstructed. */
  readonly parentToolUseId?: string;
  /** Per-sub-MD budget envelope. */
  readonly budget?: Partial<BudgetLimits>;
}

/** True when the spawn should run fire-and-forget. */
export function isBackgroundSpawn(spawn: SubMdSpawn): boolean {
  return Boolean(spawn.background ?? spawn.fireAndForget);
}

// ─────────────────────────────────────────────────────────────────────
// Schedule-wake payload — caller-supplied wake hint. Implementation
// lives in the wake-loop above the kernel; the orchestrator only emits.
// ─────────────────────────────────────────────────────────────────────

export interface ScheduleWake {
  readonly wakeAt: string;
  readonly reason: string;
  /** Optional event id the wake handler should pass back into think(). */
  readonly resumeToken?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Monitor payload — a coarse predicate description. The composition
// root wires the predicate to a real event bus.
// ─────────────────────────────────────────────────────────────────────

export interface MonitorWatch {
  readonly watchId: string;
  readonly predicate: string;
  readonly timeoutMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Decision union — closed so pattern-matchers exhaust every variant.
// ─────────────────────────────────────────────────────────────────────

export type Decision =
  | {
      readonly kind: 'respond_to_owner';
      readonly text: string;
      readonly citations?: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'tool_call';
      readonly call: DecisionToolCall;
    }
  | {
      readonly kind: 'spawn_sub_md';
      readonly spawn: SubMdSpawn;
    }
  | {
      readonly kind: 'schedule_wake';
      readonly wake: ScheduleWake;
    }
  | {
      readonly kind: 'monitor';
      readonly watch: MonitorWatch;
    }
  | {
      readonly kind: 'final';
      readonly text: string;
    };

// ─────────────────────────────────────────────────────────────────────
// Dispatch result — emitted by the orchestrator's dispatch() for each
// Decision. The main loop consumes this to advance the plan and update
// the budget.
// ─────────────────────────────────────────────────────────────────────

export type DispatchResult =
  | {
      readonly kind: 'tool_ok';
      readonly callId: string;
      readonly output: unknown;
      readonly latencyMs: number;
      readonly tokensIn: number;
      readonly tokensOut: number;
      readonly usdCost: number;
    }
  | {
      readonly kind: 'tool_error';
      readonly callId: string;
      readonly message: string;
      readonly latencyMs: number;
    }
  | {
      readonly kind: 'response';
      readonly text: string;
      readonly tokensIn: number;
      readonly tokensOut: number;
      readonly usdCost: number;
    }
  | {
      readonly kind: 'spawn_ack';
      readonly subMdId: string;
      readonly handoffToken: string;
      /**
       * Set when the spawn was fire-and-forget. The parent should NOT
       * block on the child; the SubagentStop hook fires whenever the
       * child completes.
       */
      readonly background?: boolean;
    }
  | {
      readonly kind: 'wake_ack';
      readonly resumeToken: string;
    }
  | {
      readonly kind: 'monitor_ack';
      readonly watchId: string;
    };
