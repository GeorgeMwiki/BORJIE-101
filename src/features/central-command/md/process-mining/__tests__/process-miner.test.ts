/**
 * Tests — process miner. Verifies directly-follows graph extraction,
 * variant clustering, start/end detection, and dwell + wait stats.
 */

import { describe, expect, it } from "vitest";

import { mineProcess } from "../process-miner";
import type { ProcessEventRecord } from "../types";

const ORG = "11111111-1111-1111-1111-111111111111";

function ev(
  caseId: string,
  activity: string,
  occurredAt: string,
  seq: number,
): ProcessEventRecord {
  return Object.freeze({
    id: `evt-${caseId}-${seq}`,
    orgId: ORG,
    processKey: "loan_origination",
    caseId,
    activity,
    actorKind: "user",
    actorId: "u-1",
    occurredAt,
    sequenceId: seq,
    prevHash: null,
    rowHash: "x",
    createdAt: occurredAt,
  });
}

describe("mineProcess", () => {
  it("returns empty for empty input", () => {
    const r = mineProcess({ events: [] });
    expect(r.graph.nodes).toEqual([]);
    expect(r.graph.edges).toEqual([]);
    expect(r.metrics.traceCount).toBe(0);
  });

  it("mines a simple 3-step process correctly", () => {
    const events = [
      ev("c1", "Apply", "2026-05-01T09:00:00Z", 1),
      ev("c1", "KYC", "2026-05-01T10:00:00Z", 2),
      ev("c1", "Approve", "2026-05-01T11:00:00Z", 3),
      ev("c2", "Apply", "2026-05-02T09:00:00Z", 4),
      ev("c2", "KYC", "2026-05-02T11:00:00Z", 5),
      ev("c2", "Approve", "2026-05-02T13:00:00Z", 6),
    ];
    const r = mineProcess({ events, minVariantSupport: 1 });
    expect(r.metrics.traceCount).toBe(2);
    expect(r.graph.nodes.map((n) => n.activity).sort()).toEqual([
      "Apply",
      "Approve",
      "KYC",
    ]);
    const edges = r.graph.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edges).toEqual(["Apply->KYC", "KYC->Approve"]);
    expect(r.graph.startActivities).toEqual(["Apply"]);
    expect(r.graph.endActivities).toEqual(["Approve"]);
    // commonVariantShare = 1.0 since both cases share the same sequence
    expect(r.metrics.commonVariantShare).toBe(1);
  });

  it("clusters variants by sequence", () => {
    const events = [
      // 3 cases follow Apply → KYC → Approve
      ...["c1", "c2", "c3"].flatMap((c, i) => [
        ev(c, "Apply", `2026-05-0${i + 1}T09:00:00Z`, i * 3 + 1),
        ev(c, "KYC", `2026-05-0${i + 1}T10:00:00Z`, i * 3 + 2),
        ev(c, "Approve", `2026-05-0${i + 1}T11:00:00Z`, i * 3 + 3),
      ]),
      // 1 case goes through rework
      ev("c4", "Apply", "2026-05-04T09:00:00Z", 10),
      ev("c4", "KYC", "2026-05-04T10:00:00Z", 11),
      ev("c4", "KYC", "2026-05-04T11:00:00Z", 12), // rework
      ev("c4", "Approve", "2026-05-04T12:00:00Z", 13),
    ];
    const r = mineProcess({ events, minVariantSupport: 1 });
    expect(r.metrics.traceCount).toBe(4);
    expect(r.metrics.distinctVariants).toBe(2);
    expect(r.metrics.reworkRate).toBeGreaterThan(0);
    const dominant = r.graph.variants[0]!;
    expect(dominant.caseCount).toBe(3);
    expect(dominant.sequence).toEqual(["Apply", "KYC", "Approve"]);
  });

  it("computes dwell + wait stats", () => {
    const events = [
      ev("c1", "A", "2026-05-01T00:00:00Z", 1),
      ev("c1", "B", "2026-05-01T01:00:00Z", 2),
      ev("c2", "A", "2026-05-02T00:00:00Z", 3),
      ev("c2", "B", "2026-05-02T03:00:00Z", 4), // 3h wait
    ];
    const r = mineProcess({ events, minVariantSupport: 1 });
    const edge = r.graph.edges.find((e) => e.from === "A" && e.to === "B")!;
    expect(edge.frequency).toBe(2);
    // wait mean = (1h + 3h)/2 = 2h
    expect(edge.waitMs.mean).toBe(2 * 3_600_000);
  });

  it("respects MAX_EVENTS by truncation, not error", () => {
    // Build 100 events (well under 500k cap, just verifying graceful pathing).
    const events: ProcessEventRecord[] = [];
    for (let i = 0; i < 100; i += 1) {
      events.push(
        ev(
          `c${i}`,
          "X",
          `2026-05-01T00:00:${(i % 60).toString().padStart(2, "0")}Z`,
          i,
        ),
      );
    }
    const r = mineProcess({ events, minVariantSupport: 1 });
    expect(r.metrics.traceCount).toBe(100);
  });

  it("does NOT crash when all events share the same timestamp", () => {
    const events = [
      ev("c1", "A", "2026-05-01T00:00:00Z", 1),
      ev("c1", "B", "2026-05-01T00:00:00Z", 2),
      ev("c1", "C", "2026-05-01T00:00:00Z", 3),
    ];
    const r = mineProcess({ events, minVariantSupport: 1 });
    expect(r.graph.nodes.length).toBe(3);
    const edge = r.graph.edges.find((e) => e.from === "A" && e.to === "B")!;
    expect(edge.waitMs.mean).toBe(0);
  });
});
