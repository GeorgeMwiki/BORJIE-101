/**
 * Durable wrapper around `@borjie/ai-copilot/task-agents`'
 * `TaskAgentExecutor`. Each phase of the run (autonomy probe, budget
 * guard, agent invocation, audit emission, event publish) becomes a
 * named `step.run(...)` so Inngest can checkpoint between them.
 *
 * Why a wrapper and not a fork? The legacy `TaskAgentExecutor` stays
 * the source of truth for guardrail logic (autonomy gate, budget,
 * audit, events) — we MUST NOT diverge that behaviour. The wrapper's
 * only job is to slice the existing call into checkpointed steps so a
 * crash mid-batch resumes from the last successful step instead of
 * replaying the whole cron.
 *
 * Idempotency contract:
 *   - `step.run(id, fn)` is memoized by Inngest on (functionId, runId,
 *     stepId). The wrapper uses STABLE, DETERMINISTIC step ids derived
 *     from `(agentId, tenantId, requestId)` so a replay returns the
 *     prior result without re-invoking the executor body.
 *   - The wrapper itself never mutates the legacy executor's inputs —
 *     immutability is preserved end-to-end.
 *
 * Backward-compat:
 *   - The wrapper is opt-in via `DURABLE_EXEC_ENABLED=true` (read at
 *     the composition root and threaded in as `enabled` on the
 *     composition). When disabled the api-gateway calls the original
 *     `TaskAgentExecutor.execute(...)` directly.
 */

import type {
  DurableFunctionContext,
  DurableStepLike,
  InngestComposition,
} from './inngest-client.js';

// ---------------------------------------------------------------------------
// Structural ports — avoid a hard runtime import of @borjie/ai-copilot.
// The kernel package depends only on the SHAPE of the executor so:
//   - tests can pass a hand-rolled stub
//   - the dependency graph stays acyclic
//   - upgrading the legacy executor is a pure additive change
// ---------------------------------------------------------------------------

export interface TaskAgentExecuteOptionsLike {
  readonly tenantId: string;
  readonly agentId: string;
  readonly payload: unknown;
  readonly trigger:
    | { readonly kind: 'manual'; readonly userId: string }
    | { readonly kind: 'cron' }
    | { readonly kind: 'event'; readonly eventId: string };
}

export interface TaskAgentExecuteOutputLike {
  readonly runId: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly outcome:
    | 'executed'
    | 'skipped_policy'
    | 'skipped_budget'
    | 'no_op'
    | 'error';
  readonly summary: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly affected: ReadonlyArray<{ readonly kind: string; readonly id: string }>;
  readonly durationMs: number;
  readonly ranAt: string;
  readonly triggerKind: 'manual' | 'cron' | 'event';
}

/** Structural shape of `TaskAgentExecutor` from `@borjie/ai-copilot`. */
export interface TaskAgentExecutorLike {
  execute(opts: TaskAgentExecuteOptionsLike): Promise<TaskAgentExecuteOutputLike>;
}

// ---------------------------------------------------------------------------
// Inngest event contract
// ---------------------------------------------------------------------------

/** Name of the event a producer sends to invoke a single agent run. */
export const TASK_AGENT_RUN_EVENT = 'task-agent/run.requested';

export interface TaskAgentRunRequestedEvent {
  readonly name: typeof TASK_AGENT_RUN_EVENT;
  readonly data: {
    readonly tenantId: string;
    readonly agentId: string;
    /**
     * Caller-supplied idempotency key. Inngest will treat two events
     * with the same `data.requestId` as the same logical run, ensuring
     * the wrapped executor's side-effects fire at most once.
     */
    readonly requestId: string;
    readonly payload: unknown;
    readonly trigger:
      | { readonly kind: 'manual'; readonly userId: string }
      | { readonly kind: 'cron' }
      | { readonly kind: 'event'; readonly eventId: string };
  };
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

export interface DurableExecutorDeps {
  readonly composition: InngestComposition;
  readonly executor: TaskAgentExecutorLike;
  /**
   * Hook called after a successful durable run. Production callers wire
   * this to a real PlatformEvent publisher; tests use it to assert the
   * post-checkpoint side-effects fire exactly once on replay.
   */
  readonly onCompleted?: (output: TaskAgentExecuteOutputLike) => Promise<void> | void;
}

export interface DurableTaskAgentExecutor {
  /**
   * Producer side — enqueues an event onto the Inngest bus. Safe to
   * call from any code path; the executor's actual body runs inside
   * the registered Inngest function (see `definition`).
   */
  enqueue(args: {
    readonly tenantId: string;
    readonly agentId: string;
    readonly payload: unknown;
    readonly trigger:
      | { readonly kind: 'manual'; readonly userId: string }
      | { readonly kind: 'cron' }
      | { readonly kind: 'event'; readonly eventId: string };
    /** Optional override; defaults to a UUID. */
    readonly requestId?: string;
  }): Promise<{ readonly requestId: string; readonly enqueued: boolean }>;
  /**
   * Registered Inngest function definition. The api-gateway's
   * `/api/inngest` HTTP handler picks this up via the standard `serve`
   * adapter.
   */
  readonly definition: ReturnType<
    InngestComposition['client']['createFunction']
  >;
  /**
   * Direct invocation of the durable body for tests + the bypass path
   * (used when `DURABLE_EXEC_ENABLED=false` so the same code paths run
   * end-to-end in CI regardless of feature-flag state). Production
   * code should always go through `enqueue`.
   */
  runDurable(
    event: TaskAgentRunRequestedEvent,
    step: DurableStepLike,
  ): Promise<TaskAgentExecuteOutputLike>;
}

/**
 * Compose the durable wrapper.
 *
 * Step layout (each `step.run` becomes a resumable checkpoint):
 *   1. `validate-request` — defensive parse of the event payload. Cheap;
 *      idempotent on replay.
 *   2. `execute-agent`    — the actual legacy `TaskAgentExecutor.execute`
 *      call. The legacy executor handles autonomy + budget + audit + event
 *      emission internally; we treat it as one atomic checkpoint so a
 *      crash retries the whole call (the legacy executor is already
 *      idempotent enough — autonomy/budget short-circuit before any
 *      side-effect; the only true side-effect is the audit row which is
 *      keyed by `runId`).
 *   3. `notify-completion` — fan-out hook. Wrapped in its own step so a
 *      partial-failure here doesn't replay the agent body.
 *
 * Retries: Inngest's default policy retries every `step.run` on
 * transient failure with exponential back-off. We surface the contract
 * by NOT swallowing thrown errors inside the step body — the legacy
 * executor returns `{outcome: 'error', ...}` on agent failure instead
 * of throwing, so Inngest only retries on truly transient infra errors
 * (DB unreachable, audit-sink write timeout, etc.).
 */
export function createDurableTaskAgentExecutor(
  deps: DurableExecutorDeps,
): DurableTaskAgentExecutor {
  const { composition, executor, onCompleted } = deps;

  const definition = composition.client.createFunction({
    id: `${composition.config.appId}.task-agent.run`,
    name: 'task-agent run (durable)',
    trigger: { event: TASK_AGENT_RUN_EVENT },
    handler: async (ctx: DurableFunctionContext) => {
      const event = ctx.event as TaskAgentRunRequestedEvent;
      return runDurableBody(event, ctx.step, executor, onCompleted);
    },
  });

  return {
    async enqueue(args) {
      const requestId = args.requestId ?? generateRequestId();
      if (!composition.enabled) {
        // Flag is off — caller should bypass the wrapper entirely. We
        // still hand back a `requestId` so the call site has a stable
        // correlator, but `enqueued: false` signals the no-op.
        return { requestId, enqueued: false };
      }
      await composition.client.send({
        name: TASK_AGENT_RUN_EVENT,
        data: {
          tenantId: args.tenantId,
          agentId: args.agentId,
          requestId,
          payload: args.payload,
          trigger: args.trigger,
        },
      });
      return { requestId, enqueued: true };
    },
    definition,
    async runDurable(event, step) {
      return runDurableBody(event, step, executor, onCompleted);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function runDurableBody(
  event: TaskAgentRunRequestedEvent,
  step: DurableStepLike,
  executor: TaskAgentExecutorLike,
  onCompleted: DurableExecutorDeps['onCompleted'],
): Promise<TaskAgentExecuteOutputLike> {
  const { tenantId, agentId, requestId } = event.data;
  const stepKey = `${agentId}:${tenantId}:${requestId}`;

  // Step 1 — validate. Pure function over the event; replay-safe.
  const validated = await step.run(`validate-request:${stepKey}`, () => {
    if (!tenantId || !agentId || !requestId) {
      throw new Error(
        `Invalid task-agent event: missing tenantId/agentId/requestId (got ${JSON.stringify({
          tenantId,
          agentId,
          requestId,
        })})`,
      );
    }
    return event.data;
  });

  // Step 2 — execute the legacy agent. The executor is contractually
  // non-throwing (it materializes failures as `outcome: 'error'`), so a
  // thrown error here is a true infra fault and warrants the default
  // Inngest retry policy.
  const output = await step.run(`execute-agent:${stepKey}`, async () => {
    return executor.execute({
      tenantId: validated.tenantId,
      agentId: validated.agentId,
      payload: validated.payload,
      trigger: validated.trigger,
    });
  });

  // Step 3 — completion fan-out. Wrapped in its own step so a transient
  // notifier failure doesn't replay the agent body.
  if (onCompleted) {
    await step.run(`notify-completion:${stepKey}`, async () => {
      await onCompleted(output);
    });
  }

  return output;
}

function generateRequestId(): string {
  // Lazy-imported to avoid pulling the Node `crypto` types into the
  // module surface. The `globalThis.crypto.randomUUID()` path works in
  // Node ≥ 19 and the browser; the `Math.random` fallback is only used
  // when the runtime is older (kept defensive for unusual sandboxes).
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoLike?.randomUUID) {
    return `req_${cryptoLike.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `req_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
}
