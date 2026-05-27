/**
 * brainTurn — SSE-first POST /api/v1/brain/turn client.
 *
 * `postBrainTurn` is preserved verbatim so the schema-driven home-chat
 * tests pass unchanged. The chat surface migrates to `streamBrainTurn`
 * for the SSE-first UX. Backwards compatibility: when the gateway
 * responds with `application/json` (older builds), `react-native-sse`
 * raises an `error` event with the body in `message`. We parse it via
 * `BrainTurnResponseSchema` and synthesise an equivalent ordered stream
 * (`accepted → message_chunk → tool_call* → proposed_action? → done`)
 * so the HomeChat surface runs one render path regardless of transport.
 */
import { API_BASE_URL } from '../api/config'
import { ApiError } from '../api/errors'
import { getAuthToken } from '../auth/session'
import {
  BrainTurnResponseSchema,
  ProposedActionSchema,
  ToolCallResultSchema,
  type BrainTurnResponse,
  type ProposedAction,
  type ToolCallResult
} from './types'

export interface PostBrainTurnArgs {
  readonly userText: string
  readonly threadId: string | null
  readonly persona?: string
}

const BRAIN_TURN_PATH = '/api/v1/brain/turn'

export async function postBrainTurn(
  args: PostBrainTurnArgs
): Promise<BrainTurnResponse> {
  const url = `${API_BASE_URL}${BRAIN_TURN_PATH}`
  const token = await getAuthToken()
  if (!token) {
    throw new ApiError('not_authenticated', 401, url, null)
  }
  const body: Record<string, unknown> = { userText: args.userText }
  if (args.threadId !== null && args.threadId.length > 0) {
    body['threadId'] = args.threadId
  }
  if (args.persona !== undefined && args.persona.length > 0) {
    body['forcePersonaId'] = args.persona
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    })
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'network_error',
      0,
      url,
      null
    )
  }

  const raw = await response.text()
  if (!response.ok) {
    throw new ApiError(
      `brain.turn ${response.status}`,
      response.status,
      url,
      raw.slice(0, 256)
    )
  }

  let parsed: unknown
  try {
    parsed = raw.length > 0 ? JSON.parse(raw) : {}
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : 'parse_error',
      response.status,
      url,
      raw.slice(0, 256)
    )
  }

  const result = BrainTurnResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new ApiError(
      'brain.turn schema mismatch',
      response.status,
      url,
      result.error.issues
    )
  }
  return result.data
}

// ─────────────────────────────────────────────────────────────────────
// Streaming surface
// ─────────────────────────────────────────────────────────────────────

export type BrainStreamEventKind =
  | 'accepted'
  | 'message_chunk'
  | 'tool_call'
  | 'proposed_action'
  | 'done'
  | 'error'

export interface BrainStreamEvent {
  readonly kind: BrainStreamEventKind
  readonly data: BrainStreamData
}

export type BrainStreamData =
  | { readonly type: 'accepted'; readonly threadId: string }
  | { readonly type: 'message_chunk'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly toolCall: ToolCallResult }
  | { readonly type: 'proposed_action'; readonly action: ProposedAction }
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
  const url = `${API_BASE_URL}${BRAIN_TURN_PATH}`
  const token = await getAuthToken()
  if (!token) {
    throw new ApiError('not_authenticated', 401, url, null)
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
          new ApiError(parsed.data.message, 0, url, { code: parsed.data.code })
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
      safeReject(new ApiError(message, status, url, null))
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
    const parsed = ToolCallResultSchema.safeParse(candidate)
    if (!parsed.success) {
      return null
    }
    return { kind: 'tool_call', data: { type: 'tool_call', toolCall: parsed.data } }
  }
  if (eventType === 'proposed_action') {
    const candidate = record['action'] ?? record
    const parsed = ProposedActionSchema.safeParse(candidate)
    if (!parsed.success) {
      return null
    }
    return {
      kind: 'proposed_action',
      data: { type: 'proposed_action', action: parsed.data }
    }
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
  for (const toolCall of envelope.toolCalls) {
    events.push({
      kind: 'tool_call',
      data: { type: 'tool_call', toolCall }
    })
  }
  if (envelope.proposedAction) {
    events.push({
      kind: 'proposed_action',
      data: { type: 'proposed_action', action: envelope.proposedAction }
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
