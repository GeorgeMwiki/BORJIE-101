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
 *
 * NAMED-EVENT WIRE FORMAT (cm-1 fix):
 * The gateway emits Hono named SSE events:
 *   event: turn.accepted    data: {"threadId":"..."}
 *   event: message_chunk    data: {"text":"...","done":false}
 *   event: ack              data: {"threadId":"..."}
 *   event: tool_call        data: {"tool":"...","status":"started"|"ok"|"error","args":{...}}
 *   (proposed_action is embedded in message_chunk as data.proposedAction, NOT a separate event)
 *   event: done             data: {"threadId":"...","tokensUsed":N}
 *   event: error            data: {"code":"...","message":"..."}
 *
 * react-native-sse routes named events to per-name listeners only — a
 * generic 'message' listener never fires for these. We register
 * addEventListener for EACH named event type.
 *
 * The data JSON payload uses the field `text` (not `delta`) for
 * message_chunk frames. `parseNamedFrame` reads accordingly; the
 * `delta` alias is kept for backward compat with any legacy emitters
 * and the legacy-JSON-fallback path.
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
  | 'auditor'
  | 'done'
  | 'error'

export interface BrainStreamEvent {
  readonly kind: BrainStreamEventKind
  readonly data: BrainStreamData
}

/**
 * The evidence-chain Auditor grounding verdict for a turn. Mirrors the
 * owner-web `ChatGroundingSignal` contract (apps/owner-web/src/lib/types/
 * chat.ts) and the chat-ui `BorjieGroundingSignal` — every junior
 * recommendation must cite >=1 evidence_id (CLAUDE.md hard rule). The
 * gateway surfaces the verdict as the terminal `auditor` SSE frame; the
 * chat surface renders a grounding warning when the answer was ungrounded
 * (`groundingFault` or a non-null `evidenceWarning`).
 */
export interface BrainGroundingSignal {
  readonly verdict: 'approve' | 'reject' | 'needs_human'
  readonly evidenceCount: number
  readonly evidenceWarning: 'no_evidence_cited' | 'evidence_invalid' | null
  readonly groundingFault: boolean
}

export type BrainStreamData =
  | { readonly type: 'accepted'; readonly threadId: string }
  | { readonly type: 'message_chunk'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly toolCall: ToolCallResult }
  | { readonly type: 'proposed_action'; readonly action: ProposedAction }
  | { readonly type: 'auditor'; readonly signal: BrainGroundingSignal }
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

    // NAMED-EVENT LISTENERS (cm-1 fix):
    // react-native-sse routes named events ONLY to same-named listeners.
    // We register one listener per event name the gateway emits.

    const handleParsed = (parsed: BrainStreamEvent): void => {
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
    }

    // turn.accepted — gateway emits: {"threadId":"..."}
    source.addEventListener('turn.accepted', (event: RNEventMessage) => {
      const parsed = parseNamedFrame('turn.accepted', event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })

    // ack — alias for turn.accepted in some gateway builds
    source.addEventListener('ack', (event: RNEventMessage) => {
      const parsed = parseNamedFrame('turn.accepted', event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })

    // message_chunk — gateway emits: {"text":"...","done":false}
    source.addEventListener('message_chunk', (event: RNEventMessage) => {
      const parsed = parseNamedFrame('message_chunk', event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })

    // tool_call — gateway emits: {"tool":"...","status":"started"|"ok"|"error","args":{...}}
    // (brain.hono.ts projectStreamEvent → { event:'tool_call', data:{ tool, status, args } }).
    source.addEventListener('tool_call', (event: RNEventMessage) => {
      const parsed = parseNamedFrame('tool_call', event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })

    // proposed_action — gateway emits: {"action":{...}}
    source.addEventListener('proposed_action', (event: RNEventMessage) => {
      const parsed = parseNamedFrame('proposed_action', event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })

    // auditor — evidence-chain grounding verdict. brain.hono.ts emits
    // {"verdict":"...","evidenceCount":N,"evidenceWarning":...}; the
    // mining/chat route + web clients use snake_case. `parseTypedFrame`
    // accepts both. Surfaced so an ungrounded answer never streams silently.
    source.addEventListener('auditor', (event: RNEventMessage) => {
      const parsed = parseNamedFrame('auditor', event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })

    // done — gateway emits: {"threadId":"...","tokensUsed":N}
    source.addEventListener('done', (event: RNEventMessage) => {
      const parsed = parseNamedFrame('done', event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })

    // error — gateway emits: {"code":"...","message":"..."}
    source.addEventListener('error', (event: RNEventError) => {
      // First check if this is an application-level error event from the
      // gateway (named 'error' SSE event). If the event has a `data`
      // field it came through the named-event path; try parsing it as an
      // app error frame before falling back to legacy JSON.
      const asMessage = event as unknown as RNEventMessage
      if (typeof asMessage.data === 'string' && asMessage.data.length > 0) {
        const parsed = parseNamedFrame('error', asMessage)
        if (parsed !== null) {
          handleParsed(parsed)
          return
        }
      }
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

    // Fallback: legacy untyped 'message' events for gateway builds that
    // send unnamed SSE (no `event:` line). These embed the event type
    // inside the data JSON as `record['event']`.
    source.addEventListener('message', (event: RNEventMessage) => {
      const parsed = parseFrame(event)
      if (parsed !== null) {
        handleParsed(parsed)
      }
    })
  })
}

// ─────────────────────────────────────────────────────────────────────
// SSE parsing helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Named event types the gateway brain router emits (non-error).
 * react-native-sse routes these to per-name listeners.
 */
type GatewayDataEventName =
  | 'message'
  | 'turn.accepted'
  | 'ack'
  | 'message_chunk'
  | 'tool_call'
  | 'proposed_action'
  | 'auditor'
  | 'done'
  | 'error'

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
  addEventListener(name: GatewayDataEventName, cb: (e: RNEventMessage) => void): void
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

/**
 * parseNamedFrame — decode a frame that arrived on a named SSE listener.
 *
 * The `eventName` is the SSE `event:` field as delivered by
 * react-native-sse; the data JSON payload does NOT embed an `event`
 * key (Hono never puts one in the data object — only in the SSE framing
 * line). Reads `text` (not `delta`) for message_chunk per the gateway
 * wire format.
 */
export function parseNamedFrame(
  eventName: string,
  event: RNEventMessage
): BrainStreamEvent | null {
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
  return parseTypedFrame(eventName, record)
}

/**
 * parseFrame — decode a legacy unnamed 'message' event whose data JSON
 * embeds the event type as `record['event']`. Kept for backward compat
 * with gateway builds that emit unnamed SSE frames.
 */
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
    // Gateway emits `text` in the named-event path. Accept `delta` too
    // for the legacy unnamed-frame path and test backward compat.
    const text =
      typeof record['text'] === 'string' && record['text'].length > 0
        ? record['text']
        : typeof record['delta'] === 'string'
          ? record['delta']
          : ''
    // Gateway routes proposed_action THROUGH message_chunk (brain.hono.ts:461-474):
    //   { event:'message_chunk', data:{ text:'', done:false, proposedAction:{...} } }
    // When a proposedAction sub-field is present, return the proposed_action
    // event instead of (or in addition to) the text chunk. An empty-text chunk
    // that only carries the proposedAction payload is treated as proposed_action.
    const rawPa = record['proposedAction']
    if (rawPa !== null && rawPa !== undefined && typeof rawPa === 'object') {
      const pa = rawPa as Record<string, unknown>
      const rawRisk = typeof pa['risk'] === 'string' ? pa['risk'].toUpperCase() : ''
      const riskLevel: ProposedAction['riskLevel'] =
        rawRisk === 'CRITICAL' ? 'CRITICAL'
        : rawRisk === 'HIGH' ? 'HIGH'
        : rawRisk === 'MEDIUM' ? 'MEDIUM'
        : 'LOW'
      const description =
        typeof pa['description'] === 'string' ? pa['description'] : ''
      const spaceIdx = description.indexOf(' ')
      const verb = spaceIdx > 0 ? description.slice(0, spaceIdx) : description
      const object = spaceIdx > 0 ? description.slice(spaceIdx + 1) : ''
      const reviewRequired =
        typeof pa['reviewRequired'] === 'boolean' ? pa['reviewRequired'] : false
      const parsed = ProposedActionSchema.safeParse({ verb, object, riskLevel, reviewRequired })
      if (parsed.success) {
        return {
          kind: 'proposed_action',
          data: { type: 'proposed_action', action: parsed.data }
        }
      }
    }
    if (text.length === 0) {
      return null
    }
    return { kind: 'message_chunk', data: { type: 'message_chunk', delta: text } }
  }
  if (eventType === 'tool_call') {
    // Gateway emits: { tool, status: 'started'|'ok'|'error', args }
    // (brain.hono.ts:453-459). ToolCallResultSchema requires { tool, ok }
    // so we build the result directly from the real field names rather than
    // feeding the raw frame through safeParse, which would fail because
    // `status` !== `ok` field.
    const tool = typeof record['tool'] === 'string' ? record['tool'] : ''
    if (tool.length === 0) {
      return null
    }
    const status = typeof record['status'] === 'string' ? record['status'] : 'ok'
    const toolCall: ToolCallResult = {
      tool,
      ok: status !== 'error',
      result: record['args'] !== undefined ? record['args'] : undefined
    }
    return { kind: 'tool_call', data: { type: 'tool_call', toolCall } }
  }
  if (eventType === 'proposed_action') {
    // The gateway routes proposed_action through message_chunk (not as a
    // separate SSE event type) in the normal streaming path — see
    // brain.hono.ts:461-474: projectStreamEvent case 'proposed_action'
    // returns event:'message_chunk' with a proposedAction sub-field.
    // This branch handles any legacy gateway build that emits a standalone
    // proposed_action event. Map the gateway shape to ProposedActionSchema:
    //   risk → riskLevel (coerce to enum or default LOW)
    //   description → derive verb + object
    const candidate = record['action'] ?? record
    const raw = typeof candidate === 'object' && candidate !== null
      ? candidate as Record<string, unknown>
      : record
    const rawRisk = typeof raw['risk'] === 'string' ? raw['risk'].toUpperCase() : ''
    const riskLevel: ProposedAction['riskLevel'] =
      rawRisk === 'CRITICAL' ? 'CRITICAL'
      : rawRisk === 'HIGH' ? 'HIGH'
      : rawRisk === 'MEDIUM' ? 'MEDIUM'
      : 'LOW'
    const description =
      typeof raw['description'] === 'string' ? raw['description'] : ''
    // Split "verb object" on the first space; fall back to description as verb.
    const spaceIdx = description.indexOf(' ')
    const verb = spaceIdx > 0 ? description.slice(0, spaceIdx) : description
    const object = spaceIdx > 0 ? description.slice(spaceIdx + 1) : ''
    const reviewRequired =
      typeof raw['reviewRequired'] === 'boolean' ? raw['reviewRequired'] : false
    const parsed = ProposedActionSchema.safeParse({ verb, object, riskLevel, reviewRequired })
    if (!parsed.success) {
      return null
    }
    return {
      kind: 'proposed_action',
      data: { type: 'proposed_action', action: parsed.data }
    }
  }
  if (eventType === 'auditor') {
    // Evidence-chain grounding verdict. brain.hono.ts (the /api/v1/brain/turn
    // route this client hits) emits camelCase {verdict, evidenceCount,
    // evidenceWarning}; the mining/chat route + web clients use snake_case
    // {verdict, evidence_count, evidence_warning, grounding_fault}.
    // `parseGroundingSignal` accepts BOTH so the warning surfaces regardless
    // of the gateway build — never silently dropped.
    return {
      kind: 'auditor',
      data: { type: 'auditor', signal: parseGroundingSignal(record) }
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

/**
 * Project the gateway `auditor` frame onto a `BrainGroundingSignal`.
 * Reads both wire casings (camelCase `evidenceCount`/`evidenceWarning` from
 * brain.hono.ts and snake_case `evidence_count`/`evidence_warning`/
 * `grounding_fault` from the mining/chat + web contract). Defensive: an
 * unexpected payload degrades to an `approve` / no-warning signal rather than
 * crashing the stream. Mirrors owner-web `remapLiveData('auditor', …)` and
 * chat-ui `parseGroundingSignal`.
 */
export function parseGroundingSignal(
  record: Record<string, unknown>
): BrainGroundingSignal {
  const verdict =
    record['verdict'] === 'reject' || record['verdict'] === 'needs_human'
      ? record['verdict']
      : 'approve'
  const warningRaw = record['evidenceWarning'] ?? record['evidence_warning']
  const evidenceWarning: BrainGroundingSignal['evidenceWarning'] =
    warningRaw === 'no_evidence_cited' || warningRaw === 'evidence_invalid'
      ? warningRaw
      : null
  const countRaw = record['evidenceCount'] ?? record['evidence_count']
  const evidenceCount = typeof countRaw === 'number' ? countRaw : 0
  const groundingFault =
    record['groundingFault'] === true || record['grounding_fault'] === true
  return { verdict, evidenceCount, evidenceWarning, groundingFault }
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
