/**
 * WebSearchProvider — chained Brave → SerpAPI → DuckDuckGo HTML.
 *
 * The MD's `runDeepResearch` calls one provider; this module wires
 * three engines behind it. The first one with a configured API key
 * answers; failures cascade through to the next. DuckDuckGo's HTML
 * endpoint is the no-key fallback.
 *
 * Server-only: every fetch uses `BRAVE_SEARCH_API_KEY` /
 * `SERPAPI_API_KEY` from the process env. Keys never reach the
 * browser; the MD chat route is the only consumer.
 *
 * Bank-grade discipline:
 *   - Per-engine timeout (default 6 s).
 *   - Hard cap on results returned (default 5 — overridden by caller).
 *   - On every engine: parse defensively, return [] on any unexpected
 *     shape rather than throw, so the synthesis stage still completes.
 *
 * @module features/central-command/md/research/web-search-provider
 */

import { createLogger } from "@/lib/logger";
import { getAdapterBreaker } from "@/core/risk-mitigation/adapter-breakers";

import type { WebSearchHit, WebSearchProvider } from "./deep-research";

const log = createLogger("md.research.web-search");

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_LIMIT = 5;

export interface MakeWebSearchProviderOptions {
  /** Override the per-engine timeout (default 6 s). */
  readonly timeoutMs?: number;
  /** Override the BRAVE key (otherwise reads BRAVE_SEARCH_API_KEY). */
  readonly braveApiKey?: string;
  /** Override the SerpAPI key (otherwise reads SERPAPI_API_KEY). */
  readonly serpApiKey?: string;
  /** Inject a custom fetch (test seam). */
  readonly fetchImpl?: typeof fetch;
}

export function makeWebSearchProvider(
  options: MakeWebSearchProviderOptions = {},
): WebSearchProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const braveKey =
    options.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY ?? "";
  const serpKey = options.serpApiKey ?? process.env.SERPAPI_API_KEY ?? "";

  return async (
    query: string,
    opts?: { readonly limit?: number },
  ): Promise<ReadonlyArray<WebSearchHit>> => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const limit = Math.max(1, Math.min(20, opts?.limit ?? DEFAULT_LIMIT));

    // Try Brave first when configured.
    if (braveKey) {
      const hits = await safeSearch(
        () => braveSearch(trimmed, limit, braveKey, fetchImpl, timeoutMs),
        "brave",
      );
      if (hits.length > 0) return hits;
    }

    // Then SerpAPI.
    if (serpKey) {
      const hits = await safeSearch(
        () => serpApiSearch(trimmed, limit, serpKey, fetchImpl, timeoutMs),
        "serpapi",
      );
      if (hits.length > 0) return hits;
    }

    // No-key fallback. DuckDuckGo Lite HTML endpoint is intentionally
    // simple — parses the first N anchor tags. Returns [] on any
    // structural drift.
    const ddg = await safeSearch(
      () => duckduckgoSearch(trimmed, limit, fetchImpl, timeoutMs),
      "duckduckgo",
    );
    return ddg;
  };
}

// ---------------------------------------------------------------------------
// Engine implementations
// ---------------------------------------------------------------------------

async function braveSearch(
  query: string,
  limit: number,
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ReadonlyArray<WebSearchHit>> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  // iter-44: wrap the Brave HTTP call in the shared "brave-search" breaker.
  // When the upstream is failing fast we want to stop spending request
  // budget on it; the chained SerpAPI / DDG fallback still answers.
  const res = await getAdapterBreaker("brave-search").execute(() =>
    fetchWithTimeout(
      fetchImpl,
      url.toString(),
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
      },
      timeoutMs,
    ),
  );
  if (!res.ok) {
    log.warn("brave.search.non-ok", { status: res.status });
    return [];
  }
  const body = (await res.json()) as {
    web?: {
      results?: Array<{ url: string; title: string; description?: string }>;
    };
  };
  const rows = body.web?.results ?? [];
  return rows
    .filter((r) => typeof r.url === "string" && typeof r.title === "string")
    .slice(0, limit)
    .map(
      (r): WebSearchHit => ({
        url: r.url,
        title: r.title,
        snippet: r.description,
        // Brave doesn't expose a numeric score; assume mid-band relevance.
        score: 0.7,
      }),
    );
}

async function serpApiSearch(
  query: string,
  limit: number,
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ReadonlyArray<WebSearchHit>> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(limit));
  url.searchParams.set("engine", "google");
  // iter-44: wrap SerpAPI call in shared "serpapi" breaker.
  const res = await getAdapterBreaker("serpapi").execute(() =>
    fetchWithTimeout(fetchImpl, url.toString(), {}, timeoutMs),
  );
  if (!res.ok) {
    log.warn("serpapi.search.non-ok", { status: res.status });
    return [];
  }
  const body = (await res.json()) as {
    organic_results?: Array<{ link: string; title: string; snippet?: string }>;
  };
  const rows = body.organic_results ?? [];
  return rows
    .filter((r) => typeof r.link === "string" && typeof r.title === "string")
    .slice(0, limit)
    .map(
      (r): WebSearchHit => ({
        url: r.link,
        title: r.title,
        snippet: r.snippet,
        score: 0.65,
      }),
    );
}

async function duckduckgoSearch(
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ReadonlyArray<WebSearchHit>> {
  // DuckDuckGo's Instant Answer API has poor coverage for arbitrary
  // queries. The HTML endpoint at /html/ returns server-rendered
  // results we can parse with a tight regex. No key needed.
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const res = await fetchWithTimeout(
    fetchImpl,
    url.toString(),
    {
      headers: {
        // Identifies the request to the upstream; mirrors common
        // server-side proxies.
        "User-Agent": "BorjieMDResearcher/1.0 (+https://borjie.co.tz/research)",
      },
    },
    timeoutMs,
  );
  if (!res.ok) {
    log.warn("duckduckgo.search.non-ok", { status: res.status });
    return [];
  }
  const html = await res.text();
  // Extract result blocks: <a class="result__a" href="...">title</a>
  const linkPattern =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const hits: WebSearchHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(html)) !== null && hits.length < limit) {
    const href = m[1];
    const title = stripTags(m[2]).trim();
    const real = unwrapDuckduckgoRedirect(href);
    if (!title || !real) continue;
    hits.push({ url: real, title, score: 0.55 });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function safeSearch<T>(
  fn: () => Promise<ReadonlyArray<T>>,
  engineName: string,
): Promise<ReadonlyArray<T>> {
  try {
    return await fn();
  } catch (e) {
    log.warn(`md.web-search.${engineName}.failed`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function unwrapDuckduckgoRedirect(href: string): string {
  // DDG wraps results in /l/?uddg=<encoded>; pluck the real target.
  if (href.startsWith("//duckduckgo.com/l/")) {
    const idx = href.indexOf("uddg=");
    if (idx >= 0) {
      try {
        return decodeURIComponent(href.slice(idx + 5).split("&")[0]);
      } catch {
        return "";
      }
    }
  }
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  return "";
}
