/**
 * Supervisor hierarchy types — CEO -> 6 dept managers -> 15 task-agents.
 *
 * Pattern (Anthropic "Building Effective Agents" 2024 + 2026 refresh):
 *   Orchestrator-worker (hierarchical). A CEO supervisor reasons about
 *   the user request, picks one or more departments, hands off to each
 *   manager, and aggregates the managers' decisions into a single plan
 *   the executor / action-tools layer can ground.
 *
 * Design rules:
 *   - Every manager is a PURE FUNCTION (request, taskAgentRegistry,
 *     llmClient) => Plan. No I/O, no DB, no hidden state. The CEO is
 *     also pure under the same signature; it composes managers.
 *   - The task-agent registry is the *only* place a manager can name
 *     a worker. Unknown ids surface in `manager.warnings` not as
 *     thrown exceptions.
 *   - Eviction is gated by constitution C09 (NO-AUTONOMOUS-FILING):
 *     every eviction plan has `requiresHumanApproval: true` AND
 *     `gatedBy: ['C09-NO-AUTONOMOUS-FILING']`.
 *   - The CEO uses the multi-LLM synthesizer (mixture-of-agents,
 *     Wang et al. 2024) when an LLM-typed router is supplied — three
 *     proposers reduce blind spots on routing decisions; jury mode is
 *     preferred for routing to avoid synthesizer hallucinations of
 *     department names.
 */

// Jurisdiction is mirrored locally rather than imported across package
// boundaries — central-intelligence does not depend on autonomy-governance
// at the package-graph level (would introduce a cycle in the wrong
// direction; the constitution should be PASSED IN as data, not pulled).
// Keep this list in sync with
// `packages/autonomy-governance/src/constitution/borjie-constitution.ts`.
export type Jurisdiction = 'TZ' | 'KE' | 'UG' | 'NG' | 'RW' | 'ZA';

// ---------------------------------------------------------------------------
// Department taxonomy
// ---------------------------------------------------------------------------

/**
 * The six departments of a digital property-management company. Matches
 * .audit/litfin-sota-2026-05-23/16-agent-orchestration-teams.md §3.
 */
export type Department =
  | 'leasing'
  | 'accounting'
  | 'maintenance'
  | 'eviction'
  | 'owner-relations'
  | 'marketing';

export const ALL_DEPARTMENTS: ReadonlyArray<Department> = Object.freeze([
  'leasing',
  'accounting',
  'maintenance',
  'eviction',
  'owner-relations',
  'marketing',
]);

// ---------------------------------------------------------------------------
// Supervisor request — what the CEO receives
// ---------------------------------------------------------------------------

/**
 * Free-text user intent plus optional structured hints. The supervisor
 * layer is intentionally permissive about the input shape — the CEO's
 * job is to translate intent to a department plan.
 */
export interface SupervisorRequest {
  /** Raw user / system text describing what should happen. */
  readonly userMessage: string;
  /** Tenant whose data the work touches. Required for audit + jurisdiction. */
  readonly tenantId: string;
  /** Required so jurisdiction-bound clauses (C01/C04/C09) load correctly. */
  readonly jurisdiction: Jurisdiction;
  /** Optional correlation id propagated into every manager + task-agent run. */
  readonly correlationId?: string;
  /**
   * Optional pre-classified departments. When present the CEO skips the
   * LLM routing call and goes straight to manager fan-out. Useful for
   * deterministic callers (cron, webhook router).
   */
  readonly hintedDepartments?: ReadonlyArray<Department>;
  /**
   * Optional payload bag forwarded as-is to each manager. Managers
   * decide whether their relevant slice is present.
   */
  readonly payload?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Department decision — what each manager returns
// ---------------------------------------------------------------------------

/**
 * A single step the manager proposes to run. References a TaskAgent by
 * id (must exist in the registry the manager was given) plus the typed
 * payload to invoke it with.
 */
export interface ProposedAgentStep {
  readonly taskAgentId: string;
  /** Human-readable why for this step — surfaces in audit trail. */
  readonly rationale: string;
  /** Payload conformant with the named agent's `payloadSchema`. */
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Sequence order within the manager. Steps with the same `order` may
   * run in parallel; the executor enforces the ordering.
   */
  readonly order: number;
}

/**
 * One manager's contribution to the CEO plan. Departments that have
 * nothing to do return `steps: []` with a non-empty `reasoning` line so
 * the CEO can surface the no-op decision.
 */
export interface DeptDecision {
  readonly department: Department;
  /** Manager's chain-of-thought summary (1-3 sentences). */
  readonly reasoning: string;
  /** Steps the executor should run. May be empty (no-op decision). */
  readonly steps: ReadonlyArray<ProposedAgentStep>;
  /**
   * If true the manager believes its work cannot proceed without a
   * named human approver. CEO must propagate this onto the plan.
   */
  readonly requiresHumanApproval: boolean;
  /**
   * Constitution clause ids that gated or warned this decision. The
   * eviction manager always includes C09; others include clauses only
   * when applicable.
   */
  readonly gatedBy: ReadonlyArray<string>;
  /**
   * Non-fatal warnings — e.g. unknown task-agent id, missing payload
   * field, low LLM agreement. Surfaced to the UI and to ops.
   */
  readonly warnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// SupervisorPlan — what the CEO returns to the caller
// ---------------------------------------------------------------------------

export interface SupervisorPlan {
  /** Echo of the originating request for downstream correlation. */
  readonly request: SupervisorRequest;
  /** Department decisions, in the order the CEO routed them. */
  readonly decisions: ReadonlyArray<DeptDecision>;
  /**
   * Flattened total step count across all departments. Convenience for
   * UI badges and audit. Equivalent to sum(decisions[i].steps.length).
   */
  readonly totalSteps: number;
  /**
   * True when ANY contributing manager required human approval. Once
   * true the whole plan must route through the four-eye-approval path
   * before the executor runs a single step.
   */
  readonly requiresHumanApproval: boolean;
  /**
   * Aggregated constitution clauses cited by all participating managers.
   * Always includes 'C09-NO-AUTONOMOUS-FILING' when an eviction step is
   * present.
   */
  readonly citedClauses: ReadonlyArray<string>;
  /**
   * CEO-level synthesis note — explains why these departments were
   * chosen and what the integrated outcome is. 1-3 sentences.
   */
  readonly ceoSynthesis: string;
  /** Aggregated warnings across all managers. */
  readonly warnings: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// LLM client contract — purposely minimal so we can pass synthesizer
// or a single-provider router OR `null` (deterministic mode).
// ---------------------------------------------------------------------------

/**
 * Minimal LLM client contract the supervisor layer depends on. Wraps
 * the multi-LLM synthesizer or a simpler router. Returns text content
 * the manager parses for its plan.
 *
 * Callers wire `@borjie/ai-copilot/providers/multi-llm-synthesizer`
 * here via a thin adapter — the supervisor module itself does NOT
 * import ai-copilot to keep central-intelligence's dependency graph
 * inverted.
 */
export interface SupervisorLLMClient {
  /**
   * Single-shot completion. Implementation may use mixture-of-agents
   * internally; the supervisor only consumes the synthesized text.
   * Returning `null` means "LLM unavailable" — the caller must fall
   * back to the manager's deterministic policy.
   */
  complete(input: {
    readonly systemPrompt: string;
    readonly userPrompt: string;
    readonly maxTokens?: number;
  }): Promise<{ readonly content: string } | null>;
}

// ---------------------------------------------------------------------------
// TaskAgent registry contract — what a manager needs to know
// ---------------------------------------------------------------------------

/**
 * Loose handle to one task-agent's metadata. The supervisor layer does
 * NOT call `execute` directly — only reads identifier + title +
 * description so it can choose between agents and surface human-
 * readable rationale. The executor in `kernel/agency/executor` actually
 * runs them.
 */
export interface TaskAgentHandle {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/**
 * Read-only view of the task-agent registry the manager may name from.
 * Composition root passes either the full
 * `@borjie/ai-copilot/task-agents` registry (production) or a
 * filtered subset (tests, tenant-scoped autonomy).
 */
export interface TaskAgentRegistryView {
  /** O(1) lookup by id. */
  get(id: string): TaskAgentHandle | undefined;
  /** All registered agents — used when manager wants to enumerate. */
  all(): ReadonlyArray<TaskAgentHandle>;
}

// ---------------------------------------------------------------------------
// Manager + CEO function signatures
// ---------------------------------------------------------------------------

/**
 * Pure manager function. Same signature for every department — keeps
 * the CEO's fan-out call site uniform.
 */
export type DeptManager = (
  request: SupervisorRequest,
  registry: TaskAgentRegistryView,
  llm: SupervisorLLMClient | null,
) => Promise<DeptDecision>;

/**
 * Pure CEO function. Routes to one or more managers and aggregates.
 */
export type CEOSupervisor = (
  request: SupervisorRequest,
  registry: TaskAgentRegistryView,
  managers: Readonly<Partial<Record<Department, DeptManager>>>,
  llm: SupervisorLLMClient | null,
) => Promise<SupervisorPlan>;
