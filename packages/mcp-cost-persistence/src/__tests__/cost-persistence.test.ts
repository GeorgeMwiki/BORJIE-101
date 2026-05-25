import { describe, expect, it } from "vitest";
import {
  appendCost,
  createCostBuffer,
  flushAll,
  flushCost,
  snapshot,
  type CostSink,
  type McpCostEntry,
} from "../index.js";

function entry(over: Partial<McpCostEntry> = {}): McpCostEntry {
  return {
    toolName: "property.listings",
    serverId: "property-mcp",
    tier: "standard",
    estimatedCostUsd: 0.005,
    wasFree: false,
    ts: 1_700_000_000_000,
    ...over,
  };
}

function memorySink(): CostSink & { entries: McpCostEntry[] } {
  const all: McpCostEntry[] = [];
  return {
    entries: all,
    async insert(rows) {
      all.push(...rows);
    },
  };
}

describe("createCostBuffer", () => {
  it("starts empty with zero totals", () => {
    const s = createCostBuffer();
    expect(s.pending).toHaveLength(0);
    expect(s.totals.totalCostUsd).toBe(0);
    expect(s.totals.freeCallCount).toBe(0);
    expect(s.totals.paidCallCount).toBe(0);
  });
});

describe("appendCost", () => {
  it("accumulates total cost", () => {
    let s = createCostBuffer();
    s = appendCost(s, entry({ estimatedCostUsd: 0.01 }));
    s = appendCost(s, entry({ estimatedCostUsd: 0.02 }));
    expect(s.totals.totalCostUsd).toBeCloseTo(0.03, 6);
  });

  it("splits by tier", () => {
    let s = createCostBuffer();
    s = appendCost(s, entry({ tier: "premium", estimatedCostUsd: 0.05 }));
    s = appendCost(s, entry({ tier: "cheap", estimatedCostUsd: 0.001 }));
    expect(s.totals.costByTier.premium).toBeCloseTo(0.05, 6);
    expect(s.totals.costByTier.cheap).toBeCloseTo(0.001, 6);
  });

  it("splits by server", () => {
    let s = createCostBuffer();
    s = appendCost(s, entry({ serverId: "alpha", estimatedCostUsd: 0.01 }));
    s = appendCost(s, entry({ serverId: "beta", estimatedCostUsd: 0.02 }));
    expect(s.totals.costByServer.alpha).toBeCloseTo(0.01, 6);
    expect(s.totals.costByServer.beta).toBeCloseTo(0.02, 6);
  });

  it("counts free vs paid", () => {
    let s = createCostBuffer();
    s = appendCost(s, entry({ wasFree: true }));
    s = appendCost(s, entry({ wasFree: false }));
    s = appendCost(s, entry({ wasFree: false }));
    expect(s.totals.freeCallCount).toBe(1);
    expect(s.totals.paidCallCount).toBe(2);
  });

  it("does not mutate input state", () => {
    const init = createCostBuffer();
    const snap = JSON.parse(JSON.stringify(init));
    appendCost(init, entry());
    expect(init).toEqual(snap);
  });
});

describe("flushCost", () => {
  it("returns empty result when no pending", async () => {
    const sink = memorySink();
    const r = await flushCost(createCostBuffer(), sink);
    expect(r.flushed).toBe(0);
    expect(r.errored).toBe(false);
  });

  it("flushes the batch and clears pending", async () => {
    let s = createCostBuffer();
    for (let i = 0; i < 5; i += 1) s = appendCost(s, entry());
    const sink = memorySink();
    const r = await flushCost(s, sink);
    expect(r.flushed).toBe(5);
    expect(r.state.pending).toHaveLength(0);
    expect(sink.entries).toHaveLength(5);
  });

  it("preserves entries when sink throws", async () => {
    let s = createCostBuffer();
    for (let i = 0; i < 3; i += 1) s = appendCost(s, entry());
    const sink: CostSink = {
      async insert() {
        throw new Error("db_down");
      },
    };
    const r = await flushCost(s, sink);
    expect(r.errored).toBe(true);
    expect(r.flushed).toBe(0);
    expect(r.state.pending).toHaveLength(3);
  });

  it("respects custom batch size", async () => {
    let s = createCostBuffer();
    for (let i = 0; i < 12; i += 1) s = appendCost(s, entry());
    const sink = memorySink();
    const r = await flushCost(s, sink, { batchSize: 5 });
    expect(r.flushed).toBe(5);
    expect(r.state.pending).toHaveLength(7);
  });
});

describe("flushAll", () => {
  it("drains until empty", async () => {
    let s = createCostBuffer();
    for (let i = 0; i < 25; i += 1) s = appendCost(s, entry());
    const sink = memorySink();
    const r = await flushAll(s, sink, { batchSize: 10 });
    expect(r.flushed).toBe(25);
    expect(r.state.pending).toHaveLength(0);
    expect(sink.entries).toHaveLength(25);
  });
});

describe("snapshot", () => {
  it("returns the running totals", () => {
    let s = createCostBuffer();
    s = appendCost(s, entry({ estimatedCostUsd: 0.1 }));
    const snap = snapshot(s);
    expect(snap.totalCostUsd).toBeCloseTo(0.1, 6);
  });
});
