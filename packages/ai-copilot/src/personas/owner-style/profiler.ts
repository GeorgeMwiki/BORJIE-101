/**
 * Owner-Style Profiler — online Bayesian updating of the OwnerStyleProfile.
 *
 * Model: each categorical dimension carries a Dirichlet posterior over its
 * categories (a pseudo-count weight vector). Each observation contributes
 * positive weight to the categories it implies. We never overwrite — we always
 * *blend* with the prior.
 *
 * Decay: before applying a new observation we exponentially decay all existing
 * weights toward the prior alpha (default 0.98 — half-life ~34 observations).
 * Old observations weigh less; recent observations weigh more.
 *
 * Ported from the BossNyumba profiler and retargeted real-estate → mining: the
 * EN + SW lexicons carry mining-owner idioms (mgodi = mine, mrabaha = royalty,
 * madini = minerals) alongside the generic Swahili register tokens.
 */

import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  CATEGORY_VALUES,
  DIMENSION_KEYS,
  PRIOR_ALPHA,
  type OwnerStyleProfile,
} from './style-dimensions.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single chat-turn observation we use to update the profile. */
export const ChatTurnObservationSchema = z.object({
  text: z.string(),
  /** Epoch millis of the turn. */
  tsMs: z.number().int().nonnegative(),
  /**
   * Optional reaction from the owner to the previous Mr. Mwikila response.
   *  +1 = thumbs up / "good" / continue
   *  -1 = thumbs down / "stop" / "no"
   *   0 = neutral / unclassified
   */
  reaction: z.number().min(-1).max(1).optional(),
});
export type ChatTurnObservation = z.infer<typeof ChatTurnObservationSchema>;

/** Evidence vector extracted from a single turn (per-dimension category votes). */
export interface EvidenceVector {
  readonly verbosity?: Record<string, number>;
  readonly detail?: Record<string, number>;
  readonly language?: Record<string, number>;
  readonly formality?: Record<string, number>;
  readonly posture?: Record<string, number>;
}

export interface ProfilerOptions {
  /**
   * Decay factor in (0, 1]. Each update multiplies the existing pseudo-counts
   * by `decay` before adding the new evidence weight. Default 0.98.
   */
  readonly decay?: number;
  /** Now-ish — injectable for tests. */
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Lexicon-based evidence extraction (deterministic, testable). EN + SW.
// ---------------------------------------------------------------------------

const VERBOSITY_HINTS = (text: string): Record<string, number> => {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words <= 10) return { terse: 1 };
  if (words <= 40) return { balanced: 1 };
  return { verbose: 1 };
};

/** "How much why / reasoning" lexicon — EN + SW. */
const DETAIL_LEXICON: Record<string, ReadonlyArray<string>> = {
  high: [
    'why',
    'explain',
    'reason',
    'details',
    'breakdown',
    'walk me through',
    'kwa nini', // why
    'eleza', // explain
    'sababu', // reason
    'kwa undani', // in detail
  ],
  low: [
    'just the answer',
    'bottom line',
    'summary',
    'tldr',
    'kwa ufupi', // briefly
    'muhtasari', // summary
  ],
};

/** Register lexicon — EN + SW. */
const FORMALITY_LEXICON: Record<string, ReadonlyArray<string>> = {
  formal: [
    'pursuant',
    'kindly',
    'respectfully',
    'shall',
    'regards',
    'tafadhali', // please (polite)
    'naomba', // I request (polite)
    'heshima', // respect
  ],
  casual: [
    'hey',
    'lol',
    'cool',
    'yeah',
    'gonna',
    'sawa', // ok/cool
    'mambo', // hey/whatsup
    'poa', // cool
    'vipi', // whatsup
  ],
};

/**
 * Decision + risk stance lexicon — EN + SW. Mining-owner flavoured: a licence
 * holder weighing a pit expansion, a vendor switch, or a royalty review.
 */
const POSTURE_LEXICON: Record<string, ReadonlyArray<string>> = {
  cautious: [
    'careful',
    'cautious',
    'safe',
    'avoid risk',
    'go slow',
    'angalia', // be careful / watch out
    'pole pole', // slowly
    'hatari', // danger / risk
    'usalama', // safety
  ],
  bold: [
    'aggressive',
    'bold',
    'go big',
    'double down',
    'scale fast',
    'just do it',
    'expand the pit',
    'fanya tu', // just do it
    'haraka', // fast / quickly
    'songa mbele', // push forward
  ],
};

/**
 * Swahili tokens used to estimate the language lean. Mining-owner flavoured:
 * includes generic SW + mining-domain SW (mine, minerals, royalty, licence).
 */
const SWAHILI_TOKENS = [
  'habari',
  'asante',
  'tafadhali',
  'ndio',
  'hapana',
  'sawa',
  'karibu',
  'pesa', // money
  'mgodi', // mine
  'madini', // minerals
  'mrabaha', // royalty
  'leseni', // licence
  'mkataba', // contract
  'malipo', // payment
  'mnunuzi', // buyer
];

function countMatches(
  haystack: string,
  needles: ReadonlyArray<string>
): number {
  const lower = haystack.toLowerCase();
  let n = 0;
  for (const needle of needles) {
    if (!needle) continue;
    if (lower.includes(needle)) n += 1;
  }
  return n;
}

function votesFromLexicon(
  text: string,
  lexicon: Record<string, ReadonlyArray<string>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [category, words] of Object.entries(lexicon)) {
    const hits = countMatches(text, words);
    if (hits > 0) out[category] = hits;
  }
  return out;
}

/**
 * Extract a per-dimension evidence vector from a single chat turn. Purely
 * lexical — no LLM call.
 */
export function extractEvidence(turn: ChatTurnObservation): EvidenceVector {
  const text = turn.text;
  const verbosity: Record<string, number> = VERBOSITY_HINTS(text);
  const detail = votesFromLexicon(text, DETAIL_LEXICON);
  const formality = votesFromLexicon(text, FORMALITY_LEXICON);
  const posture = votesFromLexicon(text, POSTURE_LEXICON);

  // Language: count swahili tokens vs total tokens.
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const swahiliHits = tokens.filter((t) => SWAHILI_TOKENS.includes(t)).length;
  const language: Record<string, number> = {};
  if (tokens.length > 0) {
    const ratio = swahiliHits / tokens.length;
    if (ratio >= 0.5) language.sw = 1;
    else if (ratio >= 0.2) language.sw_leaning_bilingual = 1;
    else if (ratio > 0) language.en_leaning_bilingual = 1;
    else language.en = 0.5; // weak vote; absence isn't proof
  }

  // exactOptionalPropertyTypes: build mutable obj, assign only present keys.
  const out: {
    verbosity?: Record<string, number>;
    detail?: Record<string, number>;
    language?: Record<string, number>;
    formality?: Record<string, number>;
    posture?: Record<string, number>;
  } = { verbosity };
  if (Object.keys(detail).length) out.detail = detail;
  if (Object.keys(language).length) out.language = language;
  if (Object.keys(formality).length) out.formality = formality;
  if (Object.keys(posture).length) out.posture = posture;
  return out;
}

// ---------------------------------------------------------------------------
// Bayesian blend
// ---------------------------------------------------------------------------

function applyDecay(
  weights: Readonly<Record<string, number>>,
  decay: number
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
  weight: number
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
  let bestKey = entries[0]?.[0] ?? '';
  let bestVal = -Infinity;
  for (const [k, v] of entries) {
    total += v;
    if (v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  return { value: bestKey, confidence: total > 0 ? bestVal / total : 0 };
}

function blendDimension<TValue extends string>(
  dim: { value: TValue; weights: Record<string, number>; confidence: number },
  votes: Record<string, number> | undefined,
  decay: number,
  evidenceWeight: number,
  allowedValues: ReadonlyArray<TValue>
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
 * weights the votes (the owner pushed back), zero is neutral, positive
 * amplifies.
 */
export function updateProfile(
  prior: OwnerStyleProfile,
  turn: ChatTurnObservation,
  options: ProfilerOptions = {}
): OwnerStyleProfile {
  const parsed = ChatTurnObservationSchema.safeParse(turn);
  if (!parsed.success) {
    logger.warn('owner-style.profiler.invalid-turn', {
      error: parsed.error.message,
    });
    return prior;
  }
  const decay = options.decay ?? 0.98;
  const safeDecay = decay > 0 && decay <= 1 ? decay : 0.98;
  const now = (options.now ?? (() => new Date().toISOString()))();

  const evidence = extractEvidence(parsed.data);
  const reaction = parsed.data.reaction ?? 0;

  // Map reaction -> evidence weight. -1 = retreat (0.25), 0 = neutral (1.0),
  // +1 = amplify (1.75).
  const evidenceWeight = reaction < 0 ? 0.25 : reaction > 0 ? 1.75 : 1.0;

  const verbosity = blendDimension(
    prior.verbosity,
    evidence.verbosity,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.verbosity as ReadonlyArray<
      OwnerStyleProfile['verbosity']['value']
    >
  );
  const detail = blendDimension(
    prior.detail,
    evidence.detail,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.detail as ReadonlyArray<OwnerStyleProfile['detail']['value']>
  );
  const language = blendDimension(
    prior.language,
    evidence.language,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.language as ReadonlyArray<
      OwnerStyleProfile['language']['value']
    >
  );
  const formality = blendDimension(
    prior.formality,
    evidence.formality,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.formality as ReadonlyArray<
      OwnerStyleProfile['formality']['value']
    >
  );
  const posture = blendDimension(
    prior.posture,
    evidence.posture,
    safeDecay,
    evidenceWeight,
    CATEGORY_VALUES.posture as ReadonlyArray<
      OwnerStyleProfile['posture']['value']
    >
  );

  const next: OwnerStyleProfile = {
    ...prior,
    verbosity,
    detail,
    language,
    formality,
    posture,
    feedbackCount: prior.feedbackCount + 1,
    lastUpdatedAt: now,
    confidence: 0, // recomputed below
  };
  return { ...next, confidence: aggregateConfidence(next) };
}

/** Apply an entire batch of observations in order. */
export function updateProfileBatch(
  prior: OwnerStyleProfile,
  turns: ReadonlyArray<ChatTurnObservation>,
  options: ProfilerOptions = {}
): OwnerStyleProfile {
  return turns.reduce<OwnerStyleProfile>(
    (acc, t) => updateProfile(acc, t, options),
    prior
  );
}

// Exported for feedback-loop.ts (reaction-only updates reuse the blender
// without re-running lexicon extraction).
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
    allowedValues: ReadonlyArray<TValue>
  ) {
    return blendDimension(dim, votes, decay, weight, allowedValues);
  },
} as const;

export type Internal = typeof _internal;
