/**
 * useDebouncedSubmit tests — G4 robustness-audit closure (2026-05-29).
 *
 * Pure-logic harness — buyer-mobile's vitest config runs in Node with
 * no React DOM / test-renderer, so we drive the hook via a minimal
 * React shim that lets us hold a ref across "renders" and call the
 * returned callback directly. The behaviour we want to pin is the
 * debounce window math, which is independent of React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Minimal React shim — useRef returns a stable ref object across calls
// in the same harness scope; useCallback returns the supplied callback
// untouched. This is enough to exercise the debounce logic without
// pulling in React DOM / react-test-renderer.
//
// vi.hoisted runs the factory before vi.mock so the shared mock fns
// exist at the moment the mocked module is resolved.
const { useRefMock, useCallbackMock } = vi.hoisted(() => ({
  useRefMock: vi.fn(<T,>(initial: T) => ({ current: initial })),
  useCallbackMock: vi.fn(<F extends (...a: any[]) => any>(fn: F) => fn)
}))

vi.mock('react', () => ({
  useRef: useRefMock,
  useCallback: useCallbackMock
}))

import { useDebouncedSubmit } from '../hooks/useDebouncedSubmit'

describe('useDebouncedSubmit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useRefMock.mockClear()
    useCallbackMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('first invocation calls the handler', () => {
    const handler = vi.fn()
    const debounced = useDebouncedSubmit(handler)
    debounced()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('second invocation within the default 800ms window is dropped', () => {
    const handler = vi.fn()
    const debounced = useDebouncedSubmit(handler)
    debounced()
    expect(handler).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400)
    debounced()
    expect(handler).toHaveBeenCalledTimes(1) // still 1 — gated
  })

  it('second invocation after the window elapses fires', () => {
    const handler = vi.fn()
    const debounced = useDebouncedSubmit(handler)
    debounced()
    vi.advanceTimersByTime(900)
    debounced()
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('custom windowMs is honoured', () => {
    const handler = vi.fn()
    const debounced = useDebouncedSubmit(handler, { windowMs: 200 })
    debounced()
    vi.advanceTimersByTime(100)
    debounced()
    expect(handler).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(150)
    debounced()
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('forwards arguments to the wrapped handler', () => {
    const handler = vi.fn()
    const debounced = useDebouncedSubmit(handler)
    debounced('foo', 42)
    expect(handler).toHaveBeenCalledWith('foo', 42)
  })

  it('rapid synchronous double-tap fires the handler exactly once', () => {
    // The flaky-network case the audit calls out: two onPress events
    // fire in the same microtask before isPending flips.
    const handler = vi.fn()
    const debounced = useDebouncedSubmit(handler)
    debounced()
    debounced()
    debounced()
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
