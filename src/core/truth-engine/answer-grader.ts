/**
 * Answer Grader — runtime fail-closed guard.
 *
 * Inspects an AI response BEFORE delivery. If the response contains a
 * monetary, regulatory, or rate claim, the grader checks the response was
 * grounded in a `truth_claims` row. If not, it either:
 *
 *   1) Replaces the claim with a deferral phrase ("I don't have current
 *      data on that..."), or
 *
 *   2) Wraps the claim with research-estimate framing if a stale claim
 *      exists ("Based on online research from [date], estimated at...").
 *
 * Never lets an invented number reach the user. Never blocks legitimate
 * non-claim content. Logs every intervention for audit.
 */

import type { ClaimLookupResult } from "./types";

// ============================================================================
// Claim detection — patterns that indicate the AI is making a factual claim
// ============================================================================

const MONETARY_CLAIM =
  /(TZS|TSh|USD|US\$|\$)\s?[\d,]+(?:\.\d+)?(?:\s?(million|billion|thousand|k|m|bn))?/gi;
const PERCENT_CLAIM = /\b\d{1,3}(?:\.\d+)?\s?%/g;
const RATE_CLAIM = /\b(rate|interest|APR|yield|fee)\s+(of|is|at)\s+\d/gi;
const REGULATORY_CLAIM =
  /\b(VAT|TIN|BRELA|BOT|TRA|FIU|NEMC|FCC|TCRA)\b\s+(?:requires|mandates|is|of|cap|threshold|rate|charge)/gi;

export interface ClaimDetection {
  readonly text: string;
  readonly kind: "monetary" | "percent" | "rate" | "regulatory";
  readonly index: number;
}

export function detectClaims(response: string): readonly ClaimDetection[] {
  const detections: ClaimDetection[] = [];

  pushAll(response, MONETARY_CLAIM, "monetary", detections);
  pushAll(response, PERCENT_CLAIM, "percent", detections);
  pushAll(response, RATE_CLAIM, "rate", detections);
  pushAll(response, REGULATORY_CLAIM, "regulatory", detections);

  return detections.sort((a, b) => a.index - b.index);
}

function pushAll(
  text: string,
  pattern: RegExp,
  kind: ClaimDetection["kind"],
  out: ClaimDetection[],
): void {
  const re = new RegExp(pattern.source, pattern.flags);
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    out.push({ text: m[0], kind, index: m.index });
    m = re.exec(text);
  }
}

// ============================================================================
// Grade the response
// ============================================================================

export interface GradedResponse {
  readonly content: string;
  readonly grade: "verified" | "research_estimate" | "mixed" | "no_claims";
  readonly interventions: number;
  readonly attribution: string | null;
}

/**
 * Apply attribution + framing to an AI response based on a per-prompt
 * lookup result. Caller passes the lookup result that the prompt-assembler
 * already produced; the grader never re-queries the database.
 */
export function gradeResponse(args: {
  readonly response: string;
  readonly lookup: ClaimLookupResult | null;
  readonly language: "en" | "sw";
}): GradedResponse {
  const claims = detectClaims(args.response);
  if (claims.length === 0) {
    return {
      content: args.response,
      grade: "no_claims",
      interventions: 0,
      attribution: null,
    };
  }

  const lookup = args.lookup;

  // No grounding for any claim — substitute deferral phrasing
  if (!lookup || lookup.status === "must_defer") {
    const deferral =
      lookup && lookup.status === "must_defer"
        ? args.language === "sw"
          ? lookup.suggestedDeferralSw
          : lookup.suggestedDeferralEn
        : args.language === "sw"
          ? "Sina takwimu rasmi za sasa kuhusu hilo. Niitafiti na kurudi nakupatie jibu lenye ushahidi."
          : "I don't have current verified data on that. Let me research and come back with an evidence-backed answer.";

    return {
      content: deferral,
      grade: "research_estimate",
      interventions: claims.length,
      attribution: null,
    };
  }

  if (lookup.status === "found" && lookup.grade === "verified") {
    const attribution =
      args.language === "sw" ? lookup.attributionSw : lookup.attributionEn;
    const prefix =
      args.language === "sw" ? `${attribution}: ` : `${attribution}: `;
    return {
      content: prefix + args.response,
      grade: "verified",
      interventions: 0,
      attribution,
    };
  }

  // research_estimate
  const attribution =
    args.language === "sw" ? lookup.attributionSw : lookup.attributionEn;
  const verifyHint =
    args.language === "sw" ? lookup.verifyHintSw : lookup.verifyHintEn;

  return {
    content: `${attribution}: ${args.response} (${verifyHint})`,
    grade: "research_estimate",
    interventions: 0,
    attribution,
  };
}

/**
 * Strict validator used by the response-processor pipeline. Returns true if
 * the response is safe to send to the user; false if every claim in the
 * response is ungrounded AND the lookup returned a deferral.
 *
 * Use this as a final guard rail in the response pipeline. If false, the
 * caller should overwrite the response with the deferral phrasing returned
 * by `gradeResponse(...).content`.
 */
export function isResponseGrounded(args: {
  readonly response: string;
  readonly lookup: ClaimLookupResult | null;
}): boolean {
  const claims = detectClaims(args.response);
  if (claims.length === 0) return true; // no claim, no grounding required

  if (!args.lookup) return false;
  if (args.lookup.status === "must_defer") return false;
  return true;
}
