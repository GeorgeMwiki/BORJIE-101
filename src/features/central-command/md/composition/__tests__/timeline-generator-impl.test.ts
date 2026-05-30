/**
 * Tests — concrete TimelineGenerator. Verifies that the orchestrator's
 * `MdTimelineRequest` is correctly translated into runCpm input + the
 * critical path / slack flags survive the round-trip.
 */

import { describe, expect, it } from "vitest";

import { concreteTimelineGenerator } from "../timeline-generator-impl";

const ANCHOR = new Date("2026-06-01T00:00:00Z").getTime();

describe("concreteTimelineGenerator", () => {
  it("returns [] for empty action list", async () => {
    const out = await concreteTimelineGenerator({
      actions: [],
      startMs: ANCHOR,
    });
    expect(out).toEqual([]);
  });

  it("schedules a 3-step DAG with the correct critical path", async () => {
    const out = await concreteTimelineGenerator({
      actions: [
        { id: "a", title: "A", effortPersonDays: 2 },
        { id: "b", title: "B", effortPersonDays: 5, dependsOn: ["a"] },
        { id: "c", title: "C", effortPersonDays: 3, dependsOn: ["a"] },
      ],
      startMs: ANCHOR,
    });
    expect(out.length).toBe(3);
    const map = new Map(out.map((m) => [m.id, m] as const));
    const a = map.get("a")!;
    const b = map.get("b")!;
    const c = map.get("c")!;
    // a starts at anchor.
    expect(a.startMs).toBe(ANCHOR);
    // b starts after a ends → ANCHOR + 2 days.
    expect(b.startMs).toBe(ANCHOR + 2 * 86_400_000);
    expect(c.startMs).toBe(ANCHOR + 2 * 86_400_000);
    // Critical path: a → b (5 > 3).
    expect(a.onCriticalPath).toBe(true);
    expect(b.onCriticalPath).toBe(true);
    expect(c.onCriticalPath).toBe(false);
    // c has slack since b dominates.
    expect(c.slackDays).toBeGreaterThan(0);
  });

  it("returns [] when a dependency is missing (graceful fallback)", async () => {
    const out = await concreteTimelineGenerator({
      actions: [
        { id: "a", title: "A", effortPersonDays: 1, dependsOn: ["dangling"] },
      ],
      startMs: ANCHOR,
    });
    expect(out).toEqual([]);
  });

  it("rounds fractional effort up to ≥ 1 day", async () => {
    const out = await concreteTimelineGenerator({
      actions: [{ id: "a", title: "A", effortPersonDays: 0.3 }],
      startMs: ANCHOR,
    });
    expect(out.length).toBe(1);
    expect(out[0]!.endMs - out[0]!.startMs).toBe(1 * 86_400_000);
  });
});
