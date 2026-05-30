/**
 * External Dictionary Service
 *
 * Three-tier lookup orchestrator for Swahili-English translation:
 *   Tier 1: Local embedded dictionary (520 financial terms) — 0ms
 *   Tier 2: In-memory translation memory (learned terms) — 0ms
 *   Tier 3: External API (Azure Translator → Google Translate) — ~100ms
 *
 * One-way learning: External API results are cached back into
 * Borjie's translation memory and vocabulary learner. We consume
 * external services but NEVER push our learned data back to them.
 * Every external lookup becomes a Borjie-owned data point.
 *
 * Graceful degradation: If no API keys are configured, the system
 * operates in local-only mode using the embedded dictionary.
 *
 * @module external-dictionary-service
 */

import { TRANSLATION_LIMITS } from '@/config/platform-constants'
import { readFileSync } from 'fs'
import { join } from 'path'
import type {
  SupportedLanguage,
  ExternalTranslationResult,
  ExternalTranslation,
  DictionaryLookupResult,
  ExternalProvider,
  FinancialDictionaryEntry,
} from './types'
import { findTranslation, recordTranslation } from './translation-memory'

// ============================================================================
// Configuration
// ============================================================================

const AZURE_TRANSLATOR_URL = 'https://api.cognitive.microsofttranslator.com'
const AZURE_API_VERSION = '3.0'
const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2'

// Rate limiting thresholds (characters per month) — sourced from platform-constants
const AZURE_FREE_LIMIT = TRANSLATION_LIMITS.azureFreeCharacters
const AZURE_WARN_THRESHOLD = TRANSLATION_LIMITS.azureWarnThreshold
const AZURE_HARD_STOP = TRANSLATION_LIMITS.azureHardStop
const GOOGLE_FREE_LIMIT = TRANSLATION_LIMITS.googleFreeCharacters
const GOOGLE_WARN_THRESHOLD = TRANSLATION_LIMITS.googleWarnThreshold
const GOOGLE_HARD_STOP = TRANSLATION_LIMITS.googleHardStop

// API response cache TTL (24 hours)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// ============================================================================
// State
// ============================================================================

interface CacheEntry {
  readonly data: ExternalTranslationResult
  readonly timestamp: number
}

const apiCache = new Map<string, CacheEntry>()

interface UsageCounter {
  chars: number
  month: number
  year: number
}

const azureUsage: UsageCounter = { chars: 0, month: -1, year: -1 }
const googleUsage: UsageCounter = { chars: 0, month: -1, year: -1 }

// Local dictionary cache
let localDictionary: readonly FinancialDictionaryEntry[] | null = null

function loadLocalDictionary(): readonly FinancialDictionaryEntry[] {
  if (localDictionary) return localDictionary

  try {
    const filePath = join(process.cwd(), 'data', 'dictionaries', 'sw-en-financial-dictionary.json')
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    localDictionary = parsed.terms ?? []
  } catch {
    localDictionary = []
  }

  return localDictionary!
}

// ============================================================================
// Rate Limiting
// ============================================================================

function resetUsageIfNewMonth(counter: UsageCounter): void {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  if (counter.month !== currentMonth || counter.year !== currentYear) {
    counter.chars = 0
    counter.month = currentMonth
    counter.year = currentYear
  }
}

function canUseAzure(charCount: number): boolean {
  resetUsageIfNewMonth(azureUsage)
  return (azureUsage.chars + charCount) < AZURE_HARD_STOP
}

function canUseGoogle(charCount: number): boolean {
  resetUsageIfNewMonth(googleUsage)
  return (googleUsage.chars + charCount) < GOOGLE_HARD_STOP
}

function trackAzureUsage(charCount: number): void {
  resetUsageIfNewMonth(azureUsage)
  azureUsage.chars += charCount
  if (azureUsage.chars > AZURE_WARN_THRESHOLD) {
    console.warn(`[ExternalDict] Azure usage: ${azureUsage.chars}/${AZURE_FREE_LIMIT} chars this month`)
  }
}

function trackGoogleUsage(charCount: number): void {
  resetUsageIfNewMonth(googleUsage)
  googleUsage.chars += charCount
  if (googleUsage.chars > GOOGLE_WARN_THRESHOLD) {
    console.warn(`[ExternalDict] Google usage: ${googleUsage.chars}/${GOOGLE_FREE_LIMIT} chars this month`)
  }
}

// ============================================================================
// API Cache
// ============================================================================

function getCacheKey(text: string, from: SupportedLanguage, to: SupportedLanguage): string {
  return `${from}:${to}:${text.toLowerCase().trim()}`
}

function getCached(key: string): ExternalTranslationResult | null {
  const entry = apiCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    apiCache.delete(key)
    return null
  }
  return { ...entry.data, cached: true }
}

function setCache(key: string, data: ExternalTranslationResult): void {
  apiCache.set(key, { data, timestamp: Date.now() })

  // Evict old entries if cache grows too large
  if (apiCache.size > 5000) {
    const cutoff = Date.now() - CACHE_TTL_MS
    for (const [k, v] of apiCache) {
      if (v.timestamp < cutoff) apiCache.delete(k)
    }
  }
}

// ============================================================================
// Tier 1: Local Dictionary Lookup
// ============================================================================

function lookupLocalDictionary(
  text: string,
  from: SupportedLanguage,
  to: SupportedLanguage
): ExternalTranslationResult | null {
  const dictionary = loadLocalDictionary()
  const lower = text.toLowerCase().trim()

  const entry = dictionary.find(e =>
    from === 'en'
      ? e.en.toLowerCase() === lower
      : e.sw.toLowerCase() === lower
  )

  if (!entry) return null

  const translatedText = to === 'sw' ? entry.sw : entry.en

  return {
    translations: [{
      text: translatedText,
      language: to,
      confidence: 0.95,
      partOfSpeech: undefined,
      examples: to === 'sw' ? [entry.example_sw] : [entry.example_en],
      backTranslation: from === 'en' ? entry.en : entry.sw,
    }],
    provider: 'azure' as ExternalProvider,
    cached: false,
    sourceText: text,
    sourceLang: from,
    targetLang: to,
  }
}

// ============================================================================
// Tier 2: Translation Memory Lookup
// ============================================================================

function lookupTranslationMemory(
  text: string,
  to: SupportedLanguage
): ExternalTranslationResult | null {
  const entry = findTranslation(text, to)
  if (!entry) return null

  return {
    translations: [{
      text: entry.translatedText,
      language: entry.targetLang,
      confidence: entry.confidence,
    }],
    provider: 'azure' as ExternalProvider,
    cached: true,
    sourceText: text,
    sourceLang: entry.sourceLang,
    targetLang: entry.targetLang,
  }
}

// ============================================================================
// Tier 3: External APIs
// ============================================================================

async function callAzureTranslate(
  text: string,
  from: SupportedLanguage,
  to: SupportedLanguage
): Promise<ExternalTranslationResult | null> {
  const apiKey = process.env.AZURE_TRANSLATOR_KEY
  const region = process.env.AZURE_TRANSLATOR_REGION || 'eastus'

  if (!apiKey) return null
  if (!canUseAzure(text.length)) return null

  try {
    const url = `${AZURE_TRANSLATOR_URL}/translate?api-version=${AZURE_API_VERSION}&from=${from}&to=${to}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: text }]),
    })

    if (!response.ok) return null

    const data = await response.json() as Array<{
      translations: Array<{ text: string; to: string }>
    }>

    trackAzureUsage(text.length)

    if (!data[0]?.translations?.length) return null

    const translations: ExternalTranslation[] = data[0].translations.map(t => ({
      text: t.text,
      language: t.to as SupportedLanguage,
      confidence: 0.85,
    }))

    return {
      translations,
      provider: 'azure',
      cached: false,
      sourceText: text,
      sourceLang: from,
      targetLang: to,
    }
  } catch {
    return null
  }
}

async function callAzureDictionaryLookup(
  term: string,
  from: SupportedLanguage,
  to: SupportedLanguage
): Promise<DictionaryLookupResult | null> {
  const apiKey = process.env.AZURE_TRANSLATOR_KEY
  const region = process.env.AZURE_TRANSLATOR_REGION || 'eastus'

  if (!apiKey) return null
  if (!canUseAzure(term.length)) return null

  try {
    const url = `${AZURE_TRANSLATOR_URL}/dictionary/lookup?api-version=${AZURE_API_VERSION}&from=${from}&to=${to}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: term }]),
    })

    if (!response.ok) return null

    const data = await response.json() as Array<{
      normalizedSource: string
      displaySource: string
      translations: Array<{
        normalizedTarget: string
        displayTarget: string
        posTag: string
        confidence: number
        prefixWord: string
        backTranslations: Array<{ normalizedText: string; displayText: string }>
      }>
    }>

    trackAzureUsage(term.length)

    if (!data[0]?.translations?.length) return null

    return {
      term: data[0].displaySource || term,
      language: from,
      translations: data[0].translations.map(t => ({
        displayTarget: t.displayTarget,
        posTag: t.posTag,
        confidence: t.confidence,
        prefixWord: t.prefixWord || '',
        backTranslations: t.backTranslations.map(bt => bt.displayText),
      })),
      provider: 'azure',
    }
  } catch {
    return null
  }
}

async function callGoogleTranslate(
  text: string,
  from: SupportedLanguage,
  to: SupportedLanguage
): Promise<ExternalTranslationResult | null> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY

  if (!apiKey) return null
  if (!canUseGoogle(text.length)) return null

  try {
    const response = await fetch(GOOGLE_TRANSLATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: from,
        target: to,
        key: apiKey,
        format: 'text',
      }),
    })

    if (!response.ok) return null

    const data = await response.json() as {
      data: {
        translations: Array<{ translatedText: string }>
      }
    }

    trackGoogleUsage(text.length)

    if (!data.data?.translations?.length) return null

    const translations: ExternalTranslation[] = data.data.translations.map(t => ({
      text: t.translatedText,
      language: to,
      confidence: 0.75,
    }))

    return {
      translations,
      provider: 'google',
      cached: false,
      sourceText: text,
      sourceLang: from,
      targetLang: to,
    }
  } catch {
    return null
  }
}

// ============================================================================
// One-Way Cache-Back (the learning)
// ============================================================================

function cacheBackToBorjie(
  result: ExternalTranslationResult,
  context: string = 'external_api_lookup'
): void {
  if (!result.translations.length) return

  const bestTranslation = result.translations[0]

  // Store in translation memory — Borjie now owns this translation
  recordTranslation({
    sourceText: result.sourceText,
    sourceLang: result.sourceLang,
    translatedText: bestTranslation.text,
    targetLang: result.targetLang,
    context,
    source: 'external_api',
  })

  // Also store the reverse direction
  recordTranslation({
    sourceText: bestTranslation.text,
    sourceLang: result.targetLang,
    translatedText: result.sourceText,
    targetLang: result.sourceLang,
    context,
    source: 'external_api',
  })
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Three-tier translation lookup.
 * Tier 1: Local dictionary → Tier 2: Translation memory → Tier 3: External API
 * Results from Tier 3 are cached back into Borjie's translation memory.
 */
export async function translateText(
  text: string,
  from: SupportedLanguage,
  to: SupportedLanguage
): Promise<ExternalTranslationResult | null> {
  if (!text.trim()) return null

  const cacheKey = getCacheKey(text, from, to)

  // Check API response cache first (24h TTL)
  const cached = getCached(cacheKey)
  if (cached) return cached

  // Tier 1: Local dictionary
  const local = lookupLocalDictionary(text, from, to)
  if (local) return local

  // Tier 2: Translation memory (learned terms)
  const memory = lookupTranslationMemory(text, to)
  if (memory) return memory

  // Tier 3: External API (Azure primary, Google failover)
  const azure = await callAzureTranslate(text, from, to)
  if (azure) {
    setCache(cacheKey, azure)
    cacheBackToBorjie(azure)
    return azure
  }

  const google = await callGoogleTranslate(text, from, to)
  if (google) {
    setCache(cacheKey, google)
    cacheBackToBorjie(google)
    return google
  }

  return null
}

/**
 * Dictionary lookup with part of speech, confidence, and back-translations.
 * Uses Azure Dictionary API for richer results than simple translation.
 */
export async function dictionaryLookup(
  term: string,
  from: SupportedLanguage,
  to: SupportedLanguage
): Promise<DictionaryLookupResult | null> {
  if (!term.trim()) return null

  // Try local dictionary first
  const dictionary = loadLocalDictionary()
  const lower = term.toLowerCase().trim()
  const localEntry = dictionary.find(e =>
    from === 'en'
      ? e.en.toLowerCase() === lower
      : e.sw.toLowerCase() === lower
  )

  if (localEntry) {
    return {
      term: from === 'en' ? localEntry.en : localEntry.sw,
      language: from,
      translations: [{
        displayTarget: to === 'sw' ? localEntry.sw : localEntry.en,
        posTag: 'NOUN',
        confidence: 0.95,
        prefixWord: '',
        backTranslations: [from === 'en' ? localEntry.en : localEntry.sw],
      }],
      provider: 'azure',
    }
  }

  // Azure Dictionary Lookup API (richer than translate)
  const result = await callAzureDictionaryLookup(term, from, to)

  if (result && result.translations.length > 0) {
    // Cache the best translation back to Borjie
    recordTranslation({
      sourceText: term,
      sourceLang: from,
      translatedText: result.translations[0].displayTarget,
      targetLang: to,
      context: 'dictionary_lookup',
      source: 'external_api',
    })
  }

  return result
}

/**
 * Enrich unknown Swahili words by looking them up externally.
 * Fire-and-forget — does not return results, just caches them
 * into Borjie's translation memory for future local hits.
 */
export async function enrichUnknownTerms(
  swahiliWords: readonly string[]
): Promise<void> {
  const dictionary = loadLocalDictionary()
  const knownSwahili = new Set(dictionary.map(e => e.sw.toLowerCase()))

  const unknown = swahiliWords.filter(w => {
    const lower = w.toLowerCase()
    // Skip if in local dictionary
    if (knownSwahili.has(lower)) return false
    // Skip if already in translation memory
    if (findTranslation(w, 'en')) return false
    // Skip very short words (likely particles)
    if (lower.length < 3) return false
    return true
  })

  if (unknown.length === 0) return

  // Look up unknown words (batch, max 10 per call to stay within rate limits)
  const batch = unknown.slice(0, 10)

  for (const word of batch) {
    try {
      await translateText(word, 'sw', 'en')
    } catch {
      // Best-effort, never fail the caller
    }
  }
}

/**
 * Check if external translation APIs are available.
 */
export function getExternalDictionaryStatus(): {
  readonly azureAvailable: boolean
  readonly googleAvailable: boolean
  readonly azureUsageChars: number
  readonly googleUsageChars: number
  readonly localTermCount: number
  readonly apiCacheSize: number
} {
  resetUsageIfNewMonth(azureUsage)
  resetUsageIfNewMonth(googleUsage)

  return {
    azureAvailable: !!process.env.AZURE_TRANSLATOR_KEY,
    googleAvailable: !!process.env.GOOGLE_TRANSLATE_API_KEY,
    azureUsageChars: azureUsage.chars,
    googleUsageChars: googleUsage.chars,
    localTermCount: loadLocalDictionary().length,
    apiCacheSize: apiCache.size,
  }
}
