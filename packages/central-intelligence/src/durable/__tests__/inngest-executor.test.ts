/**
 * Durable-executor — behavioural tests.
 *
 * No mocking framework — every collaborator is a hand-rolled in-memory
 * port that implements the production contract verbatim.
 *
 * Coverage targets (per task scope):
 *   1. Step idempotency        — replay returns memoized result without
 *                                re-invoking the executor body.
 *   2. Retry-on-transient      — a thrown error during `execute-agent`
 *                                surfaces to Inngest (we observe it via
 *                                the step-runner stub) and a retry
 *                                succeeds without firing side-effects
 *                                from the prior attempt twice.
 *   3. Checkpoint-resume       — when the function crashes mid-run, a
 *                                fresh invocation re-uses the prior
 *                                checkpoints and only re-runs from the
 *                                first uncommitted step.
 */

import { describe, it, expect } from 'vitest';
import {
  createDurableTaskAgentExecutor,
  TASK_AGENT_RUN_EVENT,
  type TaskAgentExecutorLike,
  type TaskAgentExecuteOptionsLike,
  type TaskAgentExecuteOutputLike,
  type TaskAgentRunRequestedEvent,
} from '../inngest-executor.js';
import {
  createNoopInngestClient,
  type DurableStepLike,
  type InngestComposition,
} from '../inngest-client.js';

// ---------------------------------------------------------------------------
// Test scaffolding — real ports, no mocks.
// ---------------------------------------------------------------------------

/**
 * Step runner that mimics Inngest's memoization contract: `step.run(id,
 * fn)` returns the cached value on second invocation under the same
 * `id`, regardless of whether `fn` would throw.
 *
 * Behaviour switches drive the three test cases:
 *   - `throwOn`     — a set of step ids that throw the FIRST time only.
 *     Subsequent invocations return the cached result (mirrors Inngest
 *     retry after a transient failure resolved).
 *   - `recordCalls` — caller-visible log of (stepId, attemptCount) so
 *     we can assert how many times each body actually executed.
 */
function createMemoStep(opts?: {
  readonly throwOn?: ReadonlyArray<string>;
}): DurableStepLike & {
  readonly cache: Map<string, unknown>;
  readonly calls: Array<{ readonly id: string; readonly attempt: number }>;
} {
  const cache = new Map<string, unknown>();
  const calls: Array<{ id: string; attempt: number }> = [];
  const failOnce = new Set(opts?.throwOn ?? []);
  const attemptByStep = new Map<string, number>();

  return {
    async run<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
      if (cache.has(id)) {
        return cache.get(id) as T;
      }
      const attempt = (attemptByStep.get(id) ?? 0) + 1;
      attemptByStep.set(id, attempt);
      calls.push({ id, attempt });
      if (failOnce.has(id) && attempt === 1) {
        throw new Error(`transient failure on step ${id} (attempt ${attempt})`);
      }
      const value = await fn();
      cache.set(id, value);
      return value;
    },
    cache,
    calls,
  };
}

/** Real composition with the no-op client — no Inngest SDK required. */
function makeComposition(): InngestComposition {
  return {
    client: createNoopInngestClient(),
    config: { appId: 'test-app', enabled: false },
    enabled: false,
  };
}

/**
 * In-memory `TaskAgentExecutor` that counts invocations so the tests
 * can prove the durable wrapper only re-invokes when expected.
 */
function makeCountingExecutor(): TaskAgentExecutorLike & {
  readonly calls: ReadonlyArray<TaskAgentExecuteOptionsLike>;
} {
  const calls: TaskAgentExecuteOptionsLike[] = [];
  return {
    async execute(opts) {
      calls.push(opts);
      const output: TaskAgentExecuteOutputLike = {
        runId: `tar_${calls.length}`,
        agentId: opts.agentId,
        tenantId: opts.tenantId,
        outcome: 'executed',
        summary: `ran ${opts.agentId}`,
        data: { invocation: calls.length },
        affected: [],
        durationMs: 1,
        ranAt: new Date('2026-05-24T00:00:00Z').toISOString(),
        triggerKind: opts.trigger.kind,
      };
      return output;
    },
    get calls() {
      return calls.slice();
    },
  };
}

function makeEvent(): TaskAgentRunRequestedEvent {
  return {
    name: TASK_AGENT_RUN_EVENT,
    data: {
      tenantId: 'tenant_abc',
      agentId: 'rent_reminder_agent',
      requestId: 'req_fixed_001',
      payload: { dueInDays: 3 },
      trigger: { kind: 'cron' },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDurableTaskAgentExecutor — step idempotency', () => {
  it('replays a successful run from cache without re-invoking the executor', async () => {
    const composition = makeComposition();
    const executor = makeCountingExecutor();
    const completions: TaskAgentExecuteOutputLike[] = [];
    const durable = createDurableTaskAgentExecutor({
      composition,
      executor,
      onCompleted: (out) => {
        completions.push(out);
      },
    });

    const step = createMemoStep();
    const event = makeEvent();

    const first = await durable.runDurable(event, step);
    const second = await durable.runDurable(event, step);

    // Same memoized result both times.
    expect(second).toStrictEqual(first);
    // Executor body invoked exactly ONCE — replay used the cache.
    expect(executor.calls.length).toBe(1);
    expect(executor.calls[0]?.agentId).toBe('rent_reminder_agent');
    // onCompleted fired exactly once — its step is memoized too.
    expect(completions.length).toBe(1);
    // Each step body was called exactly once across both runs.
    const idsCalled = step.calls.map((c) => c.id);
    expect(idsCalled.filter((i) => i.startsWith('execute-agent:')).length).toBe(1);
    expect(idsCalled.filter((i) => i.startsWith('notify-completion:')).length).toBe(1);
  });
});

describe('createDurableTaskAgentExecutor — retry on transient failure', () => {
  it('re-runs the failing step on retry and only invokes the executor once on success', async () => {
    const composition = makeComposition();
    const executor = makeCountingExecutor();
    const durable = createDurableTaskAgentExecutor({
      composition,
      executor,
    });

    const event = makeEvent();
    const stepKey = `${event.data.agentId}:${event.data.tenantId}:${event.data.requestId}`;

    // First attempt — transient infra failure on `execute-agent`. The
    // step-runner throws BEFORE the body runs, so the executor must
    // NOT have recorded the call.
    const stepAttempt1 = createMemoStep({
      throwOn: [`execute-agent:${stepKey}`],
    });
    await expect(durable.runDurable(event, stepAttempt1)).rejects.toThrow(
      /transient failure/,
    );
    expect(executor.calls.length).toBe(0);

    // Inngest's retry semantics: a fresh step instance (the runtime
    // re-invokes the function on a new container), but the
    // `validate-request` step IS already cached on the platform side.
    // We model that by replaying through the same memo cache.
    const stepAttempt2 = createMemoStep();
    // Pre-populate the cache with the already-validated request from
    // attempt 1 — that is what Inngest's checkpoint store does.
    stepAttempt2.cache.set(
      `validate-request:${stepKey}`,
      event.data,
    );
    const output = await durable.runDurable(event, stepAttempt2);

    expect(output.outcome).toBe('executed');
    // Executor body invoked exactly once across both attempts.
    expect(executor.calls.length).toBe(1);
    // The replay did NOT re-run validate-request (it was cached).
    const validateCalls = stepAttempt2.calls.filter((c) =>
      c.id.startsWith('validate-request:'),
    );
    expect(validateCalls.length).toBe(0);
  });
});

describe('createDurableTaskAgentExecutor — checkpoint resume', () => {
  it('resumes from the last completed step when the function is re-invoked', async () => {
    const composition = makeComposition();
    const executor = makeCountingExecutor();
    const completions: TaskAgentExecuteOutputLike[] = [];
    const durable = createDurableTaskAgentExecutor({
      composition,
      executor,
      onCompleted: (out) => {
        completions.push(out);
      },
    });

    const event = makeEvent();
    const stepKey = `${event.data.agentId}:${event.data.tenantId}:${event.data.requestId}`;

    // Simulated crash mid-run: validate + execute committed to the
    // checkpoint store; notify-completion did not. The next worker
    // pickup starts fresh but with the prior cache replayed in.
    const sharedCache = new Map<string, unknown>();
    sharedCache.set(`validate-request:${stepKey}`, event.data);
    const priorOutput: TaskAgentExecuteOutputLike = {
      runId: 'tar_prior',
      agentId: event.data.agentId,
      tenantId: event.data.tenantId,
      outcome: 'executed',
      summary: 'pre-crash run',
      data: { invocation: 0 },
      affected: [],
      durationMs: 1,
      ranAt: new Date('2026-05-24T00:00:00Z').toISOString(),
      triggerKind: 'cron',
    };
    sharedCache.set(`execute-agent:${stepKey}`, priorOutput);

    // Build a step-runner that uses the populated cache.
    const stepResume = (() => {
      const inner = createMemoStep();
      // Seed the resume cache.
      for (const [k, v] of sharedCache.entries()) inner.cache.set(k, v);
      return inner;
    })();

    const output = await durable.runDurable(event, stepResume);

    // Output matches the pre-crash checkpoint — the wrapper did NOT
    // overwrite the prior runId.
    expect(output.runId).toBe('tar_prior');
    // Executor was NOT re-invoked — its checkpoint was honoured.
    expect(executor.calls.length).toBe(0);
    // notify-completion fired exactly once on resume (it was the only
    // uncached step).
    expect(completions.length).toBe(1);
    expect(completions[0]?.runId).toBe('tar_prior');
    const notifyCalls = stepResume.calls.filter((c) =>
      c.id.startsWith('notify-completion:'),
    );
    expect(notifyCalls.length).toBe(1);
  });
});

describe('createDurableTaskAgentExecutor — enqueue (producer-side)', () => {
  it('returns enqueued:false and a stable requestId when the flag is off', async () => {
    const durable = createDurableTaskAgentExecutor({
      composition: makeComposition(),
      executor: makeCountingExecutor(),
    });
    const result = await durable.enqueue({
      tenantId: 't1',
      agentId: 'rent_reminder_agent',
      payload: {},
      trigger: { kind: 'cron' },
      requestId: 'req_fixed_001',
    });
    expect(result.enqueued).toBe(false);
    expect(result.requestId).toBe('req_fixed_001');
  });

  it('forwards a send() to the client when enabled', async () => {
    const sends: Array<{ readonly name: string }> = [];
    const composition: InngestComposition = {
      client: {
        async send(args) {
          sends.push({ name: args.name });
          return undefined;
        },
        createFunction(def) {
          return def;
        },
      },
      config: { appId: 'test-app', enabled: true },
      enabled: true,
    };
    const durable = createDurableTaskAgentExecutor({
      composition,
      executor: makeCountingExecutor(),
    });
    const result = await durable.enqueue({
      tenantId: 't1',
      agentId: 'rent_reminder_agent',
      payload: {},
      trigger: { kind: 'cron' },
    });
    expect(result.enqueued).toBe(true);
    expect(result.requestId).toMatch(/^req_/);
    expect(sends.length).toBe(1);
    expect(sends[0]?.name).toBe(TASK_AGENT_RUN_EVENT);
  });
});
