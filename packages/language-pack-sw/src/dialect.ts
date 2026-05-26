/**
 * Swahili dialect signals (UNIV-2).
 *
 * Lexicon-based dialect classifier for the four canonical Swahili
 * registers. Companion to (but independent from) the richer
 * `@borjie/swahili-linguistics` morphology layer.
 *
 *   - bongo    : Tanzanian urban (Dar es Salaam dominant)
 *   - coastal  : Kiswahili of the Swahili coast (Mombasa, Zanzibar,
 *                Lamu, Pemba) — closest to Kiswahili Sanifu
 *   - sheng    : Nairobi urban youth code-switch register (Swahili +
 *                English + Kikuyu / Luo)
 *   - standard : Kiswahili Sanifu — formal register
 *
 * Sources:
 *   - "Is there a difference between Tanzanian and Kenyan Swahili?" Talkpal
 *     https://talkpal.ai/culture/is-there-a-difference-between-tanzanian-and-kenyan-swahili/
 *     (accessed 2026-05-26)
 *   - "Shaping New Identities: Sheng, Youth, and Ethnicity in Kenya"
 *     Harvard International Review
 *     https://hir.harvard.edu/sheng-in-kenya/ (accessed 2026-05-26)
 *   - "What Makes a Sheng Word Unique?" ACAL 39 Proceedings
 *     https://www.lingref.com/cpp/acal/39/paper2188.pdf (accessed 2026-05-26)
 *   - kiswahili.net dialects FAQ
 *     https://www.kiswahili.net/5-information/general-info/swahili-dialects.html
 *     (accessed 2026-05-26)
 *   - Ethnologue — Swahili
 *     https://www.ethnologue.com/language/swh/ (accessed 2026-05-26)
 *
 * The marker lexicons here are deliberately small. Production callers
 * compose this with `@borjie/swahili-linguistics`'s richer detector
 * for high-confidence classification; this layer is the cheap
 * always-available frontline.
 */

import type {
  SwDialect,
  SwDialectDetectionResult,
  SwDialectScore,
} from './types.js';

const BONGO_MARKERS: ReadonlySet<string> = new Set([
  'bongo',
  'mambo',
  'poa',
  'mzee',
  'fika',
  'nimepiga',
  'deal',
  'mrabaha',
  'tumemadini',
  'wizara',
  'noma',
  'hayo',
]);

const COASTAL_MARKERS: ReadonlySet<string> = new Set([
  'hodi',
  'karibu',
  'jambo',
  'bwana',
  'kheri',
  'salama',
  'bandari',
  'meli',
  'forodha',
  'asubuhi',
  'jioni',
  'lahaula',
]);

const SHENG_MARKERS: ReadonlySet<string> = new Set([
  'mathree',
  'odi',
  'manze',
  'ndovu',
  'soo',
  'base',
  'form',
  'mtaani',
  'kam',
  'mbogi',
  'chali',
  'msee',
  'fala',
  'rada',
]);

const STANDARD_MARKERS: ReadonlySet<string> = new Set([
  'tafadhali',
  'asante',
  'pole',
  'samahani',
  'kupitia',
  'kuhusu',
  'leseni',
  'kibali',
  'mwizara',
  'taarifa',
]);

interface Lexicon {
  readonly dialect: SwDialect;
  readonly markers: ReadonlySet<string>;
}

const LEXICONS: ReadonlyArray<Lexicon> = Object.freeze([
  Object.freeze({ dialect: 'bongo', markers: BONGO_MARKERS }),
  Object.freeze({ dialect: 'coastal', markers: COASTAL_MARKERS }),
  Object.freeze({ dialect: 'sheng', markers: SHENG_MARKERS }),
  Object.freeze({ dialect: 'standard', markers: STANDARD_MARKERS }),
]);

function tokenise(utterance: string): ReadonlyArray<string> {
  return utterance
    .toLowerCase()
    .split(/[^a-zA-ZÀ-ÿ']+/)
    .filter((t) => t.length > 0);
}

export function detectSwDialect(utterance: string): SwDialectDetectionResult {
  if (utterance.trim().length === 0) {
    return Object.freeze({
      scores: Object.freeze(
        LEXICONS.map(
          (l) =>
            Object.freeze({
              dialect: l.dialect,
              score: 0,
              signals: Object.freeze([]),
            }) as SwDialectScore,
        ),
      ),
      topDialect: 'standard',
      confidence: 0,
    });
  }

  const tokens = tokenise(utterance);
  const totalTokens = tokens.length;

  let topDialect: SwDialect = 'standard';
  let topScore = -1;
  let totalSignals = 0;
  const scoreEntries: SwDialectScore[] = [];

  for (const lex of LEXICONS) {
    const hits = tokens.filter((t) => lex.markers.has(t));
    const score = totalTokens > 0 ? hits.length / totalTokens : 0;
    totalSignals += hits.length;
    scoreEntries.push(
      Object.freeze({
        dialect: lex.dialect,
        score,
        signals: Object.freeze(hits.slice()),
      }) as SwDialectScore,
    );
    if (score > topScore) {
      topScore = score;
      topDialect = lex.dialect;
    }
  }

  // Confidence = ratio of recognised dialect markers to total tokens,
  // capped at 1.0.
  const confidence = totalTokens > 0 ? Math.min(1, totalSignals / totalTokens) : 0;

  return Object.freeze({
    scores: Object.freeze(scoreEntries),
    topDialect: totalSignals === 0 ? 'standard' : topDialect,
    confidence,
  });
}
