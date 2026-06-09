/**
 * brainTurn — SSE-first POST /api/v1/brain/turn client for buyer-mobile.
 *
 * `postBrainTurn` is preserved verbatim so the existing schema-driven
 * home-chat tests keep passing. The chat surface consumes
 * `streamBrainTurn` for the SSE-first perceived-latency UX.
 *
 * Backwards compatibility: when the gateway responds with
 * `application/json` (older builds), `react-native-sse` raises an
 * `error` event with the body in `message`. We parse it via the legacy
 * envelope and synthesise an equivalent ordered stream so the HomeChat
 * surface runs one render path regardless of transport.
 */
import { apiConfig } from '@/api/config'
import { apiFetch } from '@/api/client'
import { ApiError } from '@/api/errors'
import { getAuthToken } from '@/auth/token'
import {
  BrainTurnRequest,
  BrainTurnRequestSchema,
  BrainTurnResponse,
  BrainTurnResponseSchema,
  ToolCallSchema,
  type ToolCall
} from './types'

const BRAIN_TURN_PATH = '/api/v1/brain/turn'

export async function postBrainTurn(input: BrainTurnRequest): Promise<BrainTurnResponse> {
  const parsedInput = BrainTurnRequestSchema.parse(input)
  const raw = await apiFetch<unknown>(BRAIN_TURN_PATH, {
    method: 'POST',
    body: parsedInput
  })
  const parsed = BrainTurnResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('brain_turn_invalid_response')
  }
  return parsed.data
}

// ─────────────────────────────────────────────────────────────────────
// Streaming surface
// ─────────────────────────────────────────────────────────────────────

export type BrainStreamEventKind =
  | 'accepted'
  | 'ack'
  | 'message_chunk'
  | 'tool_call'
  | 'done'
  | 'error'

export interface BrainStreamEvent {
  readonly kind: BrainStreamEventKind
  readonly data: BrainStreamData
}

export type BrainStreamData =
  | { readonly type: 'accepted'; readonly threadId: string }
  /**
   * Ack-fast: deterministic sub-100 ms Swahili-first placeholder emitted
   * by the gateway before any orchestrator work. The HomeChat surface
   * renders this as the first assistant-bubble fragment so the user sees
   * a "thinking…" bubble inside one frame of pressing Send. See
   * `Docs/RESEARCH/mobile-chat-latency-ux.md` §4.2 / §11 (SHIPPED).
   */
  | { readonly type: 'ack'; readonly text: string; readonly lang: 'sw' | 'en' }
  | { readonly type: 'message_chunk'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly toolCall: ToolCall }
  | { readonly type: 'done'; readonly threadId: string; readonly tokensUsed: number }
  | { readonly type: 'error'; readonly code: string; readonly message: string }

export interface StreamBrainTurnArgs {
  readonly userText: string
  readonly threadId: string | null
  readonly persona?: string
  readonly onEvent: (event: BrainStreamEvent) => void
}

export interface StreamBrainTurnResult {
  readonly threadId: string
  readonly tokensUsed: number
}

export async function streamBrainTurn(
  args: StreamBrainTurnArgs
): Promise<StreamBrainTurnResult> {
  const url = `${apiConfig.baseUrl}${BRAIN_TURN_PATH}`
  const token = await getAuthToken()
  if (!token) {
    throw new ApiError({
      status: 401,
      code: 'NOT_AUTHENTICATED',
      message: 'not_authenticated',
      url
    })
  }

  const body: Record<string, unknown> = { userText: args.userText }
  if (args.threadId !== null && args.threadId.length > 0) {
    body['threadId'] = args.threadId
  }
  if (args.persona !== undefined && args.persona.length > 0) {
    body['forcePersonaId'] = args.persona
  }

  const mod = await loadEventSource()
  const EventSourceCtor = mod.default

  return new Promise<StreamBrainTurnResult>((resolve, reject) => {
    const source = new EventSourceCtor(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body),
      pollingInterval: 0
    }) as RNEventSource

    let resolvedThreadId = args.threadId ?? ''
    let totalTokens = 0
    let settled = false

    const safeResolve = (value: StreamBrainTurnResult): void => {
      if (settled) {
        return
      }
      settled = true
      try {
        source.removeAllEventListeners()
        source.close()
      } catch {
        // best-effort
      }
      resolve(value)
    }

    const safeReject = (reason: ApiError): void => {
      if (settled) {
        return
      }
      settled = true
      try {
        source.removeAllEventListeners()
        source.close()
      } catch {
        // best-effort
      }
      reject(reason)
    }

    // Dispatch helper: process a parsed event and advance the stream state.
    function handleParsed(parsed: BrainStreamEvent): void {
      if (parsed.kind === 'accepted' && parsed.data.type === 'accepted') {
        resolvedThreadId = parsed.data.threadId
      }
      if (parsed.kind === 'done' && parsed.data.type === 'done') {
        resolvedThreadId = parsed.data.threadId
        totalTokens = parsed.data.tokensUsed
      }
      args.onEvent(parsed)
      if (parsed.kind === 'done') {
        safeResolve({ threadId: resolvedThreadId, tokensUsed: totalTokens })
        return
      }
      if (parsed.kind === 'error' && parsed.data.type === 'error') {
        safeReject(
          new ApiError({
            status: 0,
            code: parsed.data.code,
            message: parsed.data.message,
            url
          })
        )
      }
    }

    // Register a listener for each named SSE event the gateway emits.
    // react-native-sse dispatches named events (event: <name>\ndata: ...)
    // ONLY to a listener registered under that exact name. The generic
    // 'message' listener receives only unnamed frames (no event: line).
    // Each named listener receives { data: <json string> } where the JSON
    // payload contains the frame fields WITHOUT an 'event' key.
    const namedEvents: readonly string[] = [
      'turn.accepted',
      'ack',
      'message_chunk',
      'tool_call',
      'done',
      'error'
    ]
    for (const eventName of namedEvents) {
      source.addEventListener(eventName, (event: RNEventMessage) => {
        if (settled) {
          return
        }
        const payload = typeof event.data === 'string' ? event.data : ''
        if (payload.length === 0) {
          return
        }
        let record: Record<string, unknown>
        try {
          const raw = JSON.parse(payload) as unknown
          if (typeof raw !== 'object' || raw === null) {
            return
          }
          record = raw as Record<string, unknown>
        } catch {
          return
        }
        const parsed = parseTypedFrame(eventName, record)
        if (parsed !== null) {
          handleParsed(parsed)
        }
      })
    }

    // Generic 'message' listener handles unnamed frames and also serves as
    // the path for test mocks that inject { event: '...', ... } inside the
    // data JSON (the FakeEventSource in tests routes everything to 'message').
    source.addEventListener('message', (event: RNEventMessage) => {
      if (settled) {
        return
      }
      const parsed = parseFrame(event)
      if (parsed === null) {
        return
      }
      handleParsed(parsed)
    })

    source.addEventListener('error', (event: RNEventError) => {
      const fallback = tryLegacyJsonFallback(event)
      if (fallback) {
        for (const evt of fallback.events) {
          if (settled) {
            break
          }
          args.onEvent(evt)
        }
        safeResolve(fallback.result)
        return
      }
      const status = typeof event.status === 'number' ? event.status : 0
      const message = typeof event.message === 'string' ? event.message : 'stream_error'
      safeReject(
        new ApiError({ status, code: 'STREAM_ERROR', message, url })
      )
    })
  })
}

// ─────────────────────────────────────────────────────────────────────
// SSE parsing helpers
// ─────────────────────────────────────────────────────────────────────

interface RNEventMessage {
  readonly type?: string
  readonly data?: string | null
}

interface RNEventError {
  readonly type?: string
  readonly status?: number
  readonly message?: string
}

/**
 * Named SSE events are dispatched to a listener registered under the event
 * type name (e.g. 'message_chunk'), NOT to the generic 'message' listener.
 * react-native-sse@1.2.x dispatches `event: message_chunk` frames ONLY to
 * a listener registered as addEventListener('message_chunk', ...).
 */
interface RNEventSource {
  addEventListener(name: string, cb: (e: RNEventMessage) => void): void
  addEventListener(name: 'error', cb: (e: RNEventError) => void): void
  removeAllEventListeners(): void
  close(): void
}

interface EventSourceModule {
  readonly default: new (
    url: string,
    init: {
      readonly method: string
      readonly headers: Record<string, string>
      readonly body: string
      readonly pollingInterval: number
    }
  ) => RNEventSource
}

let cachedEventSourceModule: EventSourceModule | null = null

async function loadEventSource(): Promise<EventSourceModule> {
  if (cachedEventSourceModule !== null) {
    return cachedEventSourceModule
  }
  const mod = (await import('react-native-sse')) as unknown as EventSourceModule
  cachedEventSourceModule = mod
  return mod
}

export function __setEventSourceModuleForTests(mod: EventSourceModule | null): void {
  cachedEventSourceModule = mod
}

export function parseFrame(event: RNEventMessage): BrainStreamEvent | null {
  const payload = event.data
  if (typeof payload !== 'string' || payload.length === 0) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const record = parsed as Record<string, unknown>
  const eventType = typeof record['event'] === 'string' ? record['event'] : null
  if (eventType === null) {
    return null
  }
  return parseTypedFrame(eventType, record)
}

function parseTypedFrame(
  eventType: string,
  record: Record<string, unknown>
): BrainStreamEvent | null {
  if (eventType === 'turn.accepted') {
    const threadId = typeof record['threadId'] === 'string' ? record['threadId'] : ''
    if (threadId.length === 0) {
      return null
    }
    return { kind: 'accepted', data: { type: 'accepted', threadId } }
  }
  if (eventType === 'ack') {
    const text = typeof record['text'] === 'string' ? record['text'] : ''
    if (text.length === 0) {
      return null
    }
    const langRaw = typeof record['lang'] === 'string' ? record['lang'] : 'sw'
    const lang: 'sw' | 'en' = langRaw === 'en' ? 'en' : 'sw'
    return { kind: 'ack', data: { type: 'ack', text, lang } }
  }
  if (eventType === 'message_chunk') {
    // Gateway emits `text` in the data payload for named SSE events.
    // Legacy test mocks may use `delta`; accept both for backward compat.
    const delta =
      typeof record['text'] === 'string' && record['text'].length > 0
        ? record['text']
        : typeof record['delta'] === 'string'
          ? record['delta']
          : ''
    if (delta.length === 0) {
      return null
    }
    return { kind: 'message_chunk', data: { type: 'message_chunk', delta } }
  }
  if (eventType === 'tool_call') {
    const candidate = record['toolCall'] ?? record['call'] ?? record
    const parsed = ToolCallSchema.safeParse(candidate)
    if (!parsed.success) {
      return null
    }
    return { kind: 'tool_call', data: { type: 'tool_call', toolCall: parsed.data } }
  }
  if (eventType === 'done') {
    const threadId = typeof record['threadId'] === 'string' ? record['threadId'] : ''
    const tokensUsed = typeof record['tokensUsed'] === 'number' ? record['tokensUsed'] : 0
    return { kind: 'done', data: { type: 'done', threadId, tokensUsed } }
  }
  if (eventType === 'error') {
    const code = typeof record['code'] === 'string' ? record['code'] : 'stream_error'
    const message =
      typeof record['message'] === 'string' ? record['message'] : 'stream_error'
    return { kind: 'error', data: { type: 'error', code, message } }
  }
  return null
}

interface LegacyFallback {
  readonly events: ReadonlyArray<BrainStreamEvent>
  readonly result: StreamBrainTurnResult
}

function tryLegacyJsonFallback(event: RNEventError): LegacyFallback | null {
  const text = typeof event.message === 'string' ? event.message : ''
  if (text.length === 0) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const validated = BrainTurnResponseSchema.safeParse(parsed)
  if (!validated.success) {
    return null
  }
  const envelope = validated.data
  const events: BrainStreamEvent[] = [
    { kind: 'accepted', data: { type: 'accepted', threadId: envelope.threadId } }
  ]
  if (envelope.responseText.length > 0) {
    events.push({
      kind: 'message_chunk',
      data: { type: 'message_chunk', delta: envelope.responseText }
    })
  }
  for (const toolCall of envelope.toolCalls ?? []) {
    events.push({
      kind: 'tool_call',
      data: { type: 'tool_call', toolCall }
    })
  }
  events.push({
    kind: 'done',
    data: {
      type: 'done',
      threadId: envelope.threadId,
      tokensUsed: envelope.tokensUsed ?? 0
    }
  })
  return {
    events,
    result: {
      threadId: envelope.threadId,
      tokensUsed: envelope.tokensUsed ?? 0
    }
  }
}

export const BRAIN_TURN_PATH_FOR_TESTS = BRAIN_TURN_PATH
