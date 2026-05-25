import { describe, expect, it } from "vitest";
import { createGrowthBookAdapter } from "../growthbook-adapter.js";

function mockFetch(payload: unknown, opts: { ok?: boolean; status?: number } = {}) {
  return ((async () =>
    new Response(JSON.stringify(payload), {
      status: opts.status ?? (opts.ok === false ? 500 : 200),
    })) as unknown) as typeof fetch;
}

describe("createGrowthBookAdapter", () => {
  it("returns false for missing flag", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({ features: {} }),
    });
    expect(await fl.isEnabled("missing", { tenantId: "t1" })).toBe(false);
  });

  it("returns defaultValue=true as enabled", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({ features: { x: { defaultValue: true } } }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("returns defaultValue=false as disabled", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({ features: { x: { defaultValue: false } } }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("evaluates condition rule force=true", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({
        features: {
          x: {
            defaultValue: false,
            rules: [{ condition: { tenantId: "t1" }, force: true }],
          },
        },
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
    expect(await fl.isEnabled("x", { tenantId: "t2" })).toBe(false);
  });

  it("respects rule coverage (rollout)", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({
        features: {
          x: {
            defaultValue: false,
            rules: [{ coverage: 0 }],
          },
        },
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("getVariant returns string variant", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({ features: { x: { defaultValue: "blue" } } }),
    });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("blue");
  });

  it("throws on non-OK response", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({}, { ok: false, status: 500 }),
    });
    await expect(fl.isEnabled("x", { tenantId: "t1" })).rejects.toThrow();
  });

  it("getAllFlags returns Flag[] shape", async () => {
    const fl = createGrowthBookAdapter({
      apiKey: "k",
      fetchFn: mockFetch({
        features: { a: { defaultValue: true }, b: { defaultValue: false } },
      }),
    });
    const all = await fl.getAllFlags("t1");
    expect(all).toHaveLength(2);
  });
});
