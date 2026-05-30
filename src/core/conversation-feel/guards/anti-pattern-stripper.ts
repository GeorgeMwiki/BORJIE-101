/**
 * Anti-pattern detector + stripper.
 *
 * Detects and strips the canonical chatbot-feel openers, closers, and
 * apologies before a response leaves the system. Substance is preserved;
 * only filler is removed.
 *
 * References:
 *  - Anthropic, Sycophancy in Language Models (2024) — filler agreement.
 *  - OpenAI, Conversational Design Guidelines (2024).
 *  - Karpathy, "Software 2.0 + LLMs" talks (2024) — observations on
 *    LLM filler patterns and verbose preambles.
 */

import type {
  ChatbotFeelPattern,
  RemovedPhrase,
  StrippedResponse,
} from "../types";

interface PatternRule {
  readonly pattern: ChatbotFeelPattern;
  readonly regex: RegExp;
  readonly reason: string;
  readonly score_weight: number;
}

const FILLER_OPENERS: ReadonlyArray<PatternRule> = [
  {
    pattern: "filler_opener",
    regex:
      /^\s*(sure|of course|absolutely|certainly|definitely|gladly)[!,.\s]+/i,
    reason: "filler_opener: enthusiastic acknowledgment without substance",
    score_weight: 8,
  },
  {
    pattern: "filler_opener",
    regex:
      /^\s*(great|excellent|wonderful|fantastic|awesome) (question|point|idea)[!,.\s]+/i,
    reason: "filler_opener: praising the user's question",
    score_weight: 10,
  },
  {
    pattern: "filler_opener",
    regex:
      /^\s*i('?d| would) be (happy|glad|delighted|more than happy) to[^.]*[.!]\s*/i,
    reason: "filler_opener: theatrical eagerness",
    score_weight: 9,
  },
  {
    pattern: "filler_opener",
    regex: /^\s*(got it|i understand|understood|noted)[!,.\s]+/i,
    reason: "filler_opener: empty acknowledgment",
    score_weight: 7,
  },
  {
    pattern: "filler_opener",
    regex:
      /^\s*(thanks|thank you) for (your |the |that )?(question|message|input)[!,.\s]+/i,
    reason: "filler_opener: thanking for asking",
    score_weight: 8,
  },
];

const VERBOSE_PREAMBLES: ReadonlyArray<PatternRule> = [
  {
    pattern: "verbose_preamble",
    regex:
      /^\s*let me (think about|consider|reflect on) (this|that)[^.]*[.!]\s*/i,
    reason: "verbose_preamble: announcing thought process",
    score_weight: 6,
  },
  {
    pattern: "verbose_preamble",
    regex:
      /^\s*that('?s| is) (a|an) (interesting|good|tough|tricky|complex) (situation|question|problem|case)[^.]*[.!]\s*/i,
    reason: "verbose_preamble: characterizing the question",
    score_weight: 7,
  },
  {
    pattern: "verbose_preamble",
    regex: /^\s*before (i|we) (answer|continue|proceed|begin)[^.]*[,.]\s*/i,
    reason: "verbose_preamble: throat-clearing",
    score_weight: 6,
  },
  {
    pattern: "verbose_preamble",
    regex:
      /^\s*(based on|given|considering) (what you('?ve| have) (said|asked|mentioned|shared))[^.]*[,.]\s*/i,
    reason: "verbose_preamble: paraphrased setup",
    score_weight: 5,
  },
];

const SYCOPHANTIC_AGREEMENT: ReadonlyArray<PatternRule> = [
  {
    pattern: "sycophantic_agreement",
    regex:
      /\bthat('?s| is) (a |an )?(great|excellent|wonderful|fantastic|brilliant|amazing) (point|idea|observation|question|insight)[!.]/gi,
    reason: "sycophantic_agreement: empty praise of user input",
    score_weight: 10,
  },
  {
    pattern: "sycophantic_agreement",
    regex:
      /\byou('?re| are) (absolutely |completely |totally |entirely )?(right|correct|spot on)[!.]/gi,
    reason: "sycophantic_agreement: blanket affirmation",
    score_weight: 9,
  },
  {
    pattern: "sycophantic_agreement",
    regex: /\b(great|excellent|wonderful) (thinking|reasoning|analysis)[!.]/gi,
    reason: "sycophantic_agreement: praising the user's reasoning",
    score_weight: 8,
  },
];

const THEATRICAL_APOLOGIES: ReadonlyArray<PatternRule> = [
  {
    pattern: "theatrical_apology",
    regex:
      /\bi (apologi[sz]e|am sorry|'m sorry) for (any |the )?(confusion|inconvenience|misunderstanding)[^.]*[.!]/gi,
    reason: "theatrical_apology: performative regret",
    score_weight: 8,
  },
  {
    pattern: "theatrical_apology",
    regex:
      /\bi('?m| am) (so |very |truly |really )?sorry (i |that i )?(can'?t|cannot|don'?t have|am unable)[^.]*[.!]/gi,
    reason: "theatrical_apology: dramatic limitation apology",
    score_weight: 9,
  },
  {
    pattern: "theatrical_apology",
    regex:
      /\bunfortunately[,]?\s+i (don'?t|cannot|can'?t|am unable to)[^.]*[.!]/gi,
    reason: "theatrical_apology: unfortunately-prefixed limitation",
    score_weight: 7,
  },
];

const FILLER_CLOSERS: ReadonlyArray<PatternRule> = [
  {
    pattern: "anything_else_closer",
    regex:
      /\s*is there (anything|something) (else )?(i can )?help (you )?with[?!.]*\s*$/i,
    reason: "anything_else_closer: generic offer to keep helping",
    score_weight: 10,
  },
  {
    pattern: "filler_closer",
    regex:
      /\s*(i )?hope (this|that) (helps|answers your question|clarifies)[!.]*\s*$/i,
    reason: "filler_closer: hopeful sign-off",
    score_weight: 8,
  },
  {
    pattern: "filler_closer",
    regex:
      /\s*let me know if (you (have )?any|there are any|there's anything)[^.]*[.!]\s*$/i,
    reason: "filler_closer: open-ended availability",
    score_weight: 7,
  },
  {
    pattern: "filler_closer",
    regex:
      /\s*(feel free to|don'?t hesitate to) (ask|reach out|let me know)[^.]*[.!]\s*$/i,
    reason: "filler_closer: invitation to ask more",
    score_weight: 7,
  },
  {
    pattern: "filler_closer",
    regex: /\s*happy to help[!.]*\s*$/i,
    reason: "filler_closer: parting enthusiasm",
    score_weight: 6,
  },
];

const GENERIC_TRANSITIONS: ReadonlyArray<PatternRule> = [
  {
    pattern: "generic_transition",
    regex: /\bnow,? let'?s (discuss|talk about|move on to|turn to)\b/gi,
    reason: "generic_transition: announcing topic shift",
    score_weight: 5,
  },
  {
    pattern: "generic_transition",
    regex: /\bmoving on to\b/gi,
    reason: "generic_transition: explicit transition phrase",
    score_weight: 4,
  },
];

const ALL_RULES: ReadonlyArray<PatternRule> = [
  ...FILLER_OPENERS,
  ...VERBOSE_PREAMBLES,
  ...SYCOPHANTIC_AGREEMENT,
  ...THEATRICAL_APOLOGIES,
  ...FILLER_CLOSERS,
  ...GENERIC_TRANSITIONS,
];

/**
 * Pure: strip chatbot-feel patterns from a response while preserving
 * substance. Returns a new immutable record.
 */
export function stripChatbotFeel(input: string): StrippedResponse {
  if (!input || typeof input !== "string") {
    return {
      stripped: input ?? "",
      original: input ?? "",
      removed_phrases: [],
      residual_chatbot_score: 0,
    };
  }

  let working = input;
  const removed: RemovedPhrase[] = [];

  // Iterate up to 3 passes so chained openers ("Sure! Of course! ...")
  // get peeled in sequence even though each opener regex anchors to ^.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const rule of ALL_RULES) {
      const flags = rule.regex.flags.includes("g")
        ? rule.regex.flags
        : rule.regex.flags + "g";
      const re = new RegExp(rule.regex.source, flags);
      const matches = Array.from(working.matchAll(re));
      if (matches.length === 0) continue;
      for (const match of matches) {
        removed.push({
          pattern: rule.pattern,
          phrase: match[0].trim(),
          position: match.index ?? 0,
          reason: rule.reason,
        });
      }
      const next = working.replace(re, "");
      if (next !== working) {
        working = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Capitalize first letter if stripped opener left lowercase start.
  const trimmed = working.trim();
  const stripped =
    trimmed.length > 0 ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;

  // Residual score: count remaining chatbot signals that we didn't strip.
  const residual = computeResidualScore(stripped);

  return {
    stripped,
    original: input,
    removed_phrases: removed,
    residual_chatbot_score: residual,
  };
}

function computeResidualScore(text: string): number {
  let score = 0;
  // Excessive exclamation points.
  const exclaims = (text.match(/!/g) ?? []).length;
  if (exclaims > 2) score += Math.min(20, (exclaims - 2) * 4);
  // Hedge phrases beyond one.
  const hedges = (
    text.match(
      /\b(perhaps|maybe|might|could be|possibly|it depends|sort of|kind of)\b/gi,
    ) ?? []
  ).length;
  if (hedges > 1) score += Math.min(20, (hedges - 1) * 5);
  // Mechanical bullet markers in short prose.
  const bullets = (text.match(/^\s*[-*•]\s+/gm) ?? []).length;
  if (bullets > 0 && text.length < 250 && bullets >= 3) score += 15;
  return Math.min(100, score);
}

/**
 * Pure: tells caller whether stripping should escalate to a regen request
 * (when too much was removed and the response is now substance-light).
 */
export function shouldRequestRegen(result: StrippedResponse): boolean {
  if (result.removed_phrases.length === 0) return false;
  const removedChars = result.removed_phrases.reduce(
    (n, r) => n + r.phrase.length,
    0,
  );
  const totalChars = result.original.length || 1;
  const removalRatio = removedChars / totalChars;
  // If more than 60% of the response was filler, ask the model to regenerate.
  return removalRatio > 0.6 || result.stripped.trim().length < 12;
}
