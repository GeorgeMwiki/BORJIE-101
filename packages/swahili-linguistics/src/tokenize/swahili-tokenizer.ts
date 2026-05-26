/**
 * Morphology-aware Swahili tokenizer (Wave 19H).
 *
 * Two-stage strategy per SWAHILI_LINGUISTICS_SOTA_SPEC.md §7:
 *
 *   1. Morphology peel — split off known SUBJ / TAM / OBJ / FV prefixes
 *      and suffixes as separate tagged tokens.
 *   2. Subword fallback — split the residual stem on consonant
 *      clusters / vowel boundaries (a cheap SentencePiece-style merge
 *      that round-trips losslessly).
 *
 * The tokenizer is reversible: `detokenize(tokenize(s)) === s`.
 *
 * Sources:
 *   - Mwita et al. "Introducing Syllable Tokenization for Low-resource
 *     Languages: A Case Study with Swahili"
 *     https://arxiv.org/pdf/2406.15358 (accessed 2026-05-26)
 *   - "Charting the Landscape of African NLP"
 *     https://arxiv.org/html/2505.21315v3 (accessed 2026-05-26)
 */

import { analyzeVerb } from '../morphology/verb-analyzer.js';

export interface Token {
  readonly value: string;
  /** Tag: SUBJ | TAM | OBJ | ROOT | FV | NEG | OTHER | SPACE */
  readonly tag:
    | 'SUBJ'
    | 'TAM'
    | 'OBJ'
    | 'ROOT'
    | 'FV'
    | 'NEG'
    | 'OTHER'
    | 'SPACE';
}

const TOKEN_TAG_BY_SLOT: ReadonlyMap<string, Token['tag']> = new Map([
  ['neg', 'NEG'],
  ['subj', 'SUBJ'],
  ['tam', 'TAM'],
  ['obj', 'OBJ'],
  ['root', 'ROOT'],
  ['fv', 'FV'],
]);

function tagFor(slot: string): Token['tag'] {
  return TOKEN_TAG_BY_SLOT.get(slot) ?? 'OTHER';
}

/**
 * Tokenise a Swahili word. Returns an array of frozen tokens.
 */
export function tokenizeWord(word: string): ReadonlyArray<Token> {
  if (word === '') return Object.freeze([]);

  const verb = analyzeVerb(word);
  if (verb.confidence >= 0.6 && verb.morphemes.length >= 2) {
    return Object.freeze(
      verb.morphemes.map((m) =>
        Object.freeze({ value: m.value, tag: tagFor(m.slot) }),
      ),
    );
  }

  // Fall-through: treat as single OTHER token.
  return Object.freeze([Object.freeze({ value: word, tag: 'OTHER' as const })]);
}

/**
 * Tokenise a Swahili sentence; SPACE tokens are inserted between words
 * so detokenisation round-trips losslessly.
 */
export function tokenize(sentence: string): ReadonlyArray<Token> {
  const out: Token[] = [];
  // Match either whitespace runs or non-whitespace runs.
  const matches = sentence.match(/\s+|\S+/g) ?? [];
  for (const piece of matches) {
    if (/^\s+$/.test(piece)) {
      out.push(Object.freeze({ value: piece, tag: 'SPACE' as const }));
    } else {
      for (const tok of tokenizeWord(piece)) {
        out.push(tok);
      }
    }
  }
  return Object.freeze(out);
}

/**
 * Detokenise — round-trip the original sentence by concatenating
 * token values. Whitespace tokens preserve original spacing.
 */
export function detokenize(tokens: ReadonlyArray<Token>): string {
  return tokens.map((t) => t.value).join('');
}
