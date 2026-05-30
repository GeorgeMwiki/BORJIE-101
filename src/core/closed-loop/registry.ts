/**
 * Closed-Loop Process Layer — Registry.
 *
 * The fifteen Borjie processes that ship as closed loops in iter-54.
 * Each loop is a minimal stub today (deterministic, side-effect-free
 * `act()`) so the runtime can be wired end-to-end without touching the
 * sub-MD plumbing. P1 wires the real side effects by replacing each
 * loop's `act()` with a call to the matching sub-MD or VP.
 *
 * The 15 ids are frozen in `types.ts`; this registry adds the loop
 * definitions and exposes `getLoop()` / `listLoops()` for the API +
 * dashboard.
 *
 * @module core/closed-loop/registry
 */

import { defineClosedLoop } from "./runtime";
import type {
  Action,
  Adjustment,
  ClosedLoopContext,
  ClosedLoopDefinition,
  ClosedLoopId,
  Decision,
  Measurement,
  Observation,
} from "./types";

// ---------------------------------------------------------------------------
// Stub loop builder
// ---------------------------------------------------------------------------

interface StubArgs {
  readonly id: ClosedLoopId;
  readonly displayName: string;
  readonly description: string;
  readonly actAction: string;
  readonly metric: string;
  readonly unit: string;
  readonly defaultPrediction: number;
  readonly slaThreshold: number;
}

/**
 * Build a no-op closed loop. Every step returns a frozen, deterministic
 * value. The intent is to give the runtime + dashboard something to
 * run against while P1 wires the real sub-MDs in.
 */
function buildStubLoop(args: StubArgs): ClosedLoopDefinition {
  return defineClosedLoop({
    definition: Object.freeze({
      id: args.id,
      displayName: args.displayName,
      description: args.description,
      defaultTier: "borjie-admin" as const,
      maxDurationMs: 60_000,
      minIntervalMinutes: 15,
      actAction: args.actAction,

      async observe(ctx: ClosedLoopContext): Promise<Observation> {
        return Object.freeze({
          observedAtMs: ctx.nowMs,
          facts: Object.freeze({
            loopId: ctx.loopId,
            orgId: ctx.scope.orgId,
          }),
          summary: `stub-observation for ${ctx.loopId}`,
        });
      },

      async decide(
        observation: Observation,
        _ctx: ClosedLoopContext,
      ): Promise<Decision> {
        return Object.freeze({
          actionType: args.actAction,
          rationale: `stub-decide for ${args.id}; observation summary: ${observation.summary ?? "n/a"}`,
          confidence: 0.5,
          predicted: Object.freeze({
            metric: args.metric,
            value: args.defaultPrediction,
            unit: args.unit,
          }),
          payload: Object.freeze({ loopId: args.id }),
        });
      },

      async act(
        decision: Decision,
        _ctx: ClosedLoopContext,
      ): Promise<ReadonlyArray<Action>> {
        return Object.freeze([
          Object.freeze({
            type: decision.actionType,
            target: undefined,
            payload: Object.freeze({ stub: true }),
            executed: true,
          }),
        ]);
      },

      async measure(
        decision: Decision,
        actions: ReadonlyArray<Action>,
        ctx: ClosedLoopContext,
      ): Promise<Measurement> {
        const allExecuted = actions.every((a) => a.executed);
        const actual = allExecuted ? args.defaultPrediction : 0;
        const error = actual - decision.predicted.value;
        const breached = Math.abs(error) > args.slaThreshold;
        return Object.freeze({
          measuredAtMs: ctx.nowMs,
          metric: args.metric,
          predictedValue: decision.predicted.value,
          actualValue: actual,
          unit: args.unit,
          error,
          slaStatus: breached ? "breached" : "within",
        });
      },

      async adjust(
        measurement: Measurement,
        _ctx: ClosedLoopContext,
      ): Promise<ReadonlyArray<Adjustment>> {
        if (measurement.slaStatus !== "breached") return Object.freeze([]);
        return Object.freeze([
          Object.freeze({
            kind: "lesson",
            description: `${args.id} drifted on ${measurement.metric}; queue replay.`,
            delta: Object.freeze({
              metric: measurement.metric,
              error: measurement.error,
            }),
          }),
        ]);
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// The fifteen
// ---------------------------------------------------------------------------

const REGISTRY: ReadonlyArray<ClosedLoopDefinition> = Object.freeze([
  buildStubLoop({
    id: "borrower-acquisition",
    displayName: "Borrower acquisition",
    description: "Channel mix + nudge cadence for new visitors.",
    actAction: "read:platform_metrics",
    metric: "conversion-rate",
    unit: "fraction",
    defaultPrediction: 0.25,
    slaThreshold: 0.1,
  }),
  buildStubLoop({
    id: "kyc-verification",
    displayName: "KYC verification",
    description: "Routes KYC docs through fast / slow / human paths.",
    actAction: "appraisal:read",
    metric: "first-pass-approval-rate",
    unit: "fraction",
    defaultPrediction: 0.8,
    slaThreshold: 0.1,
  }),
  buildStubLoop({
    id: "credit-scoring",
    displayName: "Credit scoring",
    description: "5C + ML scoring pipeline calibration.",
    actAction: "credit_score:read",
    metric: "calibration-mae",
    unit: "score",
    defaultPrediction: 0.05,
    slaThreshold: 0.03,
  }),
  buildStubLoop({
    id: "disbursement",
    displayName: "Disbursement",
    description: "Rail selection (T24 / M-Pesa) and retry policy.",
    actAction: "read:platform_metrics",
    metric: "disburse-success-rate",
    unit: "fraction",
    defaultPrediction: 0.99,
    slaThreshold: 0.02,
  }),
  buildStubLoop({
    id: "repayment-tracking",
    displayName: "Repayment tracking",
    description: "Classifies repayments and tunes reminder cadence.",
    actAction: "read:platform_metrics",
    metric: "days-past-due-mean",
    unit: "days",
    defaultPrediction: 4,
    slaThreshold: 3,
  }),
  buildStubLoop({
    id: "collections",
    displayName: "Collections",
    description: "Per-borrower collection path and persona selection.",
    actAction: "read:platform_metrics",
    metric: "recovery-rate",
    unit: "fraction",
    defaultPrediction: 0.7,
    slaThreshold: 0.15,
  }),
  buildStubLoop({
    id: "regulator-reporting",
    displayName: "Regulator reporting",
    description: "Generate, sign, file weekly + monthly compliance reports.",
    actAction: "read:platform_metrics",
    metric: "on-time-filed-rate",
    unit: "fraction",
    defaultPrediction: 1.0,
    slaThreshold: 0.01,
  }),
  buildStubLoop({
    id: "cbr-filing",
    displayName: "Credit bureau filing",
    description: "Files new disbursements and repayments with CRB.",
    actAction: "read:platform_metrics",
    metric: "filing-accept-rate",
    unit: "fraction",
    defaultPrediction: 0.995,
    slaThreshold: 0.01,
  }),
  buildStubLoop({
    id: "officer-utilisation",
    displayName: "Officer utilisation",
    description: "Rebalances officer caseloads and assignment routing.",
    actAction: "read:platform_metrics",
    metric: "utilisation-rate",
    unit: "fraction",
    defaultPrediction: 0.75,
    slaThreshold: 0.2,
  }),
  buildStubLoop({
    id: "borrower-retention",
    displayName: "Borrower retention",
    description: "Concierge sequences for at-risk borrowers.",
    actAction: "read:platform_metrics",
    metric: "60d-retention-rate",
    unit: "fraction",
    defaultPrediction: 0.85,
    slaThreshold: 0.1,
  }),
  buildStubLoop({
    id: "complaint-resolution",
    displayName: "Complaint resolution",
    description: "Classifies, routes, and resolves complaints.",
    actAction: "read:platform_metrics",
    metric: "resolution-time-hours",
    unit: "hours",
    defaultPrediction: 12,
    slaThreshold: 24,
  }),
  buildStubLoop({
    id: "learning-progress",
    displayName: "Learning progress",
    description: "Recommends and marks mastery on classroom lessons.",
    actAction: "read:platform_metrics",
    metric: "mastery-delta",
    unit: "fraction",
    defaultPrediction: 0.4,
    slaThreshold: 0.2,
  }),
  buildStubLoop({
    id: "community-lending",
    displayName: "Community lending",
    description: "Group health, nudge cadence, admission tuning.",
    actAction: "read:platform_metrics",
    metric: "group-health-score",
    unit: "score",
    defaultPrediction: 0.75,
    slaThreshold: 0.2,
  }),
  buildStubLoop({
    id: "cross-org-pattern-mining",
    displayName: "Cross-org pattern mining",
    description: "Surfaces aggregated, PII-stripped platform patterns.",
    actAction: "read:cross_org_aggregated",
    metric: "patterns-surfaced",
    unit: "count",
    defaultPrediction: 5,
    slaThreshold: 10,
  }),
  buildStubLoop({
    id: "model-drift-watch",
    displayName: "Model drift watch",
    description: "Tracks per-model output drift and queues retrain.",
    actAction: "read:platform_metrics",
    metric: "drift-sigma",
    unit: "sigma",
    defaultPrediction: 0.5,
    slaThreshold: 2,
  }),
]);

const BY_ID: ReadonlyMap<ClosedLoopId, ClosedLoopDefinition> = new Map(
  REGISTRY.map((loop) => [loop.id, loop]),
);

export function listLoops(): ReadonlyArray<ClosedLoopDefinition> {
  return REGISTRY;
}

export function getLoop(id: ClosedLoopId): ClosedLoopDefinition | undefined {
  return BY_ID.get(id);
}

export function isClosedLoopId(value: string): value is ClosedLoopId {
  return BY_ID.has(value as ClosedLoopId);
}
