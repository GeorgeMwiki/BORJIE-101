/**
 * Credit Domain Seeds — shape and integrity tests.
 *
 * These tests guard the seed corpus that bootstraps the truth-engine for
 * IFRS 9 / Basel / PD-LGD-EAD / BoT prudential / sector NPL / 5Cs / DSR-DSCR.
 * Every seed must:
 *
 *   - Validate against the same zod schema persistClaim() uses.
 *   - Carry at least one evidence record with a parseable source URL.
 *   - When numeric, expose both numericValue and unit.
 *   - When jurisdictional, use only "GLOBAL" or a 2-letter ISO code.
 *
 * If any of these fail, the seed runner would either reject the row or
 * persist a malformed claim. We catch it at unit-test time instead.
 */

import { describe, expect, it } from "vitest";
import {
  getCreditDomainSeeds,
  getAllCreditDomainSeeds,
} from "../credit-domain-seeds";
import { validateClaimDraft } from "../../security";
import type { ClaimDraft } from "../../types";

const VALID_CATEGORIES = new Set([
  "pricing",
  "forex",
  "commodity",
  "regulatory",
  "structural",
  "benchmark",
  "geographic",
  "institutional",
]);

const VALID_JURISDICTIONS = /^[A-Z]{2}$|^GLOBAL$/;

function assertEveryClaimHasShape(
  seeds: readonly ClaimDraft[],
  scope: string,
): void {
  expect(seeds.length, `${scope}: at least one seed`).toBeGreaterThan(0);

  for (const seed of seeds) {
    // 1) Category is from the allowed union
    expect(VALID_CATEGORIES.has(seed.category), seed.factKey).toBe(true);

    // 2) factKey is snake_case + reasonable length
    expect(seed.factKey).toMatch(/^[a-z0-9_]+$/);
    expect(seed.factKey.length).toBeLessThanOrEqual(100);

    // 3) Subject + claimText non-trivial
    expect(seed.subject.length).toBeGreaterThanOrEqual(2);
    expect(seed.claimText.length).toBeGreaterThanOrEqual(10);

    // 4) Jurisdiction tag valid
    if (seed.jurisdiction !== undefined) {
      expect(seed.jurisdiction).toMatch(VALID_JURISDICTIONS);
    }

    // 5) Numeric claims must carry both numericValue and unit
    if (seed.numericValue !== undefined) {
      expect(
        seed.unit,
        `${seed.factKey} has numericValue but no unit`,
      ).toBeDefined();
      expect(Number.isFinite(seed.numericValue)).toBe(true);
    }

    // 6) Evidence — at least one entry, with sourceUrl parseable, excerpt
    //    >= 40 chars (per quality bar) and retrievedBy non-empty.
    expect(seed.evidence.length).toBeGreaterThanOrEqual(1);
    for (const ev of seed.evidence) {
      expect(ev.sourceUrl, `${seed.factKey}.evidence.sourceUrl`).toBeTruthy();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(() => new URL(ev.sourceUrl as string)).not.toThrow();
      expect(
        ev.excerpt.length,
        `${seed.factKey}.evidence.excerpt must be >= 40 chars`,
      ).toBeGreaterThanOrEqual(40);
      expect(ev.excerpt.length).toBeLessThanOrEqual(8000);
      expect(ev.retrievedBy.length).toBeGreaterThan(0);
    }

    // 7) createdBy must match the security-validator regex
    expect(seed.createdBy).toMatch(
      /^(system|cron:[a-z0-9_-]+|admin:[0-9a-f-]{36}|ondemand:[a-z0-9_:-]+)$/,
    );

    // 8) Defense-in-depth: every seed passes the same zod validator the
    //    persistence layer applies. Throws if anything is malformed.
    expect(() => validateClaimDraft(seed)).not.toThrow();
  }
}

describe("getCreditDomainSeeds(GLOBAL)", () => {
  const seeds = getCreditDomainSeeds("GLOBAL");

  it("returns IFRS / Basel / definitions seeds", () => {
    expect(seeds.length).toBeGreaterThanOrEqual(15);
  });

  it("every claim has the required shape", () => {
    assertEveryClaimHasShape(seeds, "GLOBAL");
  });

  it("only emits GLOBAL-tagged claims (no TZ-only data)", () => {
    for (const seed of seeds) {
      if (seed.jurisdiction !== undefined) {
        expect(seed.jurisdiction).toBe("GLOBAL");
      }
    }
  });

  it("includes IFRS 9 staging anchors", () => {
    const keys = seeds.map((s) => s.factKey);
    expect(keys).toContain("ifrs9_stage_1_definition");
    expect(keys).toContain("ifrs9_stage_2_definition");
    expect(keys).toContain("ifrs9_stage_3_definition");
    expect(keys).toContain("ifrs9_ecl_formula");
  });

  it("includes PD/LGD/EAD definitions and Basel floors", () => {
    const keys = seeds.map((s) => s.factKey);
    expect(keys).toContain("pd_definition");
    expect(keys).toContain("lgd_definition");
    expect(keys).toContain("ead_definition");
    expect(keys).toContain("basel_lgd_floor_unsecured_retail");
  });

  it("includes Basel III capital ratio anchors", () => {
    const keys = seeds.map((s) => s.factKey);
    expect(keys).toContain("basel_iii_cet1_minimum");
    expect(keys).toContain("basel_iii_tier1_minimum");
    expect(keys).toContain("basel_iii_total_capital_minimum");
    expect(keys).toContain("basel_iii_conservation_buffer");
  });

  it("includes the 5Cs of Credit", () => {
    const keys = seeds.map((s) => s.factKey);
    expect(keys).toContain("five_cs_of_credit");
    expect(keys).toContain("five_cs_character");
    expect(keys).toContain("five_cs_capacity");
    expect(keys).toContain("five_cs_capital");
    expect(keys).toContain("five_cs_collateral");
    expect(keys).toContain("five_cs_conditions");
  });
});

describe("getCreditDomainSeeds(TZ)", () => {
  const seeds = getCreditDomainSeeds("TZ");

  it("returns globals plus TZ-specific anchors", () => {
    const globals = getCreditDomainSeeds("GLOBAL");
    expect(seeds.length).toBeGreaterThan(globals.length);
  });

  it("every claim has the required shape", () => {
    assertEveryClaimHasShape(seeds, "TZ");
  });

  it("includes BoT prudential thresholds", () => {
    const keys = seeds.map((s) => s.factKey);
    expect(keys).toContain("bot_total_car_minimum");
    expect(keys).toContain("bot_tier1_car_minimum");
    expect(keys).toContain("bot_liquid_assets_ratio_minimum");
    expect(keys).toContain("bot_single_borrower_limit");
    expect(keys).toContain("bot_insider_lending_limit");
  });

  it("includes BoT sector NPL benchmarks", () => {
    const keys = seeds.map((s) => s.factKey);
    expect(keys).toContain("bot_npl_agriculture");
    expect(keys).toContain("bot_npl_manufacturing");
    expect(keys).toContain("bot_npl_trade_retail");
    expect(keys).toContain("bot_npl_transport_communication");
    expect(keys).toContain("bot_npl_building_construction");
    expect(keys).toContain("bot_npl_hotels_restaurants");
    expect(keys).toContain("bot_npl_personal");
    expect(keys).toContain("bot_npl_mining_quarrying");
  });

  it("includes CRB licensing anchors", () => {
    const keys = seeds.map((s) => s.factKey);
    expect(keys).toContain("crb_creditinfo_tanzania");
    expect(keys).toContain("crb_dun_bradstreet_tanzania");
    expect(keys).toContain("crb_free_annual_report_tz");
  });

  it("TZ-specific seeds all carry jurisdiction='TZ'", () => {
    const tzOnly = seeds.filter(
      (s) => s.factKey.startsWith("bot_") || s.factKey.startsWith("crb_"),
    );
    expect(tzOnly.length).toBeGreaterThanOrEqual(15);
    for (const seed of tzOnly) {
      expect(seed.jurisdiction).toBe("TZ");
    }
  });

  it("BoT-prudential numeric ratios all expose unit='percent'", () => {
    const numericBot = seeds.filter(
      (s) => s.factKey.startsWith("bot_") && s.numericValue !== undefined,
    );
    expect(numericBot.length).toBeGreaterThanOrEqual(5);
    for (const seed of numericBot) {
      expect(seed.unit).toBe("percent");
    }
  });

  it("uses bot.go.tz as evidence domain for every BoT-tagged seed", () => {
    const botSeeds = seeds.filter((s) => s.factKey.startsWith("bot_"));
    for (const seed of botSeeds) {
      const hasBotEvidence = seed.evidence.some(
        (e) => e.sourceDomain === "bot.go.tz",
      );
      expect(hasBotEvidence, `${seed.factKey} must cite bot.go.tz`).toBe(true);
    }
  });
});

describe("getCreditDomainSeeds(other)", () => {
  it("returns globals only when jurisdiction is not TZ", () => {
    const us = getCreditDomainSeeds("US");
    const globals = getCreditDomainSeeds("GLOBAL");
    expect(us.length).toBe(globals.length);
  });
});

describe("getAllCreditDomainSeeds", () => {
  it("returns the full corpus (globals + TZ)", () => {
    const all = getAllCreditDomainSeeds();
    expect(all.length).toBe(getCreditDomainSeeds("TZ").length);
    // Hard floor — the spec asks for ~25-40 high-quality seeds. We must clear
    // the lower bound or the engine has insufficient coverage to defend
    // against hallucination at launch.
    expect(all.length).toBeGreaterThanOrEqual(25);
  });

  it("has no duplicate factKey within the same jurisdiction", () => {
    const all = getAllCreditDomainSeeds();
    const seen = new Set<string>();
    for (const seed of all) {
      const key = `${seed.jurisdiction ?? "TZ"}:${seed.factKey}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
