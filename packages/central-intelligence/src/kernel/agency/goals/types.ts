/**
 * Agency — goal tracker types.
 *
 * Persistent objectives the brain works on across days / weeks. A
 * `Goal` decomposes into an ordered list of `GoalStep` records; each
 * step optionally targets a typed action tool (see
 * `../action-tools/types`). The autonomous executor walks the steps,
 * routing high-stakes ones through the four-eye approval gate and
 * auditing every transition.
 *
 * The goal tracker is provider- and storage-agnostic. The Drizzle-
 * backed adapter lives in `@borjie/database`
 * (`createKernelGoalsService`); tests pass an in-memory port.
 */
export type GoalStatus =
  | 'active' // brain is working on this
  | 'paused' // user explicitly paused
  | 'blocked' // waiting on approval / external dep
  | 'completed'
  | 'abandoned';

export type GoalPriority = 'low' | 'medium' | 'high' | 'critical';

export type GoalStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

/**
 * Reference to a thing preventing a step from running.
 * Phase D / D12.8 — surfaced through the UI so a human can clear it;
 * consumed by the executor which skips the step until the blocker is
 * resolved.
 */
export interface BlockerRef {
  readonly kind:
    | 'approval-pending'
    | 'document-missing'
    | 'compliance-hold'
    | 'tenant-unreachable'
    | 'external-dependency'
    | 'other';
  readonly description: string;
  readonly ref?: string;
}

export interface GoalStep {
  readonly id: string;
  readonly seq: number;
  readonly description: string;
  readonly toolName: string | null;
  readonly toolPayload: Record<string, unknown> | null;
  readonly status: GoalStepStatus;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly outcome: string | null;
  readonly errorMessage: string | null;
  /** Phase D / D12.8 — DAG dependency edges. */
  readonly dependsOn?: ReadonlyArray<string>;
  /** Phase D / D12.8 — optional ISO-8601 deadline. */
  readonly due?: string;
  /** Phase D / D12.8 — non-empty list keeps step pending. */
  readonly blockers?: ReadonlyArray<BlockerRef>;
}

export interface GoalMetrics {
  readonly stepsTotal: number;
  readonly stepsDone: number;
}

export interface Goal {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly title: string;
  readonly description: string;
  readonly status: GoalStatus;
  readonly priority: GoalPriority;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly steps: ReadonlyArray<GoalStep>;
  readonly metrics: GoalMetrics;
}

/**
 * Skeleton step shape used when opening a new goal — the persistence
 * layer fills in `id`, `status`, timestamps, outcome, error.
 */
export interface GoalStepDraft {
  readonly seq: number;
  readonly description: string;
  readonly toolName: string | null;
  readonly toolPayload: Record<string, unknown> | null;
  readonly dependsOn?: ReadonlyArray<string>;
  readonly due?: string;
  readonly blockers?: ReadonlyArray<BlockerRef>;
}

export interface GoalOpenArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly threadId: string;
  readonly title: string;
  readonly description: string;
  readonly status: GoalStatus;
  readonly priority: GoalPriority;
  readonly steps: ReadonlyArray<GoalStepDraft>;
}

export interface GoalListArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly status?: GoalStatus;
  readonly limit?: number;
}

export interface GoalUpdateStepArgs {
  readonly goalId: string;
  readonly stepId: string;
  readonly status: GoalStepStatus;
  readonly outcome?: string;
  readonly errorMessage?: string;
}

/**
 * Persistence port. The kernel never touches Drizzle directly; the
 * Drizzle service in `@borjie/database` adapts to this shape.
 */
export interface GoalsPort {
  open(args: GoalOpenArgs): Promise<{ id: string }>;
  list(args: GoalListArgs): Promise<ReadonlyArray<Goal>>;
  get(id: string): Promise<Goal | null>;
  updateStepStatus(args: GoalUpdateStepArgs): Promise<void>;
  setStatus(id: string, status: GoalStatus): Promise<void>;
}
