/**
 * Tests — JuniorAgentRegistry. Verifies get/list/byDomain/has +
 * duplicate detection + manifest projection.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { makeJuniorRegistry, juniorManifest } from "../registry";
import type { MdJuniorPort } from "../types";

function junior(
  id: string,
  domain: MdJuniorPort["domain"] = "hr",
): MdJuniorPort {
  const j: MdJuniorPort = {
    id,
    label: `Junior ${id}`,
    domain,
    trigger: { kind: "manual" as const, invokedBy: "test" },
    guardrails: {
      maxRowsPerRun: 100,
      maxProposalsPerRun: 4,
      cooldownMs: 1_000,
      maxDurationMs: 5_000,
      allowedTables: [],
    },
    payloadSchema: z.object({}),
    description: `Description for ${id}`,
    async execute() {
      return {
        outcome: "ok",
        proposalsFiled: 0,
        rowsProcessed: 0,
        summary: "noop",
      };
    },
  };
  return Object.freeze(j);
}

describe("makeJuniorRegistry", () => {
  it("registers and looks up by id", () => {
    const r = makeJuniorRegistry([junior("a"), junior("b", "finance")]);
    expect(r.has("a")).toBe(true);
    expect(r.get("a")!.id).toBe("a");
    expect(r.get("missing")).toBeUndefined();
  });

  it("preserves registration order", () => {
    const r = makeJuniorRegistry([junior("a"), junior("b"), junior("c")]);
    expect(r.list().map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by domain", () => {
    const r = makeJuniorRegistry([
      junior("a", "hr"),
      junior("b", "finance"),
      junior("c", "hr"),
    ]);
    expect(r.byDomain("hr").map((j) => j.id)).toEqual(["a", "c"]);
    expect(r.byDomain("finance").map((j) => j.id)).toEqual(["b"]);
  });

  it("throws on duplicate id", () => {
    expect(() => makeJuniorRegistry([junior("a"), junior("a")])).toThrowError(
      /duplicate junior id/,
    );
  });

  it("manifest strips runtime state and is frozen", () => {
    const r = makeJuniorRegistry([junior("a"), junior("b", "finance")]);
    const m = juniorManifest(r);
    expect(m.length).toBe(2);
    expect(m[0]).toEqual({
      id: "a",
      label: "Junior a",
      domain: "hr",
      description: "Description for a",
      triggerKind: "manual",
    });
    expect(Object.isFrozen(m)).toBe(true);
  });
});
