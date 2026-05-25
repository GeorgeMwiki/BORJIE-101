import { describe, expect, it } from "vitest";
import { createUnleashAdapter } from "../unleash-adapter.js";

function mockFetch(payload: unknown, status = 200) {
  return ((async () =>
    new Response(JSON.stringify(payload), { status })) as unknown) as typeof fetch;
}

describe("createUnleashAdapter", () => {
  it("returns false for missing feature", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({ features: [] }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("default strategy enables", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({
        features: [
          { name: "x", enabled: true, strategies: [{ name: "default" }] },
        ],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("gradualRolloutUserId percentage=100 enables", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({
        features: [
          {
            name: "x",
            enabled: true,
            strategies: [
              { name: "gradualRolloutUserId", parameters: { percentage: "100" } },
            ],
          },
        ],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1", userId: "u1" })).toBe(true);
  });

  it("gradualRolloutUserId percentage=0 disables", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({
        features: [
          {
            name: "x",
            enabled: true,
            strategies: [
              { name: "gradualRolloutUserId", parameters: { percentage: "0" } },
            ],
          },
        ],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1", userId: "u1" })).toBe(false);
  });

  it("disabled feature returns false even with strategies", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({
        features: [
          { name: "x", enabled: false, strategies: [{ name: "default" }] },
        ],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("no strategies + enabled=true returns true", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({
        features: [{ name: "x", enabled: true }],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("getVariant returns variant when set", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({
        features: [
          {
            name: "x",
            enabled: true,
            variant: "blue",
            strategies: [{ name: "default" }],
          },
        ],
      }),
    });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("blue");
  });

  it("throws on non-200", async () => {
    const fl = createUnleashAdapter({
      apiKey: "k",
      endpoint: "http://u",
      fetchFn: mockFetch({}, 500),
    });
    await expect(fl.isEnabled("x", { tenantId: "t1" })).rejects.toThrow();
  });
});
