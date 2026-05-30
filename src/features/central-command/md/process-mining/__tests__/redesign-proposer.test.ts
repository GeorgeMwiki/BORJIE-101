/**
 * Tests — redesign proposer. Verifies bottleneck → change mapping +
 * impact estimation + citation passthrough.
 */

import { describe, expect, it } from "vitest";

import { proposeRedesign } from "../redesign-proposer";
import type { Bottleneck, ProcessMapMetrics } from "../types";

const ORG = "11111111-1111-1111-1111-111111111111";
const BASE = "22222222-2222-2222-2222-222222222222";

const metrics: ProcessMapMetrics = {
  traceCount: 100,
  distinctVariants: 4,
  meanCaseDurationMs: 86_400_000,
  medianCaseDurationMs: 60_000_000,
  p95CaseDurationMs: 200_000_000,
  commonVariantShare: 0.6,
  reworkRate: 0.15,
};

describe("proposeRedesign", () => {
  it("returns null on empty bottlenecks", () => {
    expect(
      proposeRedesign({
        orgId: ORG,
        processKey: "loan_origination",
        baseMapId: BASE,
        metrics,
        bottlenecks: [],
        proposerId: "p",
      }),
    ).toBeNull();
  });

  it("maps wait_time → parallelise", () => {
    const r = proposeRedesign({
      orgId: ORG,
      processKey: "loan_origination",
      baseMapId: BASE,
      metrics,
      bottlenecks: [
        {
          kind: "wait_time",
          anchor: { edge: { from: "A", to: "B" } },
          severity: 0.8,
          explanation: "slow handoff",
          evidence: {},
        },
      ],
      proposerId: "junior:process-redesigner",
    });
    expect(r).not.toBeNull();
    expect(r!.changeset.length).toBe(1);
    expect(r!.changeset[0]!.kind).toBe("parallelise");
    expect(r!.changeset[0]!.target).toBe("A→B");
  });

  it("maps rework_loop → introduce_decision", () => {
    const r = proposeRedesign({
      orgId: ORG,
      processKey: "loan_origination",
      baseMapId: BASE,
      metrics,
      bottlenecks: [
        {
          kind: "rework_loop",
          anchor: { node: "KYC" },
          severity: 0.7,
          explanation: "churn",
          evidence: {},
        },
      ],
      proposerId: "p",
    });
    expect(r!.changeset[0]!.kind).toBe("introduce_decision");
    expect(r!.changeset[0]!.target).toBe("KYC");
  });

  it("caps changes at maxChanges + dedups (kind,target) pairs", () => {
    const dup: Bottleneck = {
      kind: "wait_time",
      anchor: { edge: { from: "A", to: "B" } },
      severity: 0.5,
      explanation: "x",
      evidence: {},
    };
    const r = proposeRedesign({
      orgId: ORG,
      processKey: "loan_origination",
      baseMapId: BASE,
      metrics,
      bottlenecks: [dup, dup, dup, dup, dup, dup, dup, dup],
      proposerId: "p",
      maxChanges: 3,
    });
    // Same kind+target → dedups to 1.
    expect(r!.changeset.length).toBe(1);
  });

  it("estimates cycle-time saving capped at 65%", () => {
    const bs: Bottleneck[] = Array.from({ length: 6 }, (_, i) => ({
      kind: "wait_time" as const,
      anchor: { edge: { from: `A${i}`, to: `B${i}` } },
      severity: 1,
      explanation: "x",
      evidence: {},
    }));
    const r = proposeRedesign({
      orgId: ORG,
      processKey: "loan_origination",
      baseMapId: BASE,
      metrics,
      bottlenecks: bs,
      proposerId: "p",
    });
    expect(r!.expectedImpact.cycleTimeSavingPct).toBeLessThanOrEqual(65);
  });

  it("passes citations through", () => {
    const citations = [
      {
        url: "https://example.com/a",
        title: "Title",
        quote: "A relevant pull quote.",
      },
    ];
    const r = proposeRedesign({
      orgId: ORG,
      processKey: "loan_origination",
      baseMapId: BASE,
      metrics,
      bottlenecks: [
        {
          kind: "wait_time",
          anchor: { edge: { from: "A", to: "B" } },
          severity: 0.5,
          explanation: "x",
          evidence: {},
        },
      ],
      proposerId: "p",
      citations,
    });
    expect(r!.citations).toEqual(citations);
  });

  it("adds risk surface for automate_activity changes", () => {
    const r = proposeRedesign({
      orgId: ORG,
      processKey: "loan_origination",
      baseMapId: BASE,
      metrics,
      bottlenecks: [
        {
          kind: "high_variance",
          anchor: { node: "Underwriting" },
          severity: 0.9,
          explanation: "x",
          evidence: {},
        },
      ],
      proposerId: "p",
    });
    expect(r!.expectedImpact.risks).toBeDefined();
    expect(
      r!.expectedImpact.risks!.some((s) => s.includes("manual override")),
    ).toBe(true);
  });
});
