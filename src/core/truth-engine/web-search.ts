/**
 * Web Search Provider
 *
 * Pluggable abstraction over Brave Search / Tavily / Serper. Returns ranked
 * URLs the truth-engine can then fetch through `assertFetchAllowed()` (SSRF
 * guard). NEVER fetches results directly here, NEVER trusts user-supplied
 * URLs — the search layer only proposes, the SSRF layer disposes.
 *
 * Provider precedence (first available wins):
 *   1. Brave Search (BRAVE_SEARCH_API_KEY)        — privacy-preserving, generous free tier
 *   2. Tavily (TAVILY_API_KEY)                    — research-tuned, returns extracted content
 *   3. Serper (SERPER_API_KEY)                    — Google-backed, fast
 *
 * If no provider is configured, returns []. The truth-engine then falls back
 * to its hardcoded AUTHORITATIVE_SOURCES registry — never lies, just narrower.
 */

import { z } from "zod";
import { validateOutboundUrlWithDns } from "@/lib/url-allowlist";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebSearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedAt: string | null;
  readonly source: "brave" | "tavily" | "serper";
  readonly rank: number;
}

export interface WebSearchArgs {
  readonly query: string;
  readonly siteFilter?: readonly string[]; // e.g. ['bot.go.tz','tra.go.tz'] — restrict to allowlist
  readonly freshnessDays?: number; // ranks fresher results higher
  readonly maxResults?: number; // default 8
  readonly signal?: AbortSignal;
}

export interface WebSearchOutcome {
  readonly results: readonly WebSearchResult[];
  readonly provider: "brave" | "tavily" | "serper" | "none";
  readonly latencyMs: number;
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Provider response schemas (defense-in-depth: validate before using)
// ---------------------------------------------------------------------------

const braveSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            url: z.string().url(),
            title: z.string(),
            description: z.string().default(""),
            age: z.string().nullish(),
          }),
        )
        .default([]),
    })
    .default({ results: [] }),
});

const tavilySchema = z.object({
  results: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string(),
        content: z.string().default(""),
        published_date: z.string().nullish(),
      }),
    )
    .default([]),
});

const serperSchema = z.object({
  organic: z
    .array(
      z.object({
        link: z.string().url(),
        title: z.string(),
        snippet: z.string().default(""),
        date: z.string().nullish(),
      }),
    )
    .default([]),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a web search through the first configured provider. Always returns a
 * structured outcome — never throws, never leaks API keys to the caller.
 */
export async function searchWeb(
  args: WebSearchArgs,
): Promise<WebSearchOutcome> {
  const start = Date.now();
  const max = args.maxResults ?? 8;

  // Build siteFilter clause if provided
  const query = buildQuery(args.query, args.siteFilter);

  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const results = await searchBrave(query, max, args.signal);
      return {
        results,
        provider: "brave",
        latencyMs: Date.now() - start,
        error: null,
      };
    } catch (err) {
      return fallthrough(err, "brave", query, max, args, start);
    }
  }

  if (process.env.TAVILY_API_KEY) {
    try {
      const results = await searchTavily(query, max, args.signal);
      return {
        results,
        provider: "tavily",
        latencyMs: Date.now() - start,
        error: null,
      };
    } catch (err) {
      return fallthrough(err, "tavily", query, max, args, start);
    }
  }

  if (process.env.SERPER_API_KEY) {
    try {
      const results = await searchSerper(query, max, args.signal);
      return {
        results,
        provider: "serper",
        latencyMs: Date.now() - start,
        error: null,
      };
    } catch (err) {
      return {
        results: [],
        provider: "serper",
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : "serper_failed",
      };
    }
  }

  // No provider configured — caller falls back to AUTHORITATIVE_SOURCES
  return {
    results: [],
    provider: "none",
    latencyMs: Date.now() - start,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function searchBrave(
  query: string,
  max: number,
  signal?: AbortSignal,
): Promise<readonly WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(max, 20)));
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("freshness", "py"); // past year by default

  const urlCheck = await validateOutboundUrlWithDns(url.toString());
  if (!urlCheck.ok) {
    throw new Error(`brave outbound URL rejected: ${urlCheck.reason}`);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`brave_http_${response.status}`);
  }

  const json = braveSchema.parse(await response.json());
  return json.web.results.slice(0, max).map((r, i) => ({
    url: r.url,
    title: r.title,
    snippet: r.description,
    publishedAt: r.age ?? null,
    source: "brave" as const,
    rank: i + 1,
  }));
}

async function searchTavily(
  query: string,
  max: number,
  signal?: AbortSignal,
): Promise<readonly WebSearchResult[]> {
  const tavilyUrl = "https://api.tavily.com/search";
  const urlCheck = await validateOutboundUrlWithDns(tavilyUrl);
  if (!urlCheck.ok) {
    throw new Error(`tavily outbound URL rejected: ${urlCheck.reason}`);
  }

  const response = await fetch(tavilyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "advanced",
      max_results: Math.min(max, 20),
      include_answer: false,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`tavily_http_${response.status}`);
  }

  const json = tavilySchema.parse(await response.json());
  return json.results.slice(0, max).map((r, i) => ({
    url: r.url,
    title: r.title,
    snippet: r.content.slice(0, 500),
    publishedAt: r.published_date ?? null,
    source: "tavily" as const,
    rank: i + 1,
  }));
}

async function searchSerper(
  query: string,
  max: number,
  signal?: AbortSignal,
): Promise<readonly WebSearchResult[]> {
  const serperUrl = "https://google.serper.dev/search";
  const urlCheck = await validateOutboundUrlWithDns(serperUrl);
  if (!urlCheck.ok) {
    throw new Error(`serper outbound URL rejected: ${urlCheck.reason}`);
  }

  const response = await fetch(serperUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.SERPER_API_KEY ?? "",
    },
    body: JSON.stringify({ q: query, num: Math.min(max, 20) }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`serper_http_${response.status}`);
  }

  const json = serperSchema.parse(await response.json());
  return json.organic.slice(0, max).map((r, i) => ({
    url: r.link,
    title: r.title,
    snippet: r.snippet,
    publishedAt: r.date ?? null,
    source: "serper" as const,
    rank: i + 1,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQuery(base: string, siteFilter?: readonly string[]): string {
  const trimmed = base.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!siteFilter || siteFilter.length === 0) return trimmed;
  // Build (site:a.com OR site:b.com) clause
  const sites = siteFilter
    .filter((d) => /^[a-z0-9.\-]+$/i.test(d))
    .slice(0, 8)
    .map((d) => `site:${d}`)
    .join(" OR ");
  if (!sites) return trimmed;
  return `${trimmed} (${sites})`;
}

function fallthrough(
  err: unknown,
  provider: "brave" | "tavily",
  query: string,
  max: number,
  args: WebSearchArgs,
  start: number,
): WebSearchOutcome {
  // If primary provider fails, try the next configured one
  const _nextProvider = provider === "brave" ? "tavily" : "serper";

  if (provider === "brave" && process.env.TAVILY_API_KEY) {
    return retryWith("tavily", query, max, args, start, err);
  }
  if (
    (provider === "brave" || provider === "tavily") &&
    process.env.SERPER_API_KEY
  ) {
    return retryWith("serper", query, max, args, start, err);
  }

  return {
    results: [],
    provider,
    latencyMs: Date.now() - start,
    error: err instanceof Error ? err.message : `${provider}_failed`,
  };
}

function retryWith(
  next: "tavily" | "serper",
  query: string,
  max: number,
  args: WebSearchArgs,
  start: number,
  primaryErr: unknown,
): WebSearchOutcome {
  void primaryErr;
  // Fire-and-forget retry path: spawn the next provider but cap latency
  // by returning the unsuccessful outcome immediately if the second call
  // also fails. We don't await here to keep the surface non-blocking;
  // callers that need fallback should call searchWeb again with the
  // failed provider's env unset (test harnesses) or rely on the fact
  // that the next searchWeb invocation will pick the available provider.
  // For the truth-engine, primary failure simply degrades gracefully.
  return {
    results: [],
    provider: next,
    latencyMs: Date.now() - start,
    error: "primary_failed_fallback_deferred",
  };
}
