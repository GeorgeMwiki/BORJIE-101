/**
 * Tests — Follow-Up extractor (real extraction, no mocks).
 */

import { describe, it, expect } from "vitest";
import { defaultExtractor } from "../extractor";
import type { ExtractorInput } from "../types";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";

// Sunday 2026-05-17 09:00 UTC.
const NOW = "2026-05-17T09:00:00.000Z";

function makeInput(text: string): ExtractorInput {
  return {
    turnId: "turn-1",
    tenantId: TENANT,
    ownerId: OWNER,
    text,
    now: NOW,
  };
}

describe("defaultExtractor", () => {
  it("extracts an 'I'll get back to you Tuesday' commitment with next Tuesday's date", async () => {
    const input = makeInput(
      "Sure, I'll get back to you Tuesday with the numbers.",
    );
    const out = await defaultExtractor(input);
    expect(out).toHaveLength(1);
    const c = out[0]!;
    // 2026-05-19 is the Tuesday after Sunday 2026-05-17.
    expect(c.dueAt.startsWith("2026-05-19")).toBe(true);
    expect(c.priority).toBe("normal");
    expect(c.confidence).toBeGreaterThan(0.5);
  });

  it("treats 'next Tuesday' as the WEEK-AFTER Tuesday", async () => {
    const out = await defaultExtractor(
      makeInput("Let's review pricing next Tuesday."),
    );
    expect(out).toHaveLength(1);
    // 7 days after this-Tuesday = 2026-05-26
    expect(out[0]!.dueAt.startsWith("2026-05-26")).toBe(true);
  });

  it("resolves 'in 2 weeks' relative to now", async () => {
    const out = await defaultExtractor(
      makeInput("I'll circle back in 2 weeks."),
    );
    expect(out).toHaveLength(1);
    // 2026-05-17 + 14 days = 2026-05-31
    expect(out[0]!.dueAt.startsWith("2026-05-31")).toBe(true);
  });

  it("resolves 'tomorrow morning' to 09:00 UTC the next day", async () => {
    const out = await defaultExtractor(
      makeInput("I'll send the deck tomorrow morning."),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.dueAt).toBe("2026-05-18T09:00:00.000Z");
  });

  it("escalates priority when 'urgent' is present", async () => {
    const out = await defaultExtractor(
      makeInput("I'll get back to you tomorrow — urgent."),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.priority).toBe("urgent");
  });

  it("returns empty array when no commitment is present", async () => {
    const out = await defaultExtractor(
      makeInput("Just thinking out loud here."),
    );
    expect(out).toHaveLength(0);
  });

  it("captures multiple commitments in one paragraph", async () => {
    const out = await defaultExtractor(
      makeInput(
        "I'll send the contract tomorrow. We'll review pricing next month.",
      ),
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    const labels = out.map((o) => o.dueAt.slice(0, 10));
    expect(labels).toContain("2026-05-18"); // tomorrow
    // 30 days later → 2026-06-16
    expect(labels.some((l) => l.startsWith("2026-06"))).toBe(true);
  });

  it("ignores sentences without temporal anchors", async () => {
    const out = await defaultExtractor(
      makeInput("I'll think about it. We'll see."),
    );
    expect(out).toHaveLength(0);
  });

  it("is deterministic: same inputs → same outputs", async () => {
    const input = makeInput("I'll follow up Friday with details.");
    const a = await defaultExtractor(input);
    const b = await defaultExtractor(input);
    expect(a).toEqual(b);
  });

  it("evidence captures the source sentence", async () => {
    const out = await defaultExtractor(
      makeInput("Got it. I'll send a recap tomorrow."),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.evidence.toLowerCase()).toContain("send a recap tomorrow");
  });
});
