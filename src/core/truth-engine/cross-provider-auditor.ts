/**
 * Cross-Provider Consistency Auditor
 *
 * Sample 5% of high-stakes (pricing/regulatory) responses and re-route the
 * same prompt to a second provider. Compare extracted numerical claims; if
 * they diverge beyond tolerance, log to `truth_provider_audits` and surface
 * for review.
 *
 * This is a reliability-net, not a runtime gate: the audit happens AFTER the
 * user has received a response, so it doesn't slow chat. Repeated divergence
 * for the same prompt-hash auto-creates a review-queue item.
 */

import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";

export type Provider = "claude" | "openai" | "deepseek";

export interface ProviderResponse {
  readonly provider: Provider;
  readonly text: string;
}

export interface ExtractedClaim {
  readonly text: string;
  readonly numeric: number | null;
  readonly unit: string | null;
}

const NUMERIC_TOLERANCE = 0.05; // 5% disagreement

/**
 * Per-intent sample rate. High-stakes intents (anything that could cost a
 * borrower money or set up a regulatory mistake) get audited 100%. Routine
 * intents fall back to the original 5% baseline.
 *
 * Production note: the 1.0 sample rate is gated by `shouldSampleForAudit`
 * fast-path checks so we only run the second LLM call when the request is
 * actually a numeric/regulatory claim — saves cost on chitchat and FAQs.
 */
const SAMPLE_RATE_BY_INTENT: Readonly<Record<string, number>> = {
  // 100% — anything that quotes a number that could mislead a customer
  pricing_query: 1.0,
  rate_query: 1.0,
  fee_query: 1.0,
  regulatory_query: 1.0,
  threshold_query: 1.0,
  forex_query: 1.0,
  loan_terms_query: 1.0,
  tax_query: 1.0,
  // 25% — softer numeric / advisory claims
  benchmark_query: 0.25,
  commodity_query: 0.25,
  // 5% baseline — everything else that opts in
  default: 0.05,
};

/**
 * Should this response be sampled for cross-provider audit? Probabilistic
 * sampling — high-stakes intents pinned at 100%, advisory intents at 25%,
 * everything else at 5%. Predictability is OK at 100% because the audit
 * runs AFTER the user gets their reply, so it can't be exploited.
 */
export function shouldSampleForAudit(intent: string): boolean {
  const rate = SAMPLE_RATE_BY_INTENT[intent];
  if (rate === undefined) return false; // unknown intent — never audit
  if (rate >= 1.0) return true;
  return Math.random() < rate;
}

/**
 * Hash the canonical prompt for provider-audit grouping. Strips whitespace +
 * lowercases so trivial variations group together.
 */
export function hashPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Extract a single primary claim from an AI response. Looks for the first
 * monetary or percentage figure with at most 200 chars of context.
 */
export function extractPrimaryClaim(response: string): ExtractedClaim | null {
  // Try monetary first (TZS / USD / $)
  const moneyMatch = response.match(
    /(TZS|TSh|USD|US\$|\$)\s?([\d,]+(?:\.\d+)?)(?:\s?(million|billion|thousand|k|m|bn))?/i,
  );
  if (moneyMatch) {
    const numeric = parseFloat(moneyMatch[2].replace(/,/g, ""));
    const multiplier = scaleMultiplier(moneyMatch[3]);
    return {
      text: moneyMatch[0],
      numeric: Number.isFinite(numeric) ? numeric * multiplier : null,
      unit: moneyMatch[1].toUpperCase(),
    };
  }

  // Then percentage
  const percentMatch = response.match(/(\d{1,3}(?:\.\d+)?)\s?%/);
  if (percentMatch) {
    const numeric = parseFloat(percentMatch[1]);
    return {
      text: percentMatch[0],
      numeric: Number.isFinite(numeric) ? numeric : null,
      unit: "percent",
    };
  }

  return null;
}

function scaleMultiplier(suffix?: string): number {
  if (!suffix) return 1;
  const s = suffix.toLowerCase();
  if (s === "thousand" || s === "k") return 1_000;
  if (s === "million" || s === "m") return 1_000_000;
  if (s === "billion" || s === "bn") return 1_000_000_000;
  return 1;
}

/**
 * Compare two provider responses. Persist an audit row; flag divergence if
 * numeric values differ by more than tolerance.
 */
export async function auditProviderPair(args: {
  readonly prompt: string;
  readonly intent: string;
  readonly providerA: ProviderResponse;
  readonly providerB: ProviderResponse;
}): Promise<{ readonly diverged: boolean; readonly auditId: string | null }> {
  const claimA = extractPrimaryClaim(args.providerA.text);
  const claimB = extractPrimaryClaim(args.providerB.text);

  let agreementScore = 1.0;
  let diverged = false;
  let kind: string | null = null;

  if (!claimA || !claimB) {
    if (!claimA && !claimB) {
      agreementScore = 1.0; // neither made a claim
    } else {
      agreementScore = 0.0;
      diverged = true;
      kind = "one_missing";
    }
  } else if (claimA.numeric === null || claimB.numeric === null) {
    // Text-only comparison
    agreementScore =
      claimA.text.toLowerCase() === claimB.text.toLowerCase() ? 1.0 : 0.5;
    diverged = agreementScore < 0.5;
    kind = diverged ? "contradictory" : null;
  } else {
    const larger = Math.max(Math.abs(claimA.numeric), Math.abs(claimB.numeric));
    if (larger === 0) {
      agreementScore = 1.0;
    } else {
      const diff = Math.abs(claimA.numeric - claimB.numeric) / larger;
      agreementScore = Math.max(0, 1 - diff);
      diverged = diff > NUMERIC_TOLERANCE;
      kind = diverged ? "numeric_mismatch" : null;
    }
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("truth_provider_audits")
    .insert({
      prompt_hash: hashPrompt(args.prompt),
      prompt_excerpt: args.prompt.slice(0, 200),
      intent: args.intent,
      provider_a: args.providerA.provider,
      provider_b: args.providerB.provider,
      claim_a: claimA?.text ?? "",
      claim_b: claimB?.text ?? "",
      numeric_a: claimA?.numeric ?? null,
      numeric_b: claimB?.numeric ?? null,
      agreement_score: agreementScore,
      divergence_flagged: diverged,
      divergence_kind: kind,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) return { diverged, auditId: null };
  return { diverged, auditId: data.id };
}
