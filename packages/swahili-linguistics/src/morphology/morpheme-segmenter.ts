/**
 * Morpheme segmenter (Wave 19H).
 *
 * Front-door API: take a Swahili surface form and produce its
 * morphological decomposition. Strategy:
 *
 *   1. High-confidence noun override (e.g. `kitabu`, `mtu`) wins
 *      outright — those forms are dictionary-pinned.
 *   2. Verb attempt — only when the surface looks verb-shaped and
 *      the analyzer's confidence ≥ 0.6.
 *   3. Lower-confidence noun fallback.
 *   4. Particle / unknown.
 *
 * Source attribution lives in the called modules.
 */

import type { Morpheme, PosTag } from '../types.js';
import { analyzeVerb } from './verb-analyzer.js';
import { detectNounClass } from './noun-class-detector.js';

export interface SegmentationResult {
  readonly surface: string;
  readonly lemma: string;
  readonly morphemes: ReadonlyArray<Morpheme>;
  readonly pos: PosTag;
  readonly confidence: number;
}

const VERB_LIKE_REGEX = /^(ha)?(ni|u|a|tu|m|mu|wa|i|li|ya|ki|vi|zi|ku|pa)(na|me|li|ta|nge|ngali|ki|ja|hu)?/;

function asNounResult(
  surface: string,
  noun: ReturnType<typeof detectNounClass>,
): SegmentationResult {
  const morphemes: ReadonlyArray<Morpheme> = Object.freeze([
    Object.freeze({
      value: noun.surface,
      slot: 'stem' as const,
      gloss: `noun.cl${noun.nounClass}`,
    }),
  ]);
  return Object.freeze({
    surface,
    lemma: noun.lemma,
    morphemes,
    pos: 'noun' as PosTag,
    confidence: noun.confidence,
  });
}

export function segmentMorphemes(surface: string): SegmentationResult {
  const normalised = surface.trim().toLowerCase();

  // 1. High-confidence noun override always wins (dictionary-pinned).
  let nounAnalysis: ReturnType<typeof detectNounClass> | null = null;
  try {
    const candidate = detectNounClass(normalised);
    if (candidate.confidence >= 0.9) {
      return asNounResult(surface, candidate);
    }
    nounAnalysis = candidate;
  } catch {
    // empty input — fall through.
  }

  // 2. Verb attempt — only if the surface looks verb-shaped.
  if (VERB_LIKE_REGEX.test(normalised)) {
    const verb = analyzeVerb(normalised);
    if (verb.confidence >= 0.6 && verb.morphemes.length >= 2) {
      return Object.freeze({
        surface,
        lemma: verb.lemma,
        morphemes: verb.morphemes,
        pos: 'verb' as PosTag,
        confidence: verb.confidence,
      });
    }
  }

  // 3. Lower-confidence noun fallback.
  if (nounAnalysis !== null) {
    return asNounResult(surface, nounAnalysis);
  }

  // 4. Particle / unknown fallback.
  return Object.freeze({
    surface,
    lemma: normalised,
    morphemes: Object.freeze([
      Object.freeze({
        value: normalised,
        slot: 'particle' as const,
        gloss: 'unknown',
      }),
    ]),
    pos: 'particle' as PosTag,
    confidence: 0.2,
  });
}
