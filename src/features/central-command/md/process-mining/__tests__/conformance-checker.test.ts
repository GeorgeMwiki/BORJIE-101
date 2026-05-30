/**
 * Tests — conformance checker. Verifies token-replay-style fitness +
 * unknown-activity detection + start/end bonuses.
 */

import { describe, expect, it } from "vitest";

import { checkConformance } from "../conformance-checker";
import type { ProcessMapGraph } from "../types";

const graph: ProcessMapGraph = Object.freeze({
  nodes: Object.freeze([
    {
      activity: "Apply",
      occurrences: 10,
      durationMs: { mean: 0, median: 0, p95: 0 },
    },
    {
      activity: "KYC",
      occurrences: 10,
      durationMs: { mean: 0, median: 0, p95: 0 },
    },
    {
      activity: "Approve",
      occurrences: 10,
      durationMs: { mean: 0, median: 0, p95: 0 },
    },
  ]),
  edges: Object.freeze([
    {
      from: "Apply",
      to: "KYC",
      frequency: 10,
      waitMs: { mean: 0, median: 0, p95: 0 },
    },
    {
      from: "KYC",
      to: "Approve",
      frequency: 10,
      waitMs: { mean: 0, median: 0, p95: 0 },
    },
  ]),
  variants: Object.freeze([]),
  startActivities: Object.freeze(["Apply"]),
  endActivities: Object.freeze(["Approve"]),
});

describe("checkConformance", () => {
  it("empty input → fitness 0", () => {
    const r = checkConformance(graph, []);
    expect(r.aggregateFitness).toBe(0);
  });

  it("perfect trace gets fitness 1.0", () => {
    const r = checkConformance(graph, [
      { caseId: "c1", sequence: ["Apply", "KYC", "Approve"] },
    ]);
    expect(r.aggregateFitness).toBe(1);
    expect(r.perTrace[0]!.matchedMoves).toBe(4); // 2 edges + start + end
    expect(r.perTrace[0]!.misalignedMoves).toBe(0);
  });

  it("missing edge contributes a misaligned move", () => {
    const r = checkConformance(graph, [
      { caseId: "c1", sequence: ["Apply", "Approve"] }, // skipped KYC
    ]);
    expect(r.perTrace[0]!.misalignedMoves).toBe(1);
    expect(r.perTrace[0]!.missingEdges).toEqual([
      { from: "Apply", to: "Approve" },
    ]);
  });

  it("wrong start activity penalises fitness", () => {
    const r = checkConformance(graph, [
      { caseId: "c1", sequence: ["KYC", "Approve"] },
    ]);
    // start mismatch (-1), end match (+1), edge KYC->Approve match (+1) = 2/3
    expect(r.perTrace[0]!.matchedMoves).toBe(2);
    expect(r.perTrace[0]!.misalignedMoves).toBe(1);
  });

  it("introduces unknown activities into the unknownActivities list", () => {
    const r = checkConformance(graph, [
      { caseId: "c1", sequence: ["Apply", "ManualReview", "Approve"] },
    ]);
    expect(r.unknownActivities).toEqual(["ManualReview"]);
  });

  it("aggregateFitness averages across traces correctly", () => {
    const r = checkConformance(graph, [
      { caseId: "c1", sequence: ["Apply", "KYC", "Approve"] }, // perfect
      { caseId: "c2", sequence: ["Apply", "Approve"] }, // 1 misaligned
    ]);
    expect(r.aggregateFitness).toBeGreaterThan(0.7);
    expect(r.aggregateFitness).toBeLessThan(1);
  });
});
