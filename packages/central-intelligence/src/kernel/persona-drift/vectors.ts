/**
 * Persona-vector probe — 24-dimension behavioural fingerprint for the
 * platform voice. Inspired by Anthropic's "Persona Vectors" research
 * (the Steering Vectors line) and mirrors LITFIN's
 * `src/core/governance/persona-drift/vectors.ts`.
 *
 * The probe scores the assistant's recent output against a fixed
 * reference vector. Each dimension is a [0,1] number computed from
 * lexical / structural heuristics over the rendered text. The
 * aggregate L2 distance + worst-dim drift produces a verdict that
 * the alert module emits as a `PersonaDriftEvent`.
 *
 * Property-management framing: dimensions include
 * `regulatory_citation_discipline` (KRA / RERA / PDPA / BoT) and
 * `currency_explicitness` (ISO-4217 prefix on every figure).
 *
 * NOTE: the heuristics are intentionally simple — substring counts,
 * regex hit-rates over sentence count. The signal compounds across
 * runs; one-shot the per-dim values are noisy. This is acceptable
 * because the alert module averages over a *batch* of recent
 * outputs.
 */

/**
 * The 24 dimensions of the persona vector. Order matters: the
 * reference vector below must match this enumeration index-for-index.
 */
export const PERSONA_VECTOR_DIMS = [
  'warmth',
  'directness',
  'brevity',
  'hedging_rate',
  'jargon_density',
  'no_em_dash',
  'no_filler',
  'no_buzzwords',
  'first_person_singular',
  'first_person_plural',
  'no_ai_dodge',
  'numerical_discipline',
  'currency_explicitness',
  'regulatory_citation_discipline',
  'no_eviction_promise',
  'no_market_prediction',
  'bilingual_responsiveness',
  'brand_name_preservation',
  'citation_per_claim',
  'imperative_tone',
  'question_to_user_ratio',
  'apology_rate',
  'fabrication_pressure',
  'pushback_willingness',
] as const;

export type PersonaVectorDim = (typeof PERSONA_VECTOR_DIMS)[number];

/**
 * A persona vector — readonly numeric record over the 24 dims, each
 * in [0,1].
 */
export type PersonaVector = {
  readonly [K in PersonaVectorDim]: number;
};

/**
 * The reference (target) persona for the Borjie platform voice.
 * Values are calibrated to LITFIN's reference vector, then adjusted
 * for the property-management tone (slightly higher warmth, lower
 * jargon, harder regulatory discipline). LITFIN's reference is at
 * `vectors.ts:70-97` of the LITFIN brain.
 */
export const BORJIE_REFERENCE_PERSONA: PersonaVector = {
  warmth:                          0.78,
  directness:                      0.85,
  brevity:                         0.75,
  hedging_rate:                    0.15,  // low hedging is the target
  jargon_density:                  0.30,
  no_em_dash:                      1.00,
  no_filler:                       1.00,
  no_buzzwords:                    1.00,
  first_person_singular:           0.50,  // mixed across surfaces
  first_person_plural:             0.50,
  no_ai_dodge:                     1.00,
  numerical_discipline:            0.95,
  currency_explicitness:           0.95,
  regulatory_citation_discipline:  0.85,
  no_eviction_promise:             1.00,
  no_market_prediction:            1.00,
  bilingual_responsiveness:        0.70,
  brand_name_preservation:         1.00,
  citation_per_claim:              0.85,
  imperative_tone:                 0.40,
  question_to_user_ratio:          0.25,
  apology_rate:                    0.05,
  fabrication_pressure:            0.05,  // low = good (rare)
  pushback_willingness:            0.60,
};

// ────────────────────────────────────────────────────────────────────
// Probe — computes a persona vector from a rendered output sample.
// ────────────────────────────────────────────────────────────────────

const EM_DASH_RE = /—/g;
const FILLER_RE = /\b(certainly|of course|absolutely|definitely|great question|i hope this helps|happy to help)\b/gi;
const BUZZWORD_RE = /\b(synerg\w+|leverage|cutting[- ]edge|revolutionary|game[- ]chang\w+|world[- ]class)\b/gi;
const HEDGE_RE = /\b(might|perhaps|maybe|possibly|could|i think|i believe|sort of|kind of|roughly|approximately|around)\b/gi;
const AI_DODGE_RE = /\b(as an ai|as a language model|as an artificial intelligence|i am just a|i'm just a|the system|this assistant|borjie'?s ai)\b/gi;
const CURRENCY_FIGURE_RE = /\b\d[\d,]*(\.\d+)?\b/g;
const CURRENCY_WITH_CODE_RE = /\b(TZS|KES|UGX|USD|EUR|GBP)\s*\d/g;
const REGULATOR_RE = /\b(KRA|RERA|PDPA|TGN|BoT|CMA|RMSA)\b/g;
const APOLOGY_RE = /\b(sorry|apologies|i apolog\w+|my mistake|my apologies)\b/gi;
const PUSHBACK_RE = /\b(i would advise against|i would not recommend|i disagree|that would not be advisable|i caution against)\b/gi;
const EVICTION_PROMISE_RE = /\b(guarantee\w*[^.]{0,40}(will not|won'?t|will never) be evicted|promise[^.]{0,40}(will not|won'?t) be evicted|never be evicted|will not be evicted|won'?t be evicted)\b/gi;
const MARKET_PROMISE_RE = /\b(market will (crash|boom|collapse)|guaranteed yield|guaranteed return|prices will (drop|rise) (sharply|by))\b/gi;
const FIRST_PERSON_SINGULAR_RE = /\b(i|i'm|i've|i'll|i'd|me|my|mine|myself)\b/gi;
const FIRST_PERSON_PLURAL_RE = /\b(we|we're|we've|we'll|we'd|us|our|ours|ourselves)\b/gi;
const IMPERATIVE_OPENERS_RE = /(^|\.\s+)(do|use|click|set|review|check|confirm|send|file|call)\b/gi;
const QUESTION_RE = /\?/g;
const SWAHILI_TOKENS_RE = /\b(asante|karibu|tafadhali|sawa|ndio|hapana|kwa|jambo|habari)\b/gi;
const JARGON_RE = /\b(dscr|cap rate|arrears ladder|k-anonym\w+|conformal|p99|sla|api|sso|rbac|gdpr)\b/gi;
const BRAND_RESERVED_RE = /\b(borjie|nyumba mind|boss nyumba)\b/gi;
const CITATION_RE = /\[\d+\]/g;
const FABRICATION_HINT_RE = /\b(the data shows|the records show|based on (your|the) (records|data|history)|i can see in the database)\b/gi;

export interface PersonaVectorProbeInput {
  /** The rendered assistant output to probe. */
  readonly outputText: string;
  /** Whether at least one tool call ran this turn (affects fabrication scoring). */
  readonly toolCallCount: number;
  /** Whether the user wrote in Swahili (affects bilingual responsiveness). */
  readonly userWroteSwahili?: boolean;
}

/**
 * Compute a persona vector from a single output sample. Each value
 * is clamped to [0,1]. The probe is pure and synchronous so the
 * kernel can call it inline at end-of-turn.
 */
export function probePersonaVector(
  input: PersonaVectorProbeInput,
): PersonaVector {
  const text = input.outputText;
  if (text.length === 0) {
    return { ...BORJIE_REFERENCE_PERSONA };
  }

  const sentences = splitSentences(text);
  const sentenceCount = Math.max(1, sentences.length);
  const words = text.match(/\b[\w']+\b/g) ?? [];
  const wordCount = Math.max(1, words.length);
  const lower = text.toLowerCase();

  const emDashCount = (text.match(EM_DASH_RE) ?? []).length;
  const fillerCount = (text.match(FILLER_RE) ?? []).length;
  const buzzwordCount = (text.match(BUZZWORD_RE) ?? []).length;
  const hedgeCount = (text.match(HEDGE_RE) ?? []).length;
  const aiDodgeCount = (text.match(AI_DODGE_RE) ?? []).length;
  const apologyCount = (text.match(APOLOGY_RE) ?? []).length;
  const pushbackCount = (text.match(PUSHBACK_RE) ?? []).length;
  const evictionPromise = EVICTION_PROMISE_RE.test(text);
  EVICTION_PROMISE_RE.lastIndex = 0;
  const marketPromise = MARKET_PROMISE_RE.test(text);
  MARKET_PROMISE_RE.lastIndex = 0;

  const firstSing = (text.match(FIRST_PERSON_SINGULAR_RE) ?? []).length;
  const firstPlur = (text.match(FIRST_PERSON_PLURAL_RE) ?? []).length;
  const imperativeCount = (text.match(IMPERATIVE_OPENERS_RE) ?? []).length;
  const questionCount = (text.match(QUESTION_RE) ?? []).length;
  const swahiliCount = (text.match(SWAHILI_TOKENS_RE) ?? []).length;
  const jargonCount = (text.match(JARGON_RE) ?? []).length;
  const brandPresent = BRAND_RESERVED_RE.test(text);
  BRAND_RESERVED_RE.lastIndex = 0;
  const citationCount = (text.match(CITATION_RE) ?? []).length;
  const fabricationHintCount = (text.match(FABRICATION_HINT_RE) ?? []).length;

  const figures = text.match(CURRENCY_FIGURE_RE) ?? [];
  const withCode = text.match(CURRENCY_WITH_CODE_RE) ?? [];
  // Currency-explicitness: fraction of large figures that travel with
  // an ISO-4217 code. Small figures (<100) are not penalised.
  const largeFigures = figures.filter((f) => Number(f.replace(/,/g, '')) >= 100).length;
  const currencyExplicit =
    largeFigures === 0 ? 1 : Math.min(1, withCode.length / largeFigures);

  const regulatorCount = (text.match(REGULATOR_RE) ?? []).length;

  return {
    warmth:                          warmthScore(lower),
    directness:                      clamp(1 - hedgeCount / Math.max(1, sentenceCount / 2)),
    brevity:                         clamp(1 - sentenceCount / 20),
    hedging_rate:                    clamp(hedgeCount / sentenceCount),
    jargon_density:                  clamp(jargonCount / Math.max(1, wordCount / 50)),
    no_em_dash:                      emDashCount === 0 ? 1 : 0,
    no_filler:                       fillerCount === 0 ? 1 : 0,
    no_buzzwords:                    buzzwordCount === 0 ? 1 : 0,
    first_person_singular:           clamp(firstSing / Math.max(1, sentenceCount)),
    first_person_plural:             clamp(firstPlur / Math.max(1, sentenceCount)),
    no_ai_dodge:                     aiDodgeCount === 0 ? 1 : 0,
    numerical_discipline:            largeFigures > 0 && citationCount === 0 ? 0.5 : clamp(1 - fabricationHintCount * 0.3),
    currency_explicitness:           currencyExplicit,
    regulatory_citation_discipline:  regulatorCount > 0 ? 1 : clamp(0.6),
    no_eviction_promise:             evictionPromise ? 0 : 1,
    no_market_prediction:            marketPromise ? 0 : 1,
    bilingual_responsiveness:        input.userWroteSwahili
                                       ? (swahiliCount > 0 ? 1 : 0.3)
                                       : 0.7,
    brand_name_preservation:         brandPresent ? 1 : 0.7,
    citation_per_claim:              clamp(citationCount / Math.max(1, sentenceCount / 2)),
    imperative_tone:                 clamp(imperativeCount / Math.max(1, sentenceCount / 2)),
    question_to_user_ratio:          clamp(questionCount / sentenceCount),
    apology_rate:                    clamp(apologyCount / sentenceCount),
    fabrication_pressure:            input.toolCallCount === 0 && fabricationHintCount > 0
                                       ? Math.min(1, fabricationHintCount * 0.3)
                                       : 0,
    pushback_willingness:            pushbackCount > 0 ? 1 : 0.5,
  };
}

/**
 * Per-dimension drift (absolute distance from the reference). Returns
 * a record over the same dims so callers can pick the worst axis.
 */
export function perDimDrift(
  sample: PersonaVector,
  reference: PersonaVector = BORJIE_REFERENCE_PERSONA,
): PersonaVector {
  const out = {} as { [K in PersonaVectorDim]: number };
  for (const dim of PERSONA_VECTOR_DIMS) {
    out[dim] = Math.abs(sample[dim] - reference[dim]);
  }
  return out as PersonaVector;
}

/**
 * Aggregate L2 distance over the persona vector. Normalised by the
 * dimensionality so the number is in roughly the same scale as a
 * single per-dim drift.
 */
export function aggregateL2(
  sample: PersonaVector,
  reference: PersonaVector = BORJIE_REFERENCE_PERSONA,
): number {
  let sumSq = 0;
  for (const dim of PERSONA_VECTOR_DIMS) {
    const d = sample[dim] - reference[dim];
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / PERSONA_VECTOR_DIMS.length);
}

/**
 * Find the worst axis and its drift magnitude.
 */
export function worstDim(
  drift: PersonaVector,
): { readonly dim: PersonaVectorDim; readonly value: number } {
  let worst: PersonaVectorDim = PERSONA_VECTOR_DIMS[0];
  let worstVal = drift[worst];
  for (const dim of PERSONA_VECTOR_DIMS) {
    if (drift[dim] > worstVal) {
      worstVal = drift[dim];
      worst = dim;
    }
  }
  return { dim: worst, value: worstVal };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function splitSentences(text: string): ReadonlyArray<string> {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const WARMTH_TOKENS = [
  'welcome', 'happy', 'pleased', 'thank you', 'help', 'support',
  'glad', 'hello', 'hi ', 'karibu', 'asante',
];

function warmthScore(lower: string): number {
  const hits = WARMTH_TOKENS.filter((t) => lower.includes(t)).length;
  return Math.min(1, 0.4 + hits * 0.15);
}

function clamp(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
