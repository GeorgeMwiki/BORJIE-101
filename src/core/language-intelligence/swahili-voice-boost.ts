/**
 * Swahili Voice Boost -- Domain vocabulary hints for ASR
 *
 * Feeds financial vocabulary to speech recognition to improve
 * accuracy on domain-specific terms like "ujasiriamali" (entrepreneurship),
 * "rehani" (collateral), "mdhamini" (guarantor).
 *
 * Three capabilities:
 * 1. Domain vocabulary boosting for ASR engines
 * 2. Post-ASR normalization (SMS/Sheng to standard Swahili)
 * 3. Code-switching SSML generation for TTS
 *
 * @module swahili-voice-boost
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { FinancialDictionaryEntry } from "./types";
import {
  AGGLUTINATIVE_FINANCIAL_VERBS,
  FINANCIAL_PHRASES,
  NUMBER_WORDS,
  ASR_ERROR_CORRECTIONS,
  COMMON_SWAHILI_WORDS,
  EXTRA_ENGLISH_FINANCIAL,
} from "./swahili-voice-boost-data";

// ============================================================================
// Types
// ============================================================================

export interface PronunciationGuide {
  readonly word: string;
  readonly phonetic: string;
  readonly stressPattern: string;
  readonly morphemeBoundaries: string;
}

export interface VoiceBoostConfig {
  readonly financialVocabulary: readonly string[];
  readonly commonPhrases: readonly string[];
  readonly pronunciationGuides: readonly PronunciationGuide[];
}

interface NormalizationEntry {
  readonly informal: string;
  readonly standard: string;
  readonly type: string;
  readonly meaning_en: string;
  readonly frequency: string;
  readonly region: string;
}

// ============================================================================
// Cached Data (read once, reuse)
// ============================================================================

let cachedDictionary: readonly FinancialDictionaryEntry[] | null = null;
let cachedNormalizationMap: ReadonlyMap<string, string> | null = null;
let cachedSwahiliWordSet: ReadonlySet<string> | null = null;
let cachedEnglishFinancialSet: ReadonlySet<string> | null = null;
let cachedVoiceBoostConfig: VoiceBoostConfig | null = null;

function loadFinancialDictionary(): readonly FinancialDictionaryEntry[] {
  if (cachedDictionary) return cachedDictionary;

  let loaded: readonly FinancialDictionaryEntry[];
  try {
    const filePath = join(
      process.cwd(),
      "data",
      "dictionaries",
      "sw-en-financial-dictionary.json",
    );
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    loaded = parsed.terms ?? [];
  } catch {
    loaded = [];
  }

  cachedDictionary = loaded;
  return loaded;
}

function loadNormalizationMap(): ReadonlyMap<string, string> {
  if (cachedNormalizationMap) return cachedNormalizationMap;

  const map = new Map<string, string>();

  try {
    const filePath = join(
      process.cwd(),
      "data",
      "dictionaries",
      "sw-informal-normalization.json",
    );
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const entries: readonly NormalizationEntry[] = parsed.entries ?? [];

    for (const entry of entries) {
      map.set(entry.informal.toLowerCase(), entry.standard.toLowerCase());
    }
  } catch {
    // Normalization unavailable; will return text as-is
  }

  cachedNormalizationMap = map;
  return map;
}

function loadSwahiliWordSet(): ReadonlySet<string> {
  if (cachedSwahiliWordSet) return cachedSwahiliWordSet;

  const dictionary = loadFinancialDictionary();
  const words = new Set<string>();

  for (const entry of dictionary) {
    for (const part of entry.sw.toLowerCase().split(/\s+/)) {
      if (part.length > 1) words.add(part);
    }
  }

  for (const w of COMMON_SWAHILI_WORDS) {
    words.add(w);
  }

  cachedSwahiliWordSet = words;
  return words;
}

function loadEnglishFinancialSet(): ReadonlySet<string> {
  if (cachedEnglishFinancialSet) return cachedEnglishFinancialSet;

  const dictionary = loadFinancialDictionary();
  const words = new Set<string>();

  for (const entry of dictionary) {
    for (const part of entry.en.toLowerCase().split(/[\s/]+/)) {
      if (part.length > 2) words.add(part);
    }
  }

  for (const w of EXTRA_ENGLISH_FINANCIAL) {
    words.add(w);
  }

  cachedEnglishFinancialSet = words;
  return words;
}

// ============================================================================
// Task 1: Domain Vocabulary Boosting for ASR
// ============================================================================

/**
 * Get the full Swahili voice boost configuration.
 * Returns financial vocabulary hints, common phrases, and pronunciation guides
 * for feeding into ASR engines to improve domain-specific accuracy.
 */
export function getSwahiliVoiceBoostConfig(): VoiceBoostConfig {
  if (cachedVoiceBoostConfig) return cachedVoiceBoostConfig;

  const dictionary = loadFinancialDictionary();

  const financialVocabulary = dictionary.map((entry) => entry.sw.toLowerCase());

  const config: VoiceBoostConfig = {
    financialVocabulary,
    commonPhrases: FINANCIAL_PHRASES,
    pronunciationGuides: AGGLUTINATIVE_FINANCIAL_VERBS,
  };

  cachedVoiceBoostConfig = config;
  return config;
}

// ============================================================================
// Task 2: Post-ASR Normalization
// ============================================================================

/**
 * Format a number with thousands separators (Tanzanian convention uses commas).
 */
function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Parse a sequence of Swahili number words into a digit value.
 *
 * Handles patterns like:
 * - "milioni tano" -> 5,000,000
 * - "elfu kumi" -> 10,000
 * - "mia tatu na hamsini" -> 350
 * - "laki mbili" -> 200,000
 */
function parseSwahiliNumber(words: readonly string[]): {
  readonly value: number;
  readonly consumed: number;
} {
  let total = 0;
  let current = 0;
  let consumed = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();

    if (word === "na") {
      consumed++;
      continue;
    }

    const numVal = NUMBER_WORDS.get(word);
    if (numVal === undefined) break;

    consumed++;

    if (numVal >= 1000) {
      const multiplier = current === 0 ? 1 : current;
      total += multiplier * numVal;
      current = 0;
    } else if (numVal >= 100) {
      const multiplier = current === 0 ? 1 : current;
      current = multiplier * numVal;
    } else {
      current += numVal;
    }
  }

  total += current;
  return { value: total, consumed };
}

/**
 * Normalize ASR output from spoken Swahili to clean, standard text.
 *
 * Pipeline:
 * 1. Convert spoken number words to digits ("milioni tano" -> "5,000,000")
 * 2. Fix common ASR errors for financial terms
 * 3. Apply SMS/Sheng normalization (informal -> standard)
 */
export function normalizeASROutput(transcript: string): string {
  if (!transcript || transcript.trim().length === 0) return transcript;

  const normMap = loadNormalizationMap();
  const words = transcript.split(/\s+/);
  const result: string[] = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i];
    const lower = word.toLowerCase();

    // Step 1: Check if this starts a number sequence
    if (NUMBER_WORDS.has(lower)) {
      const remaining = words.slice(i).map((w) => w.toLowerCase());
      const parsed = parseSwahiliNumber(remaining);

      if (parsed.value > 0 && parsed.consumed > 0) {
        result.push(formatNumber(parsed.value));
        i += parsed.consumed;
        continue;
      }
    }

    // Step 2: Apply ASR error corrections (financial terms)
    const asrFixed = ASR_ERROR_CORRECTIONS.get(lower);
    if (asrFixed) {
      result.push(asrFixed);
      i++;
      continue;
    }

    // Step 3: Apply SMS/Sheng normalization
    const normalized = normMap.get(lower);
    if (normalized) {
      result.push(normalized);
      i++;
      continue;
    }

    // No transformation needed
    result.push(word);
    i++;
  }

  return result.join(" ");
}

// ============================================================================
// Task 3: Code-Switching SSML Generation for TTS
// ============================================================================

/**
 * Detect whether a word is likely English (not Swahili).
 *
 * Heuristic: a word is English if it appears in the English financial
 * dictionary but NOT in the Swahili dictionary or common Swahili words.
 */
function isEnglishFinancialTerm(word: string): boolean {
  const lower = word.toLowerCase();
  const swahiliWords = loadSwahiliWordSet();
  const englishFinancial = loadEnglishFinancialSet();

  if (swahiliWords.has(lower)) return false;
  if (englishFinancial.has(lower)) return true;

  return false;
}

/**
 * Generate SSML for code-switched Swahili/English text.
 *
 * When Swahili text contains English financial terms, wraps them
 * in `<lang xml:lang="en">` tags so TTS engines pronounce them
 * with English phonetics rather than Swahili letter-by-letter reading.
 *
 * Example:
 *   Input:  "Kiwango cha interest rate ni nzuri"
 *   Output: '<speak><lang xml:lang="sw">Kiwango cha</lang> <lang xml:lang="en">interest rate</lang> <lang xml:lang="sw">ni nzuri</lang></speak>'
 */
export function generateSSMLForCodeSwitched(text: string): string {
  if (!text || text.trim().length === 0) {
    return "<speak></speak>";
  }

  const words = text.split(/\s+/);
  const segments: Array<{
    readonly lang: "sw" | "en";
    readonly words: string[];
  }> = [];

  let currentLang: "sw" | "en" = "sw";
  let currentWords: string[] = [];

  for (const word of words) {
    const wordLang: "sw" | "en" = isEnglishFinancialTerm(word) ? "en" : "sw";

    if (wordLang === currentLang) {
      currentWords.push(word);
    } else {
      if (currentWords.length > 0) {
        segments.push({ lang: currentLang, words: [...currentWords] });
      }
      currentLang = wordLang;
      currentWords = [word];
    }
  }

  if (currentWords.length > 0) {
    segments.push({ lang: currentLang, words: [...currentWords] });
  }

  const hasCodeSwitching = segments.some((s) => s.lang === "en");
  if (!hasCodeSwitching) {
    return `<speak><lang xml:lang="sw">${text}</lang></speak>`;
  }

  const ssmlParts = segments.map(
    (seg) => `<lang xml:lang="${seg.lang}">${seg.words.join(" ")}</lang>`,
  );

  return `<speak>${ssmlParts.join(" ")}</speak>`;
}
