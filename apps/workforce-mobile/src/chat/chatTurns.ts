/**
 * chatTurns — pure state machines + R7 timing constants for the
 * streaming HomeChat surface.
 *
 * The chat surface tracks two flavours of turn:
 *   • `LiveTurn` — the one in-flight turn. Always at most one. Drives
 *     skeleton / pulse / streaming bubble rendering.
 *   • `SettledTurn` — completed turns persisted to AsyncStorage and
 *     rendered as the conversation history.
 *
 * Each apply* function is a pure reducer: `(turn, event) → turn'`. Tests
 * exercise them directly (vitest node env — no RN renderer needed). The
 * HomeChat surface is then a thin glue around setState + setTimeout.
 *
 * Immutability is mandatory — every reducer returns a new object so
 * React's strict-mode double-render does not see torn state.
 */

import type { Citation, ProposedAction, ToolCallResult } from './types'

/**
 * R7 timing values lifted verbatim from
 * Docs/research/mobile-chat-latency-ux.md §11.3 (timing table). Tests
 * assert against this object so a drift in any value trips CI before
 * a pilot ever hits the regressed perceived-latency budget.
 *
 * SKELETON_ONSET_MS — wait this long before showing the shimmer so it
 *   doesn't flash for sub-200 ms turns (NN/G).
 * PULSE_GRACE_MS — wait this long after send before the three-dot
 *   pulse appears (Doherty 400 ms bound — past this the user is aware
 *   of waiting).
 * SLOW_INDICATOR_MS — switch to "Borjie ana shughuli…" at 3 s
 *   (CodeAnt engagement cliff).
 * BUBBLE_ENTRY_DURATION_MS — slide-up + fade reveal duration.
 */
export const R7_TIMINGS = Object.freeze({
  SKELETON_ONSET_MS: 200,
  PULSE_GRACE_MS: 400,
  SLOW_INDICATOR_MS: 3_000,
  BUBBLE_ENTRY_DURATION_MS: 200,
  SKELETON_MIN_LIFETIME_MS: 200,
  TOKEN_STREAM_WPS: 15
}) as Readonly<Record<string, number>>

export type LiveTurnKind =
  | 'pending'           // user bubble visible, awaiting `accepted`
  | 'streaming'         // `accepted` landed; tokens flowing
  | 'streaming-complete'// final `done` landed; about to settle
  | 'failed'            // terminal error; show FailureDot for retry

export interface LiveTurn {
  readonly id: string
  readonly userText: string
  readonly threadId: string | null
  readonly text: string
  readonly toolCalls: ReadonlyArray<ToolCallResult>
  readonly proposedAction: ProposedAction | null
  readonly citations: ReadonlyArray<Citation>
  readonly kind: LiveTurnKind
  readonly errorMessage: string | null
  readonly startedAtMs: number
}

export interface SettledTurn {
  readonly id: string
  readonly userText: string
  readonly responseText: string
  readonly toolCalls: ReadonlyArray<ToolCallResult>
  readonly proposedAction: ProposedAction | null
  readonly citations: ReadonlyArray<Citation>
  readonly threadId: string
  readonly tokensUsed: number
  readonly createdAtMs: number
}

export function newTurnId(now: number = Date.now()): string {
  return `t_${now}_${Math.random().toString(36).slice(2, 8)}`
}

export function optimisticTurn(userText: string, now: number = Date.now()): LiveTurn {
  return {
    id: newTurnId(now),
    userText,
    threadId: null,
    text: '',
    toolCalls: [],
    proposedAction: null,
    citations: [],
    kind: 'pending',
    errorMessage: null,
    startedAtMs: now
  }
}

export function applyTurnAccepted(turn: LiveTurn, threadId: string): LiveTurn {
  if (turn.kind === 'failed') {
    return turn
  }
  return {
    ...turn,
    threadId,
    kind: turn.kind === 'pending' ? 'streaming' : turn.kind
  }
}

export function applyMessageChunk(turn: LiveTurn, delta: string): LiveTurn {
  if (turn.kind === 'failed') {
    return turn
  }
  return {
    ...turn,
    text: turn.text + delta,
    kind: 'streaming'
  }
}

export function applyToolCall(turn: LiveTurn, call: ToolCallResult): LiveTurn {
  if (turn.kind === 'failed') {
    return turn
  }
  return {
    ...turn,
    toolCalls: [...turn.toolCalls, call]
  }
}

export function applyProposedAction(turn: LiveTurn, action: ProposedAction): LiveTurn {
  if (turn.kind === 'failed') {
    return turn
  }
  return {
    ...turn,
    proposedAction: action
  }
}

export function applyStreamError(turn: LiveTurn, message: string): LiveTurn {
  return {
    ...turn,
    kind: 'failed',
    errorMessage: message
  }
}

export function finaliseTurn(
  turn: LiveTurn,
  threadId: string,
  tokensUsed: number,
  now: number = Date.now()
): SettledTurn {
  return {
    id: turn.id,
    userText: turn.userText,
    responseText: turn.text,
    toolCalls: turn.toolCalls,
    proposedAction: turn.proposedAction,
    citations: turn.citations,
    threadId,
    tokensUsed,
    createdAtMs: now
  }
}

export function toPersistedSlice(
  turns: ReadonlyArray<SettledTurn>,
  cap: number
): ReadonlyArray<SettledTurn> {
  if (turns.length <= cap) {
    return turns
  }
  return turns.slice(turns.length - cap)
}

/**
 * `derivePendingState` summarises the visual state for tests + telemetry.
 * Returns a string the HomeChat doesn't need at render time but tests
 * can assert on to verify timing transitions deterministically.
 */
export function derivePendingState(
  turn: LiveTurn,
  lang: 'sw' | 'en'
): {
  readonly label: string
  readonly showSpinner: boolean
  readonly showStream: boolean
} {
  if (turn.kind === 'failed') {
    return {
      label: lang === 'sw' ? 'Imeshindwa. Gusa kuanza tena.' : 'Failed. Tap to retry.',
      showSpinner: false,
      showStream: false
    }
  }
  if (turn.kind === 'pending') {
    return {
      label: lang === 'sw' ? 'Borjie anafikiri…' : 'Borjie is thinking…',
      showSpinner: true,
      showStream: false
    }
  }
  return {
    label: '',
    showSpinner: false,
    showStream: turn.text.length > 0
  }
}
