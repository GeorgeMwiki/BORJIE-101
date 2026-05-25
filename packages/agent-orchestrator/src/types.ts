/**
 * @borjie/agent-orchestrator — public types.
 *
 * A composable, model-agnostic orchestration layer for 2026-era agent
 * patterns. Every runtime port (LLM brain, tools, persistence, audit
 * sinks) is injected so the package compiles and tests stand-alone.
 *
 * Design tenets:
 *
 *   - PURE TYPES + PURE FUNCTIONS. No side-effects at import time.
 *   - IMMUTABLE STATE. Every transition returns a NEW object.
 *   - PORT/ADAPTER. The package never imports an SDK directly.
 *   - STREAMING-FRIENDLY. Long-running flows emit `OrchestratorEvent`s.
 *
 * Source-of-truth references:
 *
 *   - ReAct (Yao et al. 2022 + 2026 BFCL v4 best practice)
 *   - Plan-and-Execute (LangGraph 0.5 docs, 2026)
 *   - Reflexion (Shinn et al. 2023 + Voyager-style skill promotion)
 *   - Self-Consistency (Wang et al. 2022 best-of-N)
 *   - Constitutional AI (Anthropic 2022/2024)
 *   - OpenAI Swarm (Apr 2025) — handoff-based multi-agent
 *   - AutoGen 0.6 (Microsoft 2025) — round-robin / manager group chat
 *   - CrewAI 0.50 (Q1 2026) — process: sequential | hierarchical
 *   - LangGraph 0.5 — state-machine + checkpointing
 *
 * See `Docs/AGENT_ORCHESTRATOR_RESEARCH_2026-05-24.md` for the full
 * bibliography (10+ citations).
 */

// ─────────────────────────────────────────────────────────────────────
// Brain port — the single seam every pattern reads/writes through.
// Implementations: Anthropic SDK adapter, OpenAI adapter, deterministic
// in-test stub, etc. The package owns NONE of those — only this port.
// ─────────────────────────────────────────────────────────────────────

export interface BrainCallRequest {
  /** System prompt (cacheable). */
  readonly system: string;
  /** Ordered message list. Roles match Anthropic/OpenAI conventions. */
  readonly messages: ReadonlyArray<BrainMessage>;
  /** Optional tool catalogue exposed to the model. */
  readonly tools?: ReadonlyArray<BrainTool>;
  /** Sampling temperature. `0` = deterministic; `1` = creative. */
  readonly temperature?: number;
  /** Token cap for THIS call. */
  readonly maxTokens?: number;
  /** Strict structured output expected; brain may set tool_choice. */
  readonly structuredOutput?: boolean;
  /**
   * Caller-supplied tag (for logging + cache invalidation). The brain
   * implementation may surface it back on the response.
   */
  readonly traceTag?: string;
}

export interface BrainMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Tool-call name + id when role === 'tool'. */
  readonly name?: string;
  readonly toolCallId?: string;
}

export interface BrainTool {
  readonly name: string;
  readonly description: string;
  /** JSON-schema describing the tool's input. */
  readonly inputSchema: Record<string, unknown>;
}

export interface BrainCallResponse {
  /** Plain assistant text (may be empty if only tool_calls are returned). */
  readonly text: string;
  /** Structured tool invocations the agent wants to perform. */
  readonly toolCalls: ReadonlyArray<BrainToolCall>;
  /** Token usage for budget accounting. */
  readonly usage: TokenUsage;
  /** Model id actually selected by the router (for telemetry). */
  readonly model: string;
  /** Whether prompt caching reused the system prompt. */
  readonly cacheHit?: boolean;
  /** Reason the model stopped (end_turn | tool_use | max_tokens | budget). */
  readonly stopReason: StopReason;
}

export interface BrainToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'budget_exceeded'
  | 'error';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
}

export interface BrainPort {
  call(req: BrainCallRequest): Promise<BrainCallResponse>;
}

// ─────────────────────────────────────────────────────────────────────
// Tool port — every runtime tool the agent can call.
// ─────────────────────────────────────────────────────────────────────

export interface ToolPort<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  /** JSON-schema; for the model. */
  readonly inputSchema: Record<string, unknown>;
  /** Pure executor. May throw — caller wraps in retry. */
  execute(input: TInput): Promise<TOutput>;
}

// ─────────────────────────────────────────────────────────────────────
// Agent spec + role.
// ─────────────────────────────────────────────────────────────────────

export type AgentRole =
  | 'planner'
  | 'executor'
  | 'researcher'
  | 'critic'
  | 'judge'
  | 'router'
  | 'worker'
  | 'supervisor'
  | 'specialist';

export interface AgentSpec {
  /** Stable identifier inside an orchestrator. */
  readonly id: string;
  /** Short human label. */
  readonly name: string;
  readonly role: AgentRole;
  /**
   * System prompt — placed in the cacheable system slot for Anthropic
   * prompt caching.
   */
  readonly systemPrompt: string;
  /** Tools this agent may invoke (by tool name). */
  readonly toolAllowlist: ReadonlyArray<string>;
  /** Preferred model tier; the router may override based on cost. */
  readonly preferredModel?: ModelTier;
}

export type ModelTier = 'fast' | 'balanced' | 'powerful';

// ─────────────────────────────────────────────────────────────────────
// Task + plan + step (re-exported from a leaner internal shape so the
// orchestrator doesn't depend on @borjie/agent-platform).
// ─────────────────────────────────────────────────────────────────────

export interface Task {
  readonly id: string;
  /** Natural-language description of the goal. */
  readonly description: string;
  /** Optional structured inputs the agent may consume. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  /** Per-task budget override. */
  readonly budget?: Partial<BudgetSpec>;
}

export interface Step {
  readonly id: string;
  readonly description: string;
  /** Tool name to invoke; null = pure-LLM reasoning step. */
  readonly toolName: string | null;
  readonly input?: unknown;
  /** Step ids that must complete before this one starts. */
  readonly dependsOn: ReadonlyArray<string>;
}

export interface Plan {
  readonly id: string;
  readonly task: Task;
  readonly steps: ReadonlyArray<Step>;
}

// ─────────────────────────────────────────────────────────────────────
// Execution result — the standard envelope every pattern returns.
// ─────────────────────────────────────────────────────────────────────

export type ExecutionOutcome =
  | 'success'
  | 'budget-exhausted'
  | 'failed'
  | 'rejected'
  | 'handoff';

export interface ExecutionTraceEntry {
  readonly at: string;
  readonly kind:
    | 'thought'
    | 'action'
    | 'observation'
    | 'plan'
    | 'critique'
    | 'vote'
    | 'handoff'
    | 'final';
  readonly detail: string;
  readonly agentId?: string;
}

export interface ExecutionResult {
  readonly outcome: ExecutionOutcome;
  /** Final user-facing answer (if any). */
  readonly answer: string;
  /** Full trace of every reasoning + action step taken. */
  readonly trace: ReadonlyArray<ExecutionTraceEntry>;
  /** Token usage rolled up across every brain call. */
  readonly usage: TokenUsage;
  /** Number of brain calls actually issued. */
  readonly brainCalls: number;
  /** Reason explaining outcome (free-text). */
  readonly reason?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Critique (Reflexion / Constitutional patterns).
// ─────────────────────────────────────────────────────────────────────

export interface Critique {
  /** Whether the draft is acceptable as-is. */
  readonly accept: boolean;
  /** Confidence in [0,1]. */
  readonly confidence: number;
  /** Free-text rationale the agent will read back. */
  readonly rationale: string;
  /** Specific improvements the agent should attempt next pass. */
  readonly suggestions: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Handoff (Swarm pattern).
// ─────────────────────────────────────────────────────────────────────

export interface Handoff {
  /** Agent id receiving the handoff. */
  readonly toAgentId: string;
  /** Free-text reason — surfaces in the trace + audit. */
  readonly reason: string;
  /** Optional structured payload passed to the new agent. */
  readonly payload?: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Group-chat state (AutoGen-style).
// ─────────────────────────────────────────────────────────────────────

export interface GroupChatMessage {
  readonly agentId: string;
  readonly content: string;
  readonly at: string;
}

export interface GroupChatState {
  readonly messages: ReadonlyArray<GroupChatMessage>;
  readonly round: number;
  readonly finished: boolean;
  readonly finishReason?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Budget spec.
// ─────────────────────────────────────────────────────────────────────

export interface BudgetSpec {
  /** Per-call token cap. */
  readonly perCall: number;
  /** Per-session token cap across ALL brain calls. */
  readonly perSession: number;
  /** Per-tenant token cap (caller tracks externally). */
  readonly perTenant?: number;
  /** Max wall-clock per session in ms. */
  readonly maxWallMs?: number;
  /** Max number of brain calls per session. */
  readonly maxBrainCalls?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Router policy.
// ─────────────────────────────────────────────────────────────────────

export interface RouterRule {
  /** Match the request `traceTag` or system prompt by substring. */
  readonly matcher:
    | { readonly kind: 'tag-equals'; readonly tag: string }
    | { readonly kind: 'tag-prefix'; readonly prefix: string }
    | { readonly kind: 'role'; readonly role: AgentRole }
    | { readonly kind: 'complexity-above'; readonly threshold: number };
  /** Tier to route this request to. */
  readonly tier: ModelTier;
}

export interface RouterPolicy {
  readonly defaultTier: ModelTier;
  readonly rules: ReadonlyArray<RouterRule>;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator event stream — every multi-agent / streaming runtime
// emits these so consumers can render UI + drive audit.
// ─────────────────────────────────────────────────────────────────────

export type OrchestratorEvent =
  | { readonly kind: 'session-start'; readonly sessionId: string; readonly at: string }
  | { readonly kind: 'agent-thought'; readonly agentId: string; readonly text: string; readonly at: string }
  | { readonly kind: 'tool-call'; readonly agentId: string; readonly toolName: string; readonly input: unknown; readonly at: string }
  | { readonly kind: 'tool-result'; readonly agentId: string; readonly toolName: string; readonly output: unknown; readonly at: string }
  | { readonly kind: 'handoff'; readonly fromAgentId: string; readonly toAgentId: string; readonly reason: string; readonly at: string }
  | { readonly kind: 'message'; readonly agentId: string; readonly content: string; readonly at: string }
  | { readonly kind: 'critique'; readonly agentId: string; readonly accept: boolean; readonly rationale: string; readonly at: string }
  | { readonly kind: 'vote'; readonly agentId: string; readonly choice: string; readonly at: string }
  | { readonly kind: 'budget-warning'; readonly axis: string; readonly remaining: number; readonly at: string }
  | { readonly kind: 'budget-exceeded'; readonly axis: string; readonly at: string }
  | { readonly kind: 'session-end'; readonly outcome: ExecutionOutcome; readonly at: string };

// ─────────────────────────────────────────────────────────────────────
// Errors.
// ─────────────────────────────────────────────────────────────────────

export class BudgetExceededError extends Error {
  public readonly axis: 'tokens' | 'calls' | 'wall-ms' | 'tenant-tokens';
  public readonly limit: number;
  public readonly observed: number;

  constructor(
    axis: BudgetExceededError['axis'],
    limit: number,
    observed: number,
    message?: string,
  ) {
    super(message ?? `budget exceeded on axis '${axis}': observed ${observed} > limit ${limit}`);
    this.name = 'BudgetExceededError';
    this.axis = axis;
    this.limit = limit;
    this.observed = observed;
  }
}

export class HandoffLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandoffLoopError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Pure-function helpers — re-exported so single-agent + multi-agent
// modules and tests share one canonical implementation.
// ─────────────────────────────────────────────────────────────────────

const EMPTY_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
});

export function emptyUsage(): TokenUsage {
  return EMPTY_USAGE;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const cc = (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0);
  const cr = (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0);
  const base = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (cc > 0 && cr > 0) {
    return Object.freeze({ ...base, cacheCreationInputTokens: cc, cacheReadInputTokens: cr });
  }
  if (cc > 0) {
    return Object.freeze({ ...base, cacheCreationInputTokens: cc });
  }
  if (cr > 0) {
    return Object.freeze({ ...base, cacheReadInputTokens: cr });
  }
  return Object.freeze(base);
}

export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens;
}

export function nowIso(): string {
  return new Date().toISOString();
}
