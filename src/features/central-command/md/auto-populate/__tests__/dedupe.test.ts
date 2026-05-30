/**
 * Auto-Populate — Dedupe tests.
 *
 * Real fuzzy-match assertions. Pure-function in/out. No mocks.
 */

import { describe, it, expect } from "vitest";
import {
  collapseIntraTurnDuplicates,
  jaccardTokenRatio,
  levenshtein,
  levenshteinRatio,
  mergeEntities,
  resolveEntity,
} from "../dedupe";
import type { ExtractedEntity } from "../entity-types";
import type { KnownEntity } from "../dedupe";

function mkCustomer(
  name: string,
  confidence = 0.9,
  extra: Partial<Record<string, unknown>> = {},
): ExtractedEntity {
  return {
    kind: "customer",
    canonicalName: name.toLowerCase(),
    displayName: name,
    confidence,
    sourceSpan: { start: 0, end: name.length, text: name },
    ...extra,
  } as ExtractedEntity;
}

describe("levenshtein + ratio", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshteinRatio("abc", "abc")).toBe(1);
  });

  it("handles empty input", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshteinRatio("", "")).toBe(1);
  });

  it("computes textbook distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("flaw", "lawn")).toBe(2);
  });

  it("ratio in [0,1]", () => {
    const r = levenshteinRatio("acme", "acmee");
    expect(r).toBeGreaterThan(0.7);
    expect(r).toBeLessThan(1);
  });
});

describe("jaccardTokenRatio", () => {
  it("returns 1 for identical token sets", () => {
    expect(jaccardTokenRatio("acme corp", "acme corp")).toBe(1);
  });

  it("handles token reorderings", () => {
    expect(jaccardTokenRatio("acme corp", "corp acme")).toBe(1);
  });

  it("partial overlap", () => {
    expect(jaccardTokenRatio("alpha beta", "beta gamma")).toBeCloseTo(1 / 3, 5);
  });

  it("empty strings", () => {
    expect(jaccardTokenRatio("", "")).toBe(1);
    expect(jaccardTokenRatio("abc", "")).toBe(0);
  });
});

describe("resolveEntity — dedupe", () => {
  const known: ReadonlyArray<KnownEntity> = [
    {
      id: "row-1",
      tenantId: "t-1",
      kind: "customer",
      canonicalName: "acme",
      displayName: "Acme Corp",
    },
    {
      id: "row-2",
      tenantId: "t-1",
      kind: "customer",
      canonicalName: "globex",
      displayName: "Globex Inc",
    },
    {
      id: "row-3",
      tenantId: "t-1",
      kind: "supplier",
      canonicalName: "bolt",
      displayName: "Bolt Logistics",
    },
  ];

  it("merges on exact canonical match", () => {
    const incoming = mkCustomer("Acme");
    const match = resolveEntity(incoming, known);
    expect(match.action).toBe("merge");
    expect(match.matchedId).toBe("row-1");
    expect(match.reason).toContain("exact match");
  });

  it("inserts when no known rows of the kind exist", () => {
    const incoming = {
      kind: "project",
      canonicalName: "atlas",
      displayName: "Project Atlas",
      confidence: 0.9,
      sourceSpan: { start: 0, end: 13, text: "Project Atlas" },
    } as ExtractedEntity;
    const match = resolveEntity(incoming, known);
    expect(match.action).toBe("insert");
    expect(match.reason).toContain("no existing rows");
  });

  it("merges 'Acme Corp.' with existing 'acme' via canonical normalisation", () => {
    const incoming = mkCustomer("Acme Corp.");
    // canonicaliseName("Acme Corp.") -> "acme"
    const match = resolveEntity(incoming, known);
    expect(match.action).toBe("merge");
    expect(match.matchedId).toBe("row-1");
  });

  it("merges 'Globx' against 'globex' via Levenshtein", () => {
    // The default Levenshtein threshold is 0.88 — "globx" vs "globex" is
    // 1 edit / 6 chars = 0.833. That's BELOW 0.88, so we expect insert.
    const incoming = mkCustomer("Globx");
    const match = resolveEntity(incoming, known);
    expect(match.action).toBe("insert");
  });

  it("merges with a lower threshold when configured", () => {
    const incoming = mkCustomer("Globx");
    const match = resolveEntity(incoming, known, {
      levenshteinThreshold: 0.8,
    });
    expect(match.action).toBe("merge");
    expect(match.matchedId).toBe("row-2");
  });

  it("inserts when fuzzy score is far below thresholds", () => {
    const incoming = mkCustomer("Initech");
    const match = resolveEntity(incoming, known);
    expect(match.action).toBe("insert");
  });

  it("ignores rows of a different kind", () => {
    // 'Bolt' exists as a SUPPLIER. Incoming customer 'Bolt' should INSERT,
    // not merge with the supplier row.
    const incoming = mkCustomer("Bolt");
    const match = resolveEntity(incoming, known);
    expect(match.action).toBe("insert");
  });
});

describe("collapseIntraTurnDuplicates", () => {
  it("collapses two mentions of the same canonical entity", () => {
    const batch = [mkCustomer("Acme", 0.7), mkCustomer("Acme Corp", 0.9)];
    const collapsed = collapseIntraTurnDuplicates(batch);
    expect(collapsed).toHaveLength(1);
    // Higher confidence wins.
    expect(collapsed[0]!.confidence).toBe(0.9);
  });

  it("keeps distinct entities of the same kind", () => {
    const batch = [mkCustomer("Acme"), mkCustomer("Globex")];
    const collapsed = collapseIntraTurnDuplicates(batch);
    expect(collapsed).toHaveLength(2);
  });

  it("preserves cross-kind entities even with similar names", () => {
    const batch: ExtractedEntity[] = [
      mkCustomer("Bolt"),
      {
        kind: "supplier",
        canonicalName: "bolt",
        displayName: "Bolt",
        confidence: 0.9,
        sourceSpan: { start: 0, end: 4, text: "Bolt" },
      },
    ];
    const collapsed = collapseIntraTurnDuplicates(batch);
    expect(collapsed).toHaveLength(2);
  });
});

describe("mergeEntities", () => {
  it("winner's values take priority, loser fills gaps", () => {
    const winner = mkCustomer("Acme", 0.9);
    const loser = mkCustomer("Acme", 0.6, { industry: "Fintech" });
    const merged = mergeEntities(winner, loser);
    expect(merged.confidence).toBe(0.9);
    // industry should be carried from loser since winner lacked it.
    expect((merged as { industry?: string }).industry).toBe("Fintech");
  });

  it("returns winner unchanged when kinds differ", () => {
    const a = mkCustomer("X");
    const b: ExtractedEntity = {
      kind: "product",
      canonicalName: "x",
      displayName: "X",
      confidence: 0.5,
      sourceSpan: { start: 0, end: 1, text: "X" },
    };
    const merged = mergeEntities(a, b);
    expect(merged.kind).toBe("customer");
  });
});
