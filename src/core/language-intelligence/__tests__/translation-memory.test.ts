/**
 * Integration tests for Translation Memory with Supabase write-through
 *
 * Tests the translation memory module which now persists to Supabase
 * while maintaining an in-memory cache for fast lookups.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase before importing the module
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
  }),
}))

// Mock fs module — must provide both named and default exports
vi.mock('fs', async () => {
  const mockReadFileSync = vi.fn().mockReturnValue(
    JSON.stringify({
      terms: [
        { id: '1', en: 'loan', sw: 'mkopo', category: 'lending' },
        { id: '2', en: 'collateral', sw: 'dhamana', category: 'lending' },
        { id: '3', en: 'interest', sw: 'riba', category: 'finance' },
      ],
    })
  )
  return {
    default: { readFileSync: mockReadFileSync },
    readFileSync: mockReadFileSync,
    existsSync: vi.fn().mockReturnValue(true),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }
})

describe('Translation Memory', () => {
  let tm: typeof import('../translation-memory')

  beforeEach(async () => {
    // Reset module to clear cache state
    vi.resetModules()
    tm = await import('../translation-memory')
  })

  describe('findTranslation', () => {
    it('finds English to Swahili translation from dictionary', () => {
      const result = tm.findTranslation('loan', 'sw')
      expect(result).not.toBeNull()
      expect(result!.translatedText).toBe('mkopo')
      expect(result!.confidence).toBe(0.9)
      expect(result!.source).toBe('dictionary')
    })

    it('finds Swahili to English translation from dictionary', () => {
      const result = tm.findTranslation('dhamana', 'en')
      expect(result).not.toBeNull()
      expect(result!.translatedText).toBe('collateral')
    })

    it('returns null for unknown terms', () => {
      const result = tm.findTranslation('nonexistent', 'sw')
      expect(result).toBeNull()
    })

    it('is case insensitive', () => {
      const result = tm.findTranslation('LOAN', 'sw')
      expect(result).not.toBeNull()
      expect(result!.translatedText).toBe('mkopo')
    })
  })

  describe('recordTranslation', () => {
    it('creates a new translation entry', () => {
      const entry = tm.recordTranslation({
        sourceText: 'benki',
        sourceLang: 'sw',
        translatedText: 'bank',
        targetLang: 'en',
        context: 'finance',
        source: 'user_conversation',
      })

      expect(entry.sourceText).toBe('benki')
      expect(entry.translatedText).toBe('bank')
      expect(entry.confidence).toBe(0.5) // user_conversation initial confidence
      expect(entry.observationCount).toBe(1)
      expect(entry.id).toMatch(/^tm_/)
    })

    it('increases confidence on repeated observations', () => {
      const entry1 = tm.recordTranslation({
        sourceText: 'fedha',
        sourceLang: 'sw',
        translatedText: 'money',
        targetLang: 'en',
        context: 'finance',
        source: 'user_conversation',
      })

      const entry2 = tm.recordTranslation({
        sourceText: 'fedha',
        sourceLang: 'sw',
        translatedText: 'money',
        targetLang: 'en',
        context: 'banking',
        source: 'ai_generated',
      })

      expect(entry2.confidence).toBeGreaterThan(entry1.confidence)
      expect(entry2.observationCount).toBe(2)
    })

    it('applies correct initial confidence by source', () => {
      const dict = tm.recordTranslation({
        sourceText: 'test1',
        sourceLang: 'sw',
        translatedText: 'test1en',
        targetLang: 'en',
        context: 'test',
        source: 'dictionary',
      })
      expect(dict.confidence).toBe(0.9)

      const officer = tm.recordTranslation({
        sourceText: 'test2',
        sourceLang: 'sw',
        translatedText: 'test2en',
        targetLang: 'en',
        context: 'test',
        source: 'officer_correction',
      })
      expect(officer.confidence).toBe(0.95)

      const ai = tm.recordTranslation({
        sourceText: 'test3',
        sourceLang: 'sw',
        translatedText: 'test3en',
        targetLang: 'en',
        context: 'test',
        source: 'ai_generated',
      })
      expect(ai.confidence).toBe(0.6)
    })

    it('recorded translation is findable', () => {
      tm.recordTranslation({
        sourceText: 'akaunti',
        sourceLang: 'sw',
        translatedText: 'account',
        targetLang: 'en',
        context: 'banking',
        source: 'user_conversation',
      })

      const found = tm.findTranslation('akaunti', 'en')
      expect(found).not.toBeNull()
      expect(found!.translatedText).toBe('account')
    })
  })

  describe('extractInlineTranslations', () => {
    it('extracts "word, I mean translation" pattern', () => {
      const results = tm.extractInlineTranslations('mkopo, I mean a loan')
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.word === 'mkopo' || r.translation === 'loan')).toBe(true)
    })

    it('extracts parenthetical pattern', () => {
      const results = tm.extractInlineTranslations('loan (mkopo)')
      expect(results.length).toBeGreaterThan(0)
    })

    it('extracts "which means" pattern', () => {
      const results = tm.extractInlineTranslations('dhamana which means collateral')
      expect(results.length).toBeGreaterThan(0)
    })

    it('returns empty for messages without translations', () => {
      const results = tm.extractInlineTranslations('I need a loan please')
      expect(results).toEqual([])
    })
  })

  describe('getMemoryStats', () => {
    it('returns statistics including dictionary entries', async () => {
      const stats = await tm.getMemoryStats()
      expect(stats.totalEntries).toBeGreaterThanOrEqual(6) // 3 terms * 2 directions
      expect(stats.dictionaryEntries).toBeGreaterThanOrEqual(6)
      expect(stats.avgConfidence).toBeGreaterThan(0)
    })

    it('counts learned entries separately from dictionary', async () => {
      tm.recordTranslation({
        sourceText: 'biashara',
        sourceLang: 'sw',
        translatedText: 'business',
        targetLang: 'en',
        context: 'commerce',
        source: 'user_conversation',
      })

      const stats = await tm.getMemoryStats()
      expect(stats.learnedEntries).toBeGreaterThanOrEqual(1)
    })
  })
})
