/**
 * Tests for `runDeepResearch` — the MD-side synthesis tool that
 * combines web search + page fetch + internal lookup into one
 * confidence-scored finding bundle.
 *
 * Coverage:
 *   - Happy path with web hits only → web-only confidence + summary
 *   - Internal-only lookup → internal-anchored confidence + reason
 *   - Mixed sources → both included; internal-boost increases confidence
 *   - Empty query → no_data short circuit
 *   - Web search provider throws → continues with internal-only
 *   - Web fetch fails for a hit → that hit is skipped
 *   - maxUrls cap honored
 *   - walltime budget honored (no further fetches after deadline)
 *   - excerpts capped at 1200 chars
 */

import { describe, it, expect, vi } from "vitest";
import {
  runDeepResearch,
  type ResearchFinding,
  type WebFetchProvider,
  type WebSearchProvider,
} from "../deep-research";

const makeWebSearch =
  (
    hits: ReadonlyArray<{
      url: string;
      title: string;
      snippet?: string;
      score?: number;
    }>,
    behaviour: "ok" | "throw" = "ok",
  ): WebSearchProvider =>
  async (_q, _opts) => {
    if (behaviour === "throw") throw new Error("search_down");
    return hits;
  };

const makeWebFetch =
  (
    pages: Record<
      string,
      { url: string; title: string; textExcerpt: string } | "throw"
    >,
  ): WebFetchProvider =>
  async (url, _opts) => {
    const v = pages[url];
    if (!v) throw new Error(`unknown_url:${url}`);
    if (v === "throw") throw new Error(`fetch_failed:${url}`);
    return v;
  };

describe("runDeepResearch — empty query", () => {
  it("short-circuits with confidence=0 + reason=empty_query", async () => {
    const out = await runDeepResearch({
      query: "   ",
      webSearch: makeWebSearch([]),
      webFetch: makeWebFetch({}),
    });
    expect(out.confidence).toBe(0);
    expect(out.reason).toBe("empty_query");
    expect(out.findings).toHaveLength(0);
  });
});

describe("runDeepResearch — happy paths", () => {
  it("returns web findings + a sensible confidence + web-only reason", async () => {
    const out = await runDeepResearch({
      query: "tier-2 loan rates",
      webSearch: makeWebSearch([
        { url: "https://a.example/x", title: "Bank A", score: 0.8 },
        { url: "https://b.example/y", title: "Bank B", score: 0.6 },
      ]),
      webFetch: makeWebFetch({
        "https://a.example/x": {
          url: "https://a.example/x",
          title: "Bank A",
          textExcerpt: "tier-2 loans at 14%",
        },
        "https://b.example/y": {
          url: "https://b.example/y",
          title: "Bank B",
          textExcerpt: "tier-2 loans at 16%",
        },
      }),
    });
    expect(out.findings).toHaveLength(2);
    expect(out.findings.every((f) => f.source === "web")).toBe(true);
    expect(out.confidence).toBeGreaterThan(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
    expect(out.reason).toBe("web-only");
    expect(out.summary).toContain("tier-2 loan rates");
  });

  it("internal-only lookup produces internal-anchored reason + boost", async () => {
    const internalFindings: ReadonlyArray<ResearchFinding> = [
      {
        source: "internal",
        rowRef: { table: "loans", id: "row-1" },
        title: "Existing loan #1",
        excerpt: "tier-2 issued at 13.5% APR",
        relevance: 0.9,
      },
    ];
    const out = await runDeepResearch({
      query: "tier-2 internal",
      webSearch: makeWebSearch([]),
      webFetch: makeWebFetch({}),
      internalLookup: async () => internalFindings,
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].source).toBe("internal");
    expect(out.reason).toContain("internal-anchored");
  });

  it("mixed sources combine findings + internal boost lifts confidence", async () => {
    const webOnly = await runDeepResearch({
      query: "competitor pricing",
      webSearch: makeWebSearch([
        { url: "https://w.example/p", title: "C1", score: 0.8 },
      ]),
      webFetch: makeWebFetch({
        "https://w.example/p": {
          url: "https://w.example/p",
          title: "C1",
          textExcerpt: "12% rate",
        },
      }),
    });
    const mixed = await runDeepResearch({
      query: "competitor pricing",
      webSearch: makeWebSearch([
        { url: "https://w.example/p", title: "C1", score: 0.8 },
      ]),
      webFetch: makeWebFetch({
        "https://w.example/p": {
          url: "https://w.example/p",
          title: "C1",
          textExcerpt: "12% rate",
        },
      }),
      internalLookup: async () => [
        {
          source: "internal",
          rowRef: { table: "rates", id: "r" },
          title: "Our rate",
          excerpt: "13%",
          relevance: 0.85,
        },
      ],
    });
    expect(mixed.confidence).toBeGreaterThanOrEqual(webOnly.confidence);
    expect(mixed.findings).toHaveLength(2);
  });
});

describe("runDeepResearch — failure tolerance", () => {
  it("continues with internal data when web search throws", async () => {
    const out = await runDeepResearch({
      query: "x",
      webSearch: makeWebSearch([], "throw"),
      webFetch: makeWebFetch({}),
      internalLookup: async () => [
        {
          source: "internal",
          rowRef: { table: "t", id: "id-1" },
          title: "row",
          excerpt: "value",
          relevance: 0.7,
        },
      ],
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].source).toBe("internal");
  });

  it("skips a URL whose fetch fails but keeps the others", async () => {
    const out = await runDeepResearch({
      query: "x",
      webSearch: makeWebSearch([
        { url: "https://a.example/x", title: "A", score: 0.7 },
        { url: "https://b.example/y", title: "B", score: 0.7 },
      ]),
      webFetch: makeWebFetch({
        "https://a.example/x": "throw",
        "https://b.example/y": {
          url: "https://b.example/y",
          title: "B",
          textExcerpt: "ok",
        },
      }),
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].title).toBe("B");
  });

  it("returns no_data summary when both lanes are empty", async () => {
    const out = await runDeepResearch({
      query: "x",
      webSearch: makeWebSearch([]),
      webFetch: makeWebFetch({}),
    });
    expect(out.confidence).toBe(0);
    expect(out.reason).toBe("no_data");
    expect(out.summary).toContain("No findings");
  });
});

describe("runDeepResearch — caps + budgets", () => {
  it("honours maxUrls", async () => {
    const fetchSpy = vi.fn(async (url: string) => ({
      url,
      title: "t",
      textExcerpt: "x",
    }));
    const out = await runDeepResearch({
      query: "x",
      maxUrls: 2,
      webSearch: makeWebSearch([
        { url: "https://1.x/", title: "1", score: 0.5 },
        { url: "https://2.x/", title: "2", score: 0.5 },
        { url: "https://3.x/", title: "3", score: 0.5 },
        { url: "https://4.x/", title: "4", score: 0.5 },
      ]),
      webFetch: fetchSpy,
    });
    expect(out.findings).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("excerpts are capped at 1200 chars", async () => {
    const long = "y".repeat(5000);
    const out = await runDeepResearch({
      query: "x",
      webSearch: makeWebSearch([
        { url: "https://big.x/", title: "Big", score: 0.6 },
      ]),
      webFetch: makeWebFetch({
        "https://big.x/": {
          url: "https://big.x/",
          title: "Big",
          textExcerpt: long,
        },
      }),
    });
    expect(out.findings[0].excerpt.length).toBe(1200);
  });

  it("stops fetching once the walltime budget is exhausted", async () => {
    let now = 0;
    const tick = () => now;
    const fetchSpy = vi.fn(async (url: string) => {
      now += 50;
      return { url, title: "t", textExcerpt: "x" };
    });
    const out = await runDeepResearch({
      query: "x",
      walltimeMs: 100,
      clock: tick,
      webSearch: makeWebSearch([
        { url: "https://1.x/", title: "1", score: 0.5 },
        { url: "https://2.x/", title: "2", score: 0.5 },
        { url: "https://3.x/", title: "3", score: 0.5 },
        { url: "https://4.x/", title: "4", score: 0.5 },
      ]),
      webFetch: fetchSpy,
    });
    // First two fetches take 50 + 50 = 100 ms; third would overrun.
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(out.findings.length).toBeLessThanOrEqual(3);
  });
});
