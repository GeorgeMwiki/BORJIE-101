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

    source.addEventListener('message', (event: RNEventMessage) => {
      const parsed = parseFrame(event)
      if (parsed === null) {
        return
      }
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

interface RNEventSource {
  addEventListener(name: 'message', cb: (e: RNEventMessage) => void): void
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
  if (eventType === 'message_chunk') {
    const delta = typeof record['delta'] === 'string' ? record['delta'] : ''
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
