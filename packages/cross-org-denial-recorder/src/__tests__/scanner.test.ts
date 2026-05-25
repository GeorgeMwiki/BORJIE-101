import { describe, expect, it } from "vitest";
import {
  aggregate,
  DenialReason,
  findBruteForcePatterns,
  type DenialRow,
} from "../index.js";

function row(over: Partial<DenialRow> = {}): DenialRow {
  return {
    actorUserId: "u-1",
    actorTenantId: "t-A",
    targetTenantId: "t-B",
    route: "/api/x",
    httpMethod: "GET",
    reason: DenialReason.RLS_DENIED,
    requestId: null,
    metadata: {},
    deniedAtIso: "2026-05-01T00:00:00Z",
    ...over,
  };
}

describe("aggregate", () => {
  it("returns empty stats on empty input", () => {
    const s = aggregate([], 60_000);
    expect(s.total).toBe(0);
    expect(s.byReason).toEqual({});
    expect(s.byActor).toEqual({});
    expect(s.windowMs).toBe(60_000);
  });

  it("counts by reason", () => {
    const s = aggregate(
      [
        row({ reason: "RLS_DENIED" }),
        row({ reason: "RLS_DENIED" }),
        row({ reason: "TIER_INSUFFICIENT" }),
      ],
      60_000,
    );
    expect(s.byReason).toEqual({ RLS_DENIED: 2, TIER_INSUFFICIENT: 1 });
  });

  it("counts by actor, anonymises null actors", () => {
    const s = aggregate(
      [
        row({ actorUserId: "u-1" }),
        row({ actorUserId: "u-1" }),
        row({ actorUserId: null }),
      ],
      60_000,
    );
    expect(s.byActor["u-1"]).toBe(2);
    expect(s.byActor["__anonymous__"]).toBe(1);
  });

  it("treats falsy reason as UNKNOWN", () => {
    const s = aggregate([row({ reason: "" })], 60_000);
    expect(s.byReason.UNKNOWN).toBe(1);
  });
});

describe("findBruteForcePatterns", () => {
  it("returns empty on insufficient attempts", () => {
    const rows = Array.from({ length: 5 }, () => row());
    const f = findBruteForcePatterns(rows);
    expect(f).toEqual([]);
  });

  it("flags actor exceeding attempt and route thresholds", () => {
    const rows: DenialRow[] = [];
    for (let i = 0; i < 25; i += 1) {
      rows.push(row({ route: `/api/r${i % 5}` }));
    }
    const f = findBruteForcePatterns(rows);
    expect(f).toHaveLength(1);
    expect(f[0].actorUserId).toBe("u-1");
    expect(f[0].targetTenantId).toBe("t-B");
    expect(f[0].attempts).toBe(25);
    expect(f[0].distinctRoutes).toBe(5);
  });

  it("does not flag when distinct routes are too few", () => {
    const rows = Array.from({ length: 25 }, () => row({ route: "/api/x" }));
    const f = findBruteForcePatterns(rows);
    expect(f).toEqual([]);
  });

  it("respects custom thresholds", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ route: `/api/r${i}` }),
    );
    const f = findBruteForcePatterns(rows, {
      minAttempts: 5,
      minDistinctRoutes: 3,
    });
    expect(f).toHaveLength(1);
  });

  it("captures firstSeenIso and lastSeenIso", () => {
    const rows = [
      row({ deniedAtIso: "2026-01-01T00:00:00Z", route: "/a" }),
      row({ deniedAtIso: "2026-06-01T00:00:00Z", route: "/b" }),
      row({ deniedAtIso: "2026-03-01T00:00:00Z", route: "/c" }),
      row({ deniedAtIso: "2026-04-01T00:00:00Z", route: "/d" }),
      row({ deniedAtIso: "2026-05-01T00:00:00Z", route: "/e" }),
    ];
    const f = findBruteForcePatterns(rows, {
      minAttempts: 5,
      minDistinctRoutes: 3,
    });
    expect(f[0].firstSeenIso).toBe("2026-01-01T00:00:00Z");
    expect(f[0].lastSeenIso).toBe("2026-06-01T00:00:00Z");
  });

  it("ignores rows with null actorUserId", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ actorUserId: null, route: `/r${i}` }),
    );
    const f = findBruteForcePatterns(rows);
    expect(f).toEqual([]);
  });

  it("separates findings per actor-target pair", () => {
    const rows: DenialRow[] = [];
    for (let i = 0; i < 25; i += 1) {
      rows.push(row({ actorUserId: "u-1", route: `/api/r${i % 5}` }));
    }
    for (let i = 0; i < 25; i += 1) {
      rows.push(row({ actorUserId: "u-2", route: `/api/s${i % 4}` }));
    }
    const f = findBruteForcePatterns(rows);
    expect(f).toHaveLength(2);
    const actors = f.map((x) => x.actorUserId).sort();
    expect(actors).toEqual(["u-1", "u-2"]);
  });
});
