/**
 * Deep-research tool — combines web search + page fetch + internal
 * data lookup into one synthesis pass the MD can call mid-turn.
 *
 * Owner says "find out what our top competitor charges for tier-2
 * loans" → the MD invokes `runDeepResearch({query, internalLookup})`
 * which:
 *
 *   1. Issues `webSearchProvider(query)` to gather candidate URLs.
 *   2. Fetches the top-N pages via `webFetchProvider(url)`.
 *   3. Pulls matching internal rows via the caller-supplied
 *      `internalLookup(query)` (Supabase reads scoped to the org).
 *   4. Builds a `ResearchSynthesis` with raw findings + citations
 *      that the orchestrator can render as a `md.research` event
 *      or fold into an `md.assessment`.
 *
 * Constitutional discipline:
 *   - No live API keys leak into the browser — providers are passed
 *     in by the caller so the same module powers both the server
 *     route and the in-test mocks.
 *   - Every finding carries a citation; a synthesis with empty
 *     findings returns `confidence: 0` and a "no_data" reason
 *     instead of fabricating an answer.
 *   - Bounded: max URLs fetched per call (default 5), max body bytes
 *     per page (default 100 KB), max total wall-clock (default 30s).
 *
 * @module features/central-command/md/research/deep-research
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const WEB_SEARCH_HIT_SCHEMA = z.object({
  url: z.string().url(),
  title: z.string(),
  snippet: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
});
export type WebSearchHit = z.infer<typeof WEB_SEARCH_HIT_SCHEMA>;

export const RESEARCH_FINDING_SCHEMA = z.object({
  source: z.enum(["web", "internal"]),
  url: z.string().optional(),
  rowRef: z
    .object({
      table: z.string(),
      id: z.string(),
    })
    .optional(),
  title: z.string(),
  excerpt: z.string(),
  /** Confidence the finding actually answers the query (0..1). */
  relevance: z.number().min(0).max(1),
});
export type ResearchFinding = z.infer<typeof RESEARCH_FINDING_SCHEMA>;

export const RESEARCH_SYNTHESIS_SCHEMA = z.object({
  query: z.string(),
  findings: z.array(RESEARCH_FINDING_SCHEMA),
  summary: z.string(),
  /** Aggregate confidence in [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** Reason for the confidence value (used by the audit trail). */
  reason: z.string(),
  durationMs: z.number().int().min(0),
});
export type ResearchSynthesis = z.infer<typeof RESEARCH_SYNTHESIS_SCHEMA>;

// ---------------------------------------------------------------------------
// Caller-supplied provider ports
// ---------------------------------------------------------------------------

/** Web search adapter — Brave, SerpAPI, DuckDuckGo, whatever the caller wires. */
export type WebSearchProvider = (
  query: string,
  options?: { readonly limit?: number },
) => Promise<ReadonlyArray<WebSearchHit>>;

/** Web page fetch adapter — server-side, applies UA + size cap upstream. */
export type WebFetchProvider = (
  url: string,
  options?: { readonly maxBytes?: number },
) => Promise<{
  readonly url: string;
  readonly title: string;
  readonly textExcerpt: string;
}>;

/** Internal data lookup — Supabase reads scoped to caller's org/tier. */
export type InternalLookupProvider = (
  query: string,
) => Promise<ReadonlyArray<ResearchFinding>>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RunDeepResearchInput {
  readonly query: string;
  readonly webSearch: WebSearchProvider;
  readonly webFetch: WebFetchProvider;
  readonly internalLookup?: InternalLookupProvider;
  readonly maxUrls?: number;
  readonly maxPerPageBytes?: number;
  readonly walltimeMs?: number;
  readonly clock?: () => number;
}

const DEFAULTS = {
  maxUrls: 5,
  maxPerPageBytes: 100_000,
  walltimeMs: 30_000,
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runDeepResearch(
  rawInput: RunDeepResearchInput,
): Promise<ResearchSynthesis> {
  const query = rawInput.query.trim();
  if (!query) {
    return Object.freeze({
      query: "",
      findings: [],
      summary: "Empty research query — nothing to look up.",
      confidence: 0,
      reason: "empty_query",
      durationMs: 0,
    });
  }

  const clock = rawInput.clock ?? Date.now;
  const start = clock();
  const maxUrls = rawInput.maxUrls ?? DEFAULTS.maxUrls;
  const maxPerPageBytes = rawInput.maxPerPageBytes ?? DEFAULTS.maxPerPageBytes;
  const walltimeMs = rawInput.walltimeMs ?? DEFAULTS.walltimeMs;

  const deadline = start + walltimeMs;
  const findings: ResearchFinding[] = [];

  // ---- Internal lookup runs in parallel with web ------------------------
  const internalPromise: Promise<ReadonlyArray<ResearchFinding>> =
    rawInput.internalLookup
      ? safeCall(() => rawInput.internalLookup!(query))
      : Promise.resolve([]);

  // ---- Web search + fetch ------------------------------------------------
  const webPromise = (async (): Promise<ReadonlyArray<ResearchFinding>> => {
    const hits = await safeCall(() =>
      rawInput.webSearch(query, { limit: maxUrls }),
    );
    const top = hits.slice(0, maxUrls);
    const out: ResearchFinding[] = [];
    for (const hit of top) {
      if (clock() >= deadline) break;
      // Inline try/catch (not safeCall) so a single page fetch failure
      // yields `null` rather than safeCall's default `[]`, which we'd
      // otherwise read as a page object and crash on .textExcerpt.
      let page: {
        readonly url: string;
        readonly title: string;
        readonly textExcerpt: string;
      } | null = null;
      try {
        page = await rawInput.webFetch(hit.url, {
          maxBytes: maxPerPageBytes,
        });
      } catch (e) {
        if (typeof console !== "undefined") {
          console.warn("[md.deep-research] page fetch failed", {
            url: hit.url,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        page = null;
      }
      if (!page) continue;
      out.push({
        source: "web",
        url: page.url,
        title: page.title || hit.title,
        excerpt: page.textExcerpt.slice(0, 1200),
        relevance: hit.score ?? 0.5,
      });
    }
    return out;
  })();

  const [internalFindings, webFindings] = await Promise.all([
    internalPromise,
    webPromise,
  ]);
  findings.push(...internalFindings, ...webFindings);

  const durationMs = clock() - start;

  if (findings.length === 0) {
    return Object.freeze({
      query,
      findings: [],
      summary:
        "No findings — web search returned nothing and no internal rows matched.",
      confidence: 0,
      reason: "no_data",
      durationMs,
    });
  }

  // Aggregate confidence: weighted by per-finding relevance, with a
  // bias toward internal sources (they're already tenant-scoped) and
  // a diminishing return after the third finding.
  const avgRelevance =
    findings.reduce((sum, f) => sum + f.relevance, 0) / findings.length;
  const internalCount = findings.filter((f) => f.source === "internal").length;
  const breadth = Math.min(findings.length, 3) / 3;
  const internalBoost = Math.min(0.2, internalCount * 0.05);
  const confidence = clamp(avgRelevance * 0.7 + breadth * 0.3 + internalBoost);

  const summary = buildSummary(query, findings);

  return Object.freeze({
    query,
    findings: Object.freeze([...findings]) as unknown as ResearchFinding[],
    summary,
    confidence,
    reason:
      internalCount > 0
        ? `internal-anchored (${internalCount} row${internalCount === 1 ? "" : "s"})`
        : "web-only",
    durationMs,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, n));
}

async function safeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn("[md.deep-research] provider call failed", e);
    }
    // Return a "neutral" value so the synthesis still completes.
    // The caller decides what neutral means per provider; we type
    // here as `any` and rely on the await contract.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    return [] as unknown as T;
  }
}

function buildSummary(
  query: string,
  findings: ReadonlyArray<ResearchFinding>,
): string {
  const internal = findings.filter((f) => f.source === "internal").length;
  const web = findings.filter((f) => f.source === "web").length;
  const bits: string[] = [];
  bits.push(
    `Found ${findings.length} relevant ${findings.length === 1 ? "finding" : "findings"} for "${query}".`,
  );
  if (internal > 0) {
    bits.push(
      `${internal} from internal data (org-scoped, tenant-RLS-respected).`,
    );
  }
  if (web > 0) {
    bits.push(`${web} from external web sources.`);
  }
  const topThree = findings.slice(0, 3);
  if (topThree.length > 0) {
    bits.push(
      `Top excerpts: ${topThree
        .map((f) => `[${f.title}] ${f.excerpt.slice(0, 120)}`)
        .join(" | ")}`,
    );
  }
  return bits.join(" ");
}
