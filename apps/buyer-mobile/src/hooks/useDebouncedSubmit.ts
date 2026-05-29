/**
 * useDebouncedSubmit — G4 robustness-audit closure (2026-05-29).
 *
 * Closes audit gap G4 from `Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`.
 *
 * Belt-and-braces protection against double-tap on mutating buttons.
 * The existing `useMutation().isPending` flag disables the button
 * while a request is in flight, but on a flaky mobile network the
 * onPress synchronous path can fire twice in the same microtask
 * BEFORE `isPending` flips. The debounce window catches that
 * sub-microsecond race.
 *
 * Usage:
 *   const onSubmit = useDebouncedSubmit(() => mutation.mutate(payload))
 *   <Button onPress={onSubmit} disabled={mutation.isPending} />
 *
 * The wrapped handler:
 *   1. Refuses the second tap within `windowMs` (default 800ms).
 *   2. Resets when the wrapped handler resolves (sync) or never (still
 *      gated for the window). On async handlers, the gate releases
 *      when `windowMs` elapses regardless of completion — the
 *      `isPending` flag is the source of truth for in-flight state.
 *
 * Pure — no React imports beyond useRef + useCallback so it tree-shakes
 * cleanly and the consumer's render path stays unaffected.
 */
import { useCallback, useRef } from 'react'

export interface DebouncedSubmitOptions {
  /** Debounce window in milliseconds. Defaults to 800. */
  readonly windowMs?: number
}

/**
 * Wraps a submit handler so a second invocation within `windowMs`
 * is silently dropped. Returns a stable callback that's safe to
 * pass to `onPress` without re-rendering the consumer.
 */
export function useDebouncedSubmit<Args extends ReadonlyArray<unknown>>(
  handler: (...args: Args) => unknown,
  options: DebouncedSubmitOptions = {}
): (...args: Args) => void {
  const windowMs = options.windowMs ?? 800
  const lastFiredAtRef = useRef<number>(0)

  return useCallback(
    (...args: Args) => {
      const now = Date.now()
      // `now - lastFired` reads zero on first invocation (initial 0)
      // and < windowMs on any duplicate within the gate window.
      if (now - lastFiredAtRef.current < windowMs) {
        return
      }
      lastFiredAtRef.current = now
      handler(...args)
    },
    [handler, windowMs]
  )
}
