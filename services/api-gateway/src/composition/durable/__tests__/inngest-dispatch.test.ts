/**
 * durable-runner — Inngest dispatch path tests. When an Inngest
 * client is wired, `executeGoal` becomes a thin dispatcher that
 * emits `agency/run.requested`. The in-process execution path
 * remains the fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createDurableRunner } from '../durable-runner.js';
import {
  createAgencyRunFunction,
  dispatchAgencyRun,
} from '../inngest-functions/index.js';
import type { StepCheckpointStore } from '../step-checkpoint-store.js';
import type { InngestClientLike } from '../inngest-client.js';

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function makeInMemoryStore(): StepCheckpointStore {
  const rows: Array<Record<string, unknown>> = [];
  const findById = (id: string) =>
    rows.find((r) => (r as { id: string }).id === id) as
      | Record<string, unknown>
      | undefined;
  return {
    async pending(args) {
      const id = `cp_${randomUUID()}`;
      rows.push({ id, ...args, state: 'pending', attemptCount: 0 });
      return { id };
    },
    async running(id) {
      const r = findById(id);
      if (r) r.state = 'running';
    },
    async success(id, output) {
      const r = findById(id);
      if (r) {
        r.state = 'success';
        r.output = output;
      }
    },
    async failure(id, msg) {
      const r = findById(id);
      if (r) {
        r.state = 'failure';
        r.error = msg;
      }
    },
    async paused(id, msg) {
      const r = findById(id);
      if (r) {
        r.state = 'paused';
        r.error = msg;
      }
    },
    async listForRun() {
      return [] as never;
    },
    async stuckRunning() {
      return [] as never;
    },
    async getById() {
      return null as never;
    },
  };
}

function makeStubClient(): {
  client: InngestClientLike;
  sent: Array<{ name: string; data: Record<string, unknown>; id?: string }>;
} {
  const sent: Array<{ name: string; data: Record<string, unknown>; id?: string }> = [];
  return {
    sent,
    client: {
      id: 'test-app',
      async send(event) {
        sent.push({ name: event.name, data: event.data, id: event.id });
        return { ids: [`ing-${sent.length}`] };
      },
    },
  };
}

describe('durable-runner — inngest dispatch', () => {
  it('routes through Inngest when client is wired', async () => {
    const { client, sent } = makeStubClient();
    const executor = {
      async executeGoal() {
        throw new Error('executor must NOT be called when inngest is wired');
      },
    };
    const runner = createDurableRunner({
      executor,
      goals: { get: async () => null as never },
      checkpoints: makeInMemoryStore(),
      inngest: client,
      sleep: async () => undefined,
    });
    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'g1',
      runId: 'r1',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe('agency/run.requested');
    expect(sent[0]?.data.tenantId).toBe('t1');
    expect(sent[0]?.data.goalId).toBe('g1');
    expect(sent[0]?.data.runId).toBe('r1');
    expect(sent[0]?.id).toBe('t1::r1');
    expect(outcome.pauseReason).toBe('dispatched-to-inngest');
    expect(outcome.completed).toBe(false);
  });

  it('falls back to inline execution when inngest.send throws', async () => {
    const client: InngestClientLike = {
      id: 'test-app',
      async send() {
        throw new Error('inngest network error');
      },
    };
    let executed = false;
    const executor = {
      async executeGoal() {
        executed = true;
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
      goals: { get: async () => null as never },
      checkpoints: makeInMemoryStore(),
      inngest: client,
      sleep: async () => undefined,
    });
    const outcome = await runner.executeGoal({
      tenantId: 't1',
      goalId: 'g-missing',
      runId: 'r2',
    });
    // Fallback called executeGoalInternal which then short-circuits
    // because goals.get returned null — the runner reports
    // `unknown goal` reason. The point of this test is that the
    // inline path was attempted.
    expect(outcome.runId).toBe('r2');
    expect(executed).toBe(false); // goal not found, executor never ran
    expect(outcome.pauseReason).toContain('unknown goal');
  });
});

describe('inngest-functions — dispatchAgencyRun', () => {
  it('sends an event with the canonical name + data shape', async () => {
    const { client, sent } = makeStubClient();
    const result = await dispatchAgencyRun(client, {
      tenantId: 't1',
      goalId: 'g1',
      runId: 'r1',
    });
    expect(result.inngestEventIds).toEqual(['ing-1']);
    expect(sent[0]?.name).toBe('agency/run.requested');
    expect(sent[0]?.data).toEqual({ tenantId: 't1', goalId: 'g1', runId: 'r1' });
  });
});

describe('inngest-functions — createAgencyRunFunction', () => {
  it('returns null when client does not expose createFunction', () => {
    const client: InngestClientLike = {
      id: 'no-create-fn',
      async send() {
        return { ids: [] };
      },
    };
    const runner = {
      async executeGoal(args: { tenantId: string; goalId: string; runId?: string }) {
        return {
          runId: args.runId ?? 'r',
          goalId: args.goalId,
          tenantId: args.tenantId,
          executorOutcome: null,
          pausedCheckpoints: 0,
          completed: true,
          retries: 0,
          pauseReason: null,
        };
      },
    };
    const fn = createAgencyRunFunction({ client, runner });
    expect(fn).toBeNull();
  });

  it('returns the function handle when createFunction is exposed', () => {
    const client = {
      id: 'with-create-fn',
      async send() {
        return { ids: [] };
      },
      createFunction(cfg: { id: string; name: string }) {
        return { id: cfg.id, name: cfg.name };
      },
    };
    const runner = {
      async executeGoal(args: { tenantId: string; goalId: string; runId?: string }) {
        return {
          runId: args.runId ?? 'r',
          goalId: args.goalId,
          tenantId: args.tenantId,
          executorOutcome: null,
          pausedCheckpoints: 0,
          completed: true,
          retries: 0,
          pauseReason: null,
        };
      },
    };
    const fn = createAgencyRunFunction({ client, runner });
    expect(fn).not.toBeNull();
    expect(fn?.id).toBe('agency-run');
  });
});
