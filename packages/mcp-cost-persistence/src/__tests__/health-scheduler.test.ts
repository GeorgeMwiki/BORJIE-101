import { describe, expect, it } from "vitest";
import {
  createHealthHistory,
  latestPerServer,
  recordCycle,
  runProbeCycle,
  type HealthProbe,
} from "../index.js";

function fakeProbe(
  healthByServer: Record<string, boolean>,
): HealthProbe {
  return {
    async check(serverId: string) {
      return {
        serverId,
        healthy: healthByServer[serverId] ?? false,
        latencyMs: 100,
        observedAtIso: "2026-05-01T00:00:00Z",
      };
    },
  };
}

describe("runProbeCycle", () => {
  it("returns a result per server", async () => {
    const probe = fakeProbe({ a: true, b: true, c: false });
    const cycle = await runProbeCycle(probe, ["a", "b", "c"], {
      nowIso: () => "2026-05-01T00:00:00Z",
    });
    expect(cycle.results).toHaveLength(3);
    expect(cycle.unhealthyCount).toBe(1);
    expect(cycle.cycleStartedAtIso).toBe("2026-05-01T00:00:00Z");
  });

  it("captures throw as unhealthy with errorMessage", async () => {
    const probe: HealthProbe = {
      async check(serverId) {
        if (serverId === "boom") throw new Error("connection_refused");
        return {
          serverId,
          healthy: true,
          observedAtIso: "2026-05-01T00:00:00Z",
        };
      },
    };
    const cycle = await runProbeCycle(probe, ["ok", "boom"]);
    const boomR = cycle.results.find((r) => r.serverId === "boom");
    expect(boomR?.healthy).toBe(false);
    expect(boomR?.errorMessage).toBe("connection_refused");
  });

  it("returns empty results for empty server list", async () => {
    const cycle = await runProbeCycle(fakeProbe({}), []);
    expect(cycle.results).toHaveLength(0);
    expect(cycle.unhealthyCount).toBe(0);
  });
});

describe("recordCycle + history", () => {
  it("appends cycle results to history", () => {
    let h = createHealthHistory(100);
    h = recordCycle(h, {
      results: [
        {
          serverId: "a",
          healthy: true,
          observedAtIso: "2026-05-01T00:00:00Z",
        },
      ],
      unhealthyCount: 0,
      cycleStartedAtIso: "x",
      cycleEndedAtIso: "y",
    });
    expect(h.history).toHaveLength(1);
  });

  it("rotates oldest out at maxEntries", () => {
    let h = createHealthHistory(3);
    for (let i = 0; i < 5; i += 1) {
      h = recordCycle(h, {
        results: [
          {
            serverId: `s${i}`,
            healthy: true,
            observedAtIso: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
          },
        ],
        unhealthyCount: 0,
        cycleStartedAtIso: "x",
        cycleEndedAtIso: "y",
      });
    }
    expect(h.history).toHaveLength(3);
    expect(h.history[0].serverId).toBe("s2");
    expect(h.history[2].serverId).toBe("s4");
  });
});

describe("latestPerServer", () => {
  it("returns the most recent observation per server", () => {
    let h = createHealthHistory(100);
    h = recordCycle(h, {
      results: [
        {
          serverId: "a",
          healthy: false,
          observedAtIso: "2026-04-01T00:00:00Z",
        },
        {
          serverId: "a",
          healthy: true,
          observedAtIso: "2026-05-01T00:00:00Z",
        },
        {
          serverId: "b",
          healthy: true,
          observedAtIso: "2026-04-15T00:00:00Z",
        },
      ],
      unhealthyCount: 1,
      cycleStartedAtIso: "x",
      cycleEndedAtIso: "y",
    });
    const latest = latestPerServer(h);
    const a = latest.find((r) => r.serverId === "a");
    const b = latest.find((r) => r.serverId === "b");
    expect(a?.observedAtIso).toBe("2026-05-01T00:00:00Z");
    expect(a?.healthy).toBe(true);
    expect(b?.observedAtIso).toBe("2026-04-15T00:00:00Z");
  });
});
