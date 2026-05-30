/**
 * Source Authority — domain + source-type tier tests.
 */

import { describe, expect, it } from "vitest";
import { extractDomain, resolveSourceAuthority } from "../source-authority";

describe("extractDomain", () => {
  it("extracts host and strips www prefix", () => {
    expect(extractDomain("https://www.bot.go.tz/page")).toBe("bot.go.tz");
    expect(extractDomain("https://NMBBank.co.tz/loans")).toBe("nmbbank.co.tz");
  });

  it("returns null for malformed URLs", () => {
    expect(extractDomain("not a url")).toBeNull();
  });
});

describe("resolveSourceAuthority", () => {
  it("returns 1.0 for tier-1 .go.tz domains", () => {
    expect(
      resolveSourceAuthority({
        sourceUrl: "https://www.bot.go.tz/x",
        sourceDomain: "bot.go.tz",
        sourceType: "regulator",
      }),
    ).toBe(1.0);
  });

  it("returns 0.95 for known bank-official domains", () => {
    expect(
      resolveSourceAuthority({
        sourceUrl: "https://demo-bank.test/rates",
        sourceDomain: "demo-bank.test",
        sourceType: "bank_official",
      }),
    ).toBe(0.95);
  });

  it("returns 0.85 for World Bank / IMF tier", () => {
    expect(
      resolveSourceAuthority({
        sourceUrl: "https://data.worldbank.org/country/TZ",
        sourceDomain: "worldbank.org",
        sourceType: "academic",
      }),
    ).toBe(0.85);
  });

  it("falls back to source-type baseline when domain unknown", () => {
    expect(
      resolveSourceAuthority({
        sourceUrl: "https://random-blog.example",
        sourceDomain: "random-blog.example",
        sourceType: "news",
      }),
    ).toBe(0.65);
  });

  it("downweights anonymous user contributions to 0.3", () => {
    expect(
      resolveSourceAuthority({
        sourceUrl: null,
        sourceDomain: null,
        sourceType: "user_contributed",
      }),
    ).toBe(0.3);
  });

  it("boosts verified contributors to 0.6", () => {
    expect(
      resolveSourceAuthority({
        sourceUrl: null,
        sourceDomain: null,
        sourceType: "user_contributed",
        verifiedContributor: true,
      }),
    ).toBe(0.6);
  });

  it("returns 0.55 baseline for llm_consensus", () => {
    expect(
      resolveSourceAuthority({
        sourceUrl: null,
        sourceDomain: null,
        sourceType: "llm_consensus",
      }),
    ).toBe(0.55);
  });
});
