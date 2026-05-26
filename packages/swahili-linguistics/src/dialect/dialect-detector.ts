/**
 * Dialect detector (Wave 19H).
 *
 * Scores a Swahili utterance across Bongo (TZ urban), Coastal, Kenyan,
 * Sheng (Nairobi urban code-switch) and Standard. Signal-based scoring
 * — each dialect has a lexicon of marker words; we count hits and
 * normalise.
 *
 * Sources:
 *   - "Is there a difference between Tanzanian and Kenyan Swahili?" Talkpal
 *     https://talkpal.ai/culture/is-there-a-difference-between-tanzanian-and-kenyan-swahili/
 *     (accessed 2026-05-26)
 *   - "Shaping New Identities: Sheng, Youth, and Ethnicity in Kenya"
 *     https://hir.harvard.edu/sheng-in-kenya/ (accessed 2026-05-26)
 *   - "What Makes a Sheng Word Unique?" ACAL 39 Proceedings
 *     https://www.lingref.com/cpp/acal/39/paper2188.pdf (accessed 2026-05-26)
 *   - "FAQs about Kiswahili — dialects" kiswahili.net
 *     https://www.kiswahili.net/5-information/general-info/swahili-dialects.html
 *     (accessed 2026-05-26)
 */

import type { Dialect, DialectDetectionResult, DialectScore } from '../types.js';

interface DialectLexicon {
  readonly dialect: Dialect;
  readonly markers: ReadonlySet<string>;
}

const BONGO_MARKERS = new Set([
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
  'shoga',
  'hayo',
  'noma',
]);

const COASTAL_MARKERS = new Set([
  'hodi',
  'karibu',
  'jambo',
  'bwana',
  'kheri',
  'salama',
  'bandari',
  'meli',
  'forodha',
  'kazi',
  'asubuhi',
  'jioni',
  'lahaula',
]);

const KENYAN_MARKERS = new Set([
  'sasa',
  'fiti',
  'unaeza',
  'kra',
  'nema',
  'matatu',
  'pesa',
  'shamba',
  'githeri',
  'jameni',
  'iko',
  'sawa',
]);

const SHENG_MARKERS = new Set([
  'mathree',
  'odi',
  'manze',
  'ndovu',
  'soo',
  'base',
  'form',
  'mtaani',
  'kam',
  'go',
  'mbogi',
  'chali',
  'msee',
  'fala',
  'rada',
]);

const STANDARD_MARKERS = new Set([
  'tafadhali',
  'asante',
  'pole',
  'samahani',
  'kupitia',
  'kuhusu',
  'kwamba',
  'kwa',
]);

const LEXICONS: ReadonlyArray<DialectLexicon> = Object.freeze([
  { dialect: 'bongo', markers: BONGO_MARKERS },
  { dialect: 'coastal', markers: COASTAL_MARKERS },
  { dialect: 'kenyan', markers: KENYAN_MARKERS },
  { dialect: 'sheng', markers: SHENG_MARKERS },
  { dialect: 'standard', markers: STANDARD_MARKERS },
]);

function tokenize(utterance: string): ReadonlyArray<string> {
  return utterance
    .toLowerCase()
    .replace(/[.,!?;:()'"`]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Score the dialect of `utterance`. Returns a frozen result with
 * per-dialect scores, the top dialect, and an aggregate confidence
 * (max raw score / total markers seen, clipped to [0, 1]).
 *
 * Empty utterances fall back to `standard` with confidence 0.
 */
export function detectDialect(utterance: string): DialectDetectionResult {
  const tokens = tokenize(utterance);
  if (tokens.length === 0) {
    return Object.freeze({
      scores: Object.freeze(
        LEXICONS.map<DialectScore>((l) =>
          Object.freeze({
            dialect: l.dialect,
            score: 0,
            signals: Object.freeze([]),
          }),
        ),
      ),
      topDialect: 'standard' as const,
      confidence: 0,
    });
  }

  const scores = LEXICONS.map<DialectScore>((lex) => {
    const hits: string[] = [];
    for (const tok of tokens) {
      if (lex.markers.has(tok)) {
        hits.push(tok);
      }
    }
    return Object.freeze({
      dialect: lex.dialect,
      score: hits.length / tokens.length,
      signals: Object.freeze([...hits]),
    });
  });

  // Ranking — higher raw score wins; on tie, prefer standard.
  const ranked = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.dialect === 'standard') return -1;
    if (b.dialect === 'standard') return 1;
    return 0;
  });

  const top = ranked[0];
  const topDialect: Dialect = top ? top.dialect : 'standard';
  const confidence = top ? Math.min(1, top.score * 2) : 0;

  return Object.freeze({
    scores: Object.freeze(scores),
    topDialect,
    confidence,
  });
}
