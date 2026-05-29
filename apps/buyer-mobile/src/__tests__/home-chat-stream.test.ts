import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Buyer-mobile SSE streaming + R7 polish tests.
 *
 * Coverage:
 *   • `parseFrame` decodes every SSE event kind buyer-mobile cares about.
 *   • `chatTurns` reducers stay immutable and obey the state machine.
 *   • `streamBrainTurn` opens the channel, forwards events, resolves on
 *     `done`, rejects on terminal `error` / missing auth.
 *   • `streamBrainTurn` falls back to legacy JSON.
 *   • `smartReplyChips` derives 2-3 follow-up prompts from the last
 *     tool call name (R7 §3.2 static mapping for v1).
 *   • `shouldAutoScroll` only fires when the user is at the bottom
 *     (R7 §11.2.b — no yanking the viewport while reading earlier
 *     turns).
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

vi.mock('@/auth/token', () => ({
  getAuthToken: getAuthTokenMock,
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn()
}))

import {
  parseFrame,
  streamBrainTurn,
  __setEventSourceModuleForTests,
  BRAIN_TURN_PATH_FOR_TESTS,
  type BrainStreamEvent
} from '../chat/brainTurn'
import {
  applyAck,
  applyMessageChunk,
  applyStreamError,
  applyToolCall,
  applyTurnAccepted,
  finaliseTurn,
  newTurnId,
  optimisticTurn,
  shouldAutoScroll,
  smartReplyChips,
  R7_TIMINGS,
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
        cb: cb as (e: { data?: string }) => void
      })
    } else {
      this.listeners.push({
        kind: 'error',
        cb: cb as (e: { message?: string; status?: number }) => void
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
        ;(listener.cb as (e: { message?: string; status?: number }) => void)(payload)
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

describe('parseFrame — SSE envelope decoding (buyer)', () => {
  it('decodes a turn.accepted frame and emits the threadId', () => {
    const parsed = parseFrame({ data: frame({ event: 'turn.accepted', threadId: 'thr-1' }) })
    expect(parsed?.kind).toBe('accepted')
    if (parsed && parsed.data.type === 'accepted') {
      expect(parsed.data.threadId).toBe('thr-1')
    }
  })

  it('decodes an ack-fast frame with sw text + lang (G1 / G4)', () => {
    const parsed = parseFrame({
      data: frame({ event: 'ack', text: 'Karibu, ninafikiri…', lang: 'sw' })
    })
    expect(parsed?.kind).toBe('ack')
    if (parsed && parsed.data.type === 'ack') {
      expect(parsed.data.text).toBe('Karibu, ninafikiri…')
      expect(parsed.data.lang).toBe('sw')
    }
  })

  it('decodes an ack-fast frame in English', () => {
    const parsed = parseFrame({
      data: frame({ event: 'ack', text: 'Got it, thinking…', lang: 'en' })
    })
    expect(parsed?.kind).toBe('ack')
    if (parsed && parsed.data.type === 'ack') {
      expect(parsed.data.lang).toBe('en')
    }
  })

  it('returns null for an ack-fast frame with empty text', () => {
    expect(parseFrame({ data: frame({ event: 'ack', text: '', lang: 'sw' }) })).toBeNull()
  })

  it('decodes a message_chunk frame and exposes the delta', () => {
    const parsed = parseFrame({ data: frame({ event: 'message_chunk', delta: 'Karibu' }) })
    expect(parsed?.kind).toBe('message_chunk')
  })

  it('decodes a tool_call frame using the buyer ToolCall schema', () => {
    const parsed = parseFrame({
      data: frame({
        event: 'tool_call',
        toolCall: { name: 'marketplace.recommended', result: { listings: [] } }
      })
    })
    expect(parsed?.kind).toBe('tool_call')
    if (parsed && parsed.data.type === 'tool_call') {
      expect(parsed.data.toolCall.name).toBe('marketplace.recommended')
    }
  })

  it('decodes a done frame with tokensUsed', () => {
    const parsed = parseFrame({
      data: frame({ event: 'done', threadId: 'thr-1', tokensUsed: 99 })
    })
    expect(parsed?.kind).toBe('done')
    if (parsed && parsed.data.type === 'done') {
      expect(parsed.data.tokensUsed).toBe(99)
    }
  })

  it('decodes an error frame with code + message', () => {
    const parsed = parseFrame({
      data: frame({ event: 'error', code: 'BUDGET_EXCEEDED', message: 'Out of budget' })
    })
    expect(parsed?.kind).toBe('error')
    if (parsed && parsed.data.type === 'error') {
      expect(parsed.data.code).toBe('BUDGET_EXCEEDED')
    }
  })

  it('returns null for empty data and unknown event names', () => {
    expect(parseFrame({ data: '' })).toBeNull()
    expect(parseFrame({ data: frame({ event: 'mystery' }) })).toBeNull()
    expect(parseFrame({ data: 'not-json' })).toBeNull()
  })
})

describe('chatTurns — buyer reducer state machine', () => {
  it('optimisticTurn starts in pending with empty text', () => {
    const t = optimisticTurn('Habari')
    expect(t.kind).toBe('pending')
    expect(t.text).toBe('')
    expect(t.toolCalls).toEqual([])
  })

  it('applyTurnAccepted sets threadId and moves to streaming', () => {
    const t = applyTurnAccepted(optimisticTurn('hi'), 'thr-9')
    expect(t.kind).toBe('streaming')
    expect(t.threadId).toBe('thr-9')
  })

  it('applyAck seeds the assistant bubble with the placeholder + flags it', () => {
    const t = applyAck(optimisticTurn('hi'), 'Karibu, ninafikiri…')
    expect(t.text).toBe('Karibu, ninafikiri…')
    expect(t.isAckText).toBe(true)
    expect(t.kind).toBe('streaming')
  })

  it('applyMessageChunk REPLACES the ack-fast placeholder on first real delta', () => {
    const seeded = applyAck(optimisticTurn('hi'), 'Karibu, ninafikiri…')
    const real = applyMessageChunk(seeded, 'Salaam,')
    expect(real.text).toBe('Salaam,') // ack was replaced, not concatenated
    expect(real.isAckText).toBe(false)
    const more = applyMessageChunk(real, ' rafiki')
    expect(more.text).toBe('Salaam, rafiki')
  })

  it('applyAck is a no-op once the bubble already has real text', () => {
    const seeded = applyAck(optimisticTurn('hi'), 'Karibu, ninafikiri…')
    const withReal = applyMessageChunk(seeded, 'Real reply text')
    const reAck = applyAck(withReal, 'Another ack')
    expect(reAck.text).toBe('Real reply text') // not overwritten
  })

  it('applyMessageChunk concatenates deltas immutably', () => {
    const a = applyTurnAccepted(optimisticTurn('hi'), 'thr-1')
    const b = applyMessageChunk(a, 'Hab')
    const c = applyMessageChunk(b, 'ari')
    expect(c.text).toBe('Habari')
    expect(b.text).toBe('Hab')
    expect(a.text).toBe('')
  })

  it('applyToolCall appends without mutating', () => {
    const a = applyTurnAccepted(optimisticTurn('hi'), 'thr-1')
    const b = applyToolCall(a, { name: 'marketplace.recommended' })
    expect(b.toolCalls).toHaveLength(1)
    expect(a.toolCalls).toHaveLength(0)
  })

  it('applyStreamError marks failed and freezes subsequent applies', () => {
    const a = applyTurnAccepted(optimisticTurn('hi'), 'thr-1')
    const failed = applyStreamError(a, 'budget_exceeded')
    expect(failed.kind).toBe('failed')
    const ignored = applyMessageChunk(failed, 'oops')
    expect(ignored.text).toBe('')
  })

  it('finaliseTurn projects LiveTurn → SettledTurn', () => {
    const live = applyMessageChunk(applyTurnAccepted(optimisticTurn('Habari'), 'thr-1'), 'Karibu')
    const settled = finaliseTurn(live, 'thr-1', 200)
    expect(settled.threadId).toBe('thr-1')
    expect(settled.responseText).toBe('Karibu')
    expect(settled.tokensUsed).toBe(200)
  })

  it('newTurnId produces a deterministic prefix', () => {
    expect(newTurnId(1700000000000).startsWith('b_1700000000000_')).toBe(true)
  })

  it('LiveTurn invariants on a fresh optimistic turn', () => {
    const t: LiveTurn = optimisticTurn('K')
    expect(t.threadId).toBeNull()
    expect(t.errorMessage).toBeNull()
  })
})

describe('smartReplyChips — static R7 §3.2 mapping for v1', () => {
  it('returns empty list when no tool call is present', () => {
    expect(smartReplyChips(null, 'sw')).toEqual([])
  })

  it('maps marketplace.recommended to region / grade follow-ups', () => {
    const chips = smartReplyChips('marketplace.recommended', 'sw')
    expect(chips).toHaveLength(2)
    expect(chips[0]?.id).toBe('narrow-region')
  })

  it('maps bids.active to recommend / pipeline follow-ups', () => {
    const chips = smartReplyChips('bids.active', 'en')
    expect(chips).toHaveLength(2)
    expect(chips[0]?.label).toMatch(/price/)
  })

  it('returns empty list for unknown tool name', () => {
    expect(smartReplyChips('marketplace.unknown', 'sw')).toEqual([])
  })
})

describe('shouldAutoScroll — only when at-bottom (R7 §11.2.b)', () => {
  it('returns true when within the default 80 px threshold', () => {
    expect(shouldAutoScroll(900, 1000, 100)).toBe(true)
  })

  it('returns false when the user has scrolled up past the threshold', () => {
    expect(shouldAutoScroll(500, 1000, 100)).toBe(false)
  })

  it('honours a custom threshold', () => {
    expect(shouldAutoScroll(800, 1000, 100, 200)).toBe(true)
    expect(shouldAutoScroll(500, 1000, 100, 200)).toBe(false)
  })
})

describe('R7 timing constants — match the research doc (buyer)', () => {
  it('exposes every value the HomeChat surface relies on', () => {
    expect(R7_TIMINGS['SKELETON_ONSET_MS']).toBe(200)
    expect(R7_TIMINGS['SLOW_INDICATOR_MS']).toBe(3_000)
    expect(R7_TIMINGS['PULSE_GRACE_MS']).toBe(400)
    expect(R7_TIMINGS['BUBBLE_ENTRY_DURATION_MS']).toBe(200)
    expect(R7_TIMINGS['SKELETON_MIN_LIFETIME_MS']).toBe(200)
    expect(R7_TIMINGS['TOKEN_STREAM_WPS']).toBe(15)
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

  it('opens the SSE channel, forwards frames, resolves on done', async () => {
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
      frame({
        event: 'tool_call',
        toolCall: { name: 'marketplace.recommended', result: { listings: [] } }
      })
    )
    source.emitMessage(frame({ event: 'done', threadId: 'thr-1', tokensUsed: 250 }))
    const result = await promise
    expect(result).toEqual({ threadId: 'thr-1', tokensUsed: 250 })
    expect(seen.map((e) => e.kind)).toEqual([
      'accepted',
      'message_chunk',
      'tool_call',
      'done'
    ])
    expect(source.closed).toBe(true)
  })

  it('hits the canonical brain.turn path with Authorization header', async () => {
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

  it('includes threadId in the body for follow-up turns', async () => {
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

  it('falls back to the legacy JSON envelope when SSE is unavailable', async () => {
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
    const seen: BrainStreamEvent[] = []
    const promise = streamBrainTurn({
      userText: 'hi',
      threadId: null,
      onEvent: (event) => seen.push(event)
    })
    const source = await waitForInstance()
    source.emitError({
      message: JSON.stringify({
        threadId: 'thr-legacy',
        responseText: 'Habari Mnunuzi',
        toolCalls: [
          { name: 'marketplace.recommended', result: { listings: [] } }
        ],
        tokensUsed: 77
      })
    })
    const result = await promise
    expect(result).toEqual({ threadId: 'thr-legacy', tokensUsed: 77 })
    expect(seen.map((e) => e.kind)).toEqual([
      'accepted',
      'message_chunk',
      'tool_call',
      'done'
    ])
  })

  it('rejects with status when error event carries no parseable envelope', async () => {
    getAuthTokenMock.mockResolvedValue('jwt-test-token')
    const promise = streamBrainTurn({
      userText: 'hi',
      threadId: null,
      onEvent: () => undefined
    })
    const source = await waitForInstance()
    source.emitError({ message: 'plain text error', status: 503 })
    let caught: unknown
    try {
      await promise
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).status).toBe(503)
  })
})
