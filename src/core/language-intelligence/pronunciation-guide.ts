/**
 * Pronunciation Guide
 *
 * Provides phonetic data, syllable breakdowns, and pronunciation
 * tips for Swahili financial terms. Integrates with the embedded
 * dictionary for phonetic lookups and generates IPA approximations
 * for terms without explicit phonetic data.
 *
 * Swahili pronunciation is highly regular (nearly phonetic),
 * which makes rule-based IPA generation reliable.
 *
 * @module pronunciation-guide
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import type { SupportedLanguage, FinancialDictionaryEntry } from './types'

// ============================================================================
// Types
// ============================================================================

export interface PronunciationData {
  readonly term: string
  readonly language: SupportedLanguage
  readonly phonetic: string
  readonly ipa: string
  readonly syllables: readonly string[]
  readonly stressIndex: number
  readonly audioAvailable: boolean
  readonly tips: readonly string[]
}

export interface PronunciationSearchResult {
  readonly term: string
  readonly termSw: string
  readonly phonetic: string
  readonly category: string
  readonly difficulty: string
}

// ============================================================================
// Swahili Phonetic Rules
// ============================================================================

/**
 * Swahili vowels and their IPA equivalents.
 * Swahili has a 5-vowel system: a, e, i, o, u
 */
const VOWEL_IPA: Record<string, string> = {
  a: 'ɑ',
  e: 'ɛ',
  i: 'i',
  o: 'ɔ',
  u: 'u',
}

/**
 * Swahili consonant cluster IPA mappings.
 * Checked longest-first for correct matching.
 */
const CONSONANT_IPA: ReadonlyArray<readonly [string, string]> = [
  // Multi-character clusters (check first)
  ['ng\'', 'ŋ'],
  ['ng', 'ŋg'],
  ['ny', 'ɲ'],
  ['ch', 'tʃ'],
  ['sh', 'ʃ'],
  ['th', 'θ'],
  ['dh', 'ð'],
  ['gh', 'ɣ'],
  ['mb', 'mb'],
  ['nd', 'nd'],
  ['nj', 'ndʒ'],
  ['nz', 'nz'],
  // Single consonants
  ['b', 'b'],
  ['d', 'd'],
  ['f', 'f'],
  ['g', 'g'],
  ['h', 'h'],
  ['j', 'dʒ'],
  ['k', 'k'],
  ['l', 'l'],
  ['m', 'm'],
  ['n', 'n'],
  ['p', 'p'],
  ['r', 'ɾ'],
  ['s', 's'],
  ['t', 't'],
  ['v', 'v'],
  ['w', 'w'],
  ['y', 'j'],
  ['z', 'z'],
]

/**
 * Generate IPA transcription for a Swahili word.
 * Swahili orthography is highly regular, making rule-based IPA reliable.
 */
function generateSwahiliIPA(word: string): string {
  const lower = word.toLowerCase()
  let ipa = ''
  let i = 0

  while (i < lower.length) {
    // Try multi-character clusters first
    let matched = false
    for (const [pattern, replacement] of CONSONANT_IPA) {
      if (lower.startsWith(pattern, i)) {
        ipa += replacement
        i += pattern.length
        matched = true
        break
      }
    }

    if (!matched) {
      const char = lower[i]
      if (VOWEL_IPA[char]) {
        ipa += VOWEL_IPA[char]
      } else {
        ipa += char
      }
      i++
    }
  }

  return ipa
}

/**
 * Break a Swahili word into syllables.
 * Rule: CV(C) pattern - each syllable starts with a consonant (if present)
 * followed by a vowel.
 */
function syllabifySwahili(word: string): readonly string[] {
  const lower = word.toLowerCase()
  const vowels = new Set(['a', 'e', 'i', 'o', 'u'])
  const syllables: string[] = []
  let current = ''

  for (let i = 0; i < lower.length; i++) {
    const char = lower[i]
    const isVowel = vowels.has(char)

    current += char

    if (isVowel) {
      // Check if next char starts a new syllable
      const next = i + 1 < lower.length ? lower[i + 1] : null
      const nextNext = i + 2 < lower.length ? lower[i + 2] : null

      if (next && !vowels.has(next)) {
        // If there's a consonant followed by another consonant or end,
        // the first consonant might belong to this syllable
        if (nextNext && !vowels.has(nextNext) && next !== 'n' && next !== 'm') {
          // Double consonant cluster: split between them
          // But prenasalized consonants (mb, nd, ng, nj, nz) stay together
          syllables.push(current)
          current = ''
        } else if (!nextNext) {
          // Last consonant: attach to current syllable
          current += next
          i++
          syllables.push(current)
          current = ''
        } else {
          // Consonant followed by vowel: start new syllable
          syllables.push(current)
          current = ''
        }
      } else if (!next) {
        syllables.push(current)
        current = ''
      }
    }
  }

  if (current) {
    syllables.push(current)
  }

  return syllables.length > 0 ? syllables : [word]
}

/**
 * Find the stressed syllable index.
 * Swahili stress is penultimate (second-to-last syllable).
 */
function findStressIndex(syllables: readonly string[]): number {
  return Math.max(0, syllables.length - 2)
}

/**
 * Generate pronunciation tips based on the word's phonetic features.
 */
function generateTips(word: string, language: SupportedLanguage): readonly string[] {
  if (language !== 'sw') return []

  const tips: string[] = []
  const lower = word.toLowerCase()

  if (lower.includes('ng\'')) {
    tips.push('ng\' is pronounced like "ng" in "sing" (without the "g" sound)')
  }
  if (lower.includes('ny')) {
    tips.push('"ny" is pronounced like "ñ" in Spanish "señor"')
  }
  if (lower.includes('ch')) {
    tips.push('"ch" is pronounced like "ch" in "church"')
  }
  if (lower.includes('dh')) {
    tips.push('"dh" is pronounced like "th" in "this" (voiced)')
  }
  if (lower.includes('th')) {
    tips.push('"th" is pronounced like "th" in "think" (voiceless)')
  }
  if (lower.includes('gh')) {
    tips.push('"gh" is a soft guttural sound (Arabic influence)')
  }
  if (/^m[bdfgjklnpstvwz]/.test(lower)) {
    tips.push('The initial "m" before a consonant is syllabic — give it a slight hum')
  }
  if (/^n[dgjz]/.test(lower)) {
    tips.push('The initial "n" before a consonant is syllabic — a quick nasal sound')
  }

  // Stress tip for multi-syllable words
  const syllables = syllabifySwahili(word)
  if (syllables.length >= 3) {
    tips.push('Stress falls on the second-to-last syllable (penultimate stress)')
  }

  // Vowel tips
  if (lower.includes('aa') || lower.includes('ee') || lower.includes('ii') || lower.includes('oo') || lower.includes('uu')) {
    tips.push('Double vowels indicate a longer vowel sound — hold it slightly longer')
  }

  return tips
}

// ============================================================================
// Dictionary Cache
// ============================================================================

let dictionaryCache: readonly FinancialDictionaryEntry[] | null = null

function loadDictionary(): readonly FinancialDictionaryEntry[] {
  if (dictionaryCache) return dictionaryCache

  let loaded: readonly FinancialDictionaryEntry[]
  try {
    const filePath = join(process.cwd(), 'data', 'dictionaries', 'sw-en-financial-dictionary.json')
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    loaded = parsed.terms ?? []
  } catch {
    loaded = []
  }

  dictionaryCache = loaded
  return loaded
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get pronunciation data for a specific term.
 * Looks up the dictionary first, then generates phonetics algorithmically.
 */
export function getPronunciation(
  term: string,
  language: SupportedLanguage = 'sw'
): PronunciationData | null {
  const dictionary = loadDictionary()

  // Search by Swahili term, English term, or ID
  const lowerTerm = term.toLowerCase()
  const entry = dictionary.find(
    e => e.sw.toLowerCase() === lowerTerm ||
         e.en.toLowerCase() === lowerTerm ||
         e.id === lowerTerm
  )

  const targetWord = language === 'sw'
    ? (entry?.sw ?? term)
    : (entry?.en ?? term)

  const phonetic = language === 'sw'
    ? (entry?.phonetic_sw ?? generatePhoneticGuide(targetWord))
    : targetWord

  const syllables = language === 'sw'
    ? syllabifySwahili(targetWord)
    : [targetWord]

  const ipa = language === 'sw'
    ? generateSwahiliIPA(targetWord)
    : ''

  return {
    term: targetWord,
    language,
    phonetic,
    ipa,
    syllables,
    stressIndex: findStressIndex(syllables),
    audioAvailable: language === 'sw',
    tips: generateTips(targetWord, language),
  }
}

/**
 * Generate a simple phonetic guide (uppercase stressed syllables).
 * Used as fallback when the dictionary doesn't have an explicit phonetic.
 */
function generatePhoneticGuide(word: string): string {
  const syllables = syllabifySwahili(word)
  const stressIdx = findStressIndex(syllables)

  return syllables
    .map((s, i) => i === stressIdx ? s.toUpperCase() : s.toLowerCase())
    .join('-')
}

/**
 * Search for terms with pronunciation data.
 * Returns matching terms with their phonetic guides.
 */
export function searchPronunciations(
  query: string,
  options: { readonly limit?: number; readonly category?: string } = {}
): readonly PronunciationSearchResult[] {
  const { limit = 20, category } = options
  const dictionary = loadDictionary()
  const lowerQuery = query.toLowerCase()

  const results = dictionary
    .filter(entry => {
      const matchesTerm =
        entry.sw.toLowerCase().includes(lowerQuery) ||
        entry.en.toLowerCase().includes(lowerQuery) ||
        entry.id.includes(lowerQuery)

      const matchesCategory = !category || entry.category === category

      return matchesTerm && matchesCategory
    })
    .slice(0, limit)
    .map(entry => ({
      term: entry.en,
      termSw: entry.sw,
      phonetic: entry.phonetic_sw || generatePhoneticGuide(entry.sw),
      category: entry.category,
      difficulty: entry.difficulty,
    }))

  return results
}

/**
 * Get all pronunciation data for terms in a given category.
 */
export function getPronunciationsByCategory(
  category: string
): readonly PronunciationData[] {
  const dictionary = loadDictionary()

  return dictionary
    .filter(e => e.category === category)
    .map(entry => {
      const syllables = syllabifySwahili(entry.sw)
      return {
        term: entry.sw,
        language: 'sw' as SupportedLanguage,
        phonetic: entry.phonetic_sw || generatePhoneticGuide(entry.sw),
        ipa: generateSwahiliIPA(entry.sw),
        syllables,
        stressIndex: findStressIndex(syllables),
        audioAvailable: true,
        tips: generateTips(entry.sw, 'sw'),
      }
    })
}

/**
 * Get pronunciation statistics.
 */
export function getPronunciationStats(): {
  readonly totalTerms: number
  readonly withExplicitPhonetic: number
  readonly withGeneratedPhonetic: number
  readonly categories: readonly string[]
} {
  const dictionary = loadDictionary()

  const withExplicit = dictionary.filter(e => e.phonetic_sw).length
  const categories = [...new Set(dictionary.map(e => e.category))]

  return {
    totalTerms: dictionary.length,
    withExplicitPhonetic: withExplicit,
    withGeneratedPhonetic: dictionary.length - withExplicit,
    categories,
  }
}

/**
 * Validate IPA generation against known phonetics.
 * Useful for testing and quality assurance.
 */
export function validateIPA(
  word: string,
  expectedIPA?: string
): { readonly word: string; readonly generated: string; readonly expected?: string; readonly matches: boolean } {
  const generated = generateSwahiliIPA(word)
  return {
    word,
    generated,
    expected: expectedIPA,
    matches: expectedIPA ? generated === expectedIPA : true,
  }
}
