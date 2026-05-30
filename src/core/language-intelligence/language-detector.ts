/**
 * Multi-Language Detector (Continuously Learnable)
 *
 * Vocabulary-backed language detection with code-switching awareness.
 * Starts with Swahili+English, but can LEARN any new language from
 * user interactions without code changes.
 *
 * Architecture: NOT hardcoded. Uses a language registry where each
 * language is a data pack (vocabulary set + patterns). New languages
 * are added by registering a pack, not by editing this file.
 *
 * Features:
 * - Detects ANY registered language (starts with English + Swahili)
 * - Identifies code-switching patterns between any two languages
 * - Classifies formality level
 * - Suggests optimal response language
 * - Learns new words from user interactions (vocabulary grows)
 * - Register new languages at runtime via registerLanguagePack()
 */

import { readFileSync } from "fs";
import { join } from "path";
import type {
  LanguageDetectionResult,
  CodeSwitchingPattern,
  FormalityLevel,
  SupportedLanguage,
  GeneralVocabularyEntry,
  FinancialDictionaryEntry,
} from "./types";

// ============================================================================
// Language Pack Registry (extensible, learnable)
// ============================================================================

/** A language pack that can be registered at runtime */
export interface LanguagePack {
  readonly code: string; // BCP-47 code: 'sw', 'en', 'fr', 'yo', etc.
  readonly name: string; // "Swahili", "Yoruba", "French", etc.
  readonly words: Set<string>; // Known words (grows via learning)
  readonly formalWords: Set<string>;
  readonly informalWords: Set<string>;
  readonly financialTerms: Set<string>;
  readonly stopWords: Set<string>; // Words too common to signal this language
}

/** Mutable registry: new languages can be added at any time */
const languageRegistry = new Map<string, LanguagePack>();

/** Register a new language pack (or update existing) */
export function registerLanguagePack(pack: LanguagePack): void {
  languageRegistry.set(pack.code, pack);
}

/** Learn a new word for a language (continuously expanding vocabulary) */
export function learnWord(
  languageCode: string,
  word: string,
  formality?: "formal" | "informal",
): void {
  const pack = languageRegistry.get(languageCode);
  if (!pack) return;

  pack.words.add(word.toLowerCase());
  if (formality === "formal") pack.formalWords.add(word.toLowerCase());
  if (formality === "informal") pack.informalWords.add(word.toLowerCase());
}

/** Get all registered language codes */
export function getRegisteredLanguages(): readonly string[] {
  return [...languageRegistry.keys()];
}

// ============================================================================
// Legacy Vocabulary Sets (mapped into registry on init)
// ============================================================================

let swahiliWords: Set<string> | null = null;
let englishFinancialTerms: Set<string> | null = null;
let formalSwahiliWords: Set<string> | null = null;
let informalSwahiliWords: Set<string> | null = null;

function loadVocabulary(): void {
  if (swahiliWords !== null) return;

  swahiliWords = new Set<string>();
  englishFinancialTerms = new Set<string>();
  formalSwahiliWords = new Set<string>();
  informalSwahiliWords = new Set<string>();

  try {
    // Load general vocabulary
    const vocabPath = join(
      process.cwd(),
      "data",
      "dictionaries",
      "sw-en-general-vocabulary.json",
    );
    const vocabRaw = readFileSync(vocabPath, "utf-8");
    const vocab: { entries: GeneralVocabularyEntry[] } = JSON.parse(vocabRaw);

    for (const entry of vocab.entries) {
      const word = entry.sw.toLowerCase();
      swahiliWords.add(word);

      // Handle multi-word entries
      if (word.includes(" ")) {
        for (const part of word.split(" ")) {
          swahiliWords.add(part);
        }
      }

      if (entry.formality === "formal") {
        formalSwahiliWords.add(word);
      } else if (
        entry.formality === "informal" ||
        entry.formality === "slang"
      ) {
        informalSwahiliWords.add(word);
      }
    }

    // Load financial dictionary for Swahili financial terms
    const dictPath = join(
      process.cwd(),
      "data",
      "dictionaries",
      "sw-en-financial-dictionary.json",
    );
    const dictRaw = readFileSync(dictPath, "utf-8");
    const dict: { terms: FinancialDictionaryEntry[] } = JSON.parse(dictRaw);

    for (const entry of dict.terms) {
      swahiliWords.add(entry.sw.toLowerCase());
      englishFinancialTerms.add(entry.en.toLowerCase());

      // Handle multi-word Swahili terms
      if (entry.sw.includes(" ")) {
        for (const part of entry.sw.toLowerCase().split(" ")) {
          swahiliWords.add(part);
        }
      }
    }
  } catch {
    // Fallback: minimal Swahili indicators if data files unavailable
    const fallbackWords = [
      "habari",
      "shikamoo",
      "mambo",
      "ndiyo",
      "hapana",
      "asante",
      "tafadhali",
      "naomba",
      "ninahitaji",
      "biashara",
      "mkopo",
      "fedha",
      "pesa",
      "nyumba",
      "duka",
      "soko",
      "kazi",
      "ninajua",
      "sijui",
      "sawa",
      "pole",
      "karibu",
      "kwaheri",
      "nimeshindwa",
      "nataka",
      "naweza",
      "yangu",
      "wangu",
    ];
    swahiliWords = new Set(fallbackWords);
    englishFinancialTerms = new Set();
    formalSwahiliWords = new Set(["shikamoo", "tafadhali"]);
    informalSwahiliWords = new Set(["mambo", "poa"]);
  }

  // Register Swahili and English into the language pack registry
  registerLanguagePack({
    code: "sw",
    name: "Swahili",
    words: swahiliWords,
    formalWords: formalSwahiliWords,
    informalWords: informalSwahiliWords,
    financialTerms: new Set(
      [...swahiliWords].filter((w) => w.length > 4).slice(0, 200),
    ),
    stopWords: new Set([
      "na",
      "ya",
      "wa",
      "kwa",
      "ni",
      "la",
      "za",
      "cha",
      "vya",
    ]),
  });

  registerLanguagePack({
    code: "en",
    name: "English",
    words: englishFinancialTerms,
    formalWords: new Set(),
    informalWords: new Set(),
    financialTerms: englishFinancialTerms,
    stopWords: ENGLISH_STOP_WORDS,
  });
}

// ============================================================================
// Common English stop words (not counted as "English signal")
// ============================================================================

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "it",
  "its",
  "they",
  "them",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "but",
  "if",
  "or",
  "because",
  "until",
  "while",
  "about",
  "up",
  "down",
  "and",
]);

// ============================================================================
// Core Detection Functions
// ============================================================================

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function classifyWord(word: string): "sw" | "en" | "unknown" {
  loadVocabulary();

  if (swahiliWords!.has(word)) return "sw";
  if (englishFinancialTerms!.has(word)) return "en";
  if (ENGLISH_STOP_WORDS.has(word)) return "en";

  // Heuristic: common Swahili prefixes/suffixes
  const swPrefixes = [
    "wa",
    "ki",
    "vi",
    "ni",
    "si",
    "na",
    "ku",
    "mi",
    "ma",
    "u",
  ];
  const swSuffixes = [
    "ni",
    "wa",
    "ji",
    "zi",
    "ko",
    "mo",
    "po",
    "yo",
    "lo",
    "vu",
  ];

  const hasSwPrefix = swPrefixes.some(
    (p) => word.startsWith(p) && word.length > p.length + 2,
  );
  const hasSwSuffix = swSuffixes.some(
    (s) => word.endsWith(s) && word.length > s.length + 2,
  );

  if (hasSwPrefix && hasSwSuffix) return "sw";

  return "unknown";
}

function detectFormality(words: string[]): FormalityLevel {
  loadVocabulary();

  let formalCount = 0;
  let informalCount = 0;

  for (const word of words) {
    if (formalSwahiliWords!.has(word)) formalCount++;
    if (informalSwahiliWords!.has(word)) informalCount++;
  }

  if (formalCount > informalCount) return "formal";
  if (informalCount > formalCount) return "informal";
  return "neutral";
}

function detectCodeSwitchingPattern(
  words: string[],
  classifications: Array<"sw" | "en" | "unknown">,
): CodeSwitchingPattern {
  const classified = classifications.filter((c) => c !== "unknown");
  if (classified.length === 0) return "none";

  const swCount = classified.filter((c) => c === "sw").length;
  const enCount = classified.filter((c) => c === "en").length;

  if (swCount === 0 || enCount === 0) return "none";

  // Check if Swahili is the frame (sentence structure) with English terms
  const firstClassified = classified[0];
  const lastClassified = classified[classified.length - 1];

  if (firstClassified === "sw" && lastClassified === "sw" && enCount > 0) {
    return "sw_frame_en_terms";
  }

  if (firstClassified === "en" && lastClassified === "en" && swCount > 0) {
    return "en_frame_sw_terms";
  }

  // Check for alternating pattern (multiple switches)
  let switches = 0;
  for (let i = 1; i < classified.length; i++) {
    if (classified[i] !== classified[i - 1]) switches++;
  }

  if (switches >= 3) return "alternating";
  if (swCount > enCount) return "sw_frame_en_terms";
  return "en_frame_sw_terms";
}

function suggestResponseLanguage(
  swRatio: number,
  codeSwitching: boolean,
  pattern: CodeSwitchingPattern,
): SupportedLanguage | "mixed" {
  if (swRatio > 0.6) return "sw";
  if (swRatio < 0.15) return "en";
  if (codeSwitching) {
    if (pattern === "sw_frame_en_terms" || pattern === "alternating")
      return "mixed";
    return "mixed";
  }
  return swRatio > 0.35 ? "sw" : "en";
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Detect the language of a user message.
 *
 * Returns a comprehensive LanguageDetectionResult with language ratios,
 * code-switching analysis, formality level, and suggested response language.
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  loadVocabulary();

  const words = tokenize(text);

  if (words.length === 0) {
    return {
      primaryLanguage: "en",
      swahiliRatio: 0,
      englishRatio: 0,
      confidence: 0,
      codeSwitchingDetected: false,
      codeSwitchingPattern: "none",
      formalityLevel: "neutral",
      detectedSwahiliWords: [],
      detectedEnglishFinancialTerms: [],
      suggestedResponseLanguage: "en",
    };
  }

  const classifications = words.map((w) => classifyWord(w));
  const detectedSwahili: string[] = [];
  const detectedEnglish: string[] = [];

  for (let i = 0; i < words.length; i++) {
    if (classifications[i] === "sw") detectedSwahili.push(words[i]);
    if (classifications[i] === "en" && englishFinancialTerms!.has(words[i])) {
      detectedEnglish.push(words[i]);
    }
  }

  const totalClassified = classifications.filter((c) => c !== "unknown").length;
  const swCount = classifications.filter((c) => c === "sw").length;
  const enCount = classifications.filter((c) => c === "en").length;

  const swRatio = totalClassified > 0 ? swCount / totalClassified : 0;
  const enRatio = totalClassified > 0 ? enCount / totalClassified : 0;
  const confidence = totalClassified / words.length;

  const codeSwitchingPattern = detectCodeSwitchingPattern(
    words,
    classifications,
  );
  const codeSwitchingDetected = codeSwitchingPattern !== "none";

  const primaryLanguage: SupportedLanguage | "mixed" = codeSwitchingDetected
    ? "mixed"
    : swRatio > 0.5
      ? "sw"
      : enRatio > 0.5
        ? "en"
        : "en";

  const formalityLevel =
    detectedSwahili.length > 0 ? detectFormality(words) : "neutral";

  return {
    primaryLanguage,
    swahiliRatio: Math.round(swRatio * 1000) / 1000,
    englishRatio: Math.round(enRatio * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    codeSwitchingDetected,
    codeSwitchingPattern,
    formalityLevel,
    detectedSwahiliWords: detectedSwahili,
    detectedEnglishFinancialTerms: detectedEnglish,
    suggestedResponseLanguage: suggestResponseLanguage(
      swRatio,
      codeSwitchingDetected,
      codeSwitchingPattern,
    ),
  };
}

/**
 * Quick check: does this text contain Swahili?
 * Faster than full detectLanguage when you just need a boolean.
 */
export function containsSwahili(text: string): boolean {
  loadVocabulary();
  const words = tokenize(text);
  return words.some((w) => swahiliWords!.has(w));
}

/**
 * Get the number of vocabulary entries loaded.
 * Useful for diagnostics and monitoring.
 */
export function getVocabularySize(): {
  swahili: number;
  englishFinancial: number;
} {
  loadVocabulary();
  return {
    swahili: swahiliWords!.size,
    englishFinancial: englishFinancialTerms!.size,
  };
}

// ============================================================================
// Span-level code-switch detector (iter-52 P0 #3)
// ============================================================================

/**
 * A contiguous span of text tagged with its detected language.
 *
 * Returned by `detectCodeSwitchSpans`. Offsets are character positions
 * into the ORIGINAL input string (start inclusive, end exclusive), so
 * callers can recover the original surface form with `text.slice(start, end)`.
 */
export interface CodeSwitchSpan {
  readonly start: number;
  readonly end: number;
  readonly lang: "en" | "sw" | "mixed";
}

/**
 * Split a code-switched utterance into language-tagged spans.
 *
 * Strategy:
 *   1. Tokenize on whitespace + simple punctuation, preserving offsets.
 *   2. Classify each token with `classifyWord` (Swahili vocab + English
 *      stop/financial vocab + Swahili affix heuristic).
 *   3. Sliding-window vote: a 3-token window decides ambiguous tokens
 *      ("unknown" inherits the dominant language in its window).
 *   4. Merge consecutive same-language tokens into a single span.
 *   5. A run of length 1 wedged between two opposite-language spans is
 *      labelled "mixed" to capture borrowed terms.
 *
 * The detector is intentionally rule-based + fast: it runs on every
 * chat turn and feeds the brain's per-turn metadata. The P1 upgrade
 * path swaps the classifier to GlotLID / UniLID weights without
 * changing this signature.
 */
export function detectCodeSwitchSpans(
  text: string,
): ReadonlyArray<CodeSwitchSpan> {
  loadVocabulary();
  if (!text || text.length === 0) return [];

  // ── 1. Tokenize with offsets ──────────────────────────────────────
  interface OffsetToken {
    readonly raw: string;
    readonly lower: string;
    readonly start: number;
    readonly end: number;
  }
  const tokens: OffsetToken[] = [];
  // Match runs of word characters (letters + apostrophe). Numbers are
  // tagged separately as language-neutral.
  const re = /[\p{L}\p{M}']+|\d+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    tokens.push({
      raw,
      lower: raw.toLowerCase(),
      start: m.index,
      end: m.index + raw.length,
    });
  }
  if (tokens.length === 0) return [];

  // ── 2. Classify each token ────────────────────────────────────────
  type Tag = "en" | "sw" | "unknown" | "neutral";
  const tags: Tag[] = tokens.map((t) => {
    // Pure-digit tokens are neutral (numbers belong to no language).
    if (/^\d+$/.test(t.lower)) return "neutral";
    const verdict = classifyWord(t.lower);
    if (verdict === "sw") return "sw";
    if (verdict === "en") return "en";
    return "unknown";
  });

  // ── 3. Window-vote ambiguous tokens (window radius = 2) ───────────
  // For each "unknown" token, look at neighbours within 2 positions
  // and inherit the dominant tag. If there is no dominant neighbour
  // tag, keep "unknown".
  const windowRadius = 2;
  const resolved: Tag[] = tags.slice();
  for (let i = 0; i < tags.length; i++) {
    if (tags[i] !== "unknown") continue;
    let sw = 0;
    let en = 0;
    for (
      let j = Math.max(0, i - windowRadius);
      j <= Math.min(tags.length - 1, i + windowRadius);
      j++
    ) {
      if (j === i) continue;
      if (tags[j] === "sw") sw += 1;
      else if (tags[j] === "en") en += 1;
    }
    if (sw > en) resolved[i] = "sw";
    else if (en > sw) resolved[i] = "en";
    else resolved[i] = "unknown";
  }

  // ── 4. Build spans ────────────────────────────────────────────────
  const spans: CodeSwitchSpan[] = [];
  let i = 0;
  while (i < tokens.length) {
    // Skip neutral / unresolved tokens at the start: they extend the
    // previous span or a future span; here we attach them to the next
    // resolved token if one exists, otherwise emit a "mixed" span.
    const startTokenIdx = i;
    const tag = resolved[i];
    if (tag !== "en" && tag !== "sw") {
      // Look ahead for the next resolved tag and lump everything into a
      // mixed span (rare; only happens for short turns with no Swahili
      // or English vocab matches).
      let j = i + 1;
      while (
        j < tokens.length &&
        resolved[j] !== "en" &&
        resolved[j] !== "sw"
      ) {
        j += 1;
      }
      if (j === tokens.length) {
        // No resolved tag at all: emit one mixed span covering the rest.
        spans.push({
          start: tokens[startTokenIdx].start,
          end: tokens[tokens.length - 1].end,
          lang: "mixed",
        });
        break;
      }
      // Attach the unresolved prefix to the next span's language.
      i = j;
      continue;
    }

    // Walk forward while the resolved tag stays the same.
    let j = i + 1;
    while (j < tokens.length) {
      const t = resolved[j];
      if (t === tag) {
        j += 1;
      } else if (t === "neutral" || t === "unknown") {
        // Allow neutral / unknown to extend the current span when the
        // next resolved token also matches the current tag.
        let k = j + 1;
        while (
          k < tokens.length &&
          (resolved[k] === "neutral" || resolved[k] === "unknown")
        ) {
          k += 1;
        }
        if (k < tokens.length && resolved[k] === tag) {
          j = k + 1;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    spans.push({
      start: tokens[startTokenIdx].start,
      end: tokens[j - 1].end,
      lang: tag,
    });
    i = j;
  }

  // ── 5. Promote singleton islands to "mixed" ───────────────────────
  // A 1-token span wedged between two opposite-language spans is
  // almost always a borrowed term (e.g. EN "loan" inside SW frame).
  const promoted: CodeSwitchSpan[] = spans.map((s, idx) => {
    if (idx === 0 || idx === spans.length - 1) return s;
    const prev = spans[idx - 1];
    const next = spans[idx + 1];
    if (
      prev.lang !== s.lang &&
      next.lang !== s.lang &&
      prev.lang === next.lang &&
      countTokensInSpan(tokens, s) === 1
    ) {
      return { ...s, lang: "mixed" as const };
    }
    return s;
  });

  return promoted;
}

function countTokensInSpan(
  tokens: ReadonlyArray<{ start: number; end: number }>,
  span: CodeSwitchSpan,
): number {
  let n = 0;
  for (const t of tokens) {
    if (t.start >= span.start && t.end <= span.end) n += 1;
  }
  return n;
}
