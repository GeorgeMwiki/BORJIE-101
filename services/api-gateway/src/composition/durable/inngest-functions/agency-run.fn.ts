/**
 * agency-run.fn — Inngest function wrapping the existing durable
 * step-by-step executor.
 *
 * The function definition is API-COMPATIBLE with our current
 * `runStep` semantics in `durable-runner.ts`: each `step.run()` call
 * is automatically checkpointed by Inngest, results survive process
 * crashes, and retries are governed by Inngest's per-function policy.
 *
 * Why a separate file instead of inlining inside durable-runner?
 *
 *   1. The runner has two backends (Inngest + custom checkpoint).
 *      Keeping Inngest's specifics out of the runner core lets us
 *      delete this file the day we go 100% Inngest without churning
 *      the runner.
 *   2. Inngest's `createFunction` signature is verbose; pulling it
 *      into its own module keeps the runner readable.
 *   3. Tests for the function builder live alongside it — no
 *      cross-cutting test surface in the runner suite.
 *
 * Production wiring:
 *
 *   - The function is registered with the Inngest dev server (or
 *     Inngest cloud) at app boot via the webhook router's `serve()`.
 *   - The function receives the event payload, walks the goal's
 *     steps, and invokes `executeStep` for each — exactly what the
 *     custom runner does today.
 *   - On any step throw, Inngest's default retry policy applies:
 *     4 attempts with exponential backoff. This MATCHES the runner's
 *     `[200, 400, 800]ms` schedule closely (Inngest is `[1s, 4s,
 *     16s, 1m]` — we accept the longer tail because Inngest gets
 *     real distributed durability in exchange).
 *
 * Test note: the actual `inngest` package's `createFunction` is
 * loaded dynamically — when absent (CI baseline), the factory
 * returns `null` and the runner sticks to its custom backend.
 */

import { AGENCY_RUN_EVENT, type InngestClientLike } from '../inngest-client.js';
import type { DurableRunArgs, DurableRunOutcome } from '../durable-runner.js';

/** Inngest function handle — narrow surface so tests don't need the
 *  full `InngestFunction` type from the SDK. */
export interface InngestFunctionLike {
  /** Inngest's own id — used for diagnostics and registration. */
  readonly id: string;
  /** Inngest's `name` field — surfaced in the dashboard. */
  readonly name?: string;
}

/** Shape of the event payload Inngest will receive. */
export interface AgencyRunEventData {
  readonly tenantId: string;
  readonly goalId: string;
  readonly runId?: string;
}

/**
 * Dispatch an agency run via Inngest. The runner calls this when
 * the Inngest backend is wired; otherwise it falls back to the
 * in-process custom runner.
 *
 * Returns the Inngest event id(s) — the actual run outcome is
 * delivered ASYNCHRONOUSLY by the Inngest webhook. Callers that
 * need the outcome inline must subscribe to the checkpoint store
 * (resume-from-success makes the read idempotent).
 */
export async function dispatchAgencyRun(
  client: InngestClientLike,
  args: AgencyRunEventData,
): Promise<{ inngestEventIds: ReadonlyArray<string> }> {
  const payload = {
    name: AGENCY_RUN_EVENT,
    data: {
      tenantId: args.tenantId,
      goalId: args.goalId,
      runId: args.runId,
    } as Record<string, unknown>,
  };
  const result = (await client.send(payload)) as { ids?: ReadonlyArray<string> };
  return { inngestEventIds: result?.ids ?? [] };
}

/** Step-runner contract — the inngest function delegates to this so
 *  the same code path is exercised by both backends. */
export interface InngestStepRunner {
  executeGoal(args: DurableRunArgs): Promise<DurableRunOutcome>;
}

/** Factory deps for `createAgencyRunFunction`. */
export interface AgencyRunFunctionDeps {
  /** Inngest client (real or stub). The factory pulls
   *  `createFunction` from the same package via dynamic import. */
  readonly client: InngestClientLike & {
    createFunction?: (cfg: unknown, trigger: unknown, handler: unknown) => InngestFunctionLike;
  };
  /** The runner instance whose `executeGoal` is the actual workload. */
  readonly runner: InngestStepRunner;
}

/**
 * Create the `agency/run.requested` Inngest function. The function
 * wraps the runner's `executeGoal` so every Inngest invocation runs
 * the same code path as a direct in-process call — only the
 * orchestration / retry / checkpoint layer differs.
 *
 * Returns `null` when the client doesn't expose `createFunction`
 * (e.g. test stubs that only implement `send`). Composition root
 * accepts `null` and silently skips registration in that case.
 */
export function createAgencyRunFunction(
  deps: AgencyRunFunctionDeps,
): InngestFunctionLike | null {
  const { client, runner } = deps;
  if (typeof client.createFunction !== 'function') return null;

  const handler = async (ctx: {
    readonly event: { readonly data: AgencyRunEventData };
    readonly step: {
      run<T>(id: string, fn: () => Promise<T>): Promise<T>;
    };
  }): Promise<DurableRunOutcome> => {
    const { tenantId, goalId, runId } = ctx.event.data;
    // The whole goal is one step.run — the runner already does its
    // own per-step checkpointing via the StepCheckpointStore. This
    // gives us two independent durability planes:
    //   - Inngest (function-level retry + cross-process resumption)
    //   - PG checkpoints (per-step resume-from-success inside one
    //     function invocation)
    return ctx.step.run(`run-${goalId}-${runId ?? 'auto'}`, async () =>
      runner.executeGoal({ tenantId, goalId, runId }),
    );
  };

  return client.createFunction(
    {
      id: 'agency-run',
      name: 'BORJIE — agency run (durable)',
      retries: 4,
    },
    { event: AGENCY_RUN_EVENT },
    handler,
  );
}
