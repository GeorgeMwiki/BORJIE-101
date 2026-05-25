import { describe, expect, it } from "vitest";
import { createInMemoryAdapter } from "../in-memory-adapter.js";

describe("createInMemoryAdapter", () => {
  it("returns false for unknown flags", async () => {
    const fl = createInMemoryAdapter({ flags: {} });
    expect(await fl.isEnabled("missing", { tenantId: "t1" })).toBe(false);
  });

  it("returns enabled=true when flag enabled", async () => {
    const fl = createInMemoryAdapter({ flags: { x: { enabled: true } } });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("returns enabled=false when flag disabled", async () => {
    const fl = createInMemoryAdapter({ flags: { x: { enabled: false } } });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("respects allowedTenants allow-list", async () => {
    const fl = createInMemoryAdapter({
      flags: { x: { enabled: true, allowedTenants: ["t1"] } },
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
    expect(await fl.isEnabled("x", { tenantId: "t2" })).toBe(false);
  });

  it("rolloutPercent=0 disables all", async () => {
    const fl = createInMemoryAdapter({
      flags: { x: { enabled: true, rolloutPercent: 0 } },
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("rolloutPercent=100 enables all", async () => {
    const fl = createInMemoryAdapter({
      flags: { x: { enabled: true, rolloutPercent: 100 } },
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
    expect(await fl.isEnabled("x", { tenantId: "t99" })).toBe(true);
  });

  it("rolloutPercent is sticky per tenant+user", async () => {
    const fl = createInMemoryAdapter({
      flags: { x: { enabled: true, rolloutPercent: 50 } },
    });
    const a = await fl.isEnabled("x", { tenantId: "t1", userId: "u1" });
    const b = await fl.isEnabled("x", { tenantId: "t1", userId: "u1" });
    expect(a).toBe(b);
  });

  it("returns configured variant when enabled", async () => {
    const fl = createInMemoryAdapter({
      flags: { x: { enabled: true, variant: "blue" } },
    });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("blue");
  });

  it("returns control when disabled", async () => {
    const fl = createInMemoryAdapter({
      flags: { x: { enabled: false, variant: "blue" } },
    });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("control");
  });

  it("getAllFlags lists every defined flag", async () => {
    const fl = createInMemoryAdapter({
      flags: { a: { enabled: true }, b: { enabled: false } },
    });
    const all = await fl.getAllFlags("t1");
    expect(all).toHaveLength(2);
    expect(all.find((f) => f.key === "a")?.enabled).toBe(true);
    expect(all.find((f) => f.key === "b")?.enabled).toBe(false);
  });

  it("getAllFlags includes variant when set", async () => {
    const fl = createInMemoryAdapter({
      flags: { a: { enabled: true, variant: "v1" } },
    });
    const all = await fl.getAllFlags("t1");
    expect(all[0]?.variant).toBe("v1");
  });

  it("rollout-50 splits roughly evenly across 1000 users", async () => {
    const fl = createInMemoryAdapter({
      flags: { x: { enabled: true, rolloutPercent: 50 } },
    });
    let on = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (await fl.isEnabled("x", { tenantId: "t", userId: `u${i}` })) on += 1;
    }
    expect(on).toBeGreaterThan(400);
    expect(on).toBeLessThan(600);
  });
});
