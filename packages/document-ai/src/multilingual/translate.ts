/**
 * translateTo — provider-agnostic translation.
 *
 * The default translator is a `BrainPort` (Claude) — a single round-
 * trip prompt asking for an isolated translation. For production
 * volumes consumers can pass a custom `TranslatePort` that wraps
 * Google Translate v3 / Intron Swahili / Cohere Aya.
 *
 * `roundTripScore` runs source → target → source and returns a
 * lexical-similarity score in [0..1] so consumers can flag low-quality
 * translations before persisting them.
 */

import type { BrainPort, LanguageCode } from '../types.js';

export interface TranslatePort {
  translate(input: {
    readonly text: string;
    readonly sourceLang: LanguageCode;
    readonly targetLang: LanguageCode;
  }): Promise<string>;
}

export interface TranslateConfig {
  readonly text: string;
  readonly sourceLang: LanguageCode;
  readonly targetLang: LanguageCode;
  readonly brain?: BrainPort;
  readonly translator?: TranslatePort;
}

export async function translateTo(config: TranslateConfig): Promise<string> {
  if (config.sourceLang === config.targetLang) return config.text;
  if (config.translator) {
    return await config.translator.translate({
      text: config.text,
      sourceLang: config.sourceLang,
      targetLang: config.targetLang,
    });
  }
  if (!config.brain) {
    throw new Error('translateTo: provide either `brain` or `translator`.');
  }
  return await brainTranslate(config.brain, config);
}

async function brainTranslate(brain: BrainPort, cfg: TranslateConfig): Promise<string> {
  const prompt = [
    `Translate the following text from ${cfg.sourceLang} to ${cfg.targetLang}.`,
    'Reply with ONLY the translation — no quotes, no preamble.',
    'Preserve numbers, dates, and proper names exactly.',
    '',
    cfg.text,
  ].join('\n');
  const result = await brain.complete(prompt, { temperature: 0, maxTokens: 2048 });
  return result.text.trim();
}

export interface RoundTripScoreConfig {
  readonly text: string;
  readonly sourceLang: LanguageCode;
  readonly viaLang: LanguageCode;
  readonly brain?: BrainPort;
  readonly translator?: TranslatePort;
}

export interface RoundTripScore {
  readonly originalText: string;
  readonly intermediateText: string;
  readonly backTranslated: string;
  readonly similarity: number;
}

export async function roundTripScore(config: RoundTripScoreConfig): Promise<RoundTripScore> {
  const baseConfig = {
    ...(config.brain ? { brain: config.brain } : {}),
    ...(config.translator ? { translator: config.translator } : {}),
  };
  const intermediate = await translateTo({
    text: config.text,
    sourceLang: config.sourceLang,
    targetLang: config.viaLang,
    ...baseConfig,
  });
  const back = await translateTo({
    text: intermediate,
    sourceLang: config.viaLang,
    targetLang: config.sourceLang,
    ...baseConfig,
  });
  return {
    originalText: config.text,
    intermediateText: intermediate,
    backTranslated: back,
    similarity: lexicalSimilarity(config.text, back),
  };
}

/**
 * Token-overlap Jaccard similarity in [0..1].
 * Cheap, language-agnostic, good enough as a quality canary.
 */
export function lexicalSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersect = 0;
  for (const t of setA) {
    if (setB.has(t)) intersect += 1;
  }
  return intersect / (setA.size + setB.size - intersect);
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\sÀ-ſ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}
