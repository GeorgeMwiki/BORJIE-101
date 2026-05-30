/**
 * Closed-loop runtime — unit tests.
 *
 * Covers the happy path, the tier-policy denial path, the action-error
 * path, and the abort path. Tests use the NULL_SINK + an in-memory
 * trace store so they run without Supabase.
 */

import { describe, it, expect } from "vitest";
import {
  defineClosedLoop,
  runTick,
  NULL_SINK,
  type ClosedLoopSink,
  type ClosedLoopAdjustmentRow,
  type ClosedLoopStateRow,
  type ClosedLoopTickRow,
} from "../runtime";
import type {
  ClosedLoopContext,
  ClosedLoopDefinition,
  ClosedLoopScope,
} from "../types";

function buildHappyLoop(): ClosedLoopDefinition {
  return defineClosedLoop({
    definition: {
      id: "kyc-verification",
      displayName: "Test KYC",
      description: "test",
      defaultTier: "borjie-admin",
      maxDurationMs: 5000,
      minIntervalMinutes: 15,
      actAction: "appraisal:read",
      async observe(ctx: ClosedLoopContext) {
        return {
          observedAtMs: ctx.nowMs,
          facts: { count: 10 },
          summary: "observed 10",
        };
      },
      async decide() {
        return {
          actionType: "appraisal:read",
          rationale: "route 10 docs to fast path",
          confidence: 0.9,
          predicted: { metric: "first-pass", value: 0.8, unit: "fraction" },
          payload: { count: 10 },
        };
      },
      async act(decision) {
        return [
          {
            type: decision.actionType,
            payload: { processed: 10 },
            executed: true,
          },
        ];
      },
      async measure(decision) {
        const actual = decision.predicted.value;
        return {
          measuredAtMs: Date.now(),
          metric: decision.predicted.metric,
          predictedValue: decision.predicted.value,
          actualValue: actual,
          unit: decision.predicted.unit,
          error: 0,
          slaStatus: "within",
        };
      },
      async adjust() {
        return [];
      },
    },
  });
}

function makeScope(): ClosedLoopScope {
  return Object.freeze({ orgId: "org-test", tier: "borjie-admin" as const });
}

describe("closed-loop runtime", () => {
  it("runs a full revolution on the happy path", async () => {
    const tick = await runTick({
      definition: buildHappyLoop(),
      scope: makeScope(),
      sink: NULL_SINK,
    });
    expect(tick.outcome).toBe("success");
    expect(tick.actions.length).toBe(1);
    expect(tick.actions[0]?.executed).toBe(true);
    expect(tick.measurement.slaStatus).toBe("within");
    expect(tick.decisionTraceId.length).toBeGreaterThan(0);
  });

  it("treats action-throws as action-error outcome", async () => {
    const loop = defineClosedLoop({
      definition: {
        ...buildHappyLoop(),
        async act() {
          throw new Error("boom");
        },
      },
    });
    const tick = await runTick({
      definition: loop,
      scope: makeScope(),
      sink: NULL_SINK,
    });
    expect(tick.outcome).toBe("action-error");
    expect(tick.actions[0]?.executed).toBe(false);
    expect(tick.actions[0]?.executionError).toContain("boom");
  });

  it("flags sla-breach when measure reports a breach", async () => {
    const loop = defineClosedLoop({
      definition: {
        ...buildHappyLoop(),
        async measure(decision) {
          return {
            measuredAtMs: Date.now(),
            metric: decision.predicted.metric,
            predictedValue: decision.predicted.value,
            actualValue: 0,
            unit: decision.predicted.unit,
            error: -decision.predicted.value,
            slaStatus: "breached",
          };
        },
        async adjust(measurement) {
          return [
            {
              kind: "lesson",
              description: "drifted",
              delta: { error: measurement.error },
            },
          ];
        },
      },
    });
    const tick = await runTick({
      definition: loop,
      scope: makeScope(),
      sink: NULL_SINK,
    });
    expect(tick.outcome).toBe("sla-breach");
    expect(tick.adjustments.length).toBe(1);
    expect(tick.adjustments[0]?.kind).toBe("lesson");
  });

  it("aborts cleanly when the external signal trips before observe", async () => {
    const ac = new AbortController();
    ac.abort();
    const tick = await runTick({
      definition: buildHappyLoop(),
      scope: makeScope(),
      sink: NULL_SINK,
      abortSignal: ac.signal,
    });
    expect(["aborted", "internal-error"]).toContain(tick.outcome);
  });

  it("denies act when tier-policy refuses", async () => {
    const loop = defineClosedLoop({
      definition: {
        ...buildHappyLoop(),
        actAction: "appraisal:write_override",
      },
    });
    const scope: ClosedLoopScope = {
      orgId: "org-test",
      tier: "borrower",
    };
    const tick = await runTick({
      definition: loop,
      scope,
      sink: NULL_SINK,
    });
    expect(tick.outcome).toBe("sla-breach");
    expect(tick.actions.length).toBe(0);
  });

  it("writes tick + state + adjustment rows to the sink", async () => {
    const ticks: ClosedLoopTickRow[] = [];
    const adjustments: ClosedLoopAdjustmentRow[] = [];
    const states: ClosedLoopStateRow[] = [];
    const sink: ClosedLoopSink = {
      async insertTick(row) {
        ticks.push(row);
      },
      async insertAdjustments(rows) {
        adjustments.push(...rows);
      },
      async upsertState(row) {
        states.push(row);
      },
    };
    const loop = defineClosedLoop({
      definition: {
        ...buildHappyLoop(),
        async measure(decision) {
          return {
            measuredAtMs: Date.now(),
            metric: decision.predicted.metric,
            predictedValue: decision.predicted.value,
            actualValue: 0,
            unit: decision.predicted.unit,
            error: -decision.predicted.value,
            slaStatus: "breached",
          };
        },
        async adjust() {
          return [{ kind: "lesson", description: "stub" }];
        },
      },
    });
    await runTick({ definition: loop, scope: makeScope(), sink });
    expect(ticks.length).toBe(1);
    expect(adjustments.length).toBe(1);
    expect(states.length).toBe(1);
    expect(states[0]?.last_outcome).toBe("sla-breach");
  });

  it("rejects loops with non-positive duration", () => {
    expect(() =>
      defineClosedLoop({
        definition: { ...buildHappyLoop(), maxDurationMs: 0 },
      }),
    ).toThrow(/maxDurationMs/);
  });
});
