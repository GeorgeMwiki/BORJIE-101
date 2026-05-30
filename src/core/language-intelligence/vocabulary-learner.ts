/**
 * Vocabulary Learner
 *
 * Processes every user message to expand the platform's
 * Swahili-English vocabulary. Extracts new words, detects
 * user-provided translations, and tracks word frequency.
 *
 * This is the "learning flywheel" -- every conversation
 * makes the system smarter for the next user.
 *
 * Persistence: Supabase `learned_vocabulary` table with in-memory cache.
 * Write-through: Every mutation writes to both cache AND Supabase.
 *
 * Learning signals:
 * 1. User writes Swahili word not in dictionary -> track it
 * 2. User provides inline translation -> record mapping
 * 3. AI response includes translation -> extract and store
 * 4. Word appears repeatedly -> increase confidence
 * 5. Word appears in specific context -> tag with context
 */

import { detectLanguage, containsSwahili } from './language-detector'
import {
  recordTranslation,
  extractInlineTranslations,
} from './translation-memory'
import type { LearnedVocabulary, SupportedLanguage } from './types'
import { createServiceClient } from '@/lib/supabase/server'

// ============================================================================
// In-Memory Cache (read-through, write-through to Supabase)
// ============================================================================

const vocabularyCache = new Map<string, LearnedVocabulary>()
let cacheLoaded = false

function vocabKey(word: string, lang: SupportedLanguage): string {
  return `${lang}:${word.toLowerCase().trim()}`
}

/**
 * Load vocabulary from Supabase into cache on first access
 */
async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return
  cacheLoaded = true

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('learned_vocabulary')
      .select('*')
      .order('total_occurrences', { ascending: false })
      .limit(5000) // Cache top 5000 words

    if (error) {
      // Supabase unavailable -- cache starts empty, learns from conversations
      return
    }

    for (const row of data ?? []) {
      const entry = mapFromDatabase(row)
      const key = vocabKey(entry.word, entry.language)
      vocabularyCache.set(key, entry)
    }
  } catch {
    // Supabase unavailable -- cache starts empty
  }
}

function mapFromDatabase(row: Record<string, unknown>): LearnedVocabulary {
  return {
    word: row.word as string,
    language: row.language as SupportedLanguage,
    observedTranslations: (row.observed_translations as LearnedVocabulary['observedTranslations']) ?? [],
    contexts: (row.contexts as readonly string[]) ?? [],
    firstSeenAt: row.first_seen_at as string,
    lastSeenAt: row.last_seen_at as string,
    totalOccurrences: row.total_occurrences as number,
  }
}

/**
 * Write-through: persist vocabulary entry to Supabase (non-blocking)
 */
function persistToSupabase(key: string, entry: LearnedVocabulary): void {
  const persist = async () => {
    try {
      const supabase = createServiceClient()
      await supabase
        .from('learned_vocabulary')
        .upsert(
          {
            id: key,
            word: entry.word,
            language: entry.language,
            observed_translations: entry.observedTranslations,
            contexts: entry.contexts,
            first_seen_at: entry.firstSeenAt,
            last_seen_at: entry.lastSeenAt,
            total_occurrences: entry.totalOccurrences,
          },
          { onConflict: 'id' }
        )
    } catch {
      // Non-blocking -- cache remains source of truth until next sync
    }
  }
  void persist()
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Process a user message to learn new vocabulary.
 *
 * This should be called AFTER every user message in the chat pipeline.
 * Writes through to Supabase for persistence.
 *
 * Returns the number of new words learned.
 */
export async function processMessage(params: {
  message: string
  userId: string
  context: string
}): Promise<{ newWordsLearned: number; inlineTranslationsFound: number }> {
  await ensureCacheLoaded()

  const { message, context } = params
  const now = new Date().toISOString()

  let newWordsLearned = 0
  let inlineTranslationsFound = 0

  // 1. Detect language of the message
  const detection = detectLanguage(message)

  // 2. Track all detected Swahili words
  for (const swWord of detection.detectedSwahiliWords) {
    const key = vocabKey(swWord, 'sw')
    const existing = vocabularyCache.get(key)

    if (existing) {
      // Word already known -- increment occurrence count
      const updated: LearnedVocabulary = {
        ...existing,
        totalOccurrences: existing.totalOccurrences + 1,
        lastSeenAt: now,
        contexts: existing.contexts.includes(context)
          ? existing.contexts
          : [...existing.contexts, context],
      }
      vocabularyCache.set(key, updated)
      persistToSupabase(key, updated)
    } else {
      // New word -- start tracking
      const newEntry: LearnedVocabulary = {
        word: swWord,
        language: 'sw',
        observedTranslations: [],
        contexts: [context],
        firstSeenAt: now,
        lastSeenAt: now,
        totalOccurrences: 1,
      }
      vocabularyCache.set(key, newEntry)
      persistToSupabase(key, newEntry)
      newWordsLearned++
    }
  }

  // 3. Extract and record inline translations
  const inlineTranslations = extractInlineTranslations(message)
  for (const { word, translation, sourceLang } of inlineTranslations) {
    const targetLang: SupportedLanguage = sourceLang === 'sw' ? 'en' : 'sw'

    recordTranslation({
      sourceText: word,
      sourceLang,
      translatedText: translation,
      targetLang,
      context,
      source: 'user_conversation',
    })

    // Update vocabulary cache with observed translation
    const key = vocabKey(word, sourceLang)
    const existing = vocabularyCache.get(key)

    if (existing) {
      const existingTranslation = existing.observedTranslations.find(
        t => t.translation.toLowerCase() === translation.toLowerCase()
      )

      if (existingTranslation) {
        const updated: LearnedVocabulary = {
          ...existing,
          observedTranslations: existing.observedTranslations.map(t =>
            t.translation.toLowerCase() === translation.toLowerCase()
              ? { ...t, count: t.count + 1, confidence: Math.min(0.99, t.confidence + (1 - t.confidence) * 0.15) }
              : t
          ),
          lastSeenAt: now,
        }
        vocabularyCache.set(key, updated)
        persistToSupabase(key, updated)
      } else {
        const updated: LearnedVocabulary = {
          ...existing,
          observedTranslations: [
            ...existing.observedTranslations,
            { translation, targetLang, confidence: 0.5, count: 1 },
          ],
          lastSeenAt: now,
        }
        vocabularyCache.set(key, updated)
        persistToSupabase(key, updated)
      }
    }

    inlineTranslationsFound++
  }

  return { newWordsLearned, inlineTranslationsFound }
}

/**
 * Process an AI response to extract translations it provided.
 *
 * Called AFTER the AI generates a response. Looks for patterns
 * where the AI translated a term for the user.
 */
export function processAIResponse(params: {
  userMessage: string
  aiResponse: string
  context: string
}): number {
  const { userMessage, aiResponse, context } = params

  // Only process if user's message had Swahili content
  if (!containsSwahili(userMessage)) return 0

  // Extract inline translations from the AI response
  const translations = extractInlineTranslations(aiResponse)
  let recorded = 0

  for (const { word, translation, sourceLang } of translations) {
    const targetLang: SupportedLanguage = sourceLang === 'sw' ? 'en' : 'sw'

    recordTranslation({
      sourceText: word,
      sourceLang,
      translatedText: translation,
      targetLang,
      context,
      source: 'ai_generated',
    })
    recorded++
  }

  return recorded
}

/**
 * Get vocabulary statistics.
 */
export async function getVocabularyStats(): Promise<{
  totalWords: number
  swahiliWords: number
  englishWords: number
  wordsWithTranslations: number
  topWords: readonly LearnedVocabulary[]
}> {
  await ensureCacheLoaded()

  const all = Array.from(vocabularyCache.values())
  const swahili = all.filter(v => v.language === 'sw')
  const english = all.filter(v => v.language === 'en')
  const withTranslations = all.filter(v => v.observedTranslations.length > 0)

  const topWords = [...all]
    .sort((a, b) => b.totalOccurrences - a.totalOccurrences)
    .slice(0, 20)

  return {
    totalWords: all.length,
    swahiliWords: swahili.length,
    englishWords: english.length,
    wordsWithTranslations: withTranslations.length,
    topWords,
  }
}

/**
 * Get all learned vocabulary for a specific language.
 */
export async function getLearnedWords(
  language: SupportedLanguage,
  limit: number = 100
): Promise<readonly LearnedVocabulary[]> {
  await ensureCacheLoaded()

  return Array.from(vocabularyCache.values())
    .filter(v => v.language === language)
    .sort((a, b) => b.totalOccurrences - a.totalOccurrences)
    .slice(0, limit)
}

/**
 * Get words learned in a specific context (e.g., "loan_application").
 */
export async function getWordsForContext(
  context: string,
  language?: SupportedLanguage
): Promise<readonly LearnedVocabulary[]> {
  await ensureCacheLoaded()

  return Array.from(vocabularyCache.values())
    .filter(v => {
      if (language && v.language !== language) return false
      return v.contexts.includes(context)
    })
    .sort((a, b) => b.totalOccurrences - a.totalOccurrences)
}
