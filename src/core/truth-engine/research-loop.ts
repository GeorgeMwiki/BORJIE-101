/**
 * Research Loop — the iterative "search → fetch → synthesize → re-search" core.
 *
 * Replaces the old "fetch a fixed list of URLs once" pattern. New flow:
 *
 *   1. Seed: gather URLs from the static AUTHORITATIVE_SOURCES registry.
 *   2. Expand: live web search (Brave/Tavily) for additional candidates,
 *      filtered to the SSRF allowlist, deduped against the seed.
 *   3. Fetch + extract: parallel fetch through circuit breaker → semantic
 *      extractor → injection classifier → PII scrubber.
 *   4. Synthesize: cross-source-synthesizer decides consensus/partial/disputed.
 *   5. Re-search: if 'insufficient' or 'disputed', expand the query
 *      (alt phrasings, adjacent jurisdictions) and run one more pass.
 *   6. Optional: LLM consensus (3 providers) when web evidence is thin.
 *
 * Returns the same `CollectionResult` shape evidence-collector returned, so
 * refresh-scheduler doesn't need to know we got smarter.
 */

import type {
  CandidateEvidence,
  ClaimCategory,
  EvidenceSourceType,
} from "./types";
import { assertFetchAllowed, scrubPII } from "./security";
import { applyInjectionPolicy } from "./injection-classifier";
import { extractRelevantExcerpt } from "./semantic-extractor";
import { breakerKeyForUrl, withBreaker } from "./circuit-breaker";
import { searchWeb } from "./web-search";
import { runLLMConsensus } from "./llm-consensus";
import { synthesizeAcrossSources } from "./cross-source-synthesizer";
import { resolveSourceAuthority, extractDomain } from "./source-authority";
import { validateOutboundUrlWithDns } from "@/lib/url-allowlist";

const FETCH_TIMEOUT_MS = 5_000;
const PER_PASS_FETCH_CAP = 6;
const MAX_LOOP_ITERATIONS = 2;

export interface ResearchArgs {
  readonly category: ClaimCategory;
  readonly subject: string;
  readonly factKey: string;
  readonly searchQuery?: string;
  readonly seedUrls: readonly {
    readonly url: string;
    readonly type: EvidenceSourceType;
  }[];
  readonly siteAllowlist: readonly string[];
  readonly enableLLMConsensus?: boolean;
  readonly retrievedBy: string;
}

export interface ResearchResult {
  readonly candidates: readonly CandidateEvidence[];
  readonly errors: ReadonlyArray<{
    readonly source: string;
    readonly error: string;
  }>;
  readonly costUsd: number;
  readonly llmCalls: number;
  readonly iterations: number;
  readonly verdict: ReturnType<typeof synthesizeAcrossSources>["verdict"];
}

/**
 * Run the multi-pass research loop and return aggregated evidence.
 */
export async function runResearchLoop(
  args: ResearchArgs,
): Promise<ResearchResult> {
  const errors: { source: string; error: string }[] = [];
  const seenUrls = new Set<string>();
  let costUsd = 0;
  let llmCalls = 0;
  const candidates: CandidateEvidence[] = [];
  const query = args.searchQuery ?? args.subject;

  // Pass 1: seed sources
  const seedCandidates = await fetchBatch(
    args.seedUrls.slice(0, PER_PASS_FETCH_CAP),
    query,
    args.retrievedBy,
    seenUrls,
    errors,
  );
  candidates.push(...seedCandidates);

  // Pass 2: live web search expansion (within SSRF allowlist)
  const search1 = await searchWeb({
    query: `${args.subject} Tanzania ${args.factKey.replace(/_/g, " ")}`,
    siteFilter: args.siteAllowlist,
    maxResults: 8,
  });

  if (search1.results.length > 0) {
    const newUrls = search1.results
      .map((r) => ({ url: r.url, type: inferSourceType(r.url) }))
      .filter((u) => !seenUrls.has(u.url))
      .slice(0, PER_PASS_FETCH_CAP);

    const extra = await fetchBatch(
      newUrls,
      query,
      args.retrievedBy,
      seenUrls,
      errors,
    );
    candidates.push(...extra);
  }

  // Synthesize what we have so far
  let verdict = synthesizeAcrossSources(candidates);
  let iterations = 1;

  // Pass 3: re-search if insufficient/disputed
  if (
    iterations < MAX_LOOP_ITERATIONS &&
    (verdict.verdict === "insufficient" || verdict.verdict === "disputed") &&
    search1.provider !== "none"
  ) {
    const expandedQuery = expandQuery(args.subject, args.category);
    const search2 = await searchWeb({
      query: expandedQuery,
      siteFilter: args.siteAllowlist,
      maxResults: 6,
    });

    const newUrls = search2.results
      .map((r) => ({ url: r.url, type: inferSourceType(r.url) }))
      .filter((u) => !seenUrls.has(u.url))
      .slice(0, PER_PASS_FETCH_CAP);

    const extra = await fetchBatch(
      newUrls,
      expandedQuery,
      args.retrievedBy,
      seenUrls,
      errors,
    );
    candidates.push(...extra);
    iterations++;
    verdict = synthesizeAcrossSources(candidates);
  }

  // Optional LLM consensus when web evidence is thin
  if (
    args.enableLLMConsensus &&
    (verdict.verdict === "insufficient" || candidates.length < 2)
  ) {
    const consensus = await runLLMConsensus({
      subject: args.subject,
      factKey: args.factKey,
      retrievedBy: args.retrievedBy,
    });
    candidates.push(...consensus.evidence);
    costUsd += consensus.costUsd;
    llmCalls += consensus.calls;
    verdict = synthesizeAcrossSources(candidates);
  }

  return {
    candidates,
    errors,
    costUsd,
    llmCalls,
    iterations,
    verdict: verdict.verdict,
  };
}

// ---------------------------------------------------------------------------
// Internal: parallel fetch with breaker + extractor + classifier chain
// ---------------------------------------------------------------------------

async function fetchBatch(
  urls: readonly { readonly url: string; readonly type: EvidenceSourceType }[],
  query: string,
  retrievedBy: string,
  seen: Set<string>,
  errors: { source: string; error: string }[],
): Promise<readonly CandidateEvidence[]> {
  const results = await Promise.allSettled(
    urls.map((u) => fetchAndProcess(u.url, u.type, query, retrievedBy)),
  );

  const out: CandidateEvidence[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const u = urls[i];
    seen.add(u.url);
    if (r.status === "fulfilled" && r.value) {
      out.push(r.value);
    } else if (r.status === "rejected") {
      errors.push({
        source: u.url,
        error: String(r.reason).slice(0, 240),
      });
    }
  }
  return out;
}

async function fetchAndProcess(
  url: string,
  sourceType: EvidenceSourceType,
  query: string,
  retrievedBy: string,
): Promise<CandidateEvidence | null> {
  // SSRF guard FIRST — never trust a URL that came from the search provider
  try {
    assertFetchAllowed(url);
  } catch {
    return null;
  }

  // Defense-in-depth: DNS-aware allowlist guard rejects URLs whose host
  // resolves into private/link-local space (rebind / IPv4-mapped pivots).
  const urlCheck = await validateOutboundUrlWithDns(url);
  if (!urlCheck.ok) return null;

  const breakerKey = breakerKeyForUrl(url);

  const text = await withBreaker(breakerKey, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Borjie-TruthEngine/2.0 (+research)" },
        redirect: "manual",
      });
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  });

  const extracted = await extractRelevantExcerpt({
    html: text,
    query,
    maxLength: 1500,
  });

  if (!extracted) return null;

  // Injection classifier (regex always; LLM if env-flag enabled)
  const policy = await applyInjectionPolicy(extracted.excerpt);
  if (policy.excerpt === null) return null;

  // PII scrub last
  const safeExcerpt = scrubPII(policy.excerpt);
  if (!safeExcerpt) return null;

  const domain = extractDomain(url);

  return {
    sourceType,
    sourceUrl: url,
    sourceDomain: domain,
    excerpt: safeExcerpt,
    fullText: text.length > 50_000 ? text.slice(0, 50_000) : text,
    retrievedBy,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferSourceType(url: string): EvidenceSourceType {
  const domain = extractDomain(url) ?? "";
  const authority = resolveSourceAuthority({
    sourceUrl: url,
    sourceDomain: domain,
    sourceType: "news",
  });
  if (authority >= 0.95) {
    if (
      domain.endsWith(".go.tz") ||
      domain.endsWith(".gov") ||
      /parliament|tra\.|brela|nbs|fcc|nemc|fiu|tcra|ras\.|tcc\./i.test(domain)
    ) {
      return "official_gov";
    }
    if (/bot\.go\.tz/i.test(domain)) return "regulator";
    return "bank_official";
  }
  if (authority >= 0.85) return "academic";
  if (authority >= 0.7) return "news";
  return "news";
}

function expandQuery(subject: string, category: ClaimCategory): string {
  const synonyms: Partial<Record<ClaimCategory, string>> = {
    pricing: "rate fee charge",
    forex: "exchange rate",
    commodity: "price market",
    regulatory: "law act regulation requirement",
    structural: "process requirement procedure",
    benchmark: "average median statistic",
    geographic: "region area location",
    institutional: "bank operator regulator",
  };
  return `${subject} ${synonyms[category] ?? ""} Tanzania official 2026`;
}
