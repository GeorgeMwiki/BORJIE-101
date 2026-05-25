/**
 * Zero-LLM tone detector.
 *
 * Scores a user message as positive / neutral / negative based on keyword
 * hits (EN + SW), punctuation, and response-time signals. The output feeds
 * the sub-persona router: negative tone \u2192 empathetic Mr. Mwikila; positive
 * tone \u2192 brisk Mr. Mwikila.
 *
 * No PII leaves this module. Keyword lists are deliberately small and
 * auditable.
 */

import type { Tone } from './types.js';

const POSITIVE_EN = [
  'great',
  'thanks',
  'perfect',
  'awesome',
  'love',
  'good',
  'nice',
  'helpful',
];
const POSITIVE_SW = [
  'asante',
  'vizuri',
  'safi',
  'bora',
  'nzuri',
  'shukrani',
];
const NEGATIVE_EN = [
  'not working',
  'broken',
  'angry',
  'frustrat',
  'wrong',
  'confus',
  'slow',
  'hate',
  'bad',
  'terrible',
];
const NEGATIVE_SW = [
  'haifanyi',
  'vibaya',
  'hasira',
  'chukizo',
  'mbaya',
  'siwezi',
  'polepole',
];

export interface ToneSignals {
  readonly message: string;
  readonly responseTimeMs?: number;
}

export function detectTone(signals: ToneSignals): Tone {
  const text = signals.message.toLowerCase();
  const positiveHits = countHits(text, POSITIVE_EN) + countHits(text, POSITIVE_SW);
  const negativeHits = countHits(text, NEGATIVE_EN) + countHits(text, NEGATIVE_SW);

  // punctuation signals
  const exclamationBias = (text.match(/!/g) ?? []).length >= 2 ? 1 : 0;
  const questionStorm = (text.match(/\?/g) ?? []).length >= 3 ? -1 : 0;
  const allCapsWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  const allCapsPenalty = allCapsWords >= 2 ? -1 : 0;

  // quick follow-ups (<4s) tend to read as frustration
  const quickReplyPenalty =
    signals.responseTimeMs !== undefined && signals.responseTimeMs < 4000
      ? -0.5
      : 0;

  const score =
    positiveHits + exclamationBias -
    (negativeHits + Math.abs(questionStorm) + Math.abs(allCapsPenalty) + Math.abs(quickReplyPenalty));

  if (score > 0.5) return 'positive';
  if (score < -0.5) return 'negative';
  return 'neutral';
}

function countHits(text: string, keywords: readonly string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) hits++;
  }
  return hits;
}
