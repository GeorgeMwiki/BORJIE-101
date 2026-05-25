/**
 * Bilingual language detection — English vs Swahili vs mixed. Uses a
 * deterministic stop-word frequency heuristic so it is testable + cheap.
 *
 * We don't ship a full langid model; OCR results are short enough that
 * stop-word weighting gives a high-precision call for the two languages
 * we care about. Anything else (Hausa, Yoruba, French, Arabic) collapses
 * to 'mixed' because the upstream LLM extractor handles those uniformly
 * via prompt-language detection.
 */

export type DetectedLanguage = 'en' | 'sw' | 'mixed';

const EN_STOP_WORDS = new Set([
  'the',
  'and',
  'of',
  'to',
  'in',
  'a',
  'is',
  'that',
  'for',
  'on',
  'with',
  'as',
  'this',
  'are',
  'by',
  'be',
  'from',
  'an',
  'has',
  'have',
  'or',
  'not',
  'at',
  'we',
  'shall',
  'will',
  'between',
  'hereby',
  'parties',
  'agreement',
  'tenant',
  'landlord',
]);

const SW_STOP_WORDS = new Set([
  'na',
  'ya',
  'wa',
  'kwa',
  'katika',
  'ni',
  'kuwa',
  'huyu',
  'huu',
  'kwamba',
  'lakini',
  'ambao',
  'mwenye',
  'tena',
  'pia',
  'kati',
  'baada',
  'kabla',
  'mkataba',
  'mpangaji',
  'mwenyenyumba',
  'malipo',
  'kitambulisho',
  'taarifa',
  'kodi',
  'nyumba',
  'mwezi',
  'mwaka',
  'shilingi',
  'tarehe',
]);

export function detectLanguage(text: string): DetectedLanguage {
  if (!text || text.trim().length === 0) return 'mixed';
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return 'mixed';

  let en = 0;
  let sw = 0;
  for (const t of tokens) {
    if (EN_STOP_WORDS.has(t)) en += 1;
    if (SW_STOP_WORDS.has(t)) sw += 1;
  }
  const total = en + sw;
  if (total === 0) return 'mixed';
  const enShare = en / total;
  const swShare = sw / total;
  if (enShare >= 0.7) return 'en';
  if (swShare >= 0.7) return 'sw';
  return 'mixed';
}
