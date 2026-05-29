/**
 * ai-suggestion-chip tests — bilingual + confidence routing.
 * Pins the strings from manager-dispatch-sota §6 so the
 * Swahili-first hard rule does not drift.
 */
import { describe, expect, it } from 'vitest'
import {
  AI_SUGGESTION_MIN_CONFIDENCE,
  AI_SUGGESTION_PREFILL_CONFIDENCE,
  deriveAiSuggestionChip,
} from '../ai-suggestion-chip.js'

describe('deriveAiSuggestionChip — manager-dispatch §6', () => {
  it('emits the Swahili default chip text verbatim', () => {
    const chip = deriveAiSuggestionChip({
      suggestionLabel: 'João',
      confidence: 0.87,
      lang: 'sw',
    })
    expect(chip.text).toBe('Borjie inapendekeza João · 87%')
    expect(chip.percent).toBe(87)
    expect(chip.route).toBe('top-three')
  })

  it('emits the English chip text', () => {
    const chip = deriveAiSuggestionChip({
      suggestionLabel: 'João',
      confidence: 0.87,
      lang: 'en',
    })
    expect(chip.text).toBe('Borjie suggests João · 87%')
  })

  it('routes high-confidence suggestions to pre-fill (>= 90%)', () => {
    const chip = deriveAiSuggestionChip({
      suggestionLabel: 'Aisha',
      confidence: 0.92,
      lang: 'sw',
    })
    expect(chip.route).toBe('pre-fill')
  })

  it('routes mid-confidence to top-three (70%..89%)', () => {
    const chip = deriveAiSuggestionChip({
      suggestionLabel: 'Pedro',
      confidence: 0.75,
      lang: 'sw',
    })
    expect(chip.route).toBe('top-three')
  })

  it('routes low-confidence to no-suggestion (< 70%)', () => {
    const chip = deriveAiSuggestionChip({
      suggestionLabel: 'Pedro',
      confidence: 0.5,
      lang: 'sw',
    })
    expect(chip.route).toBe('no-suggestion')
  })

  it('clamps confidence into [0, 1] and rounds to integer percent', () => {
    expect(deriveAiSuggestionChip({ suggestionLabel: 'X', confidence: -1, lang: 'sw' }).percent).toBe(0)
    expect(deriveAiSuggestionChip({ suggestionLabel: 'X', confidence: 1.4, lang: 'sw' }).percent).toBe(100)
  })

  it('appends a reason after the percentage when provided', () => {
    const chip = deriveAiSuggestionChip({
      suggestionLabel: 'João',
      confidence: 0.92,
      lang: 'en',
      reason: 'lowest workload',
    })
    expect(chip.text).toBe('Borjie suggests João · 92% · lowest workload')
  })

  it('exports the routing thresholds at the documented values', () => {
    expect(AI_SUGGESTION_MIN_CONFIDENCE).toBe(0.7)
    expect(AI_SUGGESTION_PREFILL_CONFIDENCE).toBe(0.9)
  })
})
