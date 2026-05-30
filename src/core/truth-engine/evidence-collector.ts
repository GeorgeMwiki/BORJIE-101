/**
 * Evidence Collector — the "master online researcher" entry point.
 *
 * Thin orchestration layer atop research-loop.ts. The real work — search,
 * fetch, semantic extraction, injection classification, cross-source
 * synthesis, optional LLM consensus — lives in research-loop.ts. This file
 * just owns the AUTHORITATIVE_SOURCES seed registry, picks the right slice
 * for the requested category, and forwards arguments.
 *
 * Cost guardrails (enforced inside research-loop):
 *   - Web fetches capped per pass; deduplicated across passes
 *   - LLM consensus only when web evidence is thin
 *   - Circuit breaker per host so a flaky origin can't drag the loop down
 *   - All errors collected, never thrown — partial evidence is better than none
 */

import type {
  CandidateEvidence,
  ClaimCategory,
  EvidenceSourceType,
} from "./types";
import { runResearchLoop } from "./research-loop";

// ============================================================================
// Source registry — authoritative URLs per category
// ============================================================================

const AUTHORITATIVE_SOURCES: Readonly<
  Record<
    ClaimCategory,
    readonly { readonly url: string; readonly type: EvidenceSourceType }[]
  >
> = {
  pricing: [
    { url: "https://www.bot.go.tz/MonetaryPolicy", type: "official_gov" },
    { url: "https://demo-bank.test/personal/loans", type: "bank_official" },
    { url: "https://www.nmbbank.co.tz/business/loans", type: "bank_official" },
  ],
  forex: [{ url: "https://www.bot.go.tz/Statistics", type: "official_gov" }],
  commodity: [
    { url: "https://www.tcc.or.tz/prices", type: "official_gov" },
    { url: "https://www.fao.org/giews/data-tools/", type: "academic" },
  ],
  regulatory: [
    { url: "https://www.tra.go.tz/index.php/tax-rates", type: "official_gov" },
    { url: "https://www.brela.go.tz", type: "official_gov" },
    { url: "https://www.bot.go.tz/Regulations", type: "regulator" },
  ],
  structural: [
    { url: "https://www.brela.go.tz/services", type: "official_gov" },
    { url: "https://www.tra.go.tz/index.php/tin", type: "official_gov" },
  ],
  benchmark: [
    { url: "https://data.worldbank.org/country/TZ", type: "academic" },
    { url: "https://www.nbs.go.tz", type: "official_gov" },
  ],
  geographic: [{ url: "https://www.nbs.go.tz", type: "official_gov" }],
  institutional: [
    { url: "https://www.bot.go.tz/BankSupervision", type: "regulator" },
  ],
};

const SITE_ALLOWLIST_BY_CATEGORY: Readonly<
  Record<ClaimCategory, readonly string[]>
> = {
  pricing: [
    "bot.go.tz",
    "demo-bank.test",
    "nmbbank.co.tz",
    "nbc.co.tz",
    "stanbicbank.co.tz",
    "absa.co.tz",
  ],
  forex: ["bot.go.tz"],
  commodity: ["tcc.or.tz", "fao.org", "worldbank.org"],
  regulatory: [
    "tra.go.tz",
    "brela.go.tz",
    "bot.go.tz",
    "parliament.go.tz",
    "fiu.go.tz",
  ],
  structural: ["brela.go.tz", "tra.go.tz", "parliament.go.tz"],
  benchmark: ["worldbank.org", "imf.org", "nbs.go.tz", "afdb.org"],
  geographic: ["nbs.go.tz"],
  institutional: ["bot.go.tz", "brela.go.tz"],
};

// ============================================================================
// Public API
// ============================================================================

export interface CollectEvidenceArgs {
  readonly category: ClaimCategory;
  readonly subject: string;
  readonly factKey: string;
  readonly searchQuery?: string;
  readonly maxWebFetches?: number;
  readonly enableLLMConsensus?: boolean;
  readonly retrievedBy: string;
}

export interface CollectionResult {
  readonly candidates: readonly CandidateEvidence[];
  readonly errors: ReadonlyArray<{
    readonly source: string;
    readonly error: string;
  }>;
  readonly costUsd: number;
  readonly llmCalls: number;
}

/**
 * Run multi-source research with the iterative research loop. Returns the
 * legacy CollectionResult shape so refresh-scheduler doesn't need to change.
 */
export async function collectEvidence(
  args: CollectEvidenceArgs,
): Promise<CollectionResult> {
  const seedUrls = AUTHORITATIVE_SOURCES[args.category] ?? [];
  const siteAllowlist = SITE_ALLOWLIST_BY_CATEGORY[args.category] ?? [];

  const result = await runResearchLoop({
    category: args.category,
    subject: args.subject,
    factKey: args.factKey,
    searchQuery: args.searchQuery,
    seedUrls,
    siteAllowlist,
    enableLLMConsensus: args.enableLLMConsensus,
    retrievedBy: args.retrievedBy,
  });

  return {
    candidates: result.candidates,
    errors: result.errors,
    costUsd: result.costUsd,
    llmCalls: result.llmCalls,
  };
}
