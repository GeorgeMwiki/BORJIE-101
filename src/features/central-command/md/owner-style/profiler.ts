/**
 * Owner-Style Profiler — online Bayesian updating of the OwnerStyleProfile.
 *
 * Model: each categorical dimension carries a Dirichlet posterior over its
 * categories (represented as a pseudo-count weight vector). Each observation
 * contributes positive weight to the categories it implies. We never
 * overwrite — we always *blend* with the prior.
 *
 * Decay: before applying a new observation we exponentially decay all
 * existing weights toward the prior alpha. This way old observations weight
 * less, recent observations weight more.
 */

import { z } from "zod";
import { createLogger } from "@/lib/logger";
import {
  CATEGORY_VALUES,
  DIMENSION_KEYS,
  PRIOR_ALPHA,
  type OwnerStyleProfile,
  type TimeOfDayBand,
} from "./style-dimensions";

const log = createLogger("md.owner-style");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single chat-turn observation we use to update the profile. */
export const ChatTurnObservationSchema = z.object({
  text: z.string(),
  /** ISO timestamp of the turn */
  timestamp: z.string(),
  /**
   * Optional reaction from the owner to the previous MD response.
   *  +1 = thumbs up / "good" / continue
   *  -1 = thumbs down / "stop" / "no"
   *   0 = neutral / unclassified
   */
  reaction: z.number().min(-1).max(1).optional(),
  /** Channel this turn arrived on */
  channel: z.enum(["chat", "email", "voice", "sms", "whatsapp"]).optional(),
});
export type ChatTurnObservation = z.infer<typeof ChatTurnObservationSchema>;

/** Evidence vector extracted from a single turn (per-dimension category votes). */
export interface EvidenceVector {
  readonly tone?: Record<string, number>;
  readonly verbosity?: Record<string, number>;
  readonly decisionStyle?: Record<string, number>;
  readonly riskAppetite?: Record<string, number>;
  readonly languagePreference?: Record<string, number>;
  readonly channelPreference?: Record<string, number>;
  readonly domainPriorities?: Record<string, number>;
  readonly timeOfDayBand?: TimeOfDayBand;
}

export interface ProfilerOptions {
  /**
   * Decay factor in (0, 1]. Each update multiplies the existing
   * pseudo-counts by `decay` before adding the new evidence weight.
   * Default 0.98 — half-life of ~34 observations.
   */
  readonly decay?: number;
  /** Now-ish — injectable for tests. */
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Lexicon-based evidence extraction (deterministic, testable)
// ---------------------------------------------------------------------------

const TONE_LEXICON = {
  formal: ["pursuant", "kindly", "respectfully", "shall", "regards"],
  casual: ["hey", "lol", "cool", "yeah", "sup", "gonna"],
  collegial: ["thanks", "appreciate", "team", "we", "together"],
  coach_like: ["why", "what if", "imagine", "consider", "think about"],
} as const;

const VERBOSITY_HINTS = (text: string): Record<string, number> => {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words <= 10) return { terse: 1 };
  if (words <= 40) return { balanced: 1 };
  return { verbose: 1 };
};

const DECISION_LEXICON = {
  directive: ["just do it", "do it", "go ahead", "execute", "proceed"],
  collaborative: [
    "what do you think",
    "any thoughts",
    "let's discuss",
    "shall we",
  ],
  consultative: ["pros and cons", "options", "trade-offs", "alternatives"],
} as const;

const RISK_LEXICON = {
  conservative: ["safe", "careful", "cautious", "avoid risk", "minimise risk"],
  moderate: ["balanced", "reasonable", "fair", "standard"],
  aggressive: ["aggressive", "bold", "big bet", "double down", "scale fast"],
} as const;

const SWAHILI_TOKENS = [
  "habari",
  "asante",
  "tafadhali",
  "biashara",
  "shilingi",
  "ndio",
  "hapana",
  "sawa",
  "karibu",
  "rafiki",
];

const DOMAIN_LEXICON = {
  sales_led: ["sales", "revenue", "leads", "deals", "pipeline", "customer"],
  ops_led: ["operations", "ops", "logistics", "supply", "inventory", "process"],
  people_led: ["staff", "team", "hire", "people", "culture", "morale"],
  finance_led: ["cashflow", "cash", "margin", "profit", "loss", "budget"],
  balanced: [],
} as const;

function countMatches(
  haystack: string,
  needles: ReadonlyArray<string>,
): number {
  const lower = haystack.toLowerCase();
  let n = 0;
  for (const needle of needles) {
    if (!needle) continue;
    const idx = lower.indexOf(needle);
    if (idx !== -1) n += 1;
  }
  return n;
}

function votesFromLexicon(
  text: string,
  lexicon: Record<string, ReadonlyArray<string>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [category, words] of Object.entries(lexicon)) {
    const hits = countMatches(text, words);
    if (hits > 0) out[category] = hits;
  }
  return out;
}

export function bandForTimestamp(iso: string): TimeOfDayBand {
  const d = new Date(iso);
  const h = d.getUTCHours();
  if (h >= 4 && h < 8) return "early_morning";
  if (h >= 8 && h < 12) return "morning";
  if (h >= 12 && h < 16) return "afternoon";
  if (h >= 16 && h < 20) return "evening";
  return "night";
}

/**
 * Extract a per-dimension evidence vector from a single chat turn.
 * Purely lexical — no LLM call. The LLM bootstrap lives in
 * `style-inferrer.ts`.
 */
export function extractEvidence(turn: ChatTurnObservation): EvidenceVector {
  const text = turn.text;
  const tone = votesFromLexicon(text, TONE_LEXICON);
  const verbosity: Record<string, number> = VERBOSITY_HINTS(text);
  const decisionStyle = votesFromLexicon(text, DECISION_LEXICON);
  const riskAppetite = votesFromLexicon(text, RISK_LEXICON);
  const domainPriorities = votesFromLexicon(text, DOMAIN_LEXICON);

  // Language: count swahili tokens vs total tokens
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const swahiliHits = tokens.filter((t) => SWAHILI_TOKENS.includes(t)).length;
  const languagePreference: Record<string, number> = {};
  if (tokens.length > 0) {
    const ratio = swahiliHits / tokens.length;
    if (ratio >= 0.5) languagePreference.swahili_only = 1;
    else if (ratio >= 0.2) languagePreference.swahili_leaning_bilingual = 1;
    else if (ratio > 0) languagePreference.english_leaning_bilingual = 1;
    else languagePreference.english_only = 0.5; // weak vote; absence isn't proof
  }

  // Channel: explicit observation
  const channelPreference: Record<string, number> = {};
  if (turn.channel === "email") channelPreference.chat_plus_email = 1;
  else if (turn.channel === "voice") channelPreference.chat_plus_voice = 1;
  else if (turn.channel === "sms" || turn.channel === "whatsapp")
    channelPreference.multi_channel = 1;
  else if (turn.channel === "chat") channelPreference.chat_only = 0.5;

  return {
    tone: Object.keys(tone).length ? tone : undefined,
    verbosity,
    decisionStyle: Object.keys(decisionStyle).length
      ? decisionStyle
      : undefined,
    riskAppetite: Object.keys(riskAppetite).length ? riskAppetite : undefined,
    languagePreference: Object.keys(languagePreference).length
      ? languagePreference
      : undefined,
    channelPreference: Object.keys(channelPreference).length
      ? channelPreference
      : undefined,
    domainPriorities: Object.keys(domainPriorities).length
      ? domainPriorities
      : undefined,
    timeOfDayBand: bandForTimestamp(turn.timestamp),
  };
}

// ---------------------------------------------------------------------------
// Bayesian blend
// ---------------------------------------------------------------------------

function applyDecay(
  weights: Readonly<Record<string, number>>,
  decay: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    const decayed = v * decay;
    out[k] = decayed < PRIOR_ALPHA ? PRIOR_ALPHA : decayed;
  }
  return out;
}

function addVotes(
  weights: Readonly<Record<string, number>>,
  votes: Readonly<Record<string, number>>,
  weight: number,
): Record<string, number> {
  const out: Record<string, number> = { ...weights };
  for (const [k, v] of Object.entries(votes)) {
    out[k] = (out[k] ?? PRIOR_ALPHA) + v * weight;
  }
  return out;
}

function argmaxAndConfidence(weights: Readonly<Record<string, number>>): {
  value: string;
  confidence: number;
} {
  const entries = Object.entries(weights);
  let total = 0;
  let bestKey = entries[0]?.[0] ?? "";
  let bestVal = -Infinity;
  for (const [k, v] of entries) {
    total += v;
    if (v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  return {
    value: bestKey,
    confidence: total > 0 ? bestVal / total : 0,
  };
}

function blendDimension<TValue extends string>(
  dim: { value: TValue; weights: Record<string, number>; confidence: number },
  votes: Record<string, number> | undefined,
  decay: number,
  evidenceWeight: number,
  allowedValues: ReadonlyArray<TValue>,
): { value: TValue; weights: Record<string, number>; confidence: number } {
  if (!votes) return dim;
  const decayed = applyDecay(dim.weights, decay);
  const blended = addVotes(decayed, votes, evidenceWeight);
  const { value, confidence } = argmaxAndConfidence(blended);
  const safeValue = (allowedValues as ReadonlyArray<string>).includes(value)
    ? (value as TValue)
    : dim.value;
  return { value: safeValue, weights: blended, confidence };
}

function blendTimeOfDay(
  tod: OwnerStyleProfile["timeOfDayPatterns"],
  band: TimeOfDayBand | undefined,
  decay: number,
): OwnerStyleProfile["timeOfDayPatterns"] {
  if (!band) return tod;
  const decayed = applyDecay(
    tod.bands as Record<string, number>,
    decay,
  ) as Record<TimeOfDayBand, number>;
  decayed[band] = (decayed[band] ?? PRIOR_ALPHA) + 1;
  const { value } = argmaxAndConfidence(decayed);
  return {
    bands: decayed,
    peakBand: value as TimeOfDayBand,
    sampleSize: tod.sampleSize + 1,
  };
}

function aggregateConfidence(profile: OwnerStyleProfile): number {
  const vals = DIMENSION_KEYS.map((k) => profile[k].confidence);
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

// ---------------------------------------------------------------------------
// Public update API
// ---------------------------------------------------------------------------

/**
 * Returns a NEW profile incorporating the given turn. Never mutates input.
 * Reaction (-1 / 0 / +1) gates evidence weight: a negative reaction *down*-
 * weights the votes (the owner pushed back on something), zero is neutral,
 * positive amplifies.
 */
export function updateProfile(
  prior: OwnerStyleProfile,
  turn: ChatTurnObservation,
  options: ProfilerOptions = {},
): OwnerStyleProfile {
  const parsed = ChatTurnObservationSchema.safeParse(turn);
  if (!parsed.success) {
    log.warn("invalid turn rejected", { error: parsed.error.message });
    return prior;
  }
  const decay = options.decay ?? 0.98;
  if (decay <= 0 || decay > 1) {
    log.warn("invalid decay; falling back", { decay });
  }
  const safeDecay = decay > 0 && decay <= 1 ? decay : 0.98;
  const now = (options.now ?? (() => new Date().toISOString()))();

  const evidence = extractEvidence(parsed.data);
  const reaction = parsed.data.reaction ?? 0;

  // Map reaction -> evidence weight. -1 = retreat (0.25),
  // 0 = neutral (1.0), +1 = amplify (1.75).
  const evidenceWeight = reaction < 0 ? 0.25 : reaction > 0 ? 1.75 : 1.0;

  const tone = blendDimension(
    prior.tone,
    evidence.tone,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.tone as ReadonlyArray<OwnerStyleProfile["tone"]["value"]>,
  );
  const verbosity = blendDimension(
    prior.verbosity,
    evidence.verbosity,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.verbosity as ReadonlyArray<
      OwnerStyleProfile["verbosity"]["value"]
    >,
  );
  const decisionStyle = blendDimension(
    prior.decisionStyle,
    evidence.decisionStyle,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.decisionStyle as ReadonlyArray<
      OwnerStyleProfile["decisionStyle"]["value"]
    >,
  );
  const riskAppetite = blendDimension(
    prior.riskAppetite,
    evidence.riskAppetite,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.riskAppetite as ReadonlyArray<
      OwnerStyleProfile["riskAppetite"]["value"]
    >,
  );
  const languagePreference = blendDimension(
    prior.languagePreference,
    evidence.languagePreference,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.languagePreference as ReadonlyArray<
      OwnerStyleProfile["languagePreference"]["value"]
    >,
  );
  const channelPreference = blendDimension(
    prior.channelPreference,
    evidence.channelPreference,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.channelPreference as ReadonlyArray<
      OwnerStyleProfile["channelPreference"]["value"]
    >,
  );
  const domainPriorities = blendDimension(
    prior.domainPriorities,
    evidence.domainPriorities,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.domainPriorities as ReadonlyArray<
      OwnerStyleProfile["domainPriorities"]["value"]
    >,
  );
  const timeOfDayPatterns = blendTimeOfDay(
    prior.timeOfDayPatterns,
    evidence.timeOfDayBand,
    safeDecay,
  );

  const next: OwnerStyleProfile = {
    ...prior,
    tone,
    verbosity,
    decisionStyle,
    riskAppetite,
    languagePreference,
    channelPreference,
    domainPriorities,
    timeOfDayPatterns,
    sampleSize: prior.sampleSize + 1,
    lastUpdatedAt: now,
    confidence: 0, // recomputed below
  };
  return { ...next, confidence: aggregateConfidence(next) };
}

/** Apply an entire batch of observations in order. */
export function updateProfileBatch(
  prior: OwnerStyleProfile,
  turns: ReadonlyArray<ChatTurnObservation>,
  options: ProfilerOptions = {},
): OwnerStyleProfile {
  return turns.reduce<OwnerStyleProfile>(
    (acc, t) => updateProfile(acc, t, options),
    prior,
  );
}

// Exported for use by feedback-loop.ts (so reaction-only updates can reuse the
// dimension blender without re-running lexicon extraction).
export const _internal = {
  blendDimension,
  applyDecay,
  argmaxAndConfidence,
  aggregateConfidence,
  /** Direct injection of pre-computed votes into a dimension. */
  injectVotes<TValue extends string>(
    dim: {
      value: TValue;
      weights: Record<string, number>;
      confidence: number;
    },
    votes: Record<string, number>,
    decay: number,
    weight: number,
    allowedValues: ReadonlyArray<TValue>,
  ) {
    return blendDimension(dim, votes, decay, weight, allowedValues);
  },
} as const;

export type Internal = typeof _internal;

// Re-export for testability
export { argmaxAndConfidence as _argmaxAndConfidence };
