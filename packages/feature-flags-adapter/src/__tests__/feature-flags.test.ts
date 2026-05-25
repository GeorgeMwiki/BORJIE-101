import { describe, expect, it } from "vitest";
import { createFeatureFlags } from "../feature-flags.js";
import { createInMemoryAdapter } from "../in-memory-adapter.js";
import type { FeatureFlagsPort } from "../types.js";

const throwingAdapter: FeatureFlagsPort = {
  async isEnabled() {
    throw new Error("boom");
  },
  async getVariant() {
    throw new Error("boom");
  },
  async getAllFlags() {
    throw new Error("boom");
  },
};

describe("createFeatureFlags", () => {
  it("delegates isEnabled to adapter", async () => {
    const fl = createFeatureFlags({
      adapter: createInMemoryAdapter({ flags: { x: { enabled: true } } }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("falls back to defaultEnabled=false on adapter throw", async () => {
    const fl = createFeatureFlags({ adapter: throwingAdapter });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("respects defaultEnabled=true on adapter throw", async () => {
    const fl = createFeatureFlags({
      adapter: throwingAdapter,
      defaultEnabled: true,
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("falls back to defaultVariant=control on throw", async () => {
    const fl = createFeatureFlags({ adapter: throwingAdapter });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("control");
  });

  it("respects custom defaultVariant on throw", async () => {
    const fl = createFeatureFlags({
      adapter: throwingAdapter,
      defaultVariant: "safe",
    });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("safe");
  });

  it("getAllFlags returns [] on throw", async () => {
    const fl = createFeatureFlags({ adapter: throwingAdapter });
    expect(await fl.getAllFlags("t1")).toEqual([]);
  });
});
