/**
 * MD core - event type tests.
 *
 * Zod schemas must accept the canonical shapes and reject malformed input.
 */

import { describe, it, expect } from "vitest";

import {
  MdEventSchema,
  MdObservationSchema,
  MdProposalSchema,
  MD_EVENT_KINDS,
  isMdEventKind,
  parseMdEvent,
} from "../types";

describe("MdEvent schemas", () => {
  it("accepts a well-formed md.observation", () => {
    const evt = MdObservationSchema.parse({
      kind: "md.observation",
      eventId: "evt-1",
      ts: 1700000000000,
      severity: "info",
      summary: "Cash $120k; 3 agenda items.",
      citations: [{ field: "finance.cashUsd", valueSummary: "$120,000" }],
    });
    expect(evt.kind).toBe("md.observation");
    expect(evt.citations.length).toBe(1);
  });

  it("rejects an md.observation with missing summary", () => {
    expect(() =>
      MdObservationSchema.parse({
        kind: "md.observation",
        eventId: "evt-1",
        ts: 1,
        severity: "info",
        citations: [],
      }),
    ).toThrow();
  });

  it("rejects an md.proposal with priorityScore out of range", () => {
    expect(() =>
      MdProposalSchema.parse({
        kind: "md.proposal",
        eventId: "evt-2",
        ts: 1,
        proposalId: "p-1",
        title: "Call top customer",
        rationale: "Pipeline stalled",
        autonomyLevel: "recommend",
        requiresApproval: false,
        priorityScore: 99_999,
        framework: "ICE",
        citations: [],
      }),
    ).toThrow();
  });

  it("discriminates union by `kind`", () => {
    const obs = MdEventSchema.parse({
      kind: "md.observation",
      eventId: "x",
      ts: 0,
      severity: "watch",
      summary: "ok",
      citations: [],
    });
    expect(obs.kind).toBe("md.observation");

    const proposal = MdEventSchema.parse({
      kind: "md.proposal",
      eventId: "y",
      ts: 0,
      proposalId: "p",
      title: "do thing",
      rationale: "because",
      autonomyLevel: "suggest",
      requiresApproval: false,
      priorityScore: 1,
      framework: "RICE",
      citations: [],
    });
    expect(proposal.kind).toBe("md.proposal");
  });

  it("enumerates exactly 8 event kinds (7 typed + md.error)", () => {
    expect(MD_EVENT_KINDS.length).toBe(8);
    expect(MD_EVENT_KINDS).toContain("md.observation");
    expect(MD_EVENT_KINDS).toContain("md.assessment");
    expect(MD_EVENT_KINDS).toContain("md.proposal");
    expect(MD_EVENT_KINDS).toContain("md.action");
    expect(MD_EVENT_KINDS).toContain("md.follow-up");
    expect(MD_EVENT_KINDS).toContain("md.style-update");
    expect(MD_EVENT_KINDS).toContain("md.assistant_text");
    expect(MD_EVENT_KINDS).toContain("md.error");
  });

  it("parses md.error as a typed variant", () => {
    const evt = MdEventSchema.parse({
      kind: "md.error",
      message: "Upstream timed out.",
    });
    expect(evt.kind).toBe("md.error");
    if (evt.kind === "md.error") {
      expect(evt.message).toContain("timed out");
    }
  });

  it("guards event kinds", () => {
    expect(isMdEventKind("md.observation")).toBe(true);
    expect(isMdEventKind("md.assistant_text")).toBe(true);
    expect(isMdEventKind("nope")).toBe(false);
  });

  it("parses md.assistant_text as a typed variant", () => {
    const evt = MdEventSchema.parse({
      kind: "md.assistant_text",
      text: "All systems normal — no urgent moves today.",
      traceId: "trace-1",
    });
    expect(evt.kind).toBe("md.assistant_text");
    if (evt.kind === "md.assistant_text") {
      // Discriminated narrowing: `text` and `traceId` are typed.
      expect(evt.text).toContain("systems");
      expect(evt.traceId).toBe("trace-1");
    }
  });

  it("requires non-empty text on md.assistant_text", () => {
    expect(() =>
      MdEventSchema.parse({ kind: "md.assistant_text", text: "" }),
    ).toThrow();
  });

  it("parseMdEvent throws on garbage", () => {
    expect(() => parseMdEvent({ foo: "bar" })).toThrow();
  });
});
