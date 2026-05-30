/**
 * Swahili Spelling Corrector
 *
 * Corrects common Swahili misspellings in digital contexts using a
 * static corrections dictionary with Levenshtein distance fallback
 * for fuzzy matching.
 *
 * Handles:
 * - Phonetic errors (damana -> dhamana)
 * - Typos (biashra -> biashara)
 * - Regional variations (bank -> benki)
 * - Informal abbreviations (boda -> bodaboda)
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import type { SpellingCorrectionResult, SpellingCorrectionEntry, SpellingCorrectionType } from './types'

// ============================================================================
// Corrections Map (loaded once at init)
// ============================================================================

let correctionsMap: Map<string, { correct: string; type: SpellingCorrectionType }> | null = null
let knownCorrectWords: Set<string> | null = null

function loadCorrections(): void {
  if (correctionsMap !== null) return

  correctionsMap = new Map()
  knownCorrectWords = new Set()

  try {
    const path = join(process.cwd(), 'data', 'dictionaries', 'sw-spelling-corrections.json')
    const raw = readFileSync(path, 'utf-8')
    const data: { corrections: SpellingCorrectionEntry[] } = JSON.parse(raw)

    for (const entry of data.corrections) {
      correctionsMap.set(entry.incorrect.toLowerCase(), {
        correct: entry.correct,
        type: entry.type,
      })
      knownCorrectWords.add(entry.correct.toLowerCase())
    }
  } catch {
    // Corrections file unavailable -- corrector will be a no-op
  }
}

// ============================================================================
// Levenshtein Distance (for fuzzy matching)
// ============================================================================

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length

  if (m === 0) return n
  if (n === 0) return m

  // Use single-row optimization for memory efficiency
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost  // substitution
      )
    }
    const temp = prev
    prev = curr
    curr = temp
  }

  return prev[n]
}

/**
 * Find the closest known correct word using Levenshtein distance.
 * Only returns a match if the distance is within threshold.
 */
function findFuzzyMatch(
  word: string,
  maxDistance: number = 2
): { correct: string; distance: number } | null {
  loadCorrections()

  let bestMatch: string | null = null
  let bestDistance = maxDistance + 1

  for (const known of knownCorrectWords!) {
    // Quick length-based pruning
    if (Math.abs(known.length - word.length) > maxDistance) continue

    const dist = levenshteinDistance(word.toLowerCase(), known)
    if (dist < bestDistance && dist <= maxDistance) {
      bestDistance = dist
      bestMatch = known
    }
  }

  return bestMatch ? { correct: bestMatch, distance: bestDistance } : null
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Correct common Swahili misspellings in a message.
 *
 * Uses exact dictionary lookup first, then Levenshtein distance for
 * words not in the dictionary. Returns the corrected text along with
 * a list of all corrections made.
 */
export function correctSpelling(text: string): SpellingCorrectionResult {
  loadCorrections()

  if (correctionsMap!.size === 0) {
    return { correctedText: text, corrections: [], hadCorrections: false }
  }

  const words = text.split(/(\s+)/) // Preserve whitespace
  const corrections: Array<{
    original: string
    corrected: string
    position: number
    confidence: number
    type: SpellingCorrectionType
  }> = []

  let position = 0
  const correctedWords = words.map(segment => {
    // Skip whitespace segments
    if (/^\s+$/.test(segment)) {
      position += segment.length
      return segment
    }

    const wordLower = segment.toLowerCase()
    const startPos = position
    position += segment.length

    // Skip very short words or numbers
    if (segment.length <= 2 || /^\d+$/.test(segment)) {
      return segment
    }

    // 1. Exact dictionary match
    const exact = correctionsMap!.get(wordLower)
    if (exact) {
      // Preserve original capitalization pattern
      const corrected = preserveCase(segment, exact.correct)
      corrections.push({
        original: segment,
        corrected,
        position: startPos,
        confidence: 0.95,
        type: exact.type,
      })
      return corrected
    }

    // 2. Skip if already a known correct word
    if (knownCorrectWords!.has(wordLower)) {
      return segment
    }

    // 3. Fuzzy match for words that look Swahili-ish (3+ chars)
    if (segment.length >= 4) {
      const fuzzy = findFuzzyMatch(wordLower, 1) // Strict: max 1 edit for auto-correct
      if (fuzzy) {
        const corrected = preserveCase(segment, fuzzy.correct)
        corrections.push({
          original: segment,
          corrected,
          position: startPos,
          confidence: Math.max(0.5, 1 - (fuzzy.distance * 0.3)),
          type: 'typo',
        })
        return corrected
      }
    }

    return segment
  })

  const correctedText = correctedWords.join('')

  return {
    correctedText,
    corrections,
    hadCorrections: corrections.length > 0,
  }
}

/**
 * Preserve the capitalization pattern of the original word
 * when applying a correction.
 */
function preserveCase(original: string, correction: string): string {
  if (original === original.toUpperCase()) {
    return correction.toUpperCase()
  }
  if (original[0] === original[0].toUpperCase()) {
    return correction.charAt(0).toUpperCase() + correction.slice(1)
  }
  return correction.toLowerCase()
}

/**
 * Get the number of correction entries loaded.
 */
export function getCorrectionCount(): number {
  loadCorrections()
  return correctionsMap!.size
}
