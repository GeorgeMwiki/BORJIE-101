/**
 * Cross-Source Synthesizer — verdict tests.
 */

import { describe, expect, it } from "vitest";
import { synthesizeAcrossSources } from "../cross-source-synthesizer";
import type { CandidateEvidence } from "../types";

const evidence = (
  domain: string,
  excerpt: string,
  type: CandidateEvidence["sourceType"] = "regulator",
): CandidateEvidence => ({
  sourceType: type,
  sourceUrl: `https://${domain}/page`,
  sourceDomain: domain,
  excerpt,
  retrievedBy: "system",
});

describe("synthesizeAcrossSources", () => {
  it("returns insufficient when no usable excerpts", () => {
    const result = synthesizeAcrossSources([]);
    expect(result.verdict).toBe("insufficient");
  });

  it("returns insufficient when all excerpts are too short", () => {
    const result = synthesizeAcrossSources([
      evidence("bot.go.tz", "tiny"),
      evidence("tra.go.tz", "also tiny"),
    ]);
    expect(result.verdict).toBe("insufficient");
  });

  it("returns consensus when 2+ sources agree on the same numeric within 5%", () => {
    const result = synthesizeAcrossSources([
      evidence(
        "bot.go.tz",
        "The headline inflation rate stood at 3.5 percent year-on-year in March 2026.",
      ),
      evidence(
        "nbs.go.tz",
        "Consumer Price Index inflation reached 3.6 percent on annual basis in March.",
      ),
    ]);
    expect(result.verdict).toBe("consensus");
    expect(result.agreeingDomains).toContain("bot.go.tz");
    expect(result.agreeingDomains).toContain("nbs.go.tz");
  });

  it("returns disputed when sources disagree beyond tolerance", () => {
    const result = synthesizeAcrossSources([
      evidence(
        "bot.go.tz",
        "The Central Bank Rate is set at 6 percent following the latest MPC decision.",
      ),
      evidence(
        "newsource.com",
        "Tanzanian central bank rate is 9 percent according to recent reports.",
      ),
      evidence(
        "secondnews.com",
        "Industry analysts cite the policy rate at 12 percent in their commentary.",
      ),
    ]);
    expect(result.verdict).toBe("disputed");
    expect(result.conflictingDomains.length).toBeGreaterThan(0);
  });

  it("returns partial when only one source carries a numeric", () => {
    const result = synthesizeAcrossSources([
      evidence(
        "bot.go.tz",
        "The Bank of Tanzania has reported a single benchmark rate of 6 percent for this quarter.",
      ),
    ]);
    expect(result.verdict).toBe("partial");
    expect(result.leadingNumeric).toBeCloseTo(6, 1);
  });

  it("ignores year-like numbers (1900-2099) when picking the leading numeric", () => {
    const result = synthesizeAcrossSources([
      evidence(
        "bot.go.tz",
        "Per the 2024 annual report, the policy rate was set at 6 percent.",
      ),
    ]);
    expect(result.leadingNumeric).toBeCloseTo(6, 1);
    expect(result.leadingNumeric).not.toBe(2024);
  });

  it("returns text-only consensus when 2+ sources agree but no numerics", () => {
    const result = synthesizeAcrossSources([
      evidence(
        "bot.go.tz",
        "Mobile money licensing in Tanzania falls under the Bank of Tanzania payment systems oversight regime.",
      ),
      evidence(
        "tcra.go.tz",
        "The Bank of Tanzania regulates mobile money operators under the National Payment Systems Act.",
      ),
    ]);
    expect(result.verdict).toBe("consensus");
    expect(result.leadingNumeric).toBeNull();
  });
});
