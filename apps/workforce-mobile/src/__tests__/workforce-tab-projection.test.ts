/**
 * Owner-spawn → workforce tab projection — mobile-side pure logic.
 *
 * Locks the two guarantees the layout depends on:
 *   1. `parseProjectedTabs` never lets a malformed server/cache payload
 *      through (invalid entries dropped, never a throw).
 *   2. `resolveProjectedTabs` maps KNOWN kinds onto screens and SKIPS
 *      unknown kinds (collected for the DEV warning) — never a crash,
 *      never a broken tab.
 */
import { describe, expect, it } from 'vitest'
import {
  PROJECTED_KIND_TO_SCREEN,
  parseProjectedTabs,
  resolveProjectedTabs
} from '../lib/workforce-tab-projection'

const validTab = {
  id: 'tab-mkt-1',
  kind: 'marketplace',
  label: 'Gold marketplace',
  origin: 'owner-spawned'
} as const

describe('parseProjectedTabs', () => {
  it('keeps valid entries', () => {
    expect(parseProjectedTabs([validTab])).toEqual([validTab])
  })

  it('drops malformed entries without throwing', () => {
    const raw = [
      validTab,
      { id: '', kind: 'marketplace', label: 'x', origin: 'owner-spawned' },
      { id: 'a', kind: 'marketplace', label: 'x', origin: 'worker-spawned' },
      { id: 'b', label: 'missing kind', origin: 'owner-spawned' },
      'not-an-object',
      null
    ]
    expect(parseProjectedTabs(raw)).toEqual([validTab])
  })

  it('returns [] for non-array payloads (old caches, bad servers)', () => {
    expect(parseProjectedTabs(undefined)).toEqual([])
    expect(parseProjectedTabs(null)).toEqual([])
    expect(parseProjectedTabs({})).toEqual([])
    expect(parseProjectedTabs('[]')).toEqual([])
  })
})

describe('resolveProjectedTabs', () => {
  it('maps a known kind onto its screen', () => {
    const { resolved, skippedKinds } = resolveProjectedTabs([validTab])
    expect(resolved).toEqual([
      {
        id: 'tab-mkt-1',
        kind: 'marketplace',
        label: 'Gold marketplace',
        screen: PROJECTED_KIND_TO_SCREEN.marketplace
      }
    ])
    expect(skippedKinds).toEqual([])
  })

  it('skips unknown kinds and reports them (deduped)', () => {
    const { resolved, skippedKinds } = resolveProjectedTabs([
      { ...validTab, id: 'a', kind: 'blueprint' },
      { ...validTab, id: 'b', kind: 'blueprint' },
      validTab
    ])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.kind).toBe('marketplace')
    expect(skippedKinds).toEqual(['blueprint'])
  })

  it('renders at most one projection per screen (first wins)', () => {
    const { resolved } = resolveProjectedTabs([
      validTab,
      { ...validTab, id: 'tab-mkt-2', label: 'Second marketplace' }
    ])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.id).toBe('tab-mkt-1')
  })

  it('returns the frozen empty resolution for no input', () => {
    const { resolved, skippedKinds } = resolveProjectedTabs([])
    expect(resolved).toEqual([])
    expect(skippedKinds).toEqual([])
  })
})
