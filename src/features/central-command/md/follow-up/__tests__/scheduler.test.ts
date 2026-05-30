/**
 * Tests — Follow-Up scheduler + escalation.
 *
 * Real scheduling logic; no mocks.
 */

import { describe, it, expect } from "vitest";
import { runFollowUpScheduler, partitionByBucket } from "../scheduler";
import { applyEscalation, computeEscalation } from "../escalation";
import type { FollowUp } from "../types";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";

function fu(over: Partial<FollowUp> = {}): FollowUp {
  return Object.freeze({
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: TENANT,
    ownerId: OWNER,
    subject: "Send recap",
    dueAt: "2026-05-20T09:00:00.000Z",
    snoozedUntil: null,
    status: "pending",
    originTurnId: "turn-1",
    escalationLevel: 0,
    priority: "normal",
    createdAt: "2026-05-17T09:00:00.000Z",
    counterparty: null,
    metadata: undefined,
    ...over,
  } as FollowUp);
}

describe("runFollowUpScheduler", () => {
  it("marks a pending follow-up as 'due' when dueAt has elapsed", () => {
    const fus = [fu({ dueAt: "2026-05-17T08:00:00.000Z" })];
    const out = runFollowUpScheduler({
      now: new Date("2026-05-17T09:00:00.000Z"),
      pending: fus,
    });
    expect(out.becameDue).toHaveLength(1);
    expect(out.becameDue[0]!.status).toBe("due");
    expect(out.escalated).toHaveLength(0);
  });

  it("keeps a snoozed follow-up out of all action buckets", () => {
    const fus = [
      fu({
        dueAt: "2026-05-17T08:00:00.000Z",
        snoozedUntil: "2026-05-18T00:00:00.000Z",
      }),
    ];
    const out = runFollowUpScheduler({
      now: new Date("2026-05-17T09:00:00.000Z"),
      pending: fus,
    });
    expect(out.stillSnoozed).toHaveLength(1);
    expect(out.becameDue).toHaveLength(0);
  });

  it("does not surface a not-yet-due follow-up", () => {
    const fus = [fu({ dueAt: "2026-06-01T09:00:00.000Z" })];
    const out = runFollowUpScheduler({
      now: new Date("2026-05-17T09:00:00.000Z"),
      pending: fus,
    });
    expect(out.becameDue).toHaveLength(0);
    expect(out.escalated).toHaveLength(0);
  });

  it("emits same output for same inputs (determinism)", () => {
    const fus = [fu({ dueAt: "2026-05-17T08:00:00.000Z" })];
    const a = runFollowUpScheduler({
      now: new Date("2026-05-17T09:00:00.000Z"),
      pending: fus,
    });
    const b = runFollowUpScheduler({
      now: new Date("2026-05-17T09:00:00.000Z"),
      pending: fus,
    });
    expect(a).toEqual(b);
  });

  it("escalates when overdue by ≥25% of lead time", () => {
    // Created 2026-05-10, due 2026-05-20 → 10 day lead. Now = 2026-05-23
    // → 3 days late = 30% overdue → level 1.
    const fus = [
      fu({
        createdAt: "2026-05-10T09:00:00.000Z",
        dueAt: "2026-05-20T09:00:00.000Z",
        status: "pending",
      }),
    ];
    const out = runFollowUpScheduler({
      now: new Date("2026-05-23T09:00:00.000Z"),
      pending: fus,
    });
    expect(out.escalated).toHaveLength(1);
    expect(out.escalated[0]!.escalationLevel).toBe(1);
    expect(out.escalated[0]!.priority).toBe("high");
    expect(out.escalated[0]!.status).toBe("escalated");
  });

  it("walks priority up the ladder as overdue ratio grows", () => {
    const base = fu({
      createdAt: "2026-05-10T09:00:00.000Z",
      dueAt: "2026-05-20T09:00:00.000Z",
    });
    // 8 days late = 80% overdue → level 2 → priority +2 (normal → urgent)
    const r2 = computeEscalation(base, new Date("2026-05-28T09:00:00.000Z"));
    expect(r2.level).toBe(2);
    expect(r2.priority).toBe("urgent");

    // 16 days late = 160% overdue → level 3 → priority capped at urgent
    const r3 = computeEscalation(base, new Date("2026-06-05T09:00:00.000Z"));
    expect(r3.level).toBe(3);
    expect(r3.priority).toBe("urgent");
  });

  it("does not mutate the input follow-up when applying escalation", () => {
    const original = fu({
      createdAt: "2026-05-10T09:00:00.000Z",
      dueAt: "2026-05-20T09:00:00.000Z",
    });
    const r = computeEscalation(original, new Date("2026-05-25T09:00:00.000Z"));
    const next = applyEscalation(original, r);
    expect(next).not.toBe(original);
    expect(original.escalationLevel).toBe(0);
    expect(next.escalationLevel).toBeGreaterThanOrEqual(1);
  });

  it("partitions follow-ups into upcoming / overdue buckets", () => {
    const now = new Date("2026-05-17T12:00:00.000Z");
    const fus = [
      fu({
        id: "00000000-0000-0000-0000-000000000a01",
        dueAt: "2026-05-15T12:00:00.000Z",
      }), // overdue
      fu({
        id: "00000000-0000-0000-0000-000000000a02",
        dueAt: "2026-05-17T12:00:00.000Z",
      }), // dueNow
      fu({
        id: "00000000-0000-0000-0000-000000000a03",
        dueAt: "2026-05-18T08:00:00.000Z",
      }), // dueSoon
      fu({
        id: "00000000-0000-0000-0000-000000000a04",
        dueAt: "2026-06-01T09:00:00.000Z",
      }), // upcoming
    ];
    const out = partitionByBucket(fus, now);
    expect(out.overdue).toHaveLength(1);
    expect(out.dueNow).toHaveLength(1);
    expect(out.dueSoon).toHaveLength(1);
    expect(out.upcoming).toHaveLength(1);
  });
});
