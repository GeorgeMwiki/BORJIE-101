/**
 * Honest "I don't know" guard.
 *
 * When confidence is below threshold or info is not in memory + RAG +
 * tools, the assistant says "I don't know" directly. No theatrical
 * apology. Format: "I don't know X. [What I do know is Y / I can find
 * out / would you tell me?]"
 *
 * Reads alongside `src/core/credit-mind/epistemic/i-dont-know.ts` for
 * upstream confidence calibration.
 *
 * References:
 *  - Anthropic, Sandbagging in Language Models (2024) — calibrated honesty.
 *  - Lin, Hilton, Evans, "TruthfulQA" (2021) — false-confident outputs are
 *    a measurable failure mode.
 *  - Ji et al., "Survey of Hallucination" (2023).
 */

export interface HonestUncertaintyInput {
  readonly calibrated_confidence: number; // 0..100
  readonly missing_required_info: ReadonlyArray<string>;
  readonly retrieval_returned_empty: boolean;
  readonly tier?: "low" | "medium" | "high" | "critical";
  readonly question_topic?: string;
  readonly known_partial_info?: string;
}

export interface HonestUncertaintyResult {
  readonly should_admit: boolean;
  readonly reason:
    | "low_confidence"
    | "missing_info"
    | "no_retrieval_match"
    | "none";
  readonly user_facing: string;
  readonly avoids_theatre: boolean;
}

const CONFIDENCE_THRESHOLDS = {
  low: 30,
  medium: 45,
  high: 60,
  critical: 75,
};

/**
 * Pure: decide whether to admit "I don't know" and produce a clean line.
 */
export function decideHonestUncertainty(
  input: HonestUncertaintyInput,
): HonestUncertaintyResult {
  const tier = input.tier ?? "medium";
  const threshold = CONFIDENCE_THRESHOLDS[tier];

  let reason: HonestUncertaintyResult["reason"] = "none";
  let admit = false;

  if (input.missing_required_info.length > 0) {
    admit = true;
    reason = "missing_info";
  } else if (input.retrieval_returned_empty) {
    admit = true;
    reason = "no_retrieval_match";
  } else if (input.calibrated_confidence < threshold) {
    admit = true;
    reason = "low_confidence";
  }

  if (!admit) {
    return {
      should_admit: false,
      reason: "none",
      user_facing: "",
      avoids_theatre: true,
    };
  }

  const topic = input.question_topic ?? "that";
  let line = "";

  if (reason === "missing_info") {
    const fields = input.missing_required_info.slice(0, 3).join(", ");
    line = `I don't have ${fields} yet. Share that and I'll answer.`;
  } else if (reason === "no_retrieval_match") {
    line = `I don't have ${topic} in what I can see. ${input.known_partial_info ? `What I do have: ${input.known_partial_info}.` : "Tell me what you know and I'll work from there."}`;
  } else {
    line = `I'm not confident on ${topic}. ${input.known_partial_info ? `What I'm sure of: ${input.known_partial_info}.` : "I'd want to verify before saying more."}`;
  }

  return {
    should_admit: true,
    reason,
    user_facing: line,
    avoids_theatre: !containsTheatre(line),
  };
}

function containsTheatre(line: string): boolean {
  return /\b(i('?m| am) (so |very |truly |really )?sorry|i apologi[sz]e|unfortunately[,\s]+i)\b/i.test(
    line,
  );
}

/**
 * Pure: post-check a candidate response for theatrical apology before any
 * "I don't know" is allowed through.
 */
export function stripTheatreFromUncertainty(candidate: string): string {
  return candidate
    .replace(
      /\bi(?:'?m| am) (?:so |very |truly |really )?sorry,?\s+(?:but\s+)?(?=i (?:don'?t|cannot|can'?t))/gi,
      "",
    )
    .replace(/\bi (?:apologi[sz]e|am sorry)[,\s]+(?:but\s+)?/gi, "")
    .replace(/\bunfortunately,?\s+i (don'?t|cannot|can'?t)/gi, "I $1")
    .replace(/^\s*[,.]+\s*/, "")
    .trim();
}
