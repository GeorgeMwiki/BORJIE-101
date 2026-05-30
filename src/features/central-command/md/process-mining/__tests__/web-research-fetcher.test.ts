/**
 * Tests — WebResearchFetcher branding (H-3). Verifies that an
 * unbranded closure cannot satisfy the type/runtime check.
 */

import { describe, expect, it } from "vitest";

import { isWebResearchFetcher, markAsWebResearchFetcher } from "../types";

describe("WebResearchFetcher brand", () => {
  it("plain closure is NOT a WebResearchFetcher", () => {
    const raw = async () => [];
    expect(isWebResearchFetcher(raw)).toBe(false);
  });

  it("markAsWebResearchFetcher produces a branded fetcher", () => {
    const branded = markAsWebResearchFetcher(async () => []);
    expect(isWebResearchFetcher(branded)).toBe(true);
  });

  it("non-function values are rejected", () => {
    expect(isWebResearchFetcher(null)).toBe(false);
    expect(isWebResearchFetcher("not a function")).toBe(false);
    expect(isWebResearchFetcher({})).toBe(false);
    expect(isWebResearchFetcher(undefined)).toBe(false);
  });

  it("branded fetcher returns its citation array", async () => {
    const branded = markAsWebResearchFetcher(async () => [
      {
        url: "https://example.com",
        title: "Test",
        quote: "A meaningful pull-quote here.",
      },
    ]);
    const result = await branded("query");
    expect(result.length).toBe(1);
    expect(result[0]!.url).toBe("https://example.com");
  });
});
