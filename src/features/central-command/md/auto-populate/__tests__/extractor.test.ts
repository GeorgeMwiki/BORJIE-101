/**
 * Auto-Populate — Extractor parser tests.
 *
 * We test the pure parser path with realistic LLM-style fixture strings,
 * including malformed responses we have actually observed in the wild
 * (markdown fences, leading prose, trailing punctuation).
 */

import { describe, it, expect } from "vitest";
import { parseEntitiesFromRaw } from "../extractor";

describe("parseEntitiesFromRaw", () => {
  it("parses a clean JSON array with one customer", () => {
    const turn = "We just signed Acme Corp for $50k ARR.";
    const raw = JSON.stringify([
      {
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme Corp",
        confidence: 0.95,
        sourceSpan: { start: 15, end: 24, text: "Acme Corp" },
        arrUsd: 50000,
        status: "active",
      },
    ]);
    const result = parseEntitiesFromRaw(raw, turn);
    expect(result.parseError).toBeNull();
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.kind).toBe("customer");
  });

  it("extracts a JSON array wrapped in markdown fence + prose", () => {
    const turn = "Sarah joined us as VP Engineering.";
    const raw = [
      "Here's what I extracted:",
      "```json",
      JSON.stringify([
        {
          kind: "employee",
          canonicalName: "sarah",
          displayName: "Sarah",
          confidence: 0.9,
          sourceSpan: { start: 0, end: 5, text: "Sarah" },
          role: "VP Engineering",
          isNewHire: true,
        },
      ]),
      "```",
    ].join("\n");
    const result = parseEntitiesFromRaw(raw, turn);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.kind).toBe("employee");
  });

  it("parses multiple entity kinds in a single turn", () => {
    const turn =
      "Met with our supplier Bolt Logistics, top SKU is X-200, NPS jumped 12 pts.";
    const raw = JSON.stringify([
      {
        kind: "supplier",
        canonicalName: "bolt logistics",
        displayName: "Bolt Logistics",
        confidence: 0.88,
        sourceSpan: { start: 23, end: 38, text: "Bolt Logistics" },
        criticality: "medium",
      },
      {
        kind: "product",
        canonicalName: "x 200",
        displayName: "X-200",
        confidence: 0.85,
        sourceSpan: { start: 50, end: 55, text: "X-200" },
        isTopSeller: true,
      },
      {
        kind: "feedback",
        canonicalName: "nps jumped 12 pts",
        displayName: "NPS jumped 12 pts",
        confidence: 0.75,
        sourceSpan: { start: 56, end: 73, text: "NPS jumped 12 pts" },
        sentiment: "positive",
        topic: "customer satisfaction",
      },
    ]);
    const result = parseEntitiesFromRaw(raw, turn);
    expect(result.entities).toHaveLength(3);
    const kinds = result.entities.map((e) => e.kind).sort();
    expect(kinds).toEqual(["feedback", "product", "supplier"]);
  });

  it("returns parseError when no array is present", () => {
    const result = parseEntitiesFromRaw(
      "I have no idea what to extract.",
      "hi",
    );
    expect(result.entities).toHaveLength(0);
    expect(result.parseError).toBe("no JSON array found in response");
  });

  it("returns parseError on invalid JSON", () => {
    const result = parseEntitiesFromRaw("[not, valid, json", "hi");
    expect(result.entities).toHaveLength(0);
    expect(result.parseError).toContain("JSON.parse failed");
  });

  it("drops malformed entities but keeps valid ones", () => {
    const turn = "We hired Bob and our top SKU is Y-1.";
    const raw = JSON.stringify([
      // Valid
      {
        kind: "employee",
        canonicalName: "bob",
        displayName: "Bob",
        confidence: 0.9,
        sourceSpan: { start: 9, end: 12, text: "Bob" },
      },
      // Malformed (no kind)
      {
        canonicalName: "y 1",
        displayName: "Y-1",
        confidence: 0.85,
      },
      // Invalid (unknown kind)
      {
        kind: "alien",
        canonicalName: "blob",
        displayName: "Blob",
        confidence: 0.5,
        sourceSpan: { start: 0, end: 4, text: "Blob" },
      },
    ]);
    const result = parseEntitiesFromRaw(raw, turn);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.kind).toBe("employee");
  });

  it("derives canonicalName when LLM forgets to emit it", () => {
    const turn = "Adding Globex Inc. to our pipeline.";
    const raw = JSON.stringify([
      {
        kind: "customer",
        displayName: "Globex Inc.",
        confidence: 0.8,
        sourceSpan: { start: 7, end: 18, text: "Globex Inc." },
      },
    ]);
    const result = parseEntitiesFromRaw(raw, turn);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.canonicalName).toBe("globex");
  });

  it("returns empty when the array is empty", () => {
    const result = parseEntitiesFromRaw("[]", "small talk");
    expect(result.entities).toHaveLength(0);
    expect(result.parseError).toBeNull();
  });

  it("caps the entity count to MAX_ENTITIES_PER_TURN", () => {
    const turn = "x".repeat(50);
    const many = Array.from({ length: 25 }, (_, i) => ({
      kind: "customer" as const,
      canonicalName: `cust-${i}`,
      displayName: `Cust ${i}`,
      confidence: 0.9,
      sourceSpan: { start: 0, end: 1, text: "x" },
    }));
    const result = parseEntitiesFromRaw(JSON.stringify(many), turn);
    expect(result.entities.length).toBeLessThanOrEqual(12);
  });
});
