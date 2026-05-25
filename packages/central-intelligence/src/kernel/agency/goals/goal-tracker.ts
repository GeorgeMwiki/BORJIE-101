/**
 * Agency — in-memory GoalsPort.
 *
 * Reference implementation used by unit tests and dev composition
 * roots before the Drizzle-backed adapter (`createKernelGoalsService`)
 * is wired. Mirrors the port shape exactly so prod / dev can swap
 * adapters without touching the executor or wake-loop.
 */
import { randomUUID } from 'crypto';
import type {
  Goal,
  GoalListArgs,
  GoalOpenArgs,
  GoalsPort,
  GoalStatus,
  GoalStep,
  GoalUpdateStepArgs,
} from './types.js';

export interface InMemoryGoalsPortDeps {
  readonly clock?: () => Date;
}

export function createInMemoryGoalsPort(
  deps: InMemoryGoalsPortDeps = {},
): GoalsPort {
  const clock = deps.clock ?? (() => new Date());
  const store = new Map<string, Goal>();

  return {
    async open(args: GoalOpenArgs) {
      const now = clock().toISOString();
      const id = randomUUID();
      const steps: ReadonlyArray<GoalStep> = args.steps.map((draft) => ({
        id: randomUUID(),
        seq: draft.seq,
        description: draft.description,
        toolName: draft.toolName,
        toolPayload: draft.toolPayload,
        status: 'pending',
        startedAt: null,
        endedAt: null,
        outcome: null,
        errorMessage: null,
        // Phase D / D12.8 — pass-through optional planning fields.
        ...(draft.dependsOn ? { dependsOn: draft.dependsOn } : {}),
        ...(draft.due ? { due: draft.due } : {}),
        ...(draft.blockers ? { blockers: draft.blockers } : {}),
      }));
      const goal: Goal = {
        id,
        tenantId: args.tenantId,
        userId: args.userId,
        threadId: args.threadId,
        title: args.title,
        description: args.description,
        status: args.status,
        priority: args.priority,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        steps,
        metrics: { stepsTotal: steps.length, stepsDone: 0 },
      };
      store.set(id, goal);
      return { id };
    },

    async list(args: GoalListArgs) {
      const limit = clampLimit(args.limit, 100);
      const out: Goal[] = [];
      for (const g of store.values()) {
        if (g.tenantId !== args.tenantId) continue;
        if (g.userId !== args.userId) continue;
        if (args.status !== undefined && g.status !== args.status) continue;
        out.push(g);
      }
      out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return out.slice(0, limit);
    },

    async get(id: string) {
      return store.get(id) ?? null;
    },

    async updateStepStatus(args: GoalUpdateStepArgs) {
      const existing = store.get(args.goalId);
      if (!existing) return;
      const now = clock().toISOString();
      const nextSteps: ReadonlyArray<GoalStep> = existing.steps.map((s) => {
        if (s.id !== args.stepId) return s;
        const startedAt =
          args.status === 'running' && !s.startedAt ? now : s.startedAt;
        const endedAt =
          args.status === 'done' ||
          args.status === 'failed' ||
          args.status === 'skipped'
            ? now
            : s.endedAt;
        return {
          ...s,
          status: args.status,
          startedAt,
          endedAt,
          outcome: args.outcome ?? s.outcome,
          errorMessage: args.errorMessage ?? s.errorMessage,
        };
      });
      const stepsDone = nextSteps.filter((s) => s.status === 'done').length;
      store.set(existing.id, {
        ...existing,
        steps: nextSteps,
        metrics: {
          stepsTotal: existing.metrics.stepsTotal,
          stepsDone,
        },
        updatedAt: now,
      });
    },

    async setStatus(id: string, status: GoalStatus) {
      const existing = store.get(id);
      if (!existing) return;
      const now = clock().toISOString();
      const completedAt =
        status === 'completed' ? now : existing.completedAt;
      store.set(id, {
        ...existing,
        status,
        completedAt,
        updatedAt: now,
      });
    },
  };
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), 1000);
}
