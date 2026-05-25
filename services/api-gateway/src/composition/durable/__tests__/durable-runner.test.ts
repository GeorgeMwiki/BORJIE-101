/**
 * durable-runner tests — checkpoint-before-step, retry-with-backoff,
 * resume-from-paused, and crash-recovery semantics.
 *
 * The runner is unit-tested against an in-memory checkpoint store and
 * a scripted executor stub so every assertion is deterministic — no
 * timer leaks, no real OTel, no DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  createDurableRunner,
  __testing,
} from '../durable-runner.js';
import type { StepCheckpointStore } from '../step-checkpoint-store.js';

interface CheckpointRow {
  id: string;
  tenantId: string;
  runId: string;
  goalId: string;
  stepIndex: number;
  stepName: string;
  state: 'pending' | 'running' | 'success' | 'failure' | 'paused';
  attemptCount: number;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

function makeInMemoryStore(): {
  store: StepCheckpointStore;
  readonly rows: ReadonlyArray<CheckpointRow>;
  /** Force the NEXT operation to throw the given error. */
  setNextThrow(err: Error): void;
} {
  const rows: CheckpointRow[] = [];
  let nextThrow: Error | null = null;
  const consumeThrow = (): void => {
    if (nextThrow) {
      const e = nextThrow;
      nextThrow = null;
      throw e;
    }
  };
  const findById = (id: string): CheckpointRow | undefined =>
    rows.find((r) => r.id === id);

  const store: StepCheckpointStore = {
    async pending(args) {
      consumeThrow();
      const id = `cp_${randomUUID()}`;
      rows.push({
        id,
        tenantId: args.tenantId,
        runId: args.runId,
        goalId: args.goalId,
        stepIndex: args.stepIndex,
        stepName: args.stepName,
        state: 'pending',
        attemptCount: 0,
        inputPayload: args.inputPayload,
        outputPayload: null,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
      });
      return { id };
    },
    async running(id) {
      consumeThrow();
      const row = findById(id);
      if (row) {
        row.state = 'running';
        row.attemptCount += 1;
      }
    },
    async success(id, output) {
      consumeThrow();
      const row = findById(id);
      if (row) {
        row.state = 'success';
        row.outputPayload = output ?? {};
        row.completedAt = new Date().toISOString();
        row.errorMessage = null;
      }
    },
    async failure(id, errorMessage) {
      consumeThrow();
      const row = findById(id);
      if (row) {
        row.state = 'failure';
        row.errorMessage = errorMessage;
        row.completedAt = new Date().toISOString();
      }
    },
    async paused(id, errorMessage) {
      consumeThrow();
      const row = findById(id);
      if (row) {
        row.state = 'paused';
        row.errorMessage = errorMessage;
        row.completedAt = new Date().toISOString();
      }
    },
    async listForRun(runId) {
      consumeThrow();
      return rows
        .filter((r) => r.runId === runId)
        .sort((a, b) => a.stepIndex - b.stepIndex);
    },
    async stuckRunning(args) {
      consumeThrow();
      return rows
        .filter((r) => r.state === 'running')
        .filter((r) => new Date(r.startedAt) < args.olderThan)
        .slice(0, args.limit ?? 100);
    },
    async getById(id) {
      consumeThrow();
      return findById(id) ?? null;
    },
  };

  const out = {
    store,
    setNextThrow: (err: Error) => {
      nextThrow = err;
    },
  } as {
    store: StepCheckpointStore;
    readonly rows: ReadonlyArray<CheckpointRow>;
    setNextThrow(err: Error): void;
  };
  Object.defineProperty(out, 'rows', { get: () => rows });
  return out;
}

interface ScriptedGoalStep {
  readonly id: string;
  readonly seq: number;
  readonly description: string;
  readonly toolName: string | null;
  readonly toolPayload: Record<string, unknown> | null;
  readonly status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  readonly startedAt: null;
  readonly endedAt: null;
  readonly outcome: null;
  readonly errorMessage: null;
}

function makeGoal(steps: ScriptedGoalStep[]) {
  return {
    id: 'g1',
    tenantId: 't1',
    userId: 'u1',
    threadId: 'th1',
    title: 'Test goal',
    description: '',
    status: 'active' as const,
    priority: 'medium' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    steps,
    metrics: { stepsTotal: steps.length, stepsDone: 0 },
  };
}

function makeStep(seq: number, toolName: string | null = null): ScriptedGoalStep {
  return {
    id: `step_${seq}`,
    seq,
    description: `step ${seq}`,
    toolName,
    toolPayload: null,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    outcome: null,
    errorMessage: null,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('durable-runner — defaults', () => {
  it('exposes the expected defaults (3 attempts, 5min staleness)', () => {
    expect(__testing.defaultMaxAttempts).toBe(3);
    expect(__testing.defaultBackoffsMs).toEqual([200, 400, 800]);
    expect(__testing.defaultRecoveryStalenessMs).toBe(5 * 60_000);
  });
});

describe('durable-runner — happy path', () => {
  it('checkpoints pending → running → success on first attempt', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(1, 'rent.send-reminder')]);
    const executor = {
      async executeGoal() {
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 1,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
    });

    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'g1',
      runId: 'r1',
    });

    expect(outcome.completed).toBe(true);
    expect(outcome.pausedCheckpoints).toBe(0);
    expect(outcome.retries).toBe(0);
    expect(cs.rows).toHaveLength(1);
    expect(cs.rows[0]?.state).toBe('success');
    expect(cs.rows[0]?.attemptCount).toBe(1);
    expect(cs.rows[0]?.stepName).toBe('rent.send-reminder');
  });

  it('uses informational-{seq} as step name when toolName is null', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(7, null)]);
    const executor = {
      async executeGoal() {
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 1,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
    });
    await runner.executeGoal({ tenantId: 't1', goalId: 'g1', runId: 'r1' });
    expect(cs.rows[0]?.stepName).toBe('informational-7');
  });
});

describe('durable-runner — retry-with-backoff', () => {
  it('retries on transient executor failure up to maxAttempts', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(1, 'rent.send-reminder')]);
    let calls = 0;
    const executor = {
      async executeGoal() {
        calls += 1;
        if (calls < 3) {
          return {
            goalId: 'g1',
            stepsRun: 1,
            stepsSucceeded: 0,
            stepsFailed: 1,
            stepsAwaitingApproval: 0,
            proposedActionIds: [],
            failureMessages: ['transient: sensor timeout'],
          };
        }
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 1,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };

    const sleepLog: number[] = [];
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async (ms) => {
        sleepLog.push(ms);
      },
      backoffsMs: [10, 20, 40],
    });

    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'g1',
      runId: 'r1',
    });

    // 3 attempts total — succeed on the third.
    expect(outcome.completed).toBe(true);
    expect(outcome.retries).toBe(2); // attempts - 1
    // 3 per-step attempts + 1 terminal poll the runner does to capture
    // the executor's final outcome for back-compat with legacy callers.
    expect(calls).toBe(4);
    // Two backoffs were slept between three attempts (10ms, 20ms).
    expect(sleepLog).toEqual([10, 20]);
    expect(cs.rows[0]?.attemptCount).toBe(3);
    expect(cs.rows[0]?.state).toBe('success');
  });

  it('transitions step to paused when retries exhaust', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(1, 'rent.send-reminder')]);
    const executor = {
      async executeGoal() {
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 0,
          stepsFailed: 1,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: ['hard failure'],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
      maxAttempts: 3,
    });

    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'g1',
      runId: 'r1',
    });

    expect(outcome.completed).toBe(false);
    expect(outcome.pausedCheckpoints).toBe(1);
    expect(outcome.pauseReason).toContain('hard failure');
    expect(cs.rows[0]?.state).toBe('paused');
    expect(cs.rows[0]?.attemptCount).toBe(3);
  });

  it('throws-from-executor counted as a failed attempt', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(1, 'rent.send-reminder')]);
    const executor = {
      async executeGoal() {
        throw new Error('boom from inside executor');
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
      maxAttempts: 2,
    });
    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'g1',
      runId: 'r1',
    });
    expect(outcome.completed).toBe(false);
    expect(outcome.pausedCheckpoints).toBe(1);
    expect(outcome.pauseReason).toContain('boom');
  });
});

describe('durable-runner — resume-from-success', () => {
  it('skips steps already marked success on a prior run', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([
      makeStep(1, 'step-a'),
      makeStep(2, 'step-b'),
    ]);
    // Pre-seed checkpoint store with a `success` for stepIndex 0.
    await cs.store.pending({
      tenantId: 't1',
      runId: 'r-resume',
      goalId: 'g1',
      stepIndex: 0,
      stepName: 'step-a',
      inputPayload: {},
    });
    const firstId = cs.rows[0]?.id;
    if (!firstId) throw new Error('seed failed');
    await cs.store.success(firstId, { ok: true });

    let calls = 0;
    const executor = {
      async executeGoal() {
        calls += 1;
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 1,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
    });

    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'g1',
      runId: 'r-resume',
    });

    // Step 0 was skipped (already success). Step 1 was processed.
    expect(outcome.completed).toBe(true);
    expect(cs.rows.filter((r) => r.runId === 'r-resume')).toHaveLength(2);
    expect(cs.rows[1]?.stepName).toBe('step-b');
    expect(cs.rows[1]?.state).toBe('success');
  });
});

describe('durable-runner — crash recovery', () => {
  it('recoverStuckRuns picks up `running` checkpoints older than the staleness window', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(1, 'step-a')]);
    // Pre-seed a `running` checkpoint with a stale started_at.
    await cs.store.pending({
      tenantId: 't1',
      runId: 'r-stuck',
      goalId: 'g1',
      stepIndex: 0,
      stepName: 'step-a',
      inputPayload: {},
    });
    const id = cs.rows[0]?.id;
    if (!id) throw new Error('seed failed');
    await cs.store.running(id);
    // Manually rewind started_at to 10 minutes ago.
    (cs.rows[0] as { startedAt: string }).startedAt = new Date(
      Date.now() - 10 * 60_000,
    ).toISOString();

    const executor = {
      async executeGoal() {
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 1,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
      recoveryStalenessMs: 5 * 60_000,
    });

    const recovered = await runner.recoverStuckRuns();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.runId).toBe('r-stuck');
    expect(recovered[0]?.completed).toBe(true);
  });

  it('recoverStuckRuns dedupes by (tenantId, runId)', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(1, 'step-a')]);
    // Seed TWO running rows for the same run (multiple steps).
    for (const seq of [0, 1]) {
      await cs.store.pending({
        tenantId: 't1',
        runId: 'r-multi',
        goalId: 'g1',
        stepIndex: seq,
        stepName: 'step-a',
        inputPayload: {},
      });
    }
    for (const row of cs.rows) {
      await cs.store.running(row.id);
      (row as { startedAt: string }).startedAt = new Date(
        Date.now() - 10 * 60_000,
      ).toISOString();
    }

    const executor = {
      async executeGoal() {
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 1,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
    });
    const recovered = await runner.recoverStuckRuns();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.runId).toBe('r-multi');
  });

  it('recoverStuckRuns is a no-op when nothing is stuck', async () => {
    const cs = makeInMemoryStore();
    const executor = {
      async executeGoal() {
        return {
          goalId: 'g1',
          stepsRun: 0,
          stepsSucceeded: 0,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => null },
      checkpoints: cs.store,
      sleep: async () => undefined,
    });
    expect(await runner.recoverStuckRuns()).toEqual([]);
  });
});

describe('durable-runner — edge cases', () => {
  it('returns a `paused`-with-reason outcome when goal is missing', async () => {
    const cs = makeInMemoryStore();
    const executor = {
      async executeGoal() {
        return {
          goalId: 'gX',
          stepsRun: 0,
          stepsSucceeded: 0,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => null },
      checkpoints: cs.store,
      sleep: async () => undefined,
    });
    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'gX',
    });
    expect(outcome.completed).toBe(false);
    expect(outcome.pauseReason).toContain('unknown goal');
  });

  it('generates a fresh runId when not supplied', async () => {
    const cs = makeInMemoryStore();
    const goal = makeGoal([makeStep(1, 'step-a')]);
    const executor = {
      async executeGoal() {
        return {
          goalId: 'g1',
          stepsRun: 1,
          stepsSucceeded: 1,
          stepsFailed: 0,
          stepsAwaitingApproval: 0,
          proposedActionIds: [],
          failureMessages: [],
        };
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => goal as never },
      checkpoints: cs.store,
      sleep: async () => undefined,
    });
    const a = await runner.executeGoal({ tenantId: 't1', goalId: 'g1' });
    const b = await runner.executeGoal({ tenantId: 't1', goalId: 'g1' });
    expect(a.runId).toMatch(/^run_/);
    expect(b.runId).toMatch(/^run_/);
    expect(a.runId).not.toBe(b.runId);
  });
});
