/**
 * Auto-Populate — Confidence Gate tests.
 *
 * Pure decision logic. No mocks. Real assertions against the three
 * possible outcomes (auto / confirm / drop) and the rendered prompts.
 */

import { describe, it, expect } from "vitest";
import { gateBatch, gateEntity, renderConfirmPrompt } from "../confidence-gate";
import type { ExtractedEntity } from "../entity-types";

function mk(
  kind: ExtractedEntity["kind"],
  confidence: number,
  displayName = "Foo",
): ExtractedEntity {
  return {
    kind,
    canonicalName: displayName.toLowerCase(),
    displayName,
    confidence,
    sourceSpan: { start: 0, end: displayName.length, text: displayName },
  } as ExtractedEntity;
}

describe("gateEntity", () => {
  it("returns auto_persist when confidence >= default threshold (0.7)", () => {
    const e = mk("customer", 0.85);
    const out = gateEntity(e);
    expect(out.decision).toBe("auto_persist");
  });

  it("returns confirm_needed when between 0.4 and 0.7", () => {
    const e = mk("customer", 0.55);
    const out = gateEntity(e);
    expect(out.decision).toBe("confirm_needed");
  });

  it("returns drop when below 0.4", () => {
    const e = mk("customer", 0.3);
    const out = gateEntity(e);
    expect(out.decision).toBe("drop");
  });

  it("honours custom thresholds", () => {
    const e = mk("customer", 0.6);
    expect(gateEntity(e, { autoThreshold: 0.5 }).decision).toBe("auto_persist");
    expect(gateEntity(e, { autoThreshold: 0.9 }).decision).toBe(
      "confirm_needed",
    );
  });

  it("hard boundary at exactly 0.7 → auto_persist", () => {
    const e = mk("customer", 0.7);
    expect(gateEntity(e).decision).toBe("auto_persist");
  });

  it("hard boundary at exactly 0.4 → confirm_needed", () => {
    const e = mk("customer", 0.4);
    expect(gateEntity(e).decision).toBe("confirm_needed");
  });
});

describe("gateBatch", () => {
  it("partitions a batch into three buckets correctly", () => {
    const batch = [
      mk("customer", 0.95, "High"),
      mk("customer", 0.5, "Mid"),
      mk("customer", 0.2, "Low"),
      mk("product", 0.85, "AlsoHigh"),
    ];
    const result = gateBatch(batch);
    expect(result.autoPersist).toHaveLength(2);
    expect(result.confirmNeeded).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
  });

  it("returns empty buckets for an empty input", () => {
    const result = gateBatch([]);
    expect(result.autoPersist).toHaveLength(0);
    expect(result.confirmNeeded).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
  });
});

describe("renderConfirmPrompt", () => {
  it("renders a friendly prompt for a confirm_needed entity", () => {
    const e = mk("customer", 0.5, "Acme Corp");
    const gated = gateEntity(e);
    const prompt = renderConfirmPrompt(gated);
    expect(prompt).toContain("Acme Corp");
    expect(prompt).toContain("customer");
  });

  it("renders 'team member' for employees", () => {
    const e = mk("employee", 0.5, "Sarah");
    const gated = gateEntity(e);
    expect(renderConfirmPrompt(gated)).toContain("team member");
  });

  it("returns null when the entity is auto_persist", () => {
    const e = mk("customer", 0.9);
    const gated = gateEntity(e);
    expect(renderConfirmPrompt(gated)).toBeNull();
  });

  it("returns null when the entity is dropped", () => {
    const e = mk("customer", 0.1);
    const gated = gateEntity(e);
    expect(renderConfirmPrompt(gated)).toBeNull();
  });

  it("covers every entity kind", () => {
    const kinds: ExtractedEntity["kind"][] = [
      "employee",
      "customer",
      "product",
      "supplier",
      "meeting",
      "decision",
      "feedback",
      "goal",
      "project",
      "risk",
      "opportunity",
    ];
    for (const k of kinds) {
      const gated = gateEntity(mk(k, 0.5, "Sample"));
      const prompt = renderConfirmPrompt(gated);
      expect(prompt).toBeTruthy();
    }
  });
});
