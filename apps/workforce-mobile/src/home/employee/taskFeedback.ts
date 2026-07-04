/**
 * Optimistic-feedback reducer for the employee "Done"/"Blocked" task actions.
 *
 * The taps used to be fire-and-forget `void enqueueWrite(...)` calls — the
 * Promise was discarded and NOTHING on screen changed, so the worker could not
 * tell the tap registered (an evaluation gulf on the primary conclude action).
 *
 * This reducer holds the per-task acknowledgement status so the UI can:
 *   - flip to an optimistic "pending" state the instant the button is pressed,
 *   - settle to "acked" when the offline enqueue resolves,
 *   - REVERT to "error" (re-enabling the tap) when the enqueue rejects, so
 *     irreplaceable field actions are never silently lost.
 *
 * It is a PURE function of (state, action) with no timers, no I/O and no React
 * import, so the transition table is unit-testable in the node vitest env.
 */

export type TaskAckKind = 'done' | 'blocked'

export type TaskAckStatus =
  | { readonly phase: 'idle' }
  | { readonly phase: 'pending'; readonly kind: TaskAckKind }
  | { readonly phase: 'acked'; readonly kind: TaskAckKind }
  | { readonly phase: 'error'; readonly kind: TaskAckKind }

/** taskId → status. A task absent from the map is implicitly `idle`. */
export type TaskAckState = Readonly<Record<string, TaskAckStatus>>

export type TaskAckAction =
  | { readonly type: 'tap'; readonly taskId: string; readonly kind: TaskAckKind }
  | { readonly type: 'ack'; readonly taskId: string }
  | { readonly type: 'fail'; readonly taskId: string }

const IDLE: TaskAckStatus = { phase: 'idle' }

export function statusFor(state: TaskAckState, taskId: string): TaskAckStatus {
  return state[taskId] ?? IDLE
}

/**
 * A pending or already-acknowledged task must not be re-tapped (double-enqueue
 * of the same conclusion); an errored task MAY be re-tapped to retry.
 */
export function isActionable(status: TaskAckStatus): boolean {
  return status.phase === 'idle' || status.phase === 'error'
}

export function taskAckReducer(
  state: TaskAckState,
  action: TaskAckAction
): TaskAckState {
  switch (action.type) {
    case 'tap': {
      const current = statusFor(state, action.taskId)
      if (!isActionable(current)) {
        return state
      }
      return { ...state, [action.taskId]: { phase: 'pending', kind: action.kind } }
    }
    case 'ack': {
      const current = statusFor(state, action.taskId)
      if (current.phase !== 'pending') {
        return state
      }
      return { ...state, [action.taskId]: { phase: 'acked', kind: current.kind } }
    }
    case 'fail': {
      const current = statusFor(state, action.taskId)
      if (current.phase !== 'pending') {
        return state
      }
      return { ...state, [action.taskId]: { phase: 'error', kind: current.kind } }
    }
    default:
      return state
  }
}
