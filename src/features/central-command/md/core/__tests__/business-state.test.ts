/**
 * MD core - business-state cache + tier scoping tests.
 */

import { describe, it, expect } from "vitest";

import {
  BusinessStateService,
  emptySnapshot,
  type BusinessStateFetcher,
} from "../business-state";
import type { BusinessSnapshot } from "@/features/central-command/md/nba/types";

function makeFetcher(initial: BusinessSnapshot, aggregated?: BusinessSnapshot) {
  let calls = 0;
  let aggregatedCalls = 0;
  const fetcher: BusinessStateFetcher & {
    readonly stats: { calls: number; aggregatedCalls: number };
  } = {
    async fetch(_orgId: string) {
      calls += 1;
      return initial;
    },
    async fetchAggregated(_orgId: string) {
      aggregatedCalls += 1;
      return aggregated ?? initial;
    },
    get stats() {
      return { calls, aggregatedCalls };
    },
  };
  return fetcher;
}

describe("BusinessStateService", () => {
  it("returns a deep-frozen snapshot", async () => {
    const f = makeFetcher(emptySnapshot("org-1"));
    const svc = new BusinessStateService(f);
    const snap = await svc.getSnapshot("org-1", "org-admin");
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.finance)).toBe(true);
    expect(() => {
      // @ts-expect-error - immutability check
      snap.orgId = "tampered";
    }).toThrow();
  });

  it("caches by orgId for the TTL window", async () => {
    const f = makeFetcher(emptySnapshot("org-1"));
    let now = 1_000_000;
    const svc = new BusinessStateService(f, {
      ttlMs: 30_000,
      clock: () => now,
    });
    await svc.getSnapshot("org-1", "org-admin");
    await svc.getSnapshot("org-1", "org-admin");
    expect(f.stats.calls).toBe(1);

    now += 30_001;
    await svc.getSnapshot("org-1", "org-admin");
    expect(f.stats.calls).toBe(2);
  });

  it("uses the aggregated branch for sovereign tier", async () => {
    const full = emptySnapshot("org-1");
    const f = makeFetcher(full, emptySnapshot("org-1"));
    const svc = new BusinessStateService(f);
    const snap = await svc.getSnapshot("org-1", "sovereign");
    expect(snap.orgId).toBe("<aggregated>");
    expect(f.stats.aggregatedCalls).toBe(1);
    expect(f.stats.calls).toBe(0);
  });

  it("strips PII when sovereign tier reads", async () => {
    const full: BusinessSnapshot = Object.freeze({
      ...emptySnapshot("org-1"),
      customers: Object.freeze([
        Object.freeze({
          customerId: "c1",
          name: "Real Customer Name",
          lastContactDaysAgo: 3,
          openComplaints: 0,
        }),
      ]),
    });
    const f = makeFetcher(full);
    const svc = new BusinessStateService(f);
    const snap = await svc.getSnapshot("org-1", "sovereign");
    expect(snap.customers.length).toBe(0);
  });

  it("denies tier when policy fails", async () => {
    const f = makeFetcher(emptySnapshot("org-1"));
    const svc = new BusinessStateService(f);
    // borrower tier cannot read org_data
    await expect(svc.getSnapshot("org-1", "borrower")).rejects.toThrow();
  });

  it("invalidates the cache on demand", async () => {
    const f = makeFetcher(emptySnapshot("org-1"));
    const svc = new BusinessStateService(f);
    await svc.getSnapshot("org-1", "org-admin");
    svc.invalidate("org-1");
    await svc.getSnapshot("org-1", "org-admin");
    expect(f.stats.calls).toBe(2);
  });
});
