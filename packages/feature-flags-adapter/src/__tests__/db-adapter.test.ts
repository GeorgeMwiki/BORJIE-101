import { describe, expect, it } from "vitest";
import { createDBFeatureFlagsAdapter, type DBClient } from "../db-adapter.js";

function makeDb(rows: Record<string, unknown[]>): DBClient {
  return {
    async query<T = unknown>(_sql: string, params?: readonly unknown[]) {
      const key = params ? params.join("|") : "*";
      return (rows[key] ?? rows["*"] ?? []) as T[];
    },
  };
}

describe("createDBFeatureFlagsAdapter", () => {
  it("returns false for missing flag", async () => {
    const fl = createDBFeatureFlagsAdapter({ db: makeDb({}) });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("returns enabled=true when row enabled", async () => {
    const fl = createDBFeatureFlagsAdapter({
      db: makeDb({
        "x|t1": [
          {
            key: "x",
            tenant_id: "t1",
            enabled: true,
            variant: null,
            rollout_percent: null,
          },
        ],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("rollout_percent=0 disables", async () => {
    const fl = createDBFeatureFlagsAdapter({
      db: makeDb({
        "x|t1": [
          {
            key: "x",
            tenant_id: "t1",
            enabled: true,
            variant: null,
            rollout_percent: 0,
          },
        ],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(false);
  });

  it("rollout_percent=100 enables", async () => {
    const fl = createDBFeatureFlagsAdapter({
      db: makeDb({
        "x|t1": [
          {
            key: "x",
            tenant_id: "t1",
            enabled: true,
            variant: null,
            rollout_percent: 100,
          },
        ],
      }),
    });
    expect(await fl.isEnabled("x", { tenantId: "t1" })).toBe(true);
  });

  it("getVariant returns row variant when enabled", async () => {
    const fl = createDBFeatureFlagsAdapter({
      db: makeDb({
        "x|t1": [
          {
            key: "x",
            tenant_id: "t1",
            enabled: true,
            variant: "green",
            rollout_percent: null,
          },
        ],
      }),
    });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("green");
  });

  it("getVariant returns control when row disabled", async () => {
    const fl = createDBFeatureFlagsAdapter({
      db: makeDb({
        "x|t1": [
          {
            key: "x",
            tenant_id: "t1",
            enabled: false,
            variant: "green",
            rollout_percent: null,
          },
        ],
      }),
    });
    expect(await fl.getVariant("x", { tenantId: "t1" })).toBe("control");
  });

  it("getAllFlags returns Flag[] from db rows", async () => {
    const fl = createDBFeatureFlagsAdapter({
      db: makeDb({
        "t1": [
          {
            key: "a",
            tenant_id: null,
            enabled: true,
            variant: null,
            rollout_percent: null,
          },
          {
            key: "b",
            tenant_id: "t1",
            enabled: false,
            variant: "v",
            rollout_percent: null,
          },
        ],
      }),
    });
    const all = await fl.getAllFlags("t1");
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.key === "b")?.variant).toBe("v");
  });
});
