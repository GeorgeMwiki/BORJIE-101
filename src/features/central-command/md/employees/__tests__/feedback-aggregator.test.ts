/**
 * Tests — Real sentiment-aggregation logic. No mocks.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateAcrossEmployees,
  aggregateForEmployee,
  extractSentimentEvents,
} from "../feedback-aggregator";
import type { Employee, FeedbackTurn, SentimentEvent } from "../types";

const TENANT = "11111111-1111-1111-1111-111111111111";

const ALICE: Employee = Object.freeze({
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  tenantId: TENANT,
  name: "Alice",
  role: "Engineer",
  hireDate: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const BOB: Employee = Object.freeze({
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  tenantId: TENANT,
  name: "Bob",
  role: "Designer",
  hireDate: "2025-09-01T00:00:00.000Z",
  createdAt: "2025-09-01T00:00:00.000Z",
});

function turn(text: string): FeedbackTurn {
  return {
    turnId: "turn-X",
    tenantId: TENANT,
    text,
    recordedAt: "2026-05-17T09:00:00.000Z",
  };
}

let counter = 0;
const idGen = () =>
  `99999999-9999-9999-9999-${String(++counter).padStart(12, "0")}`;

describe("extractSentimentEvents", () => {
  it("emits a positive event when an employee is praised", () => {
    const events = extractSentimentEvents({
      turn: turn("Alice crushed the migration. Outstanding work."),
      employees: [ALICE, BOB],
      idGen,
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.employeeId).toBe(ALICE.id);
    expect(events[0]!.polarity).toBe("positive");
    expect(events[0]!.score).toBeGreaterThan(0);
  });

  it("emits a negative event when an employee is criticized", () => {
    const events = extractSentimentEvents({
      turn: turn("I'm worried about Bob — he's been missing deadlines."),
      employees: [ALICE, BOB],
      idGen,
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.employeeId).toBe(BOB.id);
    expect(events[0]!.polarity).toBe("negative");
    expect(events[0]!.score).toBeLessThan(0);
  });

  it("emits events for multiple employees in one turn", () => {
    const events = extractSentimentEvents({
      turn: turn(
        "Alice did a fantastic job on the proposal. Bob, on the other hand, missed two deadlines.",
      ),
      employees: [ALICE, BOB],
      idGen,
    });
    expect(events.length).toBe(2);
    const byId = new Map(events.map((e) => [e.employeeId, e]));
    expect(byId.get(ALICE.id)!.polarity).toBe("positive");
    expect(byId.get(BOB.id)!.polarity).toBe("negative");
  });

  it("handles negation (does not flip positive into positive)", () => {
    const events = extractSentimentEvents({
      turn: turn("Alice is not great at running standups."),
      employees: [ALICE],
      idGen,
    });
    expect(events).toHaveLength(1);
    // "not great" → negated positive → should not be classified positive
    expect(events[0]!.polarity).not.toBe("positive");
  });

  it("returns empty array when no employees are mentioned", () => {
    const events = extractSentimentEvents({
      turn: turn("We need to upgrade the database next quarter."),
      employees: [ALICE, BOB],
      idGen,
    });
    expect(events).toHaveLength(0);
  });

  it("respects word boundaries (does not match 'Alice' inside 'Alicent')", () => {
    const events = extractSentimentEvents({
      turn: turn("Alicent's review was excellent."),
      employees: [ALICE],
      idGen,
    });
    expect(events).toHaveLength(0);
  });
});

describe("aggregateForEmployee", () => {
  function event(
    polarity: SentimentEvent["polarity"],
    score: number,
    recordedAt: string,
  ): SentimentEvent {
    return Object.freeze({
      id: idGen(),
      tenantId: TENANT,
      employeeId: ALICE.id,
      polarity,
      score,
      evidence: "test",
      originTurnId: "t",
      recordedAt,
    });
  }

  it("classifies as positive when weighted score is high", () => {
    const events = [
      event("positive", 0.8, "2026-05-15T09:00:00.000Z"),
      event("positive", 0.7, "2026-05-16T09:00:00.000Z"),
    ];
    const agg = aggregateForEmployee(
      ALICE.id,
      events,
      new Date("2026-05-17T09:00:00.000Z"),
    );
    expect(agg.classification).toBe("positive");
    expect(agg.sampleSize).toBe(2);
    expect(agg.counts.positive).toBe(2);
  });

  it("classifies as concerning when negative outweighs positive", () => {
    const events = [
      event("negative", -0.8, "2026-05-15T09:00:00.000Z"),
      event("negative", -0.7, "2026-05-16T09:00:00.000Z"),
      event("positive", 0.4, "2026-05-10T09:00:00.000Z"),
    ];
    const agg = aggregateForEmployee(
      ALICE.id,
      events,
      new Date("2026-05-17T09:00:00.000Z"),
    );
    expect(agg.classification).toBe("concerning");
    expect(agg.counts.negative).toBe(2);
  });

  it("weighs recent events more heavily (recency decay)", () => {
    // Old positive (1 year ago) vs recent negative
    const events = [
      event("positive", 0.9, "2025-05-17T09:00:00.000Z"),
      event("negative", -0.7, "2026-05-16T09:00:00.000Z"),
    ];
    const agg = aggregateForEmployee(
      ALICE.id,
      events,
      new Date("2026-05-17T09:00:00.000Z"),
    );
    // The recent negative should dominate.
    expect(agg.weightedScore).toBeLessThan(0);
    expect(agg.classification).toBe("concerning");
  });

  it("returns neutral when there are no events", () => {
    const agg = aggregateForEmployee(
      ALICE.id,
      [],
      new Date("2026-05-17T09:00:00.000Z"),
    );
    expect(agg.classification).toBe("neutral");
    expect(agg.sampleSize).toBe(0);
  });

  it("ignores events for other employees", () => {
    const events = [
      Object.freeze({
        id: idGen(),
        tenantId: TENANT,
        employeeId: BOB.id,
        polarity: "negative" as const,
        score: -0.9,
        evidence: "x",
        originTurnId: "t",
        recordedAt: "2026-05-16T09:00:00.000Z",
      }),
    ];
    const agg = aggregateForEmployee(
      ALICE.id,
      events,
      new Date("2026-05-17T09:00:00.000Z"),
    );
    expect(agg.sampleSize).toBe(0);
  });
});

describe("aggregateAcrossEmployees", () => {
  it("produces one aggregate per mentioned employee", () => {
    const events: SentimentEvent[] = [
      Object.freeze({
        id: idGen(),
        tenantId: TENANT,
        employeeId: ALICE.id,
        polarity: "positive" as const,
        score: 0.6,
        evidence: "",
        originTurnId: "t1",
        recordedAt: "2026-05-16T09:00:00.000Z",
      }),
      Object.freeze({
        id: idGen(),
        tenantId: TENANT,
        employeeId: BOB.id,
        polarity: "negative" as const,
        score: -0.6,
        evidence: "",
        originTurnId: "t1",
        recordedAt: "2026-05-16T09:00:00.000Z",
      }),
    ];
    const aggs = aggregateAcrossEmployees(
      events,
      new Date("2026-05-17T09:00:00.000Z"),
    );
    expect(aggs).toHaveLength(2);
    const byId = new Map(aggs.map((a) => [a.employeeId, a]));
    expect(byId.get(ALICE.id)!.classification).toBe("positive");
    expect(byId.get(BOB.id)!.classification).toBe("concerning");
  });
});
