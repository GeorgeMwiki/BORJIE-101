/**
 * Register classifier (Wave 19H).
 *
 * Classifies an utterance into one of:
 *   - formal      BAKITA-conformant; no slang; concord intact
 *   - colloquial  concord intact + informal markers
 *   - bongo       TZ urban; bongo neologisms acceptable
 *   - coastal     Arabic-lexicon-heavy formal coastal register
 *   - sheng       heavy code-switch + slang (Sheng)
 *
 * Heuristic: rank dialect first; map to register; if standard-leaning,
 * scan for slang vs formal markers.
 */

import type { Register } from '../types.js';
import { detectDialect } from './dialect-detector.js';

const FORMAL_MARKERS = new Set([
  'tafadhali',
  'asante',
  'samahani',
  'kupitia',
  'kuhusu',
  'kwamba',
  'kwa heshima',
  'wadhifa',
  'taarifa',
  'kuthibitisha',
]);

const COLLOQUIAL_MARKERS = new Set([
  'sawa',
  'haya',
  'eee',
  'ah',
  'yaani',
  'basi',
  'kweli',
  'kabisa',
  'sana',
]);

function tokenize(s: string): ReadonlyArray<string> {
  return s
    .toLowerCase()
    .replace(/[.,!?;:()'"`]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Classify the register of `utterance`. Frozen `Register` string.
 */
export function classifyRegister(utterance: string): Register {
  const tokens = tokenize(utterance);
  if (tokens.length === 0) return 'formal';

  const dialect = detectDialect(utterance);
  if (dialect.topDialect === 'sheng' && dialect.confidence > 0.05) {
    return 'sheng';
  }
  if (dialect.topDialect === 'coastal' && dialect.confidence > 0.05) {
    return 'coastal';
  }
  if (dialect.topDialect === 'bongo' && dialect.confidence > 0.05) {
    return 'bongo';
  }

  // Scan formal vs colloquial markers.
  let formalHits = 0;
  let colloquialHits = 0;
  for (const tok of tokens) {
    if (FORMAL_MARKERS.has(tok)) formalHits++;
    if (COLLOQUIAL_MARKERS.has(tok)) colloquialHits++;
  }

  if (formalHits > colloquialHits) return 'formal';
  if (colloquialHits > 0) return 'colloquial';
  return 'formal';
}
