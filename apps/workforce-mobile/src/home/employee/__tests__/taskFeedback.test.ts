/**
 * TRACK B10 regression guard — the employee "Done"/"Blocked" task actions must
 * give immediate on-screen feedback.
 *
 * Before the fix, `onDone`/`onBlocked` were fire-and-forget `void enqueueWrite`
 * calls: the Promise was discarded and NOTHING in the render tree changed, so
 * the worker could not tell the tap registered. These tests pin the pure
 * feedback reducer that now drives the optimistic "pending" flip, the "acked"
 * confirmation, and the graceful revert-to-error on enqueue rejection.
 */

import { describe, expect, it } from 'vitest'
import {
  isActionable,
  statusFor,
  taskAckReducer,
  type TaskAckState
} from '../taskFeedback'

const EMPTY: TaskAckState = {}

describe('taskAckReducer', () => {
  it('an untouched task is idle and actionable', () => {
    const status = statusFor(EMPTY, 't1')
    expect(status).toEqual({ phase: 'idle' })
    expect(isActionable(status)).toBe(true)
  })

  it('tapping Done flips the task to pending immediately (optimistic feedback)', () => {
    const next = taskAckReducer(EMPTY, { type: 'tap', taskId: 't1', kind: 'done' })
    const status = statusFor(next, 't1')
    // THE FIX: the tap is no longer a no-op — the UI now has a state change to
    // render the instant the button is pressed.
    expect(status).toEqual({ phase: 'pending', kind: 'done' })
    // A pending action must not be re-tappable (no double-enqueue).
    expect(isActionable(status)).toBe(false)
  })

  it('tapping Blocked flips to pending with the blocked kind', () => {
    const next = taskAckReducer(EMPTY, { type: 'tap', taskId: 't2', kind: 'blocked' })
    expect(statusFor(next, 't2')).toEqual({ phase: 'pending', kind: 'blocked' })
  })

  it('a resolved enqueue settles the task to acked, preserving the kind', () => {
    const tapped = taskAckReducer(EMPTY, { type: 'tap', taskId: 't1', kind: 'done' })
    const acked = taskAckReducer(tapped, { type: 'ack', taskId: 't1' })
    expect(statusFor(acked, 't1')).toEqual({ phase: 'acked', kind: 'done' })
    // An acked task is terminal — not re-tappable.
    expect(isActionable(statusFor(acked, 't1'))).toBe(false)
  })

  it('a rejected enqueue reverts to a re-tappable error (evidence never lost)', () => {
    const tapped = taskAckReducer(EMPTY, { type: 'tap', taskId: 't1', kind: 'blocked' })
    const errored = taskAckReducer(tapped, { type: 'fail', taskId: 't1' })
    expect(statusFor(errored, 't1')).toEqual({ phase: 'error', kind: 'blocked' })
    // The worker can retry — the failed action is actionable again.
    expect(isActionable(statusFor(errored, 't1'))).toBe(true)
  })

  it('ack/fail on a non-pending task is a no-op (guards out-of-order settles)', () => {
    expect(taskAckReducer(EMPTY, { type: 'ack', taskId: 't1' })).toBe(EMPTY)
    expect(taskAckReducer(EMPTY, { type: 'fail', taskId: 't1' })).toBe(EMPTY)
  })

  it('a second tap on a pending task is ignored (no double conclude)', () => {
    const tapped = taskAckReducer(EMPTY, { type: 'tap', taskId: 't1', kind: 'done' })
    const again = taskAckReducer(tapped, { type: 'tap', taskId: 't1', kind: 'blocked' })
    expect(again).toBe(tapped)
    expect(statusFor(again, 't1')).toEqual({ phase: 'pending', kind: 'done' })
  })

  it('retrying after an error re-enters pending', () => {
    const tapped = taskAckReducer(EMPTY, { type: 'tap', taskId: 't1', kind: 'done' })
    const errored = taskAckReducer(tapped, { type: 'fail', taskId: 't1' })
    const retried = taskAckReducer(errored, { type: 'tap', taskId: 't1', kind: 'done' })
    expect(statusFor(retried, 't1')).toEqual({ phase: 'pending', kind: 'done' })
  })

  it('does not mutate prior state (immutability)', () => {
    const tapped = taskAckReducer(EMPTY, { type: 'tap', taskId: 't1', kind: 'done' })
    expect(EMPTY).toEqual({})
    expect(tapped).not.toBe(EMPTY)
  })
})
