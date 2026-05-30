/**
 * Translation Memory
 *
 * A continuously-improving bilingual cache that learns translations
 * from every user interaction. Seeded from the static dictionary,
 * grows organically as users converse in Swahili and English.
 *
 * Architecture:
 * - In-memory cache backed by Supabase `translation_memory` table
 * - Write-through: Every mutation persists to Supabase (non-blocking)
 * - Read-through: Cache loaded from Supabase on first access
 * - Confidence-weighted entries (0-1, asymptotic toward 1.0)
 * - Observation counting for frequently-seen translations
 * - Context tagging for domain-specific accuracy
 *
 * Learning sources:
 * - Static dictionary (seed data, confidence 0.9)
 * - User conversations (inline translations, confidence 0.5+)
 * - AI responses (extracted translations, confidence 0.6+)
 * - Officer corrections (manual overrides, confidence 0.95)
 */

import { readFileSync } from "fs";
import { join } from "path";
import type {
  TranslationMemoryEntry,
  TranslationSource,
  SupportedLanguage,
  FinancialDictionaryEntry,
} from "./types";
import { createServiceClient } from "@/lib/supabase/server";

// ============================================================================
// In-Memory Cache (write-through to Supabase)
// ============================================================================

const memoryCache = new Map<string, TranslationMemoryEntry>();
const MAX_CACHE_ENTRIES = 10000;
let isSeeded = false;
let cacheLoadedFromDb = false;

/**
 * Evict oldest entries when cache exceeds MAX_CACHE_ENTRIES.
 * Maps iterate in insertion order, so the first keys are the oldest.
 */
function evictIfNeeded(): void {
  if (memoryCache.size <= MAX_CACHE_ENTRIES) return;
  const toDelete = memoryCache.size - MAX_CACHE_ENTRIES;
  let deleted = 0;
  for (const key of memoryCache.keys()) {
    if (deleted >= toDelete) break;
    memoryCache.delete(key);
    deleted++;
  }
}

function makeKey(text: string, sourceLang: string, targetLang: string): string {
  return `${sourceLang}:${targetLang}:${text.toLowerCase().trim()}`;
}

function generateId(): string {
  return `tm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Supabase Persistence
// ============================================================================

/**
 * Load translation memory from Supabase into cache on first access
 */
async function loadFromSupabase(): Promise<void> {
  if (cacheLoadedFromDb) return;
  cacheLoadedFromDb = true;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("translation_memory")
      .select("*")
      .order("observation_count", { ascending: false })
      .limit(10000);

    if (error) return;

    for (const row of data ?? []) {
      const entry = mapFromDatabase(row);
      const key = makeKey(entry.sourceText, entry.sourceLang, entry.targetLang);
      // DB entries take precedence over dictionary seeds
      memoryCache.set(key, entry);
    }
  } catch {
    // Supabase unavailable -- dictionary seeds remain
  }
}

function mapFromDatabase(row: Record<string, unknown>): TranslationMemoryEntry {
  return {
    id: row.id as string,
    sourceText: row.source_text as string,
    sourceLang: row.source_lang as SupportedLanguage,
    translatedText: row.translated_text as string,
    targetLang: row.target_lang as SupportedLanguage,
    context: (row.context as string) ?? "",
    confidence: Number(row.confidence) || 0.5,
    observationCount: (row.observation_count as number) ?? 1,
    lastObservedAt: row.last_observed_at as string,
    source: row.source as TranslationSource,
  };
}

/**
 * Write-through: persist translation entry to Supabase (non-blocking)
 */
function persistToSupabase(entry: TranslationMemoryEntry): void {
  const persist = async () => {
    try {
      const supabase = createServiceClient();
      await supabase.from("translation_memory").upsert(
        {
          id: entry.id,
          source_text: entry.sourceText,
          source_lang: entry.sourceLang,
          translated_text: entry.translatedText,
          target_lang: entry.targetLang,
          context: entry.context,
          confidence: entry.confidence,
          observation_count: entry.observationCount,
          last_observed_at: entry.lastObservedAt,
          source: entry.source,
        },
        { onConflict: "id" },
      );
    } catch {
      // Non-blocking -- cache remains source of truth
    }
  };
  void persist();
}

// ============================================================================
// Seed from Dictionary
// ============================================================================

function seedFromDictionary(): void {
  if (isSeeded) return;
  isSeeded = true;

  try {
    const dictPath = join(
      process.cwd(),
      "data",
      "dictionaries",
      "sw-en-financial-dictionary.json",
    );
    const raw = readFileSync(dictPath, "utf-8");
    const dict: { terms: FinancialDictionaryEntry[] } = JSON.parse(raw);

    const now = new Date().toISOString();

    for (const entry of dict.terms) {
      // English -> Swahili
      const enToSwKey = makeKey(entry.en, "en", "sw");
      if (!memoryCache.has(enToSwKey)) {
        const tmEntry: TranslationMemoryEntry = {
          id: generateId(),
          sourceText: entry.en,
          sourceLang: "en",
          translatedText: entry.sw,
          targetLang: "sw",
          context: entry.category,
          confidence: 0.9,
          observationCount: 1,
          lastObservedAt: now,
          source: "dictionary",
        };
        memoryCache.set(enToSwKey, tmEntry);
        persistToSupabase(tmEntry);
      }

      // Swahili -> English
      const swToEnKey = makeKey(entry.sw, "sw", "en");
      if (!memoryCache.has(swToEnKey)) {
        const tmEntry: TranslationMemoryEntry = {
          id: generateId(),
          sourceText: entry.sw,
          sourceLang: "sw",
          translatedText: entry.en,
          targetLang: "en",
          context: entry.category,
          confidence: 0.9,
          observationCount: 1,
          lastObservedAt: now,
          source: "dictionary",
        };
        memoryCache.set(swToEnKey, tmEntry);
        persistToSupabase(tmEntry);
      }
    }
  } catch {
    // Dictionary unavailable -- memory starts empty, learns from conversations
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Look up a translation in the memory.
 * Returns the highest-confidence match, or null if not found.
 */
export function findTranslation(
  text: string,
  targetLang: SupportedLanguage,
): TranslationMemoryEntry | null {
  seedFromDictionary();

  const sourceLang: SupportedLanguage = targetLang === "sw" ? "en" : "sw";
  const key = makeKey(text, sourceLang, targetLang);

  return memoryCache.get(key) || null;
}

/**
 * Async version that ensures DB cache is loaded first.
 */
export async function findTranslationAsync(
  text: string,
  targetLang: SupportedLanguage,
): Promise<TranslationMemoryEntry | null> {
  seedFromDictionary();
  await loadFromSupabase();

  const sourceLang: SupportedLanguage = targetLang === "sw" ? "en" : "sw";
  const key = makeKey(text, sourceLang, targetLang);

  return memoryCache.get(key) || null;
}

/**
 * Record a translation observation.
 *
 * If the translation already exists, increment observation count and
 * increase confidence asymptotically toward 1.0.
 * If new, create an entry with initial confidence based on source.
 *
 * Writes through to Supabase (non-blocking).
 */
export function recordTranslation(params: {
  sourceText: string;
  sourceLang: SupportedLanguage;
  translatedText: string;
  targetLang: SupportedLanguage;
  context: string;
  source: TranslationSource;
}): TranslationMemoryEntry {
  seedFromDictionary();

  const key = makeKey(params.sourceText, params.sourceLang, params.targetLang);
  const existing = memoryCache.get(key);
  const now = new Date().toISOString();

  if (existing) {
    // Increase confidence asymptotically: confidence + (1 - confidence) * 0.1
    const newConfidence = Math.min(
      0.99,
      existing.confidence + (1 - existing.confidence) * 0.1,
    );

    const updated: TranslationMemoryEntry = {
      ...existing,
      confidence: Math.round(newConfidence * 1000) / 1000,
      observationCount: existing.observationCount + 1,
      lastObservedAt: now,
    };

    memoryCache.set(key, updated);
    persistToSupabase(updated);
    return updated;
  }

  // Initial confidence based on source
  const sourceConfidence: Record<TranslationSource, number> = {
    dictionary: 0.9,
    officer_correction: 0.95,
    external_api: 0.75,
    ai_generated: 0.6,
    user_conversation: 0.5,
  };

  const entry: TranslationMemoryEntry = {
    id: generateId(),
    sourceText: params.sourceText,
    sourceLang: params.sourceLang,
    translatedText: params.translatedText,
    targetLang: params.targetLang,
    context: params.context,
    confidence: sourceConfidence[params.source],
    observationCount: 1,
    lastObservedAt: now,
    source: params.source,
  };

  memoryCache.set(key, entry);
  evictIfNeeded();
  persistToSupabase(entry);
  return entry;
}

/**
 * Extract inline translations from a message.
 *
 * Detects patterns like:
 * - "mkopo, I mean a loan"
 * - "loan (mkopo)"
 * - "dhamana which means collateral"
 * - "collateral, yaani dhamana"
 */
export function extractInlineTranslations(
  text: string,
): Array<{ word: string; translation: string; sourceLang: SupportedLanguage }> {
  const results: Array<{
    word: string;
    translation: string;
    sourceLang: SupportedLanguage;
  }> = [];

  // Pattern: "word, I mean translation" or "word, yaani translation"
  const meanPatterns = [
    /(\w+),?\s+(?:I mean|yaani|that is|meaning|maana yake)\s+(?:a\s+)?(\w+)/gi,
    /(\w+)\s*\((\w+(?:\s+\w+)?)\)/g, // word (translation)
    /(\w+),?\s+(?:which means|ambayo ni|yaani)\s+(\w+(?:\s+\w+)?)/gi,
  ];

  for (const pattern of meanPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const word1 = match[1].trim();
      const word2 = match[2].trim();

      // Determine which is Swahili and which is English
      // (Simple heuristic: check if word contains common Swahili patterns)
      const swahiliIndicators = /^(m|wa|ki|vi|u|ku|n|ny|ng)/i;
      const word1LikelySw = swahiliIndicators.test(word1);

      if (word1LikelySw) {
        results.push({ word: word1, translation: word2, sourceLang: "sw" });
      } else {
        results.push({ word: word2, translation: word1, sourceLang: "sw" });
      }
    }
  }

  return results;
}

/**
 * Get the most frequently looked up terms.
 * Useful for understanding which translations users need most.
 */
export async function getFrequentTerms(
  targetLang: SupportedLanguage,
  limit: number = 20,
): Promise<readonly TranslationMemoryEntry[]> {
  seedFromDictionary();
  await loadFromSupabase();

  return Array.from(memoryCache.values())
    .filter((e) => e.targetLang === targetLang)
    .sort((a, b) => b.observationCount - a.observationCount)
    .slice(0, limit);
}

/**
 * Get recently learned translations (from user conversations, not dictionary).
 */
export async function getRecentlyLearned(
  limit: number = 20,
): Promise<readonly TranslationMemoryEntry[]> {
  seedFromDictionary();
  await loadFromSupabase();

  return Array.from(memoryCache.values())
    .filter((e) => e.source !== "dictionary")
    .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt))
    .slice(0, limit);
}

/**
 * Get translation memory statistics.
 */
export async function getMemoryStats(): Promise<{
  totalEntries: number;
  dictionaryEntries: number;
  learnedEntries: number;
  avgConfidence: number;
}> {
  seedFromDictionary();
  await loadFromSupabase();

  const entries = Array.from(memoryCache.values());
  const dictEntries = entries.filter((e) => e.source === "dictionary");
  const learnedEntries = entries.filter((e) => e.source !== "dictionary");
  const totalConfidence = entries.reduce((sum, e) => sum + e.confidence, 0);

  return {
    totalEntries: entries.length,
    dictionaryEntries: dictEntries.length,
    learnedEntries: learnedEntries.length,
    avgConfidence:
      entries.length > 0
        ? Math.round((totalConfidence / entries.length) * 1000) / 1000
        : 0,
  };
}

// ============================================================================
// Fuzzy Matching (Levenshtein-based)
// ============================================================================

/**
 * Normalize text for fuzzy comparison: lowercase, trim, remove punctuation.
 */
function normalizeForFuzzy(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?'"()\-\[\]{}]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses a space-efficient single-row DP approach.
 */
// eslint-disable-next-line unused-imports/no-unused-vars -- variable kept for API compatibility / destructuring clarity; prefix with _ to silence permanently
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use shorter string as inner loop for space efficiency
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  let previousRow = Array.from({ length: shorter.length + 1 }, (_, i) => i);

  for (let i = 1; i <= longer.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= shorter.length; j++) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      currentRow.push(
        Math.min(
          currentRow[j - 1] + 1, // insertion
          previousRow[j] + 1, // deletion
          previousRow[j - 1] + cost, // substitution
        ),
      );
    }
    previousRow = currentRow;
  }

  return previousRow[shorter.length];
}

/**
 * Compute word-level edit distance (for short texts < 5 words).
 * Treats each word as an atomic unit.
 */
function wordEditDistance(a: string, b: string): number {
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);

  if (wordsA.length === 0) return wordsB.length;
  if (wordsB.length === 0) return wordsA.length;

  let previousRow = Array.from({ length: wordsB.length + 1 }, (_, i) => i);

  for (let i = 1; i <= wordsA.length; i++) {
    const currentRow = [i];
    for (let j = 1; j <= wordsB.length; j++) {
      const cost = wordsA[i - 1] === wordsB[j - 1] ? 0 : 1;
      currentRow.push(
        Math.min(
          currentRow[j - 1] + 1,
          previousRow[j] + 1,
          previousRow[j - 1] + cost,
        ),
      );
    }
    previousRow = currentRow;
  }

  return previousRow[wordsB.length];
}

/**
 * Generate character n-grams from a string.
 */
function generateNgrams(text: string, n: number): ReadonlySet<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= text.length - n; i++) {
    ngrams.add(text.slice(i, i + n));
  }
  return ngrams;
}

/**
 * Compute n-gram overlap score (Jaccard similarity) for longer texts.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
function ngramOverlapScore(a: string, b: string, n: number = 3): number {
  const ngramsA = generateNgrams(a, n);
  const ngramsB = generateNgrams(b, n);

  if (ngramsA.size === 0 && ngramsB.size === 0) return 1.0;
  if (ngramsA.size === 0 || ngramsB.size === 0) return 0.0;

  let intersection = 0;
  for (const ngram of ngramsA) {
    if (ngramsB.has(ngram)) {
      intersection += 1;
    }
  }

  const union = ngramsA.size + ngramsB.size - intersection;
  return union > 0 ? intersection / union : 0.0;
}

/**
 * Compute similarity score between two texts.
 *
 * For short texts (< 5 words): uses word-level edit distance
 * For longer texts: uses character n-gram overlap (trigrams)
 */
function computeSimilarity(candidate: string, query: string): number {
  const normalizedCandidate = normalizeForFuzzy(candidate);
  const normalizedQuery = normalizeForFuzzy(query);

  if (normalizedCandidate === normalizedQuery) return 1.0;

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  if (queryWords.length < 5) {
    // Word-level edit distance for short texts
    const distance = wordEditDistance(normalizedCandidate, normalizedQuery);
    const maxLen = Math.max(
      normalizedCandidate.split(/\s+/).filter(Boolean).length,
      queryWords.length,
    );
    return maxLen > 0 ? 1 - distance / maxLen : 0;
  }

  // N-gram overlap for longer texts
  return ngramOverlapScore(normalizedCandidate, normalizedQuery);
}

/**
 * Find a fuzzy match in the translation memory using Levenshtein-based
 * similarity. Returns the best match above the similarity threshold,
 * or null if no sufficiently similar entry is found.
 *
 * For short texts (< 5 words), uses word-level edit distance.
 * For longer texts, uses n-gram (trigram) overlap scoring.
 *
 * @param text - The source text to find a fuzzy match for
 * @param targetLang - The target language for translation
 * @param maxDistance - Minimum similarity threshold (0-1, default 0.75)
 * @returns The best matching translation memory entry, or null
 */
export function findFuzzyTranslation(
  text: string,
  targetLang: SupportedLanguage,
  maxDistance: number = 0.75,
): TranslationMemoryEntry | null {
  seedFromDictionary();

  const sourceLang: SupportedLanguage = targetLang === "sw" ? "en" : "sw";
  const threshold = Math.max(0, Math.min(1, maxDistance));

  let bestMatch: TranslationMemoryEntry | null = null;
  let bestScore = 0;

  for (const entry of memoryCache.values()) {
    // Only consider entries matching the requested direction
    if (entry.sourceLang !== sourceLang || entry.targetLang !== targetLang) {
      continue;
    }

    const similarity = computeSimilarity(entry.sourceText, text);

    if (similarity >= threshold && similarity > bestScore) {
      bestScore = similarity;
      bestMatch = entry;
    }
  }

  return bestMatch;
}

// ============================================================================
// Translation Cascade (Dictionary -> Fuzzy -> NLLB/Claude)
// ============================================================================

/**
 * Find a translation using a 3-tier cascade:
 *
 * Tier 0: Exact match from translation memory (sync, <1ms)
 * Tier 1: Fuzzy match using Levenshtein/n-gram (sync, <5ms)
 * Tier 2: Neural translation via NLLB or Claude fallback (async, ~100-2000ms)
 *
 * After a neural translation succeeds, the result is recorded in the
 * translation memory for future lookups at Tier 0.
 *
 * @param text - The source text to translate
 * @param targetLang - The desired target language ('en' or 'sw')
 * @param context - Optional domain context to improve translation quality
 * @returns The best available translation entry, or null if all tiers fail
 */
export async function findTranslationWithFallback(
  text: string,
  targetLang: SupportedLanguage,
  context?: string,
): Promise<TranslationMemoryEntry | null> {
  // Tier 0: Exact match
  const exact = findTranslation(text, targetLang);
  if (exact && exact.confidence >= 0.7) return exact;

  // Tier 1: Fuzzy match
  const fuzzy = findFuzzyTranslation(text, targetLang);
  if (fuzzy && fuzzy.confidence >= 0.6) return fuzzy;

  // Tier 2+: Neural translation (async)
  try {
    const { translate } = await import("./nllb-translation-service");
    const sourceLang: SupportedLanguage = targetLang === "sw" ? "en" : "sw";
    const result = await translate({
      text,
      sourceLang,
      targetLang,
      context,
    });

    if (result.translatedText) {
      // Record in memory for future lookups
      const recorded = recordTranslation({
        sourceText: text,
        sourceLang,
        translatedText: result.translatedText,
        targetLang,
        context: context ?? "",
        source: result.source === "nllb" ? "external_api" : "ai_generated",
      });
      return recorded;
    }
  } catch {
    // Translation service unavailable; return best partial match
  }

  return exact ?? fuzzy ?? null;
}
