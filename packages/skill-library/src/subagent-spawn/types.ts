/**
 * Programmatic subagent spec — closes R1 gap #7.
 *
 * Mirrors the Claude-Code-SDK `AgentDefinition` shape so the BORJIE
 * orchestrator gets a per-query agent factory with the FULL isolation
 * contract (R1 §F.3):
 *
 *   • Subagent gets its OWN system prompt + tool definitions (parent's set
 *     or subset). It does NOT receive parent conversation history, parent
 *     tool results, or parent system prompt.
 *
 *   • Only the subagent's TYPED final result returns to the parent.
 *
 *   • Subagents CANNOT spawn their own subagents (no `Agent` in `allowed_tools`).
 *
 * Compared to filesystem subagents, programmatic specs are dynamic — every
 * call to `spawnSubAgent` can supply a fresh spec composed at runtime (e.g.
 * choose tools based on jurisdiction, model based on tenant tier).
 */

/**
 * Specification for a subagent. Constructed per-call.
 */
export interface SubAgentSpec {
  /** Stable identifier, e.g. "researcher", "drafter", "compliance-checker". */
  readonly name: string;
  /**
   * Auto-delegation cue — short noun phrase the orchestrator inspects to
   * decide which spec to spawn for a given task.
   */
  readonly description: string;
  /**
   * Tool allowlist for THIS subagent. Names must NOT include `Agent` —
   * subagents cannot spawn subagents.
   */
  readonly allowed_tools: ReadonlyArray<string>;
  /** System prompt that fully replaces the parent's. */
  readonly system_prompt: string;
  /**
   * Tool-use turn cap. Required (no implicit inheritance — we want
   * per-spec budget visibility).
   */
  readonly max_turns: number;
  /**
   * Always TRUE for the isolation contract. Listed explicitly so callers
   * can't silently disable isolation; we throw if `false` is supplied.
   */
  readonly isolated_context: true;
  /** Optional per-spec model override (e.g. "haiku" for cheap workers). */
  readonly model?: 'haiku' | 'sonnet' | 'opus' | 'inherit';
  /** Optional per-spec effort override. */
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Optional worktree isolation (mirrors the agent-harness pattern). */
  readonly worktree_isolation?: WorktreeIsolation;
}

export interface WorktreeIsolation {
  /** Branch name to create the worktree on, e.g. "claude/research-task". */
  readonly branch: string;
  /** Base commit/ref the worktree forks from. */
  readonly base_ref: string;
  /** Absolute path the worktree will be created at. */
  readonly path: string;
  /** Auto-remove the worktree when the subagent completes. */
  readonly cleanup_on_exit: boolean;
}

/**
 * Typed result returned to the parent. Parent NEVER sees the subagent's
 * conversation history.
 */
export interface SubAgentResult<TOutput = unknown> {
  readonly name: string;
  readonly status: 'ok' | 'error' | 'budget_exceeded' | 'turn_limit';
  readonly output: TOutput;
  readonly turns_used: number;
  readonly cost_usd: number;
  readonly correlation_id: string;
  /** Optional structured error info when status !== 'ok'. */
  readonly error?: { code: string; message: string };
}

/**
 * Per-query map of named specs, mirroring the SDK shape
 * `agents: { researcher: {...}, drafter: {...} }`.
 */
export type SubAgentSpecMap = Readonly<Record<string, SubAgentSpec>>;

/**
 * Input passed to a subagent. The parent provides a `prompt` and an
 * optional `structured_input` blob; the subagent has no other context.
 */
export interface SubAgentInput<TStructured = unknown> {
  readonly prompt: string;
  readonly structured_input?: TStructured;
  /** Correlation id propagated for distributed tracing. */
  readonly correlation_id: string;
}
