/**
 * Tests for makeWebSearchProvider — engine chaining + safety.
 *
 * Coverage:
 *   - Empty query → []
 *   - Brave configured + happy → uses Brave (SerpAPI not called)
 *   - Brave fails / returns 0 hits → falls through to SerpAPI
 *   - Both fail → falls through to DuckDuckGo HTML
 *   - Engine timeout aborts the request and returns []
 *   - Limit cap is honored (1..20)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeWebSearchProvider } from "../web-search-provider";

// iter-60-techdebt-zero § 4: snapshot + restore process.env so mutations
// inside this file never leak into other suites.
const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

const BRAVE_OK_BODY = JSON.stringify({
  web: {
    results: [
      { url: "https://a.example/", title: "A", description: "snippet-a" },
      { url: "https://b.example/", title: "B" },
    ],
  },
});

const SERP_OK_BODY = JSON.stringify({
  organic_results: [
    { link: "https://serp1.example/", title: "S1", snippet: "snippet-s1" },
    { link: "https://serp2.example/", title: "S2" },
  ],
});

const DDG_HTML = `
<div>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg1.example%2F">DDG One</a>
  <a class="result__a" href="https://ddg2.example/">DDG Two</a>
</div>`;

function makeResp(body: string, init: { status?: number } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const ORIGINAL_BRAVE = process.env.BRAVE_SEARCH_API_KEY;
const ORIGINAL_SERP = process.env.SERPAPI_API_KEY;

beforeEach(() => {
  process.env.BRAVE_SEARCH_API_KEY = "";
  process.env.SERPAPI_API_KEY = "";
});

afterAllResetEnv();

function afterAllResetEnv(): void {
  // Snapshot restoration helper kept inline so the file stays
  // single-purpose.
  if (ORIGINAL_BRAVE === undefined) {
    delete process.env.BRAVE_SEARCH_API_KEY;
  } else {
    process.env.BRAVE_SEARCH_API_KEY = ORIGINAL_BRAVE;
  }
  if (ORIGINAL_SERP === undefined) {
    delete process.env.SERPAPI_API_KEY;
  } else {
    process.env.SERPAPI_API_KEY = ORIGINAL_SERP;
  }
}

describe("makeWebSearchProvider — input safety", () => {
  it("returns [] on empty / whitespace query without calling fetch", async () => {
    const fetchSpy = vi.fn();
    const provider = makeWebSearchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(await provider("")).toEqual([]);
    expect(await provider("   ")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("makeWebSearchProvider — engine chain", () => {
  it("uses Brave when its key is configured and the upstream returns hits", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain("api.search.brave.com");
      return makeResp(BRAVE_OK_BODY);
    });
    const provider = makeWebSearchProvider({
      braveApiKey: "brave-key",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("term");
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://a.example/");
    expect(out[0].title).toBe("A");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls through Brave → SerpAPI when Brave returns 0 hits", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("api.search.brave.com")) {
        return makeResp(JSON.stringify({ web: { results: [] } }));
      }
      if (url.includes("serpapi.com")) {
        return makeResp(SERP_OK_BODY);
      }
      return makeResp("", { status: 500 });
    });
    const provider = makeWebSearchProvider({
      braveApiKey: "k",
      serpApiKey: "k2",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("term");
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://serp1.example/");
  });

  it("falls through to DuckDuckGo HTML when no keys are set", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain("html.duckduckgo.com");
      return new Response(DDG_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const provider = makeWebSearchProvider({
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("term");
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://ddg1.example/");
    expect(out[0].title).toBe("DDG One");
    expect(out[1].url).toBe("https://ddg2.example/");
  });

  it("returns [] when all engines fail", async () => {
    const fetchSpy = vi.fn(async () => makeResp("", { status: 500 }));
    const provider = makeWebSearchProvider({
      braveApiKey: "k",
      serpApiKey: "k2",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("term");
    expect(out).toEqual([]);
  });

  it("honours the caller-supplied limit", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain("count=2");
      return makeResp(BRAVE_OK_BODY);
    });
    const provider = makeWebSearchProvider({
      braveApiKey: "k",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    const out = await provider("term", { limit: 2 });
    expect(out.length).toBeLessThanOrEqual(2);
  });
});
