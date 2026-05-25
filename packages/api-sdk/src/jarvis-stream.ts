/**
 * @borjie/api-sdk — Jarvis SSE streaming client.
 *
 * The api-gateway exposes `POST /api/v1/<surface>/jarvis/stream` as an
 * SSE channel. Per `services/api-gateway/src/routes/jarvis-router-factory.ts`
 * the wire framing is:
 *
 *   event: turn_start  data: { persona: { id, displayName, firstPersonNoun } }
 *   event: delta       data: { delta: '<token-chunk>' }
 *   event: thinking    data: { delta: '<thought-chunk>' }
 *   event: gate        data: { gate, verdict, reason? }
 *   event: confidence  data: ConfidenceVector
 *   event: done        data: { thoughtId, kind }
 *   event: error       data: { message }    (followed by `done`)
 *
 * This module models that channel as an `AsyncIterable<JarvisStreamEvent>`
 * with an `abort()` escape hatch. We deliberately keep the streaming
 * code separate from `jarvis-client.ts` so the heavy SSE / ReadableStream
 * plumbing only ships when a consumer actually imports it.
 *
 * Transport choice:
 *   - Browsers: native `EventSource` cannot POST, so we always use
 *     fetch + ReadableStream so the request body (threadId, attachments,
 *     auth headers) flows through the same plumbing the rest of the SDK
 *     uses. `EventSource` is checked here only to keep the public
 *     contract honest if a future read-only channel ever needs it.
 *   - Node 18+ / Edge runtime: `fetch` returns a `Response` with a
 *     `ReadableStream` body — same parser path.
 *
 * Reconnect:
 *   - Transient network errors before any byte is received → up to
 *     `maxReconnect` retries (default 2) with exponential backoff.
 *   - A clean `done` event (or any byte received) disables reconnect —
 *     mid-stream errors propagate as a `JarvisStreamEvent` of kind
 *     `error` so the consumer can decide whether to retry.
 */

import type { BossnyumbaClient } from './client.js';
import type {
  JarvisDecision,
  JarvisSurface,
  JarvisThinkRequest,
} from './jarvis-client.js';

// ---------------------------------------------------------------------------
// Public types — match the spec the chat-ui hook contracts against.
// ---------------------------------------------------------------------------

export interface JarvisStreamPersona {
  readonly id: string;
  readonly displayName: string;
  readonly firstPersonNoun: string;
}

export interface JarvisStreamConfidence {
  readonly groundedness: number;
  readonly stability: number;
  readonly review: number;
  readonly numericalConsistency: number;
  readonly overall: number;
}

export type JarvisStreamGateVerdict = 'pass' | 'soften' | 'block';

/**
 * Structured UI-part the MD emits during a turn — rendered by the
 * `AdaptiveRenderer` in `@borjie/genui`. The kernel sends one
 * per `tool_output_available` SSE event; the client appends to the
 * turn's `uiParts[]`.
 */
export interface JarvisStreamUiPart {
  readonly kind: string;
  readonly [key: string]: unknown;
}

export type JarvisStreamEvent =
  | {
      readonly kind: 'turn_start';
      readonly persona: JarvisStreamPersona;
      readonly thoughtId: string;
    }
  | { readonly kind: 'delta'; readonly text: string }
  | { readonly kind: 'thinking'; readonly text: string }
  | {
      readonly kind: 'gate';
      readonly verdict: JarvisStreamGateVerdict;
      readonly reason?: string;
    }
  | {
      readonly kind: 'confidence';
      readonly vector: JarvisStreamConfidence;
    }
  | {
      /**
       * Wire event name: `tool_output_available`. Payload `uiPart` is a
       * structured UI block (table / chart / kanban / approval / ...)
       * the MD emitted during the turn. Client appends to the turn's
       * `uiParts[]` so the `AdaptiveRenderer` can render it.
       */
      readonly kind: 'tool_output_available';
      readonly uiPart: JarvisStreamUiPart;
    }
  | { readonly kind: 'done'; readonly decision: JarvisDecision }
  | { readonly kind: 'error'; readonly message: string };

export interface JarvisStreamHandle {
  /** Iterator of decoded events. Terminates after `done` (or `error` + `done`). */
  events(): AsyncIterable<JarvisStreamEvent>;
  /** Abort the underlying fetch + iterator. Idempotent. */
  abort(): void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawSseEvent {
  readonly event: string;
  readonly data: string;
}

interface StreamOptions {
  /** Max reconnect attempts on transient pre-byte network errors. */
  readonly maxReconnect?: number;
  /** Caller-supplied AbortSignal. */
  readonly signal?: AbortSignal;
}

const SURFACE_PATH: Record<JarvisSurface, string> = {
  customer: '/api/v1/customer/jarvis',
  owner: '/api/v1/owner/jarvis',
  manager: '/api/v1/manager/jarvis',
  admin: '/api/v1/admin/jarvis',
  platform: '/api/v1/platform/jarvis',
};

// ---------------------------------------------------------------------------
// Public factory — used by createJarvisClient().stream(...)
// ---------------------------------------------------------------------------

/**
 * Open an SSE stream on the gateway and surface it as an
 * AsyncIterable of decoded events.
 *
 * The function returns synchronously with a {@link JarvisStreamHandle};
 * `events()` then opens the underlying connection lazily on first
 * iteration. This matches the shape the chat-ui hook expects.
 */
export function createJarvisStream(
  client: BossnyumbaClient,
  surface: JarvisSurface,
  req: JarvisThinkRequest,
  options: StreamOptions = {},
): JarvisStreamHandle {
  const root = SURFACE_PATH[surface];
  const url = `${client.baseUrl.replace(/\/+$/, '')}${root}/stream`;

  const ac = new AbortController();
  const externalSignal = options.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      ac.abort();
    } else {
      externalSignal.addEventListener('abort', () => ac.abort(), { once: true });
    }
  }

  const maxReconnect = options.maxReconnect ?? 2;

  return {
    abort(): void {
      ac.abort();
    },
    events(): AsyncIterable<JarvisStreamEvent> {
      return {
        [Symbol.asyncIterator]: (): AsyncIterator<JarvisStreamEvent> =>
          iterateStream(client, url, req, ac.signal, maxReconnect),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Iterator implementation
// ---------------------------------------------------------------------------

async function* iterateStream(
  client: BossnyumbaClient,
  url: string,
  req: JarvisThinkRequest,
  signal: AbortSignal,
  maxReconnect: number,
): AsyncGenerator<JarvisStreamEvent, void, void> {
  // Resolve auth lazily so per-request bearer-getters get a fresh token.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(client.config.defaultHeaders ?? {}),
  };
  const bearer = await resolveBearer(client.config.bearerToken);
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  if (client.config.apiKey) headers['X-API-Key'] = client.config.apiKey;

  const fetchFn = client.config.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    yield { kind: 'error', message: 'global fetch not available' };
    return;
  }

  let attempt = 0;
  let response: Response | null = null;

  // Pre-byte reconnect loop. We race the fetch against the abort
  // signal so a caller-driven abort short-circuits even when the
  // (test/mock) fetch never resolves.
  while (attempt <= maxReconnect) {
    if (signal.aborted) return;
    try {
      const fetchPromise = fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
        signal,
      });
      response = await raceWithAbort(fetchPromise, signal);
      if (response === null) return; // aborted
      break;
    } catch (err) {
      if (signal.aborted) return;
      if (attempt < maxReconnect) {
        attempt += 1;
        await sleepWithSignal(2 ** attempt * 100, signal);
        continue;
      }
      yield {
        kind: 'error',
        message: err instanceof Error ? err.message : 'network error',
      };
      return;
    }
  }

  if (!response) {
    // Defensive — the loop above should have either yielded or assigned.
    yield { kind: 'error', message: 'failed to open stream' };
    return;
  }

  if (!response.ok || !response.body) {
    yield {
      kind: 'error',
      message: `stream endpoint returned HTTP ${response.status}`,
    };
    return;
  }

  // ── Stream-decode loop. ────────────────────────────────────────────────
  // We accumulate state across the run so we can synthesise a fully-
  // populated `JarvisDecision` on the `done` event. The gateway's `done`
  // payload is intentionally minimal — `{ thoughtId, kind }` — because
  // every other field has already been streamed.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const acc: StreamAccumulator = {
    persona: null,
    text: '',
    thinking: '',
    confidence: null,
    gate: null,
    error: null,
    thoughtId: null,
  };

  try {
    while (true) {
      if (signal.aborted) return;
      let chunk: ReadableStreamReadResult<Uint8Array> | null;
      try {
        chunk = await raceWithAbort(reader.read(), signal);
      } catch (err) {
        if (signal.aborted) return;
        yield {
          kind: 'error',
          message: err instanceof Error ? err.message : 'stream read failed',
        };
        return;
      }
      if (chunk === null) return; // aborted
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const raw of blocks) {
        const ev = parseSseBlock(raw);
        if (!ev) continue;
        for (const out of translateEvent(ev, acc)) {
          if (out) yield out;
        }
      }
    }

    // Flush tail (a `done` may arrive without a trailing blank line).
    if (buffer.trim().length > 0) {
      const ev = parseSseBlock(buffer);
      if (ev) {
        for (const out of translateEvent(ev, acc)) {
          if (out) yield out;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* swallow */
    }
  }
}

// ---------------------------------------------------------------------------
// SSE parsing helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse a single SSE block of the form:
 *   event: <type>\n
 *   data: <json>\n
 *
 * Returns null for keep-alive comments (lines starting with `:`),
 * blocks without an `event:` line, blocks without a `data:` line, or
 * blocks whose `data` is malformed JSON.
 */
export function parseSseBlock(block: string): RawSseEvent | null {
  const trimmed = block.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith(':')) return null;

  let eventType: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (!eventType || dataLines.length === 0) return null;
  return { event: eventType, data: dataLines.join('\n') };
}

interface StreamAccumulator {
  persona: JarvisStreamPersona | null;
  text: string;
  thinking: string;
  confidence: JarvisStreamConfidence | null;
  gate: { verdict: JarvisStreamGateVerdict; reason?: string } | null;
  error: string | null;
  thoughtId: string | null;
}

/**
 * Translate one raw SSE event into zero or more public
 * `JarvisStreamEvent`s. The `done` event MAY synthesise additional
 * fields from the accumulator so consumers always get a fully-populated
 * `JarvisDecision`.
 *
 * Malformed JSON is silently dropped — the iterator keeps reading.
 */
export function translateEvent(
  raw: RawSseEvent,
  acc: StreamAccumulator,
): ReadonlyArray<JarvisStreamEvent | null> {
  let payload: Record<string, unknown> | null;
  try {
    payload = JSON.parse(raw.data) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!payload || typeof payload !== 'object') return [];

  switch (raw.event) {
    case 'turn_start': {
      const personaRaw = (payload.persona ?? {}) as Record<string, unknown>;
      const persona: JarvisStreamPersona = {
        id: String(personaRaw.id ?? ''),
        displayName: String(personaRaw.displayName ?? ''),
        firstPersonNoun: String(personaRaw.firstPersonNoun ?? ''),
      };
      acc.persona = persona;
      const thoughtId =
        typeof payload.thoughtId === 'string' ? payload.thoughtId : '';
      if (thoughtId) acc.thoughtId = thoughtId;
      return [{ kind: 'turn_start', persona, thoughtId }];
    }
    case 'delta': {
      const text = String(payload.delta ?? payload.text ?? '');
      if (!text) return [];
      acc.text += text;
      return [{ kind: 'delta', text }];
    }
    case 'thinking': {
      const text = String(payload.delta ?? payload.text ?? '');
      if (!text) return [];
      acc.thinking += text;
      return [{ kind: 'thinking', text }];
    }
    case 'gate': {
      const verdictRaw = String(payload.verdict ?? '');
      const verdict: JarvisStreamGateVerdict =
        verdictRaw === 'pass' || verdictRaw === 'soften' || verdictRaw === 'block'
          ? verdictRaw
          : 'pass';
      const reason =
        typeof payload.reason === 'string' && payload.reason.length > 0
          ? payload.reason
          : undefined;
      acc.gate = reason !== undefined ? { verdict, reason } : { verdict };
      return reason !== undefined
        ? [{ kind: 'gate', verdict, reason }]
        : [{ kind: 'gate', verdict }];
    }
    case 'confidence': {
      const vec: JarvisStreamConfidence = {
        groundedness: numericOr(payload.groundedness, 0),
        stability: numericOr(payload.stability, 0),
        review: numericOr(payload.review, 0),
        numericalConsistency: numericOr(payload.numericalConsistency, 0),
        overall: numericOr(payload.overall, 0),
      };
      acc.confidence = vec;
      return [{ kind: 'confidence', vector: vec }];
    }
    case 'tool_output_available': {
      // Structured UI-part emitted by the MD mid-turn. We pass it
      // straight through to the consumer; the chat-ui hook appends to
      // the turn's `uiParts[]`.
      const uiPart = payload.uiPart;
      if (
        uiPart === null ||
        typeof uiPart !== 'object' ||
        typeof (uiPart as { kind?: unknown }).kind !== 'string'
      ) {
        return [];
      }
      return [{ kind: 'tool_output_available', uiPart: uiPart as JarvisStreamUiPart }];
    }
    case 'error': {
      const message =
        typeof payload.message === 'string' ? payload.message : 'stream error';
      acc.error = message;
      return [{ kind: 'error', message }];
    }
    case 'done': {
      const kind = decisionKind(payload.kind);
      const thoughtId =
        typeof payload.thoughtId === 'string'
          ? payload.thoughtId
          : acc.thoughtId ?? '';
      const decision = synthesiseDecision(kind, thoughtId, acc);
      return [{ kind: 'done', decision }];
    }
    default:
      return [];
  }
}

function decisionKind(value: unknown): JarvisDecision['kind'] {
  if (value === 'answer' || value === 'softened' || value === 'refusal') {
    return value;
  }
  return 'answer';
}

function numericOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

/**
 * Build a fully-populated `JarvisDecision` from the streamed pieces.
 * The gateway's `done` event is intentionally minimal so we have to
 * gather text / confidence / persona from the accumulator.
 */
function synthesiseDecision(
  kind: JarvisDecision['kind'],
  thoughtId: string,
  acc: StreamAccumulator,
): JarvisDecision {
  const provenance = {
    thoughtId,
    sensorId: '__streaming__',
    modelId: '__streaming__',
    latencyMs: 0,
    producedAt: new Date().toISOString(),
  } as const;

  // exactOptionalPropertyTypes: build the object conditionally so we
  // don't assign `undefined` to readonly optional fields.
  const base: {
    -readonly [K in keyof JarvisDecision]?: JarvisDecision[K];
  } = {
    kind,
    provenance,
  };
  if (acc.text.length > 0) base.text = acc.text;
  if (acc.confidence) base.confidence = acc.confidence;
  if (kind === 'softened' && acc.gate?.reason) base.hedge = acc.gate.reason;
  if (kind === 'refusal' && acc.gate?.reason) base.reason = acc.gate.reason;
  if (kind === 'refusal' && acc.gate) {
    // If the gate emitted a verdict, surface which layer refused (best-
    // effort — the gateway only sends the verdict on this wire, not the
    // layer name; consumers that need the layer fall back to /think).
    base.gateThatRefused = 'policy';
  }

  return base as JarvisDecision;
}

async function resolveBearer(
  t: BossnyumbaClient['config']['bearerToken'],
): Promise<string | undefined> {
  if (!t) return undefined;
  if (typeof t === 'function') return await t();
  return t;
}

/**
 * Race a promise against an AbortSignal. Resolves to the promise's
 * value, or `null` if the signal aborted first.
 *
 * Used so a caller-driven `handle.abort()` short-circuits the
 * iterator even when the underlying `fetch` implementation does not
 * reject on signal abort (e.g. mocked-fetch tests).
 */
function raceWithAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve(null);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
