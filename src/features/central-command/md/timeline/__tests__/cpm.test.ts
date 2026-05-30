/**
 * Tests — Real CPM scheduling. No mocks.
 *
 * Validates earliest-start propagation, critical-path detection,
 * cycle rejection, and date arithmetic.
 */

import { describe, it, expect } from "vitest";
import { runCpm } from "../cpm";

const START = "2026-05-17T00:00:00.000Z";
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY,
  );
}

describe("runCpm", () => {
  it("schedules a linear A → B → C chain correctly", () => {
    const out = runCpm({
      startsAt: START,
      milestones: [
        { id: "A", label: "A", durationDays: 3, dependencies: [] },
        { id: "B", label: "B", durationDays: 4, dependencies: ["A"] },
        { id: "C", label: "C", durationDays: 2, dependencies: ["B"] },
      ],
    });
    expect(out.totalDurationDays).toBe(9);
    expect(daysBetween(START, out.endsAt)).toBe(9);
    expect(out.criticalPath).toEqual(["A", "B", "C"]);
  });

  it("identifies the critical path through a diamond DAG", () => {
    //          B (5d)
    //        /        \
    //   A (1d)         D (1d)
    //        \        /
    //          C (2d)
    // Critical path: A → B → D (1 + 5 + 1 = 7d), C has slack of 3.
    const out = runCpm({
      startsAt: START,
      milestones: [
        { id: "A", label: "A", durationDays: 1, dependencies: [] },
        { id: "B", label: "B", durationDays: 5, dependencies: ["A"] },
        { id: "C", label: "C", durationDays: 2, dependencies: ["A"] },
        { id: "D", label: "D", durationDays: 1, dependencies: ["B", "C"] },
      ],
    });
    expect(out.totalDurationDays).toBe(7);
    expect(out.criticalPath).toEqual(["A", "B", "D"]);
    const cById = new Map(out.milestones.map((m) => [m.id, m]));
    expect(cById.get("C")!.onCriticalPath).toBe(false);
    expect(cById.get("B")!.onCriticalPath).toBe(true);
  });

  it("propagates earliestStartAt correctly through dependencies", () => {
    const out = runCpm({
      startsAt: START,
      milestones: [
        { id: "A", label: "A", durationDays: 2, dependencies: [] },
        { id: "B", label: "B", durationDays: 3, dependencies: ["A"] },
      ],
    });
    const a = out.milestones.find((m) => m.id === "A")!;
    const b = out.milestones.find((m) => m.id === "B")!;
    expect(a.earliestStartAt).toBe(START);
    expect(daysBetween(START, a.dueAt!)).toBe(2);
    expect(daysBetween(START, b.earliestStartAt!)).toBe(2);
    expect(daysBetween(START, b.dueAt!)).toBe(5);
  });

  it("throws on a cycle", () => {
    expect(() =>
      runCpm({
        startsAt: START,
        milestones: [
          { id: "A", label: "A", durationDays: 1, dependencies: ["B"] },
          { id: "B", label: "B", durationDays: 1, dependencies: ["A"] },
        ],
      }),
    ).toThrowError(/cycle/);
  });

  it("throws on an unknown dependency id", () => {
    expect(() =>
      runCpm({
        startsAt: START,
        milestones: [
          { id: "A", label: "A", durationDays: 1, dependencies: ["MISSING"] },
        ],
      }),
    ).toThrowError(/unknown dependency/);
  });

  it("is deterministic for parallel branches (stable ordering)", () => {
    const inp = {
      startsAt: START,
      milestones: [
        { id: "A", label: "A", durationDays: 1, dependencies: [] },
        { id: "B", label: "B", durationDays: 1, dependencies: [] },
        { id: "C", label: "C", durationDays: 1, dependencies: ["A", "B"] },
      ],
    };
    const out1 = runCpm(inp);
    const out2 = runCpm(inp);
    expect(out1.milestones.map((m) => m.id)).toEqual(
      out2.milestones.map((m) => m.id),
    );
    expect(out1.criticalPath).toEqual(out2.criticalPath);
  });

  it("handles a single-node project", () => {
    const out = runCpm({
      startsAt: START,
      milestones: [
        { id: "only", label: "only", durationDays: 7, dependencies: [] },
      ],
    });
    expect(out.totalDurationDays).toBe(7);
    expect(out.criticalPath).toEqual(["only"]);
  });

  it("handles zero-duration milestones (gates)", () => {
    const out = runCpm({
      startsAt: START,
      milestones: [
        { id: "gate", label: "gate", durationDays: 0, dependencies: [] },
        { id: "work", label: "work", durationDays: 5, dependencies: ["gate"] },
      ],
    });
    expect(out.totalDurationDays).toBe(5);
    expect(out.criticalPath).toEqual(["gate", "work"]);
  });

  it("rejects empty input", () => {
    expect(() => runCpm({ startsAt: START, milestones: [] })).toThrow();
  });
});
