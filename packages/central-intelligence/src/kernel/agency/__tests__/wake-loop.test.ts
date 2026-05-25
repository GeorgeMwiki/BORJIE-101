/**
 * Tests for runWakeCycle.
 *
 *   1. No triggers → 0 goalsOpened / 0 goalsExecuted
 *   2. One trigger emits 2 goals → 2 opened, 2 executed, perTrigger.id=2
 *   3. Executor failure on one goal still counts the others
 */
import { describe, it, expect, vi } from 'vitest';
import { runWakeCycle, type WakeTrigger } from '../initiative/wake-loop.js';
import type { GoalsPort } from '../goals/types.js';

function emptyGoalsPort(): GoalsPort {
  return {
    async open() {
      return { id: 'g_unused' };
    },
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async updateStepStatus() {
      // no-op
    },
    async setStatus() {
      // no-op
    },
  };
}

function recordingGoalsPort(): {
  port: GoalsPort;
  readonly opened: ReadonlyArray<string>;
} {
  const opened: string[] = [];
  let counter = 0;
  const port: GoalsPort = {
    async open(args) {
      const id = `g_${++counter}`;
      opened.push(args.title);
      return { id };
    },
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async updateStepStatus() {
      // no-op
    },
    async setStatus() {
      // no-op
    },
  };
  const out = { port } as { port: GoalsPort; readonly opened: ReadonlyArray<string> };
  Object.defineProperty(out, 'opened', { get: () => [...opened] });
  return out;
}

describe('runWakeCycle', () => {
  it('no triggers → 0 goalsOpened / 0 goalsExecuted', async () => {
    const goals = emptyGoalsPort();
    const out = await runWakeCycle(
      { tenantIds: ['t1'] },
      {
        goals,
        executor: { async executeGoal() { return mkOutcome('x'); } },
        triggers: [],
      },
    );
    expect(out.goalsOpened).toBe(0);
    expect(out.goalsExecuted).toBe(0);
    expect(out.perTrigger).toEqual({});
  });

  it('one trigger emits 2 goals → 2 opened, 2 executed', async () => {
    const trigger: WakeTrigger = {
      id: 'arrears.30d-threshold',
      description: '',
      async detect() {
        return [
          {
            userId: 'u',
            threadId: 'th',
            title: 'A',
            description: '',
            priority: 'high',
            steps: [],
          },
          {
            userId: 'u',
            threadId: 'th',
            title: 'B',
            description: '',
            priority: 'high',
            steps: [],
          },
        ];
      },
    };
    const goals = recordingGoalsPort();
    let executed = 0;
    const out = await runWakeCycle(
      { tenantIds: ['t1'] },
      {
        goals: goals.port,
        executor: {
          async executeGoal() {
            executed += 1;
            return mkOutcome('x');
          },
        },
        triggers: [trigger],
      },
    );
    expect(out.goalsOpened).toBe(2);
    expect(out.goalsExecuted).toBe(2);
    expect(out.perTrigger['arrears.30d-threshold']).toBe(2);
    expect(executed).toBe(2);
    expect(goals.opened).toEqual(['A', 'B']);
  });

  it('executor failure on one goal still counts the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const trigger: WakeTrigger = {
      id: 'lease.expiring-30d',
      description: '',
      async detect() {
        return [
          {
            userId: 'u',
            threadId: 'th',
            title: 'A',
            description: '',
            priority: 'low',
            steps: [],
          },
          {
            userId: 'u',
            threadId: 'th',
            title: 'B',
            description: '',
            priority: 'low',
            steps: [],
          },
        ];
      },
    };
    const goals = recordingGoalsPort();
    let calls = 0;
    const out = await runWakeCycle(
      { tenantIds: ['t1'] },
      {
        goals: goals.port,
        executor: {
          async executeGoal() {
            calls += 1;
            if (calls === 1) throw new Error('boom');
            return mkOutcome('x');
          },
        },
        triggers: [trigger],
      },
    );
    expect(out.goalsOpened).toBe(2);
    // Only the second executeGoal succeeded.
    expect(out.goalsExecuted).toBe(1);
  });
});

function mkOutcome(id: string) {
  return {
    goalId: id,
    stepsRun: 0,
    stepsSucceeded: 0,
    stepsFailed: 0,
    stepsAwaitingApproval: 0,
    proposedActionIds: [] as ReadonlyArray<string>,
    failureMessages: [] as ReadonlyArray<string>,
  };
}
