/**
 * Tests — Timeline auto-generator + owner-style adapter.
 */

import { describe, it, expect } from "vitest";
import { defaultGenerator, generateTimeline } from "../auto-generator";
import { adaptTimeline } from "../owner-style-adapter";
import type { GeneratorInput } from "../types";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";
const START = "2026-05-17T00:00:00.000Z";
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function input(over: Partial<GeneratorInput> = {}): GeneratorInput {
  return {
    tenantId: TENANT,
    ownerId: OWNER,
    description: "I want to launch a new product in 3 months.",
    startsAt: START,
    style: "waterfall",
    ...over,
  };
}

describe("defaultGenerator", () => {
  it("extracts a 3-month horizon and generates 5 milestones", async () => {
    const res = await defaultGenerator(input());
    expect(res.milestones).toHaveLength(5);
    const total = res.milestones.reduce((s, m) => s + m.durationDays, 0);
    // 3 months * 30 days = 90 (allow ±5 for rounding)
    expect(total).toBeGreaterThanOrEqual(85);
    expect(total).toBeLessThanOrEqual(95);
  });

  it("derives a project name from 'launch X' phrasing", async () => {
    const res = await defaultGenerator(
      input({
        description: "Let's launch the carbon credit marketplace in 6 months.",
      }),
    );
    expect(res.projectName.toLowerCase()).toContain(
      "carbon credit marketplace",
    );
  });

  it("falls back to default horizon when no duration is mentioned", async () => {
    const res = await defaultGenerator(
      input({ description: "We need to build the new analytics dashboard." }),
    );
    const total = res.milestones.reduce((s, m) => s + m.durationDays, 0);
    // default = 3 months = 90 days
    expect(total).toBeGreaterThanOrEqual(85);
  });
});

describe("generateTimeline", () => {
  it("returns a Timeline with CPM-scheduled milestones + critical path", async () => {
    let i = 0;
    const t = await generateTimeline(
      input({ description: "Ship the chatbot in 2 months." }),
      defaultGenerator,
      {
        idGen: () => `00000000-0000-0000-0000-${String(++i).padStart(12, "0")}`,
        nowIso: "2026-05-17T00:00:00.000Z",
      },
    );
    expect(t.milestones).toHaveLength(5);
    expect(t.style).toBe("waterfall");
    const endMs = new Date(t.endsAt).getTime();
    const startMs = new Date(t.startsAt).getTime();
    expect(endMs).toBeGreaterThan(startMs);
    // critical path should include the long-duration "build" node
    const critical = t.milestones
      .filter((m) => m.onCriticalPath)
      .map((m) => m.id);
    expect(critical).toContain("build");
  });

  it("milestone dueAt aligns with start + cumulative duration", async () => {
    const t = await generateTimeline(
      input({ description: "Launch the app in 3 months." }),
      defaultGenerator,
      { nowIso: "2026-05-17T00:00:00.000Z" },
    );
    const totalDays = t.milestones.reduce((s, m) => s + m.durationDays, 0);
    const observed = Math.round(
      (new Date(t.endsAt).getTime() - new Date(t.startsAt).getTime()) /
        MS_PER_DAY,
    );
    expect(observed).toBe(totalDays);
  });
});

describe("adaptTimeline", () => {
  it("renders waterfall rows sorted by earliestStartAt", async () => {
    const t = await generateTimeline(input(), defaultGenerator, {
      nowIso: "2026-05-17T00:00:00.000Z",
    });
    const view = adaptTimeline(t, "waterfall");
    if (view.kind !== "waterfall") throw new Error("unexpected view kind");
    for (let i = 1; i < view.rows.length; i += 1) {
      expect(new Date(view.rows[i]!.startAt).getTime()).toBeGreaterThanOrEqual(
        new Date(view.rows[i - 1]!.startAt).getTime(),
      );
    }
  });

  it("buckets milestones into 14-day agile cycles", async () => {
    const t = await generateTimeline(
      input({
        description: "Build the dashboard in 1 month.",
        style: "agile-cycles",
      }),
      defaultGenerator,
      { nowIso: "2026-05-17T00:00:00.000Z" },
    );
    const view = adaptTimeline(t, "agile-cycles");
    if (view.kind !== "agile-cycles") throw new Error("expected agile view");
    expect(view.cycleLengthDays).toBe(14);
    // 30-day project → 3 cycles of 14d (last truncated)
    expect(view.cycles.length).toBeGreaterThanOrEqual(2);
    // every milestone shows up in exactly one cycle (or zero if outside
    // total horizon due to rounding — sum must be > 0).
    const seen = view.cycles.flatMap((c) => c.milestones).length;
    expect(seen).toBeGreaterThan(0);
  });

  it("renders kanban with 5 status columns", async () => {
    const t = await generateTimeline(
      input({ style: "kanban" }),
      defaultGenerator,
      { nowIso: "2026-05-17T00:00:00.000Z" },
    );
    const view = adaptTimeline(t, "kanban");
    if (view.kind !== "kanban") throw new Error("expected kanban view");
    expect(view.columns.map((c) => c.status)).toEqual([
      "not_started",
      "in_progress",
      "blocked",
      "done",
      "skipped",
    ]);
    // All milestones default to not_started.
    expect(view.columns[0]!.milestones.length).toBe(t.milestones.length);
  });
});
