/**
 * Light-touch sentiment extractor.
 *
 * The port returns a bounded scalar in [SENTIMENT_MIN, SENTIMENT_MAX].
 * Pipeline only invokes the port when the user has opted in to
 * sentiment-tier consent (`AmbientConsent.sentiment_consent === true`).
 *
 * Reference docs:
 *   - wav2vec2 emotion classifier
 *       https://huggingface.co/harshit345/xlsr-wav2vec-speech-emotion-recognition
 *   - AVEC challenges
 *       http://avec2019.org/
 *
 * The reference impl is a Swahili + English keyword polarity classifier.
 * Production impl swaps in a wav2vec2-backed emotion-on-audio model OR a
 * text classifier on the redacted transcript — either is acceptable as
 * long as the output stays inside the bounded range.
 */

import {
  SENTIMENT_MAX,
  SENTIMENT_MIN,
  type RedactedText,
  type SentimentExtractorPort,
} from '../types.js';

export {
  type SentimentExtractorPort,
} from '../types.js';

const POSITIVE_KEYWORDS: ReadonlyArray<string> = [
  'good',
  'great',
  'happy',
  'thanks',
  'asante',
  'nzuri',
  'safi',
  'vizuri',
  'shukrani',
];

const NEGATIVE_KEYWORDS: ReadonlyArray<string> = [
  'bad',
  'angry',
  'problem',
  'wasiwasi',
  'tatizo',
  'hatari',
  'mbaya',
  'ajali',
  'dharura',
];

/**
 * Build the reference sentiment extractor. Counts positive / negative
 * keyword hits in the redacted text and returns a clamped polarity.
 */
export function createReferenceSentimentExtractor(): SentimentExtractorPort {
  return {
    extract(redacted: RedactedText): Promise<number> {
      const lc = redacted.text.toLowerCase();
      let pos = 0;
      let neg = 0;
      for (const kw of POSITIVE_KEYWORDS) {
        if (lc.includes(kw)) pos += 1;
      }
      for (const kw of NEGATIVE_KEYWORDS) {
        if (lc.includes(kw)) neg += 1;
      }
      const denom = pos + neg;
      if (denom === 0) return Promise.resolve(0);
      const raw = (pos - neg) / denom;
      return Promise.resolve(clampSentiment(raw));
    },
  };
}

/** Clamp into the bounded sentiment range. Exposed for unit tests. */
export function clampSentiment(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < SENTIMENT_MIN) return SENTIMENT_MIN;
  if (value > SENTIMENT_MAX) return SENTIMENT_MAX;
  return value;
}
