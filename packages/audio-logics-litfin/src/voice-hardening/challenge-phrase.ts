/**
 * Voice challenge-phrase generator + scorer (LP-27).
 *
 * Anti-replay nonce: when the adversarial classifier returns `likely_replay`
 * or `uncertain`, the system asks the speaker to read a randomly generated
 * phrase combining a simple bilingual noun + colour + a numeric nonce, so an
 * attacker with pre-recorded audio cannot reuse it. Deterministic when given
 * an RNG (for tests); otherwise uses `crypto.randomInt`.
 *
 * No financial/mining terms in the word lists — keeps the challenge
 * scenario-neutral so attackers cannot precompute a likely vocabulary.
 *
 * @module @borjie/audio-logics-litfin/voice-hardening/challenge-phrase
 */

import { randomInt } from 'node:crypto';

import type { ChallengeLocale, ChallengePhrase } from './types.js';

const NOUNS_EN: readonly string[] = [
  'river', 'mountain', 'garden', 'window', 'lantern', 'harbor', 'valley',
  'anchor', 'compass', 'feather', 'horizon', 'meadow', 'orchard', 'pebble',
  'ribbon', 'thunder', 'willow', 'beacon',
];

const NOUNS_SW: readonly string[] = [
  'mlima', 'mto', 'bustani', 'tunda', 'samaki', 'ndege', 'barabara', 'shule',
  'nyumba', 'kahawa', 'mwezi', 'jua', 'kiti', 'ufunguo', 'mvua', 'upepo',
  'kioo', 'taa',
];

const COLOURS_EN: readonly string[] = [
  'blue', 'green', 'amber', 'violet', 'crimson', 'ivory', 'silver', 'scarlet',
];

const COLOURS_SW: readonly string[] = [
  'buluu', 'kijani', 'samawati', 'nyekundu', 'njano', 'fedha', 'zambarau', 'kahawia',
];

const PHRASE_TTL_MS = 90_000;

export interface ChallengePhraseOptions {
  readonly locale?: ChallengeLocale;
  /** Integer RNG in [0, max). Defaults to crypto.randomInt. */
  readonly rng?: (max: number) => number;
  /** Injectable clock for deterministic expiry in tests. */
  readonly now?: () => number;
}

function pick<T>(arr: readonly T[], rng: (max: number) => number): T {
  return arr[rng(arr.length)] as T;
}

/**
 * Generate a challenge phrase. The result carries the spoken text, the tokens
 * the verifier expects, and a 90-second expiry.
 */
export function generateChallengePhrase(options: ChallengePhraseOptions = {}): ChallengePhrase {
  const locale = options.locale ?? 'mixed';
  const rng = options.rng ?? ((max: number) => randomInt(0, max));
  const nowMs = options.now?.() ?? Date.now();

  const nounEn = pick(NOUNS_EN, rng);
  const nounSw = pick(NOUNS_SW, rng);
  const colourEn = pick(COLOURS_EN, rng);
  const colourSw = pick(COLOURS_SW, rng);
  const nonce = `${rng(10)}${rng(10)}${rng(10)}${rng(10)}`;

  // Tokens are the words the verifier expects: a colour, a noun, and the
  // nonce as a SINGLE token. The scorer accepts the nonce spoken either as one
  // run ("0000") or as separated digits ("0 0 0 0"), so both how a person
  // naturally reads it pass.
  let text: string;
  let tokens: string[];
  switch (locale) {
    case 'en':
      text = `Please say: ${colourEn} ${nounEn} ${nonce}.`;
      tokens = [colourEn, nounEn, nonce];
      break;
    case 'sw':
      text = `Tafadhali sema: ${colourSw} ${nounSw} ${nonce}.`;
      tokens = [colourSw, nounSw, nonce];
      break;
    case 'mixed':
    default:
      text = `Please say: ${colourEn} ${nounSw} ${nonce}.`;
      tokens = [colourEn, nounSw, nonce];
      break;
  }

  return {
    locale,
    nonce,
    text,
    tokens,
    generatedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + PHRASE_TTL_MS).toISOString(),
  };
}

/**
 * Score a spoken response against the challenge. Case-insensitive token
 * match (any order). Returns the coverage fraction; `matched` requires >=70%
 * coverage to absorb dialect / pronunciation drift while still demanding most
 * of the nonce digits. An expired challenge always fails.
 */
export function scoreChallengeResponse(
  challenge: ChallengePhrase,
  response: string,
  nowMs: number = Date.now(),
): { readonly matched: boolean; readonly coverage: number } {
  if (!response || response.trim().length === 0) return { matched: false, coverage: 0 };
  const expiry = Date.parse(challenge.expiresAt);
  if (!Number.isFinite(expiry) || nowMs > expiry) return { matched: false, coverage: 0 };

  const rawTokens = response
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const respTokens = new Set(rawTokens);
  // Concatenate every numeric token (preserving order + repeats) so a nonce
  // spoken as "0 0 0 0" or "00 00" still matches the "0000" token.
  const digitRun = rawTokens.filter((t) => /^\d+$/.test(t)).join('');

  let hits = 0;
  for (const tok of challenge.tokens) {
    const lower = tok.toLowerCase();
    const isNonce = /^\d+$/.test(lower);
    if (respTokens.has(lower) || (isNonce && lower === digitRun)) {
      hits += 1;
    }
  }
  const coverage = challenge.tokens.length === 0 ? 0 : hits / challenge.tokens.length;
  return { matched: coverage >= 0.7, coverage };
}
