// Automation Suggester — unit tests (6 fixtures + edge cases).

import { describe, expect, it } from 'vitest'
import {
  analyzePatterns,
  DEFAULT_SUGGESTION_THRESHOLD,
  type DecisionEventForAnalysis
} from '../index.js'

function makeEvents(
  kinds: string[],
  baseISO = '2026-05-19T10:00:00.000Z'
): DecisionEventForAnalysis[] {
  const base = Date.parse(baseISO)
  return kinds.map((kind, i) => ({
    actionKind: kind,
    createdAt: new Date(base + i * 1000).toISOString(),
    inputs: { i }
  }))
}

const SINCE = '2026-05-19T00:00:00.000Z'

describe('analyzePatterns — threshold behaviour', () => {
  it('fixture #1: 5 events of the same kind hit default threshold', () => {
    const events = makeEvents([
      'reply-tenant',
      'reply-tenant',
      'reply-tenant',
      'reply-tenant',
      'reply-tenant'
    ])
    const suggestions = analyzePatterns({ decisionEvents: events, since: SINCE })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]!.name).toBe('auto-reply-tenant')
    expect(suggestions[0]!.description).toContain('5 times')
  })

  it('fixture #2: 4 events do NOT cross threshold of 5', () => {
    const events = makeEvents(['x', 'x', 'x', 'x'])
    const suggestions = analyzePatterns({ decisionEvents: events, since: SINCE })
    expect(suggestions).toEqual([])
  })

  it('fixture #3: custom threshold lower than default emits earlier', () => {
    const events = makeEvents(['x', 'x', 'x'])
    const suggestions = analyzePatterns({
      decisionEvents: events,
      since: SINCE,
      threshold: 3
    })
    expect(suggestions).toHaveLength(1)
  })

  it('exposes DEFAULT_SUGGESTION_THRESHOLD = 5', () => {
    expect(DEFAULT_SUGGESTION_THRESHOLD).toBe(5)
  })
})

describe('analyzePatterns — bucketing & ordering', () => {
  it('fixture #4: two qualifying kinds are sorted by descending count', () => {
    const events = makeEvents([
      'a', 'a', 'a', 'a', 'a', 'a', 'a', // 7x
      'b', 'b', 'b', 'b', 'b' // 5x
    ])
    const suggestions = analyzePatterns({ decisionEvents: events, since: SINCE })
    expect(suggestions.map((s) => s.name)).toEqual(['auto-a', 'auto-b'])
  })

  it('fixture #5: kinds below threshold are filtered out', () => {
    const events = makeEvents([
      'over', 'over', 'over', 'over', 'over',
      'under', 'under'
    ])
    const suggestions = analyzePatterns({ decisionEvents: events, since: SINCE })
    expect(suggestions.map((s) => s.name)).toEqual(['auto-over'])
  })

  it('caps sampleInvocations at maxSamples (default 3)', () => {
    const events = makeEvents(Array(10).fill('repeated'))
    const suggestions = analyzePatterns({ decisionEvents: events, since: SINCE })
    expect(suggestions[0]!.sampleInvocations).toHaveLength(3)
  })

  it('honours custom maxSamples override', () => {
    const events = makeEvents(Array(10).fill('repeated'))
    const suggestions = analyzePatterns({
      decisionEvents: events,
      since: SINCE,
      maxSamples: 5
    })
    expect(suggestions[0]!.sampleInvocations).toHaveLength(5)
  })
})

describe('analyzePatterns — window filtering', () => {
  it('fixture #6: events before `since` are excluded from counts', () => {
    const oldEvents: DecisionEventForAnalysis[] = Array(10)
      .fill(null)
      .map((_, i) => ({
        actionKind: 'old',
        createdAt: new Date(Date.parse('2025-01-01T00:00:00Z') + i * 1000).toISOString()
      }))
    const newEvents = makeEvents(['new', 'new'])

    const suggestions = analyzePatterns({
      decisionEvents: [...oldEvents, ...newEvents],
      since: SINCE
    })
    // 10 'old' events are filtered out -> count drops to 0
    // 2 'new' events do not cross threshold either
    expect(suggestions).toEqual([])
  })

  it('events with invalid createdAt are ignored', () => {
    const events: DecisionEventForAnalysis[] = [
      ...makeEvents(['x', 'x', 'x', 'x', 'x']),
      { actionKind: 'x', createdAt: 'not-a-date' }
    ]
    const suggestions = analyzePatterns({ decisionEvents: events, since: SINCE })
    expect(suggestions[0]!.description).toContain('5 times')
  })

  it('throws on invalid `since`', () => {
    expect(() =>
      analyzePatterns({ decisionEvents: [], since: 'banana' })
    ).toThrow(/invalid "since"/)
  })

  it('returns empty for empty event list', () => {
    expect(analyzePatterns({ decisionEvents: [], since: SINCE })).toEqual([])
  })
})

describe('analyzePatterns — purity', () => {
  it('does not mutate the input event array', () => {
    const events = makeEvents(['a', 'a', 'a', 'a', 'a'])
    const snapshot = JSON.parse(JSON.stringify(events))
    analyzePatterns({ decisionEvents: events, since: SINCE })
    expect(events).toEqual(snapshot)
  })
})
