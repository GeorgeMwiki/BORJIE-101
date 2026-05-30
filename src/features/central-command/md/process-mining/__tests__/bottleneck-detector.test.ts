/**
 * Tests — bottleneck detector. Verifies each of the 5 bottleneck
 * kinds fires + severity ordering.
 */

import { describe, expect, it } from "vitest";

import { detectBottlenecks } from "../bottleneck-detector";
import type { ProcessMapGraph, ProcessMapMetrics } from "../types";

const baseMetrics: ProcessMapMetrics = {
  traceCount: 50,
  distinctVariants: 3,
  meanCaseDurationMs: 100_000,
  medianCaseDurationMs: 90_000,
  p95CaseDurationMs: 250_000,
  commonVariantShare: 0.7,
  reworkRate: 0.1,
};

function graph(
  nodes: ProcessMapGraph["nodes"],
  edges: ProcessMapGraph["edges"],
): ProcessMapGraph {
  return Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    variants: [],
    startActivities: [],
    endActivities: [],
  });
}

describe("detectBottlenecks", () => {
  it("returns [] for empty input", () => {
    expect(
      detectBottlenecks({
        graph: graph([], []),
        metrics: { ...baseMetrics, traceCount: 0 },
      }),
    ).toEqual([]);
  });

  it("flags wait_time when an edge p95 is ≥ 2× the median edge wait", () => {
    const g = graph(
      [
        {
          activity: "A",
          occurrences: 50,
          durationMs: { mean: 1000, median: 1000, p95: 1500 },
        },
        {
          activity: "B",
          occurrences: 50,
          durationMs: { mean: 1000, median: 1000, p95: 1500 },
        },
        {
          activity: "C",
          occurrences: 50,
          durationMs: { mean: 1000, median: 1000, p95: 1500 },
        },
      ],
      [
        {
          from: "A",
          to: "B",
          frequency: 50,
          waitMs: { mean: 1000, median: 1000, p95: 1500 },
        },
        {
          from: "B",
          to: "C",
          frequency: 50,
          waitMs: { mean: 100_000, median: 100_000, p95: 200_000 },
        },
      ],
    );
    const out = detectBottlenecks({ graph: g, metrics: baseMetrics });
    const w = out.find((b) => b.kind === "wait_time");
    expect(w).toBeDefined();
    expect(w!.anchor).toEqual({ edge: { from: "B", to: "C" } });
  });

  it("flags self-loop rework", () => {
    const g = graph(
      [
        {
          activity: "KYC",
          occurrences: 30,
          durationMs: { mean: 1000, median: 1000, p95: 1500 },
        },
      ],
      [
        {
          from: "KYC",
          to: "KYC",
          frequency: 5,
          waitMs: { mean: 1000, median: 1000, p95: 1500 },
        },
      ],
    );
    const out = detectBottlenecks({ graph: g, metrics: baseMetrics });
    const r = out.find((b) => b.kind === "rework_loop");
    expect(r).toBeDefined();
  });

  it("flags A↔B bouncing as rework", () => {
    const g = graph(
      [
        {
          activity: "A",
          occurrences: 10,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
        {
          activity: "B",
          occurrences: 10,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
      ],
      [
        {
          from: "A",
          to: "B",
          frequency: 5,
          waitMs: { mean: 1, median: 1, p95: 1 },
        },
        {
          from: "B",
          to: "A",
          frequency: 5,
          waitMs: { mean: 1, median: 1, p95: 1 },
        },
      ],
    );
    const out = detectBottlenecks({ graph: g, metrics: baseMetrics });
    expect(out.some((b) => b.kind === "rework_loop")).toBe(true);
  });

  it("flags parallel_gap when inbound waits diverge >= 3x", () => {
    const g = graph(
      [
        {
          activity: "A",
          occurrences: 10,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
        {
          activity: "B",
          occurrences: 10,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
        {
          activity: "C",
          occurrences: 10,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
      ],
      [
        {
          from: "A",
          to: "C",
          frequency: 10,
          waitMs: { mean: 1000, median: 1000, p95: 1000 },
        },
        {
          from: "B",
          to: "C",
          frequency: 10,
          waitMs: { mean: 5000, median: 5000, p95: 5000 },
        },
      ],
    );
    const out = detectBottlenecks({ graph: g, metrics: baseMetrics });
    expect(out.some((b) => b.kind === "parallel_gap")).toBe(true);
  });

  it("flags low_throughput when a node touches <10% of cases", () => {
    const g = graph(
      [
        {
          activity: "A",
          occurrences: 50,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
        {
          activity: "Niche",
          occurrences: 2,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
      ],
      [],
    );
    const out = detectBottlenecks({ graph: g, metrics: baseMetrics });
    expect(out.some((b) => b.kind === "low_throughput")).toBe(true);
  });

  it("flags high_variance when p95/mean dwell ratio is >= 4", () => {
    const g = graph(
      [
        {
          activity: "Manual",
          occurrences: 50,
          durationMs: { mean: 1000, median: 1200, p95: 8000 }, // 8x
        },
      ],
      [],
    );
    const out = detectBottlenecks({ graph: g, metrics: baseMetrics });
    expect(out.some((b) => b.kind === "high_variance")).toBe(true);
  });

  it("sorts by severity descending", () => {
    const g = graph(
      [
        {
          activity: "X",
          occurrences: 50,
          durationMs: { mean: 1000, median: 1000, p95: 20_000 },
        },
        {
          activity: "Y",
          occurrences: 1,
          durationMs: { mean: 1, median: 1, p95: 1 },
        },
      ],
      [],
    );
    const out = detectBottlenecks({ graph: g, metrics: baseMetrics });
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i - 1]!.severity).toBeGreaterThanOrEqual(out[i]!.severity);
    }
  });
});
