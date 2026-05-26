/**
 * PER (Phoneme Error Rate) scorer — delegates phonemisation to an
 * injected port and computes Levenshtein over the resulting phoneme
 * stream.
 *
 * The actual phoneme model lives in sibling Wave 19G `language-sota` /
 * 19H `swahili-linguistics`. Those packages may not yet exist when this
 * one lands — so the dependency is via an injected port, not a direct
 * import.
 *
 * Reference: same Levenshtein logic as `wer-scorer`, but applied to a
 * phoneme list rather than a word list.
 */

import type { LanguageTag } from '../types.js';
import { computeWer } from './wer-scorer.js';

/**
 * Injected port for phonemisation. The default implementation (used in
 * tests when no real port is wired) just returns the text split into
 * individual characters, which is a deterministic placeholder — NOT a
 * real phoneme model.
 */
export interface PhonemiserPort {
  phonemise(text: string, lang: LanguageTag): Promise<ReadonlyArray<string>>;
}

/**
 * Default `PhonemiserPort` — splits the text into Unicode codepoints.
 * Deterministic and offline. The production wiring replaces this with
 * the `language-sota` package's actual phonemiser.
 */
export const naiveCodepointPhonemiser: PhonemiserPort = Object.freeze({
  async phonemise(
    text: string,
    _lang: LanguageTag,
  ): Promise<ReadonlyArray<string>> {
    if (typeof text !== 'string') {
      return Object.freeze([]);
    }
    return Object.freeze(
      Array.from(text.toLowerCase()).filter((c) => /\S/.test(c)),
    );
  },
});

export interface PerComputation {
  readonly per: number;
  readonly substitutions: number;
  readonly deletions: number;
  readonly insertions: number;
  readonly referencePhonemes: number;
  readonly hypothesisPhonemes: number;
}

/**
 * Compute PER (Phoneme Error Rate) for a (reference, hypothesis) pair
 * in the given language using the supplied phonemiser port.
 */
export async function computePer(
  reference: string,
  hypothesis: string,
  lang: LanguageTag,
  phonemiser: PhonemiserPort,
): Promise<PerComputation> {
  try {
    const refPhonemes = await phonemiser.phonemise(reference, lang);
    const hypPhonemes = await phonemiser.phonemise(hypothesis, lang);

    // Re-use the word-level Levenshtein by joining phonemes with a unique
    // separator. The `computeWer` normaliser will drop the separator;
    // we use an inert character (' ') so phoneme boundaries become
    // word boundaries in the WER engine.
    const refStr = refPhonemes.join(' ');
    const hypStr = hypPhonemes.join(' ');
    const w = computeWer(refStr, hypStr);
    return Object.freeze({
      per: w.wer,
      substitutions: w.substitutions,
      deletions: w.deletions,
      insertions: w.insertions,
      referencePhonemes: w.referenceTokens,
      hypothesisPhonemes: w.hypothesisTokens,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PER scorer: phonemiser failed — ${message}`);
  }
}

export async function scorePer(
  reference: string,
  hypothesis: string,
  lang: LanguageTag,
  phonemiser: PhonemiserPort,
): Promise<number> {
  const { per } = await computePer(reference, hypothesis, lang, phonemiser);
  return Math.max(0, Math.min(1, per));
}
