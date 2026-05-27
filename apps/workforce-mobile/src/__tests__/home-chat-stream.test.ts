import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SSE streaming + R7 polish tests.
 *
 * Coverage:
 *   • `parseFrame` decodes every SSE event kind the gateway emits.
 *   • `chatTurns` reducers (applyTurnAccepted, applyMessageChunk,
 *      applyToolCall, applyProposedAction, applyStreamError, finaliseTurn)
 *      stay immutable and obey the LiveTurnKind state machine.
 *   • `streamBrainTurn` opens the SSE channel, threads events through
 *     to the caller, and resolves with `{ threadId, tokensUsed }`.
 *   • `streamBrainTurn` falls back to the legacy JSON envelope when the
 *     gateway responds with application/json instead of SSE.
 *   • `streamBrainTurn` rejects with `ApiError` when no auth token is
 *     cached (401 surface for the role-picker redirect).
 *   • `streamBrainTurn` propagates a terminal `error` SSE frame as an
 *     `ApiError` reject.
 */

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: {} } }
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined)
  }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}))

const { getAuthTokenMock } = vi.hoisted(() => ({
  getAuthTokenMock: vi.fn<() => Promise<string | null>>(async () => 'jwt-test-token')
}))

vi.mock('../auth/session', () => ({
  getAuthToken: getAuthTokenMock,
  setAuthToken: vi.fn(),
  getCachedAuthToken: vi.fn(() => null)
}))

import {
  parseFrame,
  streamBrainTurn,
  __setEventSourceModuleForTests,
  BRAIN_TURN_PATH_FOR_TESTS,
  type BrainStreamEvent
} from '../chat/brainTurn'
import {
  applyMessageChunk,
  applyProposedAction,
  applyStreamError,
  applyToolCall,
  applyTurnAccepted,
  derivePendingState,
  finaliseTurn,
  newTurnId,
  optimisticTurn,
  toPersistedSlice,
  type LiveTurn
} from '../chat/chatTurns'
import { ApiError } from '../api/errors'

interface FakeEventSourceInit {
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string
  readonly pollingInterval: number
}

type Listener =
  | { kind: 'message'; cb: (e: { data?: string }) => void }
  | { kind: 'error'; cb: (e: { message?: string; status?: number }) => void }

class FakeEventSource {
  public readonly url: string
  public readonly init: FakeEventSourceInit
  private listeners: Listener[] = []
  public closed = false

  constructor(url: string, init: FakeEventSourceInit) {
    this.url = url
    this.init = init
    instances.push(this)
  }

  addEventListener(name: 'message' | 'error', cb: (e: unknown) => void): void {
    if (name === 'message') {
      this.listeners.push({
        kind: 'message',
        cb: cb as (e: { data?: string }) => void,
      })
    } else {
      this.listeners.push({
        kind: 'error',
        cb: cb as (e: { message?: string; status?: number }) => void,
      })
    }
  }

  removeAllEventListeners(): void {
    this.listeners = []
  }

  close(): void {
    this.closed = true
  }

  emitMessage(data: string): void {
    for (const listener of this.listeners) {
      if (listener.kind === 'message') {
        ;(listener.cb as (e: { data: string }) => void)({ data })
      }
    }
  }

  emitError(payload: { message?: string; status?: number }): void {
    for (const listener of this.listeners) {
      if (listener.kind === 'error') {
        ;(listener.cb as (e: { message?: string; status?: number }) => void)(
          payload
        )
      }
    }
  }
}

const instances: FakeEventSource[] = []

function installFakeEventSource(): void {
  instances.length = 0
  __setEventSourceModuleForTests({
    default: FakeEventSource as unknown as new (
      url: string,
      init: FakeEventSourceInit
    ) => never
  } as Parameters<typeof __setEventSourceModuleForTests>[0])
}

/**
 * `streamBrainTurn` awaits `getAuthToken()` and `loadEventSource()` before
 * constructing the `FakeEventSource`, so `instances[0]` is only populated
 * after a couple of microtasks have flushed. Wait up to 50 microtasks
 * (≈ 0 ms wall time, plenty of margin for vitest) for the constructor.
 */
async function waitForInstance(): Promise<FakeEventSource> {
  for (let i = 0; i < 50; i++) {
    if (instances[0]) return instances[0]
    await Promise.resolve()
  }
  throw new Error('FakeEventSource was never constructed by streamBrainTurn')
}

function frame(record: Record<string, unknown>): string {
  return JSON.stringify(record)
}

describe('parseFrame — SSE envelope decoding', () => {
  it('decodes a turn.accepted frame and emits the threadId', () => {
    const parsed = parseFrame({ data: frame({ event: 'turn.accepted', threadId: 'thr-1' }) })
    expect(parsed?.kind).toBe('accepted')
    if (parsed && parsed.data.type === 'accepted') {
      expect(parsed.data.threadId).toBe('thr-1')
    }
  })

  it('decodes a message_chunk frame and exposes the delta', () => {
    const parsed = parseFrame({ data: frame({ event: 'message_chunk', delta: 'Karibu' }) })
    expect(parsed?.kind).toBe('message_chunk')
    if (parsed && parsed.data.type === 'message_chunk') {
      expect(parsed.data.delta).toBe('Karibu')
    }
  })

  it('decodes a tool_call frame using the strict ToolCallResult schema', () => {
    const parsed = parseFrame({
      data: frame({ event: 'tool_call', toolCall: { tool: 'cockpit.daily-brief', ok: true } })
    })
    expect(parsed?.kind).toBe('tool_call')
    if (parsed && parsed.data.type === 'tool_call') {
      expect(parsed.data.toolCall.tool).toBe('cockpit.daily-brief')
    }
  })

  it('decodes a done frame and forwards tokensUsed', () => {
    const parsed = parseFrame({
      data: frame({ event: 'done', threadId: 'thr-x', tokensUsed: 250 })
    })
    expect(parsed?.kind).toBe('done')
    if (parsed && parsed.data.type === 'done') {
      expect(parsed.data.threadId).toBe('thr-x')
      expect(parsed.data.tokensUsed).toBe(250)
    }
  })

  it('decodes an error frame and preserves code + message', () => {
    const parsed = parseFrame({
      data: frame({ event: 'error', code: 'BUDGET_EXCEEDED', message: 'Budget exceeded' })
    })
    expect(parsed?.kind).toBe('error')
    if (parsed && parsed.data.type === 'error') {
      expect(parsed.data.code).toBe('BUDGET_EXCEEDED')
    }
  })

  it('returns null for empty payloads and unknown event names', () => {
    expect(parseFrame({ data: '' })).toBeNull()
    expect(parseFrame({ data: frame({ event: 'mystery' }) })).toBeNull()
    expect(parseFrame({ data: 'not-json' })).toBeNull()
  })

  it('rejects a message_chunk frame with no delta', () => {
    const parsed = parseFrame({ data: frame({ event: 'message_chunk', delta: '' }) })
    expect(parsed).toBeNull()
  })
})

describe('chatTurns — reducer state machine', () => {
  it('optimisticTurn starts in pending state with empty text', () => {
    const t = optimisticTurn('Habari Borjie')
    expect(t.kind).toBe('pending')
    expect(t.text).toBe('')
    expect(t.userText).toBe('Habari Borjie')
    expect(t.toolCalls).toEqual([])
  })

  it('applyTurnAccepted transitions pending → streaming and binds threadId', () => {
    const t = applyTurnAccepted(optimisticTurn('hi'), 'thr-9')
    expect(t.kind).toBe('streaming')
    expect(t.threadId).toBe('thr-9')
  })

  it('applyMessageChunk concatenates deltas immutably', () => {
    const a = applyTurnAccepted(optimisticTurn('hi'), 'thr-1')
    const b = applyMessageChunk(a, 'Hab')
    const c = applyMessageChunk(b, 'ari')
    expect(c.text).toBe('Habari')
    expect(b.text).toBe('Hab')
    expect(a.text).toBe('')
  })

  it('applyToolCall appends without mutating the prior list', () => {
    const a = applyTurnAccepted(optimisticTurn('hi'), 'thr-1')
    const b = applyToolCall(a, { tool: 'cockpit.daily-brief', ok: true })
    expect(b.toolCalls).toHaveLength(1)
    expect(a.toolCalls).toHaveLength(0)
  })

  it('applyProposedAction attaches the action with its risk level', () => {
    const a = applyTurnAccepted(optimisticTurn('hi'), 'thr-1')
    const b = applyProposedAction(a, {
      verb: 'review',
      object: 'incident:safety',
      riskLevel: 'HIGH',
      reviewRequired: true
    })
    expect(b.proposedAction?.riskLevel).toBe('HIGH')
  })

  it('applyStreamError moves the turn to failed and ignores subsequent chunks', () => {
    const a = applyTurnAccepted(optimisticTurn('hi'), 'thr-1')
    const failed = applyStreamError(a, 'budget_exceeded')
    expect(failed.kind).toBe('failed')
    expect(failed.errorMessage).toBe('budget_exceeded')
    const ignored = applyMessageChunk(failed, 'oops')
    expect(ignored.text).toBe('')
    expect(ignored.kind).toBe('failed')
  })

  it('finaliseTurn projects LiveTurn → SettledTurn with stable fields', () => {
    const live = applyMessageChunk(
      applyTurnAccepted(optimisticTurn('Habari'), 'thr-7'),
      'Karibu Bwana'
    )
    const settled = finaliseTurn(live, 'thr-7', 1000)
    expect(settled.threadId).toBe('thr-7')
    expect(settled.tokensUsed).toBe(1000)
    expect(settled.responseText).toBe('Karibu Bwana')
    expect(settled.id).toBe(live.id)
  })

  it('toPersistedSlice caps to the most-recent N items', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      userText: `u${i}`,
      responseText: `r${i}`,
      toolCalls: [],
      proposedAction: null,
      citations: [],
      threadId: 'thr',
      tokensUsed: 0,
      createdAtMs: i
    }))
    expect(toPersistedSlice(items, 3)).toHaveLength(3)
    expect(toPersistedSlice(items, 3)[0]?.id).toBe('t2')
    expect(toPersistedSlice(items, 99)).toHaveLength(5)
  })

  it('newTurnId is deterministic in shape (t_<timestamp>_<random>)', () => {
    const id = newTurnId(1700000000000)
    expect(id.startsWith('t_1700000000000_')).toBe(true)
  })

  it('derivePendingState surfaces sw and en placeholder labels', () => {
    const t = optimisticTurn('hi')
    expect(derivePendingState(t, 'sw').label).toBe('Borjie anafikiri…')
    expect(derivePendingState(t, 'en').label).toBe('Borjie is thinking…')
    const accepted = applyTurnAccepted(t, 'thr-1')
    expect(derivePendingState(accepted, 'sw').showStream).toBe(false)
    const failed = applyStreamError(t, 'x')
    expect(derivePendingState(failed, 'sw').label).toMatch(/Imeshindwa/)
  })
})

describe('streamBrainTurn — happy path', () => {
  beforeEach(() => {
    getAuthTokenMock.mockReset()
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
    installFakeEventSource()
  })

  afterEach(() => {
    __setEventSourceModuleForTests(null)
  })

  it('opens an SSE channel and forwards every kind of frame', async () => {
    const seen: BrainStreamEvent[] = []
    const promise = streamBrainTurn({
      userText: 'Habari',
      threadId: null,
      onEvent: (event) => seen.push(event)
    })
    const source = await waitForInstance()
    source.emitMessage(frame({ event: 'turn.accepted', threadId: 'thr-1' }))
    source.emitMessage(frame({ event: 'message_chunk', delta: 'Karibu' }))
    source.emitMessage(
      frame({ event: 'tool_call', toolCall: { tool: 'cockpit.daily-brief', ok: true } })
    )
    source.emitMessage(frame({ event: 'done', threadId: 'thr-1', tokensUsed: 412 }))
    const result = await promise
    expect(result).toEqual({ threadId: 'thr-1', tokensUsed: 412 })
    expect(seen.map((e) => e.kind)).toEqual([
      'accepted',
      'message_chunk',
      'tool_call',
      'done'
    ])
    expect(source.closed).toBe(true)
  })

  it('forwards a proposed_action frame to the caller', async () => {
    const seen: BrainStreamEvent[] = []
    const promise = streamBrainTurn({
      userText: 'Habari',
      threadId: null,
      onEvent: (event) => seen.push(event)
    })
    const source = await waitForInstance()
    source.emitMessage(frame({ event: 'turn.accepted', threadId: 'thr-1' }))
    source.emitMessage(
      frame({
        event: 'proposed_action',
        action: { verb: 'review', object: 'x', riskLevel: 'LOW', reviewRequired: false }
      })
    )
    source.emitMessage(frame({ event: 'done', threadId: 'thr-1', tokensUsed: 0 }))
    await promise
    expect(seen.some((e) => e.kind === 'proposed_action')).toBe(true)
  })

  it('hits the canonical brain.turn path with the Authorization header', async () => {
    const promise = streamBrainTurn({
      userText: 'Habari',
      threadId: null,
      onEvent: () => undefined
    })
    const source = await waitForInstance()
    expect(source.url.endsWith(BRAIN_TURN_PATH_FOR_TESTS)).toBe(true)
    expect(source.init.headers['Authorization']).toBe('Bearer jwt-test-token')
    expect(source.init.headers['Accept']).toBe('text/event-stream')
    source.emitMessage(frame({ event: 'done', threadId: 'thr-1', tokensUsed: 0 }))
    await promise
  })

  it('includes threadId in the request body when continuing a thread', async () => {
    const promise = streamBrainTurn({
      userText: 'follow-up',
      threadId: 'thr-7',
      onEvent: () => undefined
    })
    const source = await waitForInstance()
    const body = JSON.parse(source.init.body) as Record<string, unknown>
    expect(body['threadId']).toBe('thr-7')
    expect(body['userText']).toBe('follow-up')
    source.emitMessage(frame({ event: 'done', threadId: 'thr-7', tokensUsed: 0 }))
    await promise
  })
})

describe('streamBrainTurn — failure modes', () => {
  beforeEach(() => {
    getAuthTokenMock.mockReset()
    installFakeEventSource()
  })

  afterEach(() => {
    __setEventSourceModuleForTests(null)
  })

  it('rejects with ApiError(401) when no auth token is cached', async () => {
    getAuthTokenMock.mockResolvedValue(null)
    await expect(
      streamBrainTurn({ userText: 'hi', threadId: null, onEvent: () => undefined })
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401
    })
  })

  it('rejects with ApiError when the gateway emits a terminal error frame', async () => {
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
    const promise = streamBrainTurn({
      userText: 'hi',
      threadId: null,
      onEvent: () => undefined
    })
    const source = await waitForInstance()
    source.emitMessage(
      frame({ event: 'error', code: 'BUDGET_EXCEEDED', message: 'Out of budget' })
    )
    let caught: unknown
    try {
      await promise
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).message).toBe('Out of budget')
  })

  it('falls back to the legacy JSON envelope when the gateway returns application/json', async () => {
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
    const seen: BrainStreamEvent[] = []
    const promise = streamBrainTurn({
      userText: 'hi',
      threadId: null,
      onEvent: (event) => seen.push(event)
    })
    const source = await waitForInstance()
    // Legacy JSON: the SSE client raises an `error` event with the body
    // in `message`. The fallback should parse it and synthesise the
    // equivalent stream.
    source.emitError({
      message: JSON.stringify({
        threadId: 'thr-legacy',
        responseText: 'Habari Bwana',
        toolCalls: [{ tool: 'cockpit.daily-brief', ok: true }],
        tokensUsed: 99
      })
    })
    const result = await promise
    expect(result).toEqual({ threadId: 'thr-legacy', tokensUsed: 99 })
    expect(seen.map((e) => e.kind)).toEqual([
      'accepted',
      'message_chunk',
      'tool_call',
      'done'
    ])
  })

  it('rejects when the error event carries no parseable legacy envelope', async () => {
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
    const promise = streamBrainTurn({
      userText: 'hi',
      threadId: null,
      onEvent: () => undefined
    })
    const source = await waitForInstance()
    source.emitError({ message: 'plain text error', status: 500 })
    let caught: unknown
    try {
      await promise
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(500)
  })
})

describe('R7 timing constants — match the research doc table', () => {
  // Docs/research/mobile-chat-latency-ux.md §11.3 fixes the perceived-
  // latency budget. We assert each constant so a drift trips CI before
  // pilots hit a regressed three-dot / skeleton / slow-indicator window.
  it('exposes every R7 timing the HomeChat surface relies on', async () => {
    const { R7_TIMINGS } = await import('../chat/chatTurns')
    expect(R7_TIMINGS['SKELETON_ONSET_MS']).toBe(200)
    expect(R7_TIMINGS['SLOW_INDICATOR_MS']).toBe(3_000)
    expect(R7_TIMINGS['PULSE_GRACE_MS']).toBe(400)
    expect(R7_TIMINGS['BUBBLE_ENTRY_DURATION_MS']).toBe(200)
    expect(R7_TIMINGS['SKELETON_MIN_LIFETIME_MS']).toBe(200)
    expect(R7_TIMINGS['TOKEN_STREAM_WPS']).toBe(15)
  })
})

describe('LiveTurn invariants', () => {
  it('a fresh optimistic turn always starts before any network event', () => {
    const t: LiveTurn = optimisticTurn('Karibu')
    expect(t.kind).toBe('pending')
    expect(t.threadId).toBeNull()
    expect(t.errorMessage).toBeNull()
  })
})
