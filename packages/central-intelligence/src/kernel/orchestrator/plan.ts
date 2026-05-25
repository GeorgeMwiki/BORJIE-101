/**
 * mdr_plan — the MD's visible, steerable plan tree.
 *
 * Models the planner-suggested decomposition of the user's request as a
 * tree of goals. Each goal has a `status` (`pending` / `active` /
 * `complete` / `rejected`) so the orchestrator can:
 *
 *   - present "here's what I'm working on" to the owner UI
 *   - skip past completed sub-goals on resume
 *   - record rejection rationale when a PreToolUse hook denies a step
 *   - decide `isComplete()` for the main-loop exit predicate
 *
 * Pure immutable updates — every mutator returns a NEW Plan. The
 * companion `PlanStore` port handles persistence; the orchestrator
 * holds the in-memory plan for the duration of one think() call.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type GoalStatus = 'pending' | 'active' | 'complete' | 'rejected';

export interface PlanGoal {
  readonly id: string;
  readonly description: string;
  readonly status: GoalStatus;
  readonly rejectionReason?: string;
  readonly subGoals: ReadonlyArray<PlanGoal>;
}

export interface PlanState {
  readonly threadId: string;
  readonly rootGoals: ReadonlyArray<PlanGoal>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlanRejection {
  readonly goalId: string;
  readonly reason: string;
  readonly code: string;
}

export interface PlanAdvance {
  readonly goalId: string;
  readonly newStatus: GoalStatus;
}

// ─────────────────────────────────────────────────────────────────────
// Plan API — wraps PlanState with the operations the main loop uses.
// ─────────────────────────────────────────────────────────────────────

export interface Plan {
  state(): PlanState;
  currentGoal(): PlanGoal | null;
  isComplete(): boolean;
  recordRejection(rejection: PlanRejection): Plan;
  advance(advance: PlanAdvance): Plan;
  addSubGoals(parentId: string, goals: ReadonlyArray<PlanGoal>): Plan;
}

// ─────────────────────────────────────────────────────────────────────
// PlanStore — persistence port (Phase E.1 wires an in-memory adapter;
// composition root binds a Postgres-backed implementation).
// ─────────────────────────────────────────────────────────────────────

export interface PlanStore {
  load(threadId: string): Promise<Plan>;
  save(plan: Plan): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createPlan(
  threadId: string,
  rootGoals: ReadonlyArray<PlanGoal>,
  clock: () => Date = () => new Date(),
): Plan {
  const initialState: PlanState = {
    threadId,
    rootGoals,
    createdAt: clock().toISOString(),
    updatedAt: clock().toISOString(),
  };
  return planFromState(initialState, clock);
}

export function createEmptyPlan(
  threadId: string,
  clock: () => Date = () => new Date(),
): Plan {
  return createPlan(threadId, [], clock);
}

function planFromState(state: PlanState, clock: () => Date): Plan {
  function findActive(goals: ReadonlyArray<PlanGoal>): PlanGoal | null {
    for (const g of goals) {
      if (g.status === 'active') return g;
      const child = findActive(g.subGoals);
      if (child) return child;
    }
    for (const g of goals) {
      if (g.status === 'pending') return g;
      const child = findFirstPending(g.subGoals);
      if (child) return child;
    }
    return null;
  }

  function findFirstPending(
    goals: ReadonlyArray<PlanGoal>,
  ): PlanGoal | null {
    for (const g of goals) {
      if (g.status === 'pending') return g;
      const child = findFirstPending(g.subGoals);
      if (child) return child;
    }
    return null;
  }

  function complete(goals: ReadonlyArray<PlanGoal>): boolean {
    if (goals.length === 0) return false;
    return goals.every(
      (g) =>
        (g.status === 'complete' || g.status === 'rejected') &&
        (g.subGoals.length === 0 || complete(g.subGoals)),
    );
  }

  function map(
    goals: ReadonlyArray<PlanGoal>,
    fn: (g: PlanGoal) => PlanGoal,
  ): ReadonlyArray<PlanGoal> {
    return goals.map((g) => {
      const next = fn(g);
      return {
        ...next,
        subGoals: map(next.subGoals, fn),
      };
    });
  }

  return {
    state(): PlanState {
      return state;
    },
    currentGoal(): PlanGoal | null {
      return findActive(state.rootGoals);
    },
    isComplete(): boolean {
      return complete(state.rootGoals);
    },
    recordRejection(rejection: PlanRejection): Plan {
      const next: PlanState = {
        ...state,
        rootGoals: map(state.rootGoals, (g) =>
          g.id === rejection.goalId
            ? {
                ...g,
                status: 'rejected',
                rejectionReason: rejection.reason,
              }
            : g,
        ),
        updatedAt: clock().toISOString(),
      };
      return planFromState(next, clock);
    },
    advance(advance: PlanAdvance): Plan {
      const next: PlanState = {
        ...state,
        rootGoals: map(state.rootGoals, (g) =>
          g.id === advance.goalId ? { ...g, status: advance.newStatus } : g,
        ),
        updatedAt: clock().toISOString(),
      };
      return planFromState(next, clock);
    },
    addSubGoals(
      parentId: string,
      goals: ReadonlyArray<PlanGoal>,
    ): Plan {
      const next: PlanState = {
        ...state,
        rootGoals: map(state.rootGoals, (g) =>
          g.id === parentId ? { ...g, subGoals: [...g.subGoals, ...goals] } : g,
        ),
        updatedAt: clock().toISOString(),
      };
      return planFromState(next, clock);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory PlanStore — convenience for tests + early composition.
// ─────────────────────────────────────────────────────────────────────

export function createInMemoryPlanStore(): PlanStore {
  const store = new Map<string, Plan>();
  return {
    async load(threadId: string): Promise<Plan> {
      const existing = store.get(threadId);
      if (existing) return existing;
      const fresh = createEmptyPlan(threadId);
      store.set(threadId, fresh);
      return fresh;
    },
    async save(plan: Plan): Promise<void> {
      store.set(plan.state().threadId, plan);
    },
  };
}
