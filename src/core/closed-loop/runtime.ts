/**
 * Closed-Loop Process Layer — Runtime.
 *
 * The runtime is the only thing that runs a tick. It:
 *
 *   1. checks the `AbortController` budget at every step boundary
 *   2. calls `observe()`
 *   3. opens a `DecisionTrace`, calls `decide()`, persists the trace
 *   4. asserts `tier-policy` for the loop's `actAction` then calls `act()`
 *   5. calls `measure()` and computes the SLA outcome
 *   6. calls `adjust()` and persists each adjustment
 *   7. writes the full tick row to `closed_loop_ticks`
 *   8. updates `closed_loops` rolling-state row
 *
 * Hard rules:
 *
 * - `assertTierPolicy` runs BEFORE `act()`. If denied, the tick ends
 *   with outcome `sla-breach` (no side effects).
 * - DecisionTrace is opened around `decide()`. `finalize()` always fires
 *   even when `act()` throws.
 * - The runtime never throws to the caller; it returns the tick row
 *   with an outcome describing what happened.
 * - Budget enforcement is cooperative: each step checks
 *   `ctx.abortSignal.aborted`. The runtime also wraps the whole tick in
 *   a watchdog that flips the signal at `maxDurationMs`.
 *
 * @module core/closed-loop/runtime
 */

import { randomUUID } from "node:crypto";
import { assertTierPolicy } from "@/core/governance/tier-policy";
import type { TierAction } from "@/core/governance/tier-policy";
import {
  InMemoryTraceStore,
  startTrace,
  type TraceStore,
} from "@/core/borjie-ai/decision-trace";
import type {
  Action,
  Adjustment,
  ClosedLoopContext,
  ClosedLoopDefinition,
  ClosedLoopOutcome,
  ClosedLoopScope,
  ClosedLoopTick,
  Decision,
  Measurement,
  Observation,
} from "./types";

// ---------------------------------------------------------------------------
// Persistence ports
// ---------------------------------------------------------------------------

/**
 * Loose Supabase-shaped writer. Production wires
 * `createServiceClient()`; tests inject an in-memory fake.
 *
 * The runtime tolerates a null sink so unit tests can run the tick
 * loop without provisioning a Supabase instance.
 */
export interface ClosedLoopSink {
  insertTick(row: ClosedLoopTickRow): Promise<void>;
  insertAdjustments(
    rows: ReadonlyArray<ClosedLoopAdjustmentRow>,
  ): Promise<void>;
  upsertState(row: ClosedLoopStateRow): Promise<void>;
}

export interface ClosedLoopTickRow {
  readonly tick_id: string;
  readonly loop_id: string;
  readonly org_id: string;
  readonly borrower_id: string | null;
  readonly application_id: string | null;
  readonly tier: string;
  readonly correlation_id: string;
  readonly started_at: string;
  readonly ended_at: string;
  readonly observation: Record<string, unknown>;
  readonly decision: Record<string, unknown>;
  readonly actions: ReadonlyArray<Record<string, unknown>>;
  readonly measurement: Record<string, unknown>;
  readonly decision_trace_id: string;
  readonly outcome: ClosedLoopOutcome;
}

export interface ClosedLoopAdjustmentRow {
  readonly id: string;
  readonly tick_id: string;
  readonly loop_id: string;
  readonly org_id: string;
  readonly kind: string;
  readonly description: string;
  readonly delta: Record<string, unknown> | null;
  readonly belief_delta: number | null;
  readonly recorded_at: string;
}

export interface ClosedLoopStateRow {
  readonly loop_id: string;
  readonly org_id: string;
  readonly last_tick_id: string;
  readonly last_tick_at: string;
  readonly last_outcome: ClosedLoopOutcome;
  readonly drift_sigma: number;
}

/** Null sink used by unit tests; every method is a no-op. */
export const NULL_SINK: ClosedLoopSink = Object.freeze({
  async insertTick(): Promise<void> {},
  async insertAdjustments(): Promise<void> {},
  async upsertState(): Promise<void> {},
});

// ---------------------------------------------------------------------------
// Factory + runner
// ---------------------------------------------------------------------------

export interface DefineClosedLoopArgs {
  readonly definition: ClosedLoopDefinition;
}

/**
 * Identity factory. Kept as a function so we can validate the
 * definition at registration time later (e.g., assert that
 * `maxDurationMs > 0` and `actAction` is a known tier-policy action).
 */
export function defineClosedLoop(
  args: DefineClosedLoopArgs,
): ClosedLoopDefinition {
  const { definition } = args;
  if (definition.maxDurationMs <= 0) {
    throw new Error(`loop ${definition.id}: maxDurationMs must be positive`);
  }
  if (!definition.actAction || definition.actAction.length === 0) {
    throw new Error(`loop ${definition.id}: actAction must be non-empty`);
  }
  return Object.freeze(definition);
}

export interface RunTickArgs {
  readonly definition: ClosedLoopDefinition;
  readonly scope: ClosedLoopScope;
  readonly sink?: ClosedLoopSink;
  readonly traceStore?: TraceStore;
  readonly correlationId?: string;
  readonly clock?: () => number;
  readonly abortSignal?: AbortSignal;
}

/**
 * Execute one full revolution of `definition` against `scope`. Never
 * throws to the caller; the tick row carries the outcome.
 */
export async function runTick(args: RunTickArgs): Promise<ClosedLoopTick> {
  const sink = args.sink ?? NULL_SINK;
  const traceStore = args.traceStore ?? new InMemoryTraceStore();
  const clock = args.clock ?? Date.now;
  const correlationId = args.correlationId ?? randomUUID();
  const startedAtMs = clock();
  const tickId = randomUUID();

  // Watchdog: flip the abort signal at maxDurationMs.
  const ac = new AbortController();
  const externalSignal = args.abortSignal;
  const onExternalAbort = (): void => ac.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort();
    else
      externalSignal.addEventListener("abort", onExternalAbort, {
        once: true,
      });
  }
  const watchdog = setTimeout(() => ac.abort(), args.definition.maxDurationMs);

  const ctx: ClosedLoopContext = Object.freeze({
    loopId: args.definition.id,
    scope: args.scope,
    nowMs: startedAtMs,
    correlationId,
    abortSignal: ac.signal,
  });

  // Sentinel values used when an earlier step fails. We persist the
  // row regardless so the auditor can read why the tick ended.
  let observation: Observation = {
    observedAtMs: startedAtMs,
    facts: {},
    summary: "no observation captured",
  };
  let decision: Decision = {
    actionType: args.definition.actAction,
    rationale: "no decision produced",
    confidence: 0,
    predicted: { metric: "no-op", value: 0, unit: "n/a" },
    payload: {},
  };
  let actions: ReadonlyArray<Action> = [];
  let measurement: Measurement = emptyMeasurement(startedAtMs);
  let adjustments: ReadonlyArray<Adjustment> = [];
  let outcome: ClosedLoopOutcome = "success";
  let decisionTraceId = "";

  try {
    // 1. observe
    if (ctx.abortSignal?.aborted) throw new Error("aborted before observe");
    observation = await args.definition.observe(ctx);

    // 2. decide (wrapped in DecisionTrace)
    if (ctx.abortSignal?.aborted) throw new Error("aborted before decide");
    const recorder = startTrace({
      correlationId,
      sessionId: `closed-loop:${args.definition.id}:${args.scope.orgId}`,
      userId: "system:closed-loop-runtime",
      tier:
        args.scope.tier === "consumer" || args.scope.tier === "community-admin"
          ? "borjie-admin"
          : args.scope.tier,
      model: "closed-loop-internal",
      modelTier: "external",
      input: {
        text: `tick ${args.definition.id}`,
        portalId: "closed-loop",
        route: `/closed-loop/${args.definition.id}`,
      },
      clock,
    });
    decisionTraceId = recorder.id;
    decision = await args.definition.decide(observation, ctx);
    recorder.addReasoning(decision.rationale.slice(0, 500));
    await recorder.finalize(
      {
        type: decision.actionType,
        payload: { ...decision.payload, predicted: decision.predicted },
      },
      traceStore,
    );

    // 3. assertTierPolicy then act
    if (ctx.abortSignal?.aborted) throw new Error("aborted before act");
    const policy = assertTierPolicy(
      args.scope.tier,
      args.definition.actAction as TierAction,
    );
    if (!policy.ok) {
      outcome = "sla-breach";
      actions = [];
    } else {
      try {
        actions = await args.definition.act(decision, ctx);
        if (actions.some((a) => !a.executed)) outcome = "action-error";
      } catch (err) {
        actions = [
          freezeAction({
            type: decision.actionType,
            target: undefined,
            payload: {},
            executed: false,
            executionError: errorMessage(err),
          }),
        ];
        outcome = "action-error";
      }
    }

    // 4. measure
    if (ctx.abortSignal?.aborted) {
      outcome = "aborted";
    } else {
      measurement = await args.definition.measure(decision, actions, ctx);
      if (measurement.slaStatus === "breached" && outcome === "success") {
        outcome = "sla-breach";
      }
    }

    // 5. adjust
    if (!ctx.abortSignal?.aborted) {
      adjustments = await args.definition.adjust(measurement, ctx);
    }
  } catch (err) {
    // Aborted vs hard internal failure. We treat any throw as
    // `internal-error` unless the abort was tripped first.
    outcome = ac.signal.aborted ? "aborted" : "internal-error";
    if (!decision.rationale.includes("error:")) {
      decision = {
        ...decision,
        rationale: `${decision.rationale} | error: ${errorMessage(err)}`,
      };
    }
  } finally {
    clearTimeout(watchdog);
    // Detach the external-abort listener so we don't accumulate
    // references on long-lived parent controllers across many ticks.
    if (externalSignal && !externalSignal.aborted) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }

  const endedAtMs = clock();
  const tick: ClosedLoopTick = Object.freeze({
    tickId,
    loopId: args.definition.id,
    scope: args.scope,
    correlationId,
    startedAtMs,
    endedAtMs,
    observation,
    decision,
    actions,
    measurement,
    adjustments,
    decisionTraceId,
    outcome,
  });

  // Persist; failures are logged and swallowed (closed loop must never
  // crash the heartbeat tick).
  try {
    await sink.insertTick(toTickRow(tick));
    if (adjustments.length > 0) {
      await sink.insertAdjustments(
        adjustments.map((a) => toAdjustmentRow(a, tick)),
      );
    }
    await sink.upsertState(toStateRow(tick));
  } catch (err) {
    console.error(
      `[closed-loop/${args.definition.id}] persist failed:`,
      errorMessage(err),
    );
  }

  return tick;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function emptyMeasurement(nowMs: number): Measurement {
  return {
    measuredAtMs: nowMs,
    metric: "no-op",
    predictedValue: 0,
    actualValue: 0,
    unit: "n/a",
    error: 0,
    slaStatus: "unknown",
  };
}

function freezeAction(a: Action): Action {
  return Object.freeze({ ...a });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toTickRow(tick: ClosedLoopTick): ClosedLoopTickRow {
  return {
    tick_id: tick.tickId,
    loop_id: tick.loopId,
    org_id: tick.scope.orgId,
    borrower_id: tick.scope.borrowerId ?? null,
    application_id: tick.scope.applicationId ?? null,
    tier: String(tick.scope.tier),
    correlation_id: tick.correlationId,
    started_at: new Date(tick.startedAtMs).toISOString(),
    ended_at: new Date(tick.endedAtMs).toISOString(),
    observation: { ...tick.observation },
    decision: { ...tick.decision },
    actions: tick.actions.map((a) => ({ ...a })),
    measurement: { ...tick.measurement },
    decision_trace_id: tick.decisionTraceId,
    outcome: tick.outcome,
  };
}

function toAdjustmentRow(
  adj: Adjustment,
  tick: ClosedLoopTick,
): ClosedLoopAdjustmentRow {
  return {
    id: randomUUID(),
    tick_id: tick.tickId,
    loop_id: tick.loopId,
    org_id: tick.scope.orgId,
    kind: adj.kind,
    description: adj.description,
    delta: adj.delta ? { ...adj.delta } : null,
    belief_delta: adj.beliefDelta ?? null,
    recorded_at: new Date(tick.endedAtMs).toISOString(),
  };
}

function toStateRow(tick: ClosedLoopTick): ClosedLoopStateRow {
  return {
    loop_id: tick.loopId,
    org_id: tick.scope.orgId,
    last_tick_id: tick.tickId,
    last_tick_at: new Date(tick.endedAtMs).toISOString(),
    last_outcome: tick.outcome,
    drift_sigma: Math.abs(tick.measurement.error),
  };
}
