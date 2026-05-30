import { describe, expect, it } from "vitest";

import {
  ACTION_CATALOG,
  ACTION_CATALOG_BY_DOMAIN,
  ACTION_CATALOG_SIZE,
  getActionTemplate,
} from "../action-catalog";
import type { ActionDomain } from "../types";

describe("action-catalog", () => {
  it("ships at least 50 templates", () => {
    expect(ACTION_CATALOG_SIZE).toBeGreaterThanOrEqual(50);
    expect(ACTION_CATALOG.length).toBe(ACTION_CATALOG_SIZE);
  });

  it("uses unique ids", () => {
    const ids = ACTION_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every required domain", () => {
    const required: readonly ActionDomain[] = [
      "sales",
      "ops",
      "hr",
      "finance",
      "customer-success",
      "compliance",
      "learning",
    ];
    for (const d of required) {
      expect(ACTION_CATALOG_BY_DOMAIN[d].length).toBeGreaterThan(0);
    }
  });

  it("keeps baseline values inside legal bands", () => {
    for (const t of ACTION_CATALOG) {
      expect(t.baselineImpact).toBeGreaterThanOrEqual(0);
      expect(t.baselineImpact).toBeLessThanOrEqual(10);
      expect(t.baselineEase).toBeGreaterThanOrEqual(0);
      expect(t.baselineEase).toBeLessThanOrEqual(10);
      expect(t.baselineConfidence).toBeGreaterThanOrEqual(0);
      expect(t.baselineConfidence).toBeLessThanOrEqual(1);
      expect(t.baselineReach).toBeGreaterThanOrEqual(0);
      expect(t.effortPersonDays).toBeGreaterThan(0);
      expect(t.triggers.length).toBeGreaterThan(0);
    }
  });

  it("freezes catalog entries", () => {
    expect(Object.isFrozen(ACTION_CATALOG)).toBe(true);
    expect(Object.isFrozen(ACTION_CATALOG[0])).toBe(true);
  });

  it("lookup returns null for unknown ids", () => {
    expect(getActionTemplate("does.not.exist")).toBeNull();
  });

  it("lookup returns the template for known ids", () => {
    const t = getActionTemplate("cs.send-nps-survey-top10");
    expect(t).not.toBeNull();
    expect(t?.domain).toBe("customer-success");
  });
});
