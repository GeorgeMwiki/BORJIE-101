/**
 * @borjie/document-ai/multilingual — public barrel.
 */

export { detectLanguage, detectLanguageSync } from './detect.js';
export type { DetectLanguageOptions } from './detect.js';

export { translateTo, roundTripScore, lexicalSimilarity } from './translate.js';
export type {
  TranslatePort,
  TranslateConfig,
  RoundTripScoreConfig,
  RoundTripScore,
} from './translate.js';
