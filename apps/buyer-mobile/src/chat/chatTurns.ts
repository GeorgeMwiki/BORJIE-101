/**
 * chatTurns — pure state machines + R7 timing constants for the
 * streaming buyer HomeChat surface.
 *
 * Mirrors the workforce-mobile reducer model but uses the buyer
 * `ChatTurn` (role/text). The HomeChat surface keeps at most one
 * `LiveTurn` in flight and an array of `SettledTurn` for history.
 */

import type { ToolCall } from './types'

export const R7_TIMINGS = Object.freeze({
  SKELETON_ONSET_MS: 200,
  PULSE_GRACE_MS: 400,
  SLOW_INDICATOR_MS: 3_000,
  BUBBLE_ENTRY_DURATION_MS: 200,
  SKELETON_MIN_LIFETIME_MS: 200,
  TOKEN_STREAM_WPS: 15
}) as Readonly<Record<string, number>>

export interface Citation {
  readonly id: string
  readonly label: string
}

export type LiveTurnKind =
  | 'pending'
  | 'streaming'
  | 'streaming-complete'
  | 'failed'

export interface LiveTurn {
  readonly id: string
  readonly userText: string
  readonly threadId: string | null
  readonly text: string
  readonly toolCalls: ReadonlyArray<ToolCall>
  readonly citations: ReadonlyArray<Citation>
  readonly kind: LiveTurnKind
  readonly errorMessage: string | null
  readonly startedAtMs: number
}

export interface SettledTurn {
  readonly id: string
  readonly userText: string
  readonly responseText: string
  readonly toolCalls: ReadonlyArray<ToolCall>
  readonly citations: ReadonlyArray<Citation>
  readonly threadId: string
  readonly tokensUsed: number
  readonly createdAtMs: number
}

export function newTurnId(now: number = Date.now()): string {
  return `b_${now}_${Math.random().toString(36).slice(2, 8)}`
}

export function optimisticTurn(userText: string, now: number = Date.now()): LiveTurn {
  return {
    id: newTurnId(now),
    userText,
    threadId: null,
    text: '',
    toolCalls: [],
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

export function applyToolCall(turn: LiveTurn, call: ToolCall): LiveTurn {
  if (turn.kind === 'failed') {
    return turn
  }
  return {
    ...turn,
    toolCalls: [...turn.toolCalls, call]
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
    citations: turn.citations,
    threadId,
    tokensUsed,
    createdAtMs: now
  }
}

/**
 * Smart-reply chip mapper. After each brain response, derive up to 3
 * follow-up prompts from the first tool call's name. Static mapping —
 * the brain-side `/brain/suggest` endpoint lands in v2 (research
 * doc §3.2 deferred to v2 per §11.5).
 */
export function smartReplyChips(
  toolCallName: string | null,
  lang: 'sw' | 'en'
): ReadonlyArray<{ readonly id: string; readonly label: string; readonly prompt: string }> {
  if (toolCallName === null) {
    return []
  }
  const sw = lang === 'sw'
  if (toolCallName === 'marketplace.recommended') {
    return [
      { id: 'narrow-region', label: sw ? 'Eneo gani?' : 'Which region?', prompt: sw ? 'Onyesha za Geita pekee' : 'Show Geita only' },
      { id: 'narrow-grade', label: sw ? 'Daraja la juu' : 'Higher grade', prompt: sw ? 'Onyesha za daraja juu zaidi' : 'Show higher grade parcels' }
    ]
  }
  if (toolCallName === 'bids.active') {
    return [
      { id: 'recommend', label: sw ? 'Bei sahihi?' : 'Right price?', prompt: sw ? 'Pendekeza bei nzuri' : 'Recommend a fair price' },
      { id: 'pipeline', label: sw ? 'Deal zinazoendelea' : 'Active deals', prompt: sw ? 'Onyesha deal zinazoendelea' : 'Show active deals' }
    ]
  }
  if (toolCallName === 'kyc.status') {
    return [
      { id: 'next-step', label: sw ? 'Hatua inayofuata?' : 'Next step?', prompt: sw ? 'KYC inahitaji nini sasa?' : 'What does KYC need next?' }
    ]
  }
  return []
}

export function shouldAutoScroll(
  scrollY: number,
  contentHeight: number,
  viewportHeight: number,
  threshold: number = 80
): boolean {
  const distanceFromBottom = contentHeight - (scrollY + viewportHeight)
  return distanceFromBottom <= threshold
}
