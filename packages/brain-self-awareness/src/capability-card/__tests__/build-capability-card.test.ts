// Capability Card — unit tests (6 fixtures + edges).

import { describe, expect, it, vi } from 'vitest'
import {
  buildCapabilityCard,
  CAP_BRAND,
  type AutonomyScope,
  type CapabilityCardDeps,
  type CalibratedLimits
} from '../index.js'

const FIXED_NOW = new Date('2026-05-19T12:00:00.000Z')

const LIMITS: CalibratedLimits = {
  confidenceFloor: 0.7,
  overconfidenceRate: 0.12,
  maxConcurrentFlows: 4,
  maxAutonomousActionCostUsd: 50
}

function makeDeps(
  overrides: Partial<CapabilityCardDeps> = {}
): CapabilityCardDeps {
  return {
    skills: {
      listEnabled: vi.fn().mockResolvedValue([
        { name: 'reply-to-tenant-message' },
        { name: 'summarise-lease' }
      ]),
      listDisabled: vi
        .fn()
        .mockResolvedValue([
          { name: 'sign-lease', reason: 'requires-approval' }
        ])
    },
    decisions: {
      listRecent: vi.fn().mockResolvedValue([
        {
          decisionId: 'd1',
          actionKind: 'reply',
          outcome: 'executed',
          at: '2026-05-19T11:30:00.000Z'
        }
      ])
    },
    flows: {
      listOngoing: vi.fn().mockResolvedValue([
        {
          flowId: 'f1',
          kind: 'tenant-onboarding',
          startedAt: '2026-05-19T10:00:00.000Z',
          statusHint: 'running'
        }
      ])
    },
    suggester: {
      listSuggestions: vi.fn().mockResolvedValue([
        {
          name: 'auto-summarise-rent-reports',
          rationale: 'observed-5-times-this-week',
          estimatedFrequencyPerWeek: 5
        }
      ])
    },
    calibration: { getLimits: vi.fn().mockResolvedValue(LIMITS) },
    autonomyScope: 'EXECUTE_WITH_APPROVAL',
    now: () => FIXED_NOW,
    ...overrides
  }
}

describe('buildCapabilityCard', () => {
  it('fixture #1: builds approval-gated card with all sections populated', async () => {
    const card = await buildCapabilityCard(makeDeps())

    expect(card.autonomyScope).toBe<AutonomyScope>('EXECUTE_WITH_APPROVAL')
    expect(card.cap).toBe('Approval-gated')
    expect(card.canDo).toEqual(['reply-to-tenant-message', 'summarise-lease'])
    expect(card.cantDo).toEqual(['sign-lease — requires-approval'])
    expect(card.ongoingFlows).toHaveLength(1)
    expect(card.recentDecisions).toHaveLength(1)
    expect(card.suggestedNext).toHaveLength(1)
    expect(card.calibratedLimits).toEqual(LIMITS)
    expect(card.builtAt).toBe('2026-05-19T12:00:00.000Z')
  })

  it('fixture #2: read-only scope brand is "Read-only"', async () => {
    const card = await buildCapabilityCard(
      makeDeps({ autonomyScope: 'READ_ONLY' })
    )
    expect(card.cap).toBe('Read-only')
  })

  it('fixture #3: autonomous scope brand is "Autonomous"', async () => {
    const card = await buildCapabilityCard(
      makeDeps({ autonomyScope: 'EXECUTE_AUTONOMOUSLY' })
    )
    expect(card.cap).toBe('Autonomous')
  })

  it('fixture #4: empty registries produce empty arrays, not undefined', async () => {
    const deps = makeDeps({
      skills: {
        listEnabled: vi.fn().mockResolvedValue([]),
        listDisabled: vi.fn().mockResolvedValue([])
      },
      decisions: { listRecent: vi.fn().mockResolvedValue([]) },
      flows: { listOngoing: vi.fn().mockResolvedValue([]) },
      suggester: { listSuggestions: vi.fn().mockResolvedValue([]) }
    })
    const card = await buildCapabilityCard(deps)
    expect(card.canDo).toEqual([])
    expect(card.cantDo).toEqual([])
    expect(card.ongoingFlows).toEqual([])
    expect(card.recentDecisions).toEqual([])
    expect(card.suggestedNext).toEqual([])
  })

  it('fixture #5: recentDecisionsLimit override is forwarded to the port', async () => {
    const listRecent = vi.fn().mockResolvedValue([])
    const deps = makeDeps({
      decisions: { listRecent },
      recentDecisionsLimit: 12
    })
    await buildCapabilityCard(deps)
    expect(listRecent).toHaveBeenCalledWith({ limit: 12 })
  })

  it('fixture #6: default recentDecisionsLimit is 5', async () => {
    const listRecent = vi.fn().mockResolvedValue([])
    const deps = makeDeps({ decisions: { listRecent } })
    await buildCapabilityCard(deps)
    expect(listRecent).toHaveBeenCalledWith({ limit: 5 })
  })

  it('propagates errors from any port (skills)', async () => {
    const deps = makeDeps({
      skills: {
        listEnabled: vi.fn().mockRejectedValue(new Error('registry down')),
        listDisabled: vi.fn().mockResolvedValue([])
      }
    })
    await expect(buildCapabilityCard(deps)).rejects.toThrow('registry down')
  })

  it('uses default clock when no `now` override passed', async () => {
    const deps = makeDeps()
    delete (deps as { now?: () => Date }).now
    const before = Date.now()
    const card = await buildCapabilityCard(deps)
    const builtAtMs = Date.parse(card.builtAt)
    expect(builtAtMs).toBeGreaterThanOrEqual(before)
  })

  it('CAP_BRAND covers every AutonomyScope value', () => {
    const scopes: AutonomyScope[] = [
      'READ_ONLY',
      'SUGGEST',
      'EXECUTE_WITH_APPROVAL',
      'EXECUTE_AUTONOMOUSLY'
    ]
    for (const s of scopes) {
      expect(CAP_BRAND[s]).toBeTruthy()
    }
  })
})
