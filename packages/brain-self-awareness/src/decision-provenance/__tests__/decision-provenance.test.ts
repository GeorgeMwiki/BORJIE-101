// Decision Provenance — unit tests (6 fixtures + edge cases).

import { describe, expect, it, vi } from 'vitest'
import {
  getProvenance,
  recordDecision,
  validateDecisionEvent,
  type DecisionEvent,
  type DecisionProvenanceDeps
} from '../index.js'

const BASE: DecisionEvent = {
  decisionId: 'dec-1',
  actionKind: 'send-reminder',
  actorRole: 'brain',
  tenantId: 'tenant-7',
  autonomyScope: 'EXECUTE_WITH_APPROVAL',
  inputs: { invoiceId: 'inv-42' },
  outputs: { messageId: 'msg-99' },
  evidence: [{ kind: 'document', id: 'lease-12', summary: 'overdue clause' }],
  alternativesConsidered: [
    {
      summary: 'wait until tomorrow',
      rejectedBecause: 'lease clause requires same-day notice'
    }
  ],
  modelId: 'claude-opus-4-7',
  promptHash: 'sha256:abc',
  outcome: 'executed',
  createdAt: '2026-05-19T11:30:00.000Z'
}

const REVISION: DecisionEvent = {
  ...BASE,
  decisionId: 'dec-2',
  outcome: 'rejected',
  createdAt: '2026-05-19T11:40:00.000Z',
  supersedes: 'dec-1'
}

function makeDeps(): {
  deps: DecisionProvenanceDeps
  appended: DecisionEvent[]
} {
  const appended: DecisionEvent[] = []
  return {
    appended,
    deps: {
      store: {
        append: vi.fn(async (e: DecisionEvent) => {
          appended.push(e)
          return e
        }),
        getById: vi.fn(async (id: string) =>
          appended.find((e) => e.decisionId === id) ?? null
        ),
        getChain: vi.fn(async (_id: string) => appended.slice())
      }
    }
  }
}

describe('validateDecisionEvent', () => {
  it('accepts a fully-populated event', () => {
    expect(() => validateDecisionEvent(BASE)).not.toThrow()
  })

  it('rejects missing decisionId', () => {
    expect(() =>
      validateDecisionEvent({ ...BASE, decisionId: '' })
    ).toThrow(/decisionId/)
  })

  it('rejects missing actionKind', () => {
    expect(() =>
      validateDecisionEvent({ ...BASE, actionKind: '' })
    ).toThrow(/actionKind/)
  })

  it('rejects non-array evidence', () => {
    expect(() =>
      validateDecisionEvent({
        ...BASE,
        evidence: 'oops' as unknown as DecisionEvent['evidence']
      })
    ).toThrow(/evidence/)
  })

  it('rejects non-array alternativesConsidered', () => {
    expect(() =>
      validateDecisionEvent({
        ...BASE,
        alternativesConsidered:
          'oops' as unknown as DecisionEvent['alternativesConsidered']
      })
    ).toThrow(/alternativesConsidered/)
  })
})

describe('recordDecision', () => {
  it('fixture #1: appends a valid decision and returns it', async () => {
    const { deps, appended } = makeDeps()
    const out = await recordDecision(deps, BASE)
    expect(out).toEqual(BASE)
    expect(appended).toHaveLength(1)
    expect(appended[0]).toEqual(BASE)
  })

  it('fixture #2: rejects an invalid decision before appending', async () => {
    const { deps, appended } = makeDeps()
    await expect(
      recordDecision(deps, { ...BASE, actionKind: '' })
    ).rejects.toThrow(/actionKind/)
    expect(appended).toHaveLength(0)
  })

  it('fixture #3: revision is appended, not overwritten', async () => {
    const { deps, appended } = makeDeps()
    await recordDecision(deps, BASE)
    await recordDecision(deps, REVISION)
    expect(appended).toHaveLength(2)
    expect(appended[1]!.supersedes).toBe('dec-1')
  })

  it('does not mutate the input event', async () => {
    const { deps } = makeDeps()
    const cloned = structuredClone(BASE)
    await recordDecision(deps, BASE)
    expect(BASE).toEqual(cloned)
  })
})

describe('getProvenance', () => {
  it('fixture #4: returns the full chain for an existing decision', async () => {
    const { deps } = makeDeps()
    await recordDecision(deps, BASE)
    await recordDecision(deps, REVISION)
    const chain = await getProvenance(deps, 'dec-1')
    expect(chain).toHaveLength(2)
    expect(chain[0]!.decisionId).toBe('dec-1')
    expect(chain[1]!.decisionId).toBe('dec-2')
  })

  it('fixture #5: throws for unknown decision IDs', async () => {
    const { deps } = makeDeps()
    await expect(getProvenance(deps, 'nope')).rejects.toThrow(
      /Decision not found/
    )
  })

  it('fixture #6: a single-event chain works (no revisions yet)', async () => {
    const { deps } = makeDeps()
    await recordDecision(deps, BASE)
    const chain = await getProvenance(deps, 'dec-1')
    expect(chain).toHaveLength(1)
    expect(chain[0]).toEqual(BASE)
  })
})

describe('append-only port surface', () => {
  it('port has no "update" method (append-only by contract)', () => {
    const { deps } = makeDeps()
    expect(
      (deps.store as unknown as Record<string, unknown>)['update']
    ).toBeUndefined()
  })
})
