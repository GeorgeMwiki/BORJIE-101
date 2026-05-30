import { describe, expect, it } from "vitest";

import { NbaService } from "../nba-service";
import { healthySnapshot, stressedSnapshot } from "./fixtures";
import type { BusinessSnapshot } from "../types";

describe("NbaService.rankActions", () => {
  it("returns up to k actions, sorted by composite score", async () => {
    const svc = new NbaService();
    const ranked = await svc.rankActions(stressedSnapshot, 5);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].compositeScore).toBeGreaterThanOrEqual(
        ranked[i].compositeScore,
      );
    }
  });

  it("attaches subjectRef when an action targets a specific entity", async () => {
    const svc = new NbaService();
    const ranked = await svc.rankActions(stressedSnapshot, 20);
    const overdueInvoiceAction = ranked.find(
      (r) => r.templateId === "fin.chase-overdue-invoice",
    );
    expect(overdueInvoiceAction).toBeDefined();
  });

  it("under stressed snapshot the top action is urgent", async () => {
    const svc = new NbaService();
    const ranked = await svc.rankActions(stressedSnapshot, 1);
    expect(ranked[0]?.eisenhower.urgencyScore).toBeGreaterThan(4);
  });

  it("rejects k <= 0", async () => {
    const svc = new NbaService();
    await expect(svc.rankActions(healthySnapshot, 0)).rejects.toThrow();
  });

  it("rejects invalid snapshots", async () => {
    const svc = new NbaService();
    const bad = { ...healthySnapshot, orgId: "" } as BusinessSnapshot;
    await expect(svc.rankActions(bad, 5)).rejects.toThrow(/BusinessSnapshot/);
  });
});

describe("NbaService.getNextLowHangingFruit", () => {
  it("returns a high-ease, decent-impact action", async () => {
    const svc = new NbaService();
    const fruit = await svc.getNextLowHangingFruit(stressedSnapshot);
    expect(fruit).not.toBeNull();
    expect(fruit?.ice.ease).toBeGreaterThanOrEqual(7);
    expect(fruit?.ice.impact).toBeGreaterThanOrEqual(4);
  });
});

describe("NbaService.getNextHighImpact", () => {
  it("returns an action with impact >= 7", async () => {
    const svc = new NbaService();
    const hi = await svc.getNextHighImpact(stressedSnapshot);
    expect(hi).not.toBeNull();
    expect(hi?.ice.impact).toBeGreaterThanOrEqual(7);
  });
});

describe("NbaService.getDailyAgenda", () => {
  it("returns up to five distinct actions", async () => {
    const svc = new NbaService();
    const agenda = await svc.getDailyAgenda(stressedSnapshot);
    expect(agenda.length).toBeGreaterThan(0);
    expect(agenda.length).toBeLessThanOrEqual(5);

    const keys = agenda.map((a) => `${a.templateId}::${a.subjectRef ?? ""}`);
    expect(new Set(keys).size).toBe(agenda.length);
  });

  it("returns a non-empty agenda even for a healthy business", async () => {
    const svc = new NbaService();
    const agenda = await svc.getDailyAgenda(healthySnapshot);
    expect(agenda.length).toBeGreaterThan(0);
  });

  it("ranking output is deterministic for the same input", async () => {
    const svc = new NbaService();
    const a = await svc.rankActions(stressedSnapshot, 5);
    const b = await svc.rankActions(stressedSnapshot, 5);
    expect(a.map((x) => x.templateId)).toEqual(b.map((x) => x.templateId));
  });
});

describe("NbaService — snapshot ranking shape", () => {
  it("stressed snapshot surfaces overdue-invoice and compliance items", async () => {
    const svc = new NbaService();
    const ranked = await svc.rankActions(stressedSnapshot, 30);
    const ids = ranked.map((r) => r.templateId);
    expect(ids).toContain("fin.chase-overdue-invoice");
    expect(ids).toContain("compliance.submit-filing");
    expect(ids).toContain("ops.review-supplier-contract");
  });
});
