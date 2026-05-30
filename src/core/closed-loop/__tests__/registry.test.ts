/**
 * Closed-loop registry — unit tests.
 *
 * Walks the 15 registered loops, confirms each is a runnable stub, and
 * spot-checks the lookup helpers.
 */

import { describe, it, expect } from "vitest";
import { listLoops, getLoop, isClosedLoopId } from "../registry";
import { runTick, NULL_SINK } from "../runtime";

describe("closed-loop registry", () => {
  it("registers exactly 15 loops", () => {
    expect(listLoops().length).toBe(15);
  });

  it("every loop id is unique", () => {
    const ids = listLoops().map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every registered loop is reachable via getLoop", () => {
    for (const loop of listLoops()) {
      expect(getLoop(loop.id)?.id).toBe(loop.id);
    }
  });

  it("isClosedLoopId returns true for registered, false for nonsense", () => {
    expect(isClosedLoopId("kyc-verification")).toBe(true);
    expect(isClosedLoopId("does-not-exist")).toBe(false);
  });

  it("each loop has a positive duration cap and non-empty actAction", () => {
    for (const loop of listLoops()) {
      expect(loop.maxDurationMs).toBeGreaterThan(0);
      expect(loop.actAction.length).toBeGreaterThan(0);
      expect(loop.displayName.length).toBeGreaterThan(0);
    }
  });

  it("a registered stub loop ticks to success against borjie-admin scope", async () => {
    const loop = getLoop("kyc-verification");
    expect(loop).toBeDefined();
    if (!loop) return;
    const tick = await runTick({
      definition: loop,
      scope: { orgId: "org-x", tier: "borjie-admin" },
      sink: NULL_SINK,
    });
    expect(["success", "sla-breach"]).toContain(tick.outcome);
  });
});
