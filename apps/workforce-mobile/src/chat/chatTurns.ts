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
import type { BrainGroundingSignal } from './brainTurn'

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
  /**
   * Evidence-chain grounding verdict from the terminal `auditor` frame.
   * Null until the verdict arrives (and on legacy wires that predate it) —
   * consumers must handle null. Surfaced as a warning when the answer was
   * ungrounded (`groundingFault` or a non-null `evidenceWarning`).
   */
  readonly grounding?: BrainGroundingSignal | null
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
  /** Evidence-chain grounding verdict for this answer, when the gateway
   *  surfaced one. Null on legacy wires that predate the `auditor` frame. */
  readonly grounding?: BrainGroundingSignal | null
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

/**
 * applyAuditor — attach the terminal evidence-chain grounding verdict.
 * A failed turn keeps its state; otherwise the verdict is recorded so the
 * bubble can render a grounding warning when the answer was ungrounded.
 */
export function applyAuditor(
  turn: LiveTurn,
  grounding: BrainGroundingSignal
): LiveTurn {
  if (turn.kind === 'failed') {
    return turn
  }
  return {
    ...turn,
    grounding
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
    createdAtMs: now,
    grounding: turn.grounding ?? null
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
 * Smart-reply chip mapper — LitFin parity with buyer-mobile. After each
 * brain response we derive up to two follow-up prompts from the first
 * tool call's `tool` id. Static mapping (the brain-side `/brain/suggest`
 * endpoint lands in v2 per the mobile-chat-latency research §11.5).
 *
 * Bilingual by construction: each chip carries the active-locale label +
 * prompt. The caller passes the resolved `lang` so a single language
 * renders per surface — no widget-only language state, no mixing.
 */
/** A single chip's bilingual `{ sw, en }` label + prompt pair. */
interface ChipCopy {
  readonly id: string
  readonly label: { readonly sw: string; readonly en: string }
  readonly prompt: { readonly sw: string; readonly en: string }
}

/**
 * Per-tool quick-reply chip copy, authored as `{ sw, en }` pairs so the active
 * locale selects ONE language (a data-field pick — no inline bilingual ternary).
 */
const SMART_REPLY_CHIPS: Readonly<Record<string, ReadonlyArray<ChipCopy>>> = {
  'cockpit.daily-brief': [
    {
      id: 'brief-cash',
      label: { sw: 'Hela na muda', en: 'Cash and runway' },
      prompt: { sw: 'Onyesha hela na muda', en: 'Show cash and runway' },
    },
    {
      id: 'brief-decisions',
      label: { sw: 'Maamuzi', en: 'Decisions' },
      prompt: { sw: 'Maamuzi yanayosubiri', en: 'Pending decisions' },
    },
  ],
  'attendance.crew': [
    {
      id: 'crew-late',
      label: { sw: 'Waliochelewa', en: 'Who is late' },
      prompt: { sw: 'Nani amechelewa leo?', en: 'Who is late today?' },
    },
    {
      id: 'crew-shift',
      label: { sw: 'Shifti', en: 'Shift' },
      prompt: { sw: 'Onyesha shifti ya leo', en: 'Show today’s shift' },
    },
  ],
  'tasks.today': [
    {
      id: 'tasks-next',
      label: { sw: 'Kazi inayofuata', en: 'Next task' },
      prompt: { sw: 'Kazi yangu inayofuata ni ipi?', en: 'What is my next task?' },
    },
  ],
  'attendance.shift': [
    {
      id: 'shift-clock',
      label: { sw: 'Ingia kazini', en: 'Clock in' },
      prompt: { sw: 'Nataka kuingia kazini', en: 'I want to clock in' },
    },
  ],
  'incidents.exceptions': [
    {
      id: 'inc-report',
      label: { sw: 'Ripoti tukio', en: 'Report an issue' },
      prompt: { sw: 'Nataka kuripoti tukio', en: 'I want to report an issue' },
    },
  ],
  'performance.snapshot': [
    {
      id: 'perf-improve',
      label: { sw: 'Niboreshe vipi?', en: 'How to improve?' },
      prompt: { sw: 'Naweza kuboresha vipi?', en: 'How can I improve?' },
    },
  ],
}

export function smartReplyChips(
  toolName: string | null,
  lang: 'sw' | 'en'
): ReadonlyArray<{ readonly id: string; readonly label: string; readonly prompt: string }> {
  if (toolName === null) {
    return []
  }
  const chips = SMART_REPLY_CHIPS[toolName]
  if (!chips) {
    return []
  }
  return chips.map((chip) => ({
    id: chip.id,
    label: chip.label[lang],
    prompt: chip.prompt[lang],
  }))
}

/**
 * `shouldAutoScroll` — LitFin parity. Only snap the chat to the bottom
 * when the user is already near it (within `threshold` px), so reading
 * earlier turns while a new one streams never yanks the viewport.
 */
export function shouldAutoScroll(
  scrollY: number,
  contentHeight: number,
  viewportHeight: number,
  threshold: number = 80
): boolean {
  const distanceFromBottom = contentHeight - (scrollY + viewportHeight)
  return distanceFromBottom <= threshold
}

/**
 * Single-language pending/failed labels per locale (a data-field pick — no
 * inline bilingual copy). One language per active locale; never both.
 */
const PENDING_STATE_COPY: Readonly<
  Record<'failed' | 'pending', { readonly sw: string; readonly en: string }>
> = {
  failed: { sw: 'Imeshindwa. Gusa kuanza tena.', en: 'Failed. Tap to retry.' },
  pending: { sw: 'Borjie anafikiri…', en: 'Borjie is thinking…' },
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
      label: PENDING_STATE_COPY.failed[lang],
      showSpinner: false,
      showStream: false
    }
  }
  if (turn.kind === 'pending') {
    return {
      label: PENDING_STATE_COPY.pending[lang],
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
