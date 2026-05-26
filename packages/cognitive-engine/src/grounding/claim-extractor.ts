/**
 * Claim extractor — Discipline 2, stage 1.
 *
 * Splits a candidate output into sentences and tags each as a "claim"
 * (factual assertion that must be cited) or "non-claim" (opinion,
 * recommendation, hedge). Deterministic heuristic; an LLM lift is
 * optionally used for borderline cases.
 *
 * Source of truth: COGNITIVE_ENGINE_SPEC.md §5 (cite-validator).
 *
 * @module @borjie/cognitive-engine/grounding/claim-extractor
 */

/** Sentence boundary regex — keeps abbreviations like `T.Sh.` intact. */
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9"'])|\n+/;

/** Hedge tokens that mark a sentence as opinion / recommendation. */
const HEDGE_TOKENS: ReadonlyArray<string> = [
  'should',
  'might',
  'could',
  'maybe',
  'i recommend',
  'i suggest',
  'consider ',
  'in my view',
  'in our view',
  'we believe',
];

/** Patterns that mark a sentence as a factual claim. */
const NUMBER_RE = /\b\d{1,3}([.,]\d+)?(%|m|mn|bn|k|km|kg|t|usd|tzs|kes)?\b/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;
const STAT_PHRASES_RE =
  /\b(higher than|lower than|the largest|the smallest|increased by|decreased by|grew|fell|rose)\b/i;
const NAMED_AUTH_RE = /\b(tumemadini|nemc|tra|bot|sec|nsf|epa|fda)\b/i;

export interface Sentence {
  readonly index: number;
  readonly text: string;
}

export interface ClassifiedSentence extends Sentence {
  readonly is_claim: boolean;
  /** Cited markers found in the sentence (e.g. `cit_xyz`). */
  readonly citation_markers: ReadonlyArray<string>;
}

export function splitSentences(text: string): ReadonlyArray<Sentence> {
  if (!text.trim()) return [];
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((s, i) => ({ index: i, text: s.trim() }))
    .filter((s) => s.text.length > 0);
}

const MARKER_RE = /\[(cit_[a-zA-Z0-9_-]+)\]/g;

export function extractMarkers(sentence: string): ReadonlyArray<string> {
  const out: Array<string> = [];
  let m: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(sentence)) !== null) {
    const id = m[1];
    if (id !== undefined) out.push(id);
  }
  return out;
}

/** Deterministic claim classifier. Returns `true` when the sentence
 *  contains at least one factual-claim signal AND no dominant hedge. */
export function classifyClaim(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  const hedged = HEDGE_TOKENS.some((t) => lower.includes(t));
  if (hedged) return false;
  if (NUMBER_RE.test(sentence)) return true;
  if (YEAR_RE.test(sentence)) return true;
  if (STAT_PHRASES_RE.test(sentence)) return true;
  if (NAMED_AUTH_RE.test(sentence)) return true;
  return false;
}

export function classifySentences(
  text: string,
): ReadonlyArray<ClassifiedSentence> {
  return splitSentences(text).map((s) => ({
    ...s,
    is_claim: classifyClaim(s.text),
    citation_markers: extractMarkers(s.text),
  }));
}
