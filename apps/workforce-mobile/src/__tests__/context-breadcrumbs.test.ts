/**
 * context-breadcrumbs (K-D) tests — workforce-mobile.
 *
 * Validates the LIFO stack helpers + wire-payload serialiser. Pure
 * functions, so we exercise them without any React Native mount.
 */

import { describe, it, expect } from 'vitest'
import {
  pushCrumb,
  popCrumb,
  replaceStack,
  serializeCrumbStack,
  toWirePayload,
  type ContextCrumb,
} from '../lib/context-breadcrumbs'

const SITE: ContextCrumb = Object.freeze({
  kind: 'site',
  id: 'mwadui',
  label: 'Mwadui',
  scopeId: 'mwadui',
})
const SHIFT: ContextCrumb = Object.freeze({
  kind: 'shift',
  id: 's_42',
  label: '10:00 - 18:00',
})
const TASK: ContextCrumb = Object.freeze({
  kind: 'task',
  id: 't_99',
  label: 'Pre-shift inspection',
})

describe('pushCrumb / popCrumb', () => {
  it('appends to an empty stack', () => {
    const out = pushCrumb([], SITE)
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('mwadui')
  })

  it('caps at 8 levels by evicting the oldest', () => {
    let stack: ReadonlyArray<ContextCrumb> = []
    for (let i = 0; i < 10; i += 1) {
      stack = pushCrumb(stack, { kind: 'tab', id: `t${i}`, label: `T${i}` })
    }
    expect(stack).toHaveLength(8)
    expect(stack[0]?.id).toBe('t2')
    expect(stack[7]?.id).toBe('t9')
  })

  it('popCrumb removes the most-recent', () => {
    const stack = pushCrumb(pushCrumb([], SITE), SHIFT)
    const popped = popCrumb(stack)
    expect(popped).toHaveLength(1)
    expect(popped[0]?.id).toBe('mwadui')
  })

  it('popCrumb on empty is a no-op', () => {
    const empty: ReadonlyArray<ContextCrumb> = []
    const popped = popCrumb(empty)
    expect(popped).toBe(empty)
  })
})

describe('replaceStack', () => {
  it('clips to MAX_STACK (8) and freezes each crumb', () => {
    const long = Array.from({ length: 12 }, (_, i) => ({
      kind: 'k',
      id: `i${i}`,
      label: `L${i}`,
    }))
    const out = replaceStack(long)
    expect(out).toHaveLength(8)
    expect(out[0]?.id).toBe('i4')
    expect(Object.isFrozen(out)).toBe(true)
    expect(Object.isFrozen(out[0])).toBe(true)
  })
})

describe('serializeCrumbStack', () => {
  it('returns null on empty', () => {
    expect(serializeCrumbStack([])).toBeNull()
  })

  it('joins labels with → separator', () => {
    const stack = [SITE, SHIFT, TASK]
    expect(serializeCrumbStack(stack)).toBe(
      'Mwadui → 10:00 - 18:00 → Pre-shift inspection',
    )
  })
})

describe('toWirePayload', () => {
  it('serialises crumbs into the typed wire shape', () => {
    const wire = toWirePayload([SITE, SHIFT])
    expect(wire.stack[0]).toEqual({
      kind: 'site',
      id: 'mwadui',
      label: 'Mwadui',
      scopeId: 'mwadui',
    })
    // The second crumb has no scopeId — must NOT appear on the wire.
    expect((wire.stack[1] as Record<string, unknown>)['scopeId']).toBeUndefined()
    expect(Object.isFrozen(wire)).toBe(true)
  })
})
