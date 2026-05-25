/**
 * AG-UI emitter — pure-server-side glue that turns brain kernel
 * `KernelStreamEvent`s (and any handcrafted events) into AG-UI
 * Protocol SSE frames.
 *
 * Responsibilities:
 *   - Maintain a sequenced ReadableStream of SSE-framed events
 *   - Reject malformed events at the boundary (defence in depth)
 *   - Emit a heartbeat every 15s so intermediate proxies don't
 *     idle-close the connection
 *   - Stop emitting (and stop the heartbeat) once the client
 *     aborts or a terminal RUN_FINISHED / RUN_ERROR has been emitted
 *   - Observe every emit() through an injectable OTel span port
 *     (`ag-ui.event.{TYPE}`) — kernel package never imports the OTel
 *     SDK directly to keep central-intelligence dependency-free
 *
 * The emitter is intentionally framework-agnostic: it returns a
 * `Response`-compatible payload (status, headers, body stream) that
 * Hono's `c.body(...)` and Next.js' `NextResponse(...)` can consume
 * unchanged. Wiring layers (api-gateway, admin-web) own
 * their framework adapters.
 */

import {
  isTerminalAgUiEvent,
  validateAgUiEvent,
  type AgUiEvent,
  type AgUiEventType,
} from './ag-ui-types.js';

// ─────────────────────────────────────────────────────────────────────
// OTel port — structural duck. Kept identical in shape to the existing
// `HqOtelSpanRecorder` so a single shared adapter on the gateway side
// can satisfy both.
// ─────────────────────────────────────────────────────────────────────

export interface AgUiOtelSpanRecorder {
  recordSpan(args: {
    readonly name: string;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
    readonly durationMs: number;
    readonly status: 'ok' | 'error';
    readonly errorMessage?: string | null;
  }): void;
}

// ─────────────────────────────────────────────────────────────────────
// UUIDv7 — tiny self-contained generator. We avoid pulling a new dep
// into central-intelligence; the spec is small and the ids only need
// monotonic-ish sortability for audit join keys. Uses the standard
// 48-bit unix-ms prefix + 12-bit rand_a + 62-bit rand_b layout.
// ─────────────────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i += 1) {
      out[i] = Math.floor(Math.random() * 256);
    }
  }
  return out;
}

function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

export function uuidv7(nowMs: number = Date.now()): string {
  const rand = randomBytes(10);
  const ts = Math.max(0, Math.floor(nowMs));
  const tsBytes = new Uint8Array(6);
  // 48-bit big-endian unix ms timestamp.
  tsBytes[0] = (ts / 2 ** 40) & 0xff;
  tsBytes[1] = (ts / 2 ** 32) & 0xff;
  tsBytes[2] = (ts >>> 24) & 0xff;
  tsBytes[3] = (ts >>> 16) & 0xff;
  tsBytes[4] = (ts >>> 8) & 0xff;
  tsBytes[5] = ts & 0xff;
  // version 7 in high nibble of byte 6
  rand[0] = (rand[0] & 0x0f) | 0x70;
  // variant 10 in top two bits of byte 8
  rand[2] = (rand[2] & 0x3f) | 0x80;
  const bytes = [
    tsBytes[0], tsBytes[1], tsBytes[2], tsBytes[3],
    tsBytes[4], tsBytes[5],
    rand[0], rand[1],
    rand[2], rand[3],
    rand[4], rand[5], rand[6], rand[7], rand[8], rand[9],
  ];
  return (
    `${hex(bytes[0])}${hex(bytes[1])}${hex(bytes[2])}${hex(bytes[3])}` +
    `-${hex(bytes[4])}${hex(bytes[5])}` +
    `-${hex(bytes[6])}${hex(bytes[7])}` +
    `-${hex(bytes[8])}${hex(bytes[9])}` +
    `-${hex(bytes[10])}${hex(bytes[11])}${hex(bytes[12])}${hex(bytes[13])}${hex(bytes[14])}${hex(bytes[15])}`
  );
}

// ─────────────────────────────────────────────────────────────────────
// Public emitter shape
// ─────────────────────────────────────────────────────────────────────

export interface AgUiEmitterDeps {
  /** Defaults to 15s. Heartbeat period in milliseconds. */
  readonly heartbeatMs?: number;
  /** Optional OTel sink. When omitted, emit() is unobserved. */
  readonly otel?: AgUiOtelSpanRecorder | null;
  /** Pluggable clock for deterministic tests. */
  readonly clock?: () => number;
  /**
   * Pluggable timer for deterministic tests. Mirror of
   * `setInterval`/`clearInterval` — Node `Timeout` and browser `number`
   * unified into `unknown`.
   */
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export interface AgUiEmitterHandle {
  /** ReadableStream of SSE-framed UTF-8 bytes. Pipe to `c.body()` / `Response`. */
  readonly stream: ReadableStream<Uint8Array>;
  /** Push one event onto the wire. No-ops after a terminal event. */
  emit(event: AgUiEvent): void;
  /** Force-close the stream (e.g. on upstream-kernel rejection). */
  close(reason?: string): void;
  /** Hook the emitter to a client AbortSignal so disconnects stop the heartbeat. */
  attachAbortSignal(signal: AbortSignal): void;
  /** Inspectable status for tests + diagnostics. */
  readonly state: {
    readonly closed: boolean;
    readonly terminalEmitted: boolean;
    readonly eventsEmitted: number;
    readonly eventsRejected: number;
    readonly lastReason: string | null;
  };
}

const SSE_HEADERS_BASE = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

const DEFAULT_HEARTBEAT_MS = 15_000;

/** SSE comment line — drops on the wire as `: heartbeat\n\n`. */
const HEARTBEAT_FRAME = `: heartbeat\n\n`;

/**
 * Build the SSE response headers. Exposed as a helper so framework
 * adapters can layer their own (e.g. CORS) on top without duplicating
 * the SSE-required set.
 */
export function agUiSseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...SSE_HEADERS_BASE, ...extra };
}

function frameEvent(event: AgUiEvent): string {
  // AG-UI spec uses one `event:` line per type + JSON-encoded `data:`.
  // We additionally emit `id:` so SSE Last-Event-Id resume works for
  // sortable runs. id = runId-or-eventField + counter is overkill here;
  // we pick a deterministic-ish id that helps debugging.
  const payload = JSON.stringify(event);
  return `event: ${event.type}\ndata: ${payload}\n\n`;
}

const TEXT_ENCODER = new TextEncoder();

export function createAgUiEmitter(deps: AgUiEmitterDeps = {}): AgUiEmitterHandle {
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const otel = deps.otel ?? null;
  const clock = deps.clock ?? (() => Date.now());
  const installTimer = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const removeTimer = deps.clearInterval ?? ((handle) => clearInterval(handle as never));

  type Mut = {
    closed: boolean;
    terminalEmitted: boolean;
    eventsEmitted: number;
    eventsRejected: number;
    lastReason: string | null;
    timerHandle: unknown | null;
    controller: ReadableStreamDefaultController<Uint8Array> | null;
    abortSignal: AbortSignal | null;
    abortListener: (() => void) | null;
  };
  const mut: Mut = {
    closed: false,
    terminalEmitted: false,
    eventsEmitted: 0,
    eventsRejected: 0,
    lastReason: null,
    timerHandle: null,
    controller: null,
    abortSignal: null,
    abortListener: null,
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      mut.controller = controller;
      // Pre-flight SSE handshake comment — flushes proxy buffers and
      // gives the client an immediate confirmation that the stream is
      // alive. Not counted as an event.
      try {
        controller.enqueue(TEXT_ENCODER.encode(`: ag-ui-stream-open\n\n`));
      } catch {
        // Controller was closed before we could send the handshake;
        // mark closed and bail.
        mut.closed = true;
      }
      // Heartbeat — drives a comment line every `heartbeatMs` so
      // intermediate proxies don't reap an idle stream. Cleared on
      // close + on terminal event emission.
      mut.timerHandle = installTimer(() => {
        if (mut.closed || mut.terminalEmitted || !mut.controller) return;
        try {
          mut.controller.enqueue(TEXT_ENCODER.encode(HEARTBEAT_FRAME));
        } catch {
          finalize('heartbeat-enqueue-failed');
        }
      }, heartbeatMs);
    },
    cancel(reason) {
      // Client disconnected — backpressure-aware close.
      finalize(typeof reason === 'string' ? reason : 'cancelled');
    },
  });

  function recordSpan(type: AgUiEventType, durationMs: number, status: 'ok' | 'error', err?: string | null) {
    if (!otel) return;
    try {
      otel.recordSpan({
        name: `ag-ui.event.${type}`,
        attributes: {
          'ag_ui.event.type': type,
          'ag_ui.events.emitted': mut.eventsEmitted,
          'ag_ui.events.rejected': mut.eventsRejected,
          'ag_ui.terminal_emitted': mut.terminalEmitted,
        },
        durationMs,
        status,
        ...(err ? { errorMessage: err } : {}),
      });
    } catch {
      // OTel sink must never break the wire; swallow.
    }
  }

  function finalize(reason: string) {
    if (mut.closed) return;
    mut.closed = true;
    mut.lastReason = mut.lastReason ?? reason;
    if (mut.timerHandle !== null) {
      try {
        removeTimer(mut.timerHandle);
      } catch {
        /* ignore */
      }
      mut.timerHandle = null;
    }
    if (mut.abortSignal && mut.abortListener) {
      try {
        mut.abortSignal.removeEventListener('abort', mut.abortListener);
      } catch {
        /* ignore */
      }
      mut.abortSignal = null;
      mut.abortListener = null;
    }
    if (mut.controller) {
      try {
        mut.controller.close();
      } catch {
        // Already closed by an upstream cancel — fine.
      }
      mut.controller = null;
    }
  }

  function emit(event: AgUiEvent): void {
    const start = clock();
    if (mut.closed) {
      mut.eventsRejected += 1;
      mut.lastReason = 'closed';
      recordSpan(
        // Best-effort name — even malformed events report a type if
        // string-typed; otherwise fall back to RUN_ERROR for the span.
        (typeof (event as { type?: unknown }).type === 'string'
          ? ((event as { type: unknown }).type as AgUiEventType)
          : 'RUN_ERROR'),
        clock() - start,
        'error',
        'closed',
      );
      return;
    }
    if (mut.terminalEmitted) {
      mut.eventsRejected += 1;
      mut.lastReason = 'after-terminal';
      recordSpan(event.type, clock() - start, 'error', 'after-terminal');
      return;
    }
    const validation = validateAgUiEvent(event);
    if (!validation.ok) {
      mut.eventsRejected += 1;
      mut.lastReason = validation.reason;
      recordSpan(
        (typeof (event as { type?: unknown }).type === 'string'
          ? ((event as { type: unknown }).type as AgUiEventType)
          : 'RUN_ERROR'),
        clock() - start,
        'error',
        validation.reason,
      );
      return;
    }
    if (!mut.controller) {
      mut.eventsRejected += 1;
      mut.lastReason = 'no-controller';
      recordSpan(event.type, clock() - start, 'error', 'no-controller');
      return;
    }
    try {
      mut.controller.enqueue(TEXT_ENCODER.encode(frameEvent(event)));
      mut.eventsEmitted += 1;
      if (isTerminalAgUiEvent(event)) {
        mut.terminalEmitted = true;
        recordSpan(event.type, clock() - start, 'ok');
        // Drain heartbeat + close on terminal so the client sees EOF.
        finalize('terminal');
        return;
      }
      recordSpan(event.type, clock() - start, 'ok');
    } catch (err) {
      mut.eventsRejected += 1;
      const msg = err instanceof Error ? err.message : 'enqueue-failed';
      mut.lastReason = msg;
      recordSpan(event.type, clock() - start, 'error', msg);
      finalize(msg);
    }
  }

  function close(reason?: string): void {
    finalize(reason ?? 'manual-close');
  }

  function attachAbortSignal(signal: AbortSignal): void {
    if (mut.closed) return;
    if (signal.aborted) {
      finalize('client-abort');
      return;
    }
    const listener = () => finalize('client-abort');
    signal.addEventListener('abort', listener, { once: true });
    mut.abortSignal = signal;
    mut.abortListener = listener;
  }

  return {
    stream,
    emit,
    close,
    attachAbortSignal,
    get state() {
      return {
        closed: mut.closed,
        terminalEmitted: mut.terminalEmitted,
        eventsEmitted: mut.eventsEmitted,
        eventsRejected: mut.eventsRejected,
        lastReason: mut.lastReason,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Kernel-stream adapter — converts the existing kernel stream events
// into the AG-UI event surface. Lives here (rather than in the
// gateway) so future Jarvis surfaces, the consumer apps, and the eval
// harness share one canonical translation.
//
// Mapping:
//   kernel.turn_start         → RUN_STARTED + TEXT_MESSAGE_START
//   kernel.text_delta         → TEXT_MESSAGE_CONTENT
//   kernel.thought_delta      → (skipped — extended-thinking is not
//                                surfaced on the AG-UI wire today;
//                                consumers can opt in via the ToolBus)
//   kernel.gate_verdict       → TOOL_CALL_START/ARGS/END + TOOL_RESULT
//                                (synthetic — surfaces the gate as a
//                                tool result the UI can render)
//   kernel.confidence         → STATE_DELTA (replace /run/confidence)
//   kernel.done(answer)       → TEXT_MESSAGE_END + RUN_FINISHED
//   kernel.done(refusal)      → TEXT_MESSAGE_END + RUN_ERROR
//   kernel.done(softened)     → TEXT_MESSAGE_END + RUN_FINISHED
//                                (softened is an answer with caveats)
// ─────────────────────────────────────────────────────────────────────

export interface KernelToAgUiAdapterDeps {
  readonly threadId: string;
  readonly runId?: string;
  readonly clock?: () => number;
}

/**
 * Drive an emitter from a kernel stream iterable. The caller is
 * responsible for catching errors thrown by the iterable and calling
 * `emitter.emit({ type: 'RUN_ERROR', ... })` itself — this keeps the
 * adapter pure (no exception handling) so unit tests can assert on the
 * exact emit sequence.
 *
 * Returns the runId that was used; useful for the caller's audit row.
 */
export async function pumpKernelToAgUi(
  emitter: AgUiEmitterHandle,
  events: AsyncIterable<KernelLikeEvent>,
  deps: KernelToAgUiAdapterDeps,
): Promise<{ readonly runId: string; readonly messageId: string }> {
  const now = deps.clock ?? (() => Date.now());
  const runId = deps.runId ?? uuidv7(now());
  const messageId = uuidv7(now());
  emitter.emit({
    type: 'RUN_STARTED',
    threadId: deps.threadId,
    runId,
    timestamp: now(),
  });
  emitter.emit({
    type: 'TEXT_MESSAGE_START',
    messageId,
    role: 'assistant',
  });

  for await (const ev of events) {
    if (ev.kind === 'turn_start') {
      // RUN_STARTED is already emitted by the caller above; the kernel
      // turn_start is informational and folded into the run start.
      continue;
    }
    if (ev.kind === 'text_delta') {
      if (typeof ev.text === 'string' && ev.text.length > 0) {
        emitter.emit({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId,
          delta: ev.text,
        });
      }
      continue;
    }
    if (ev.kind === 'thought_delta') {
      // Not surfaced on AG-UI wire — extended thinking is consumed by
      // the in-process CoT reservoir, not the chat surface.
      continue;
    }
    if (ev.kind === 'gate_verdict') {
      const toolCallId = uuidv7(now());
      emitter.emit({
        type: 'TOOL_CALL_START',
        toolCallId,
        toolName: `gate.${ev.gate}`,
      });
      emitter.emit({
        type: 'TOOL_CALL_ARGS',
        toolCallId,
        delta: JSON.stringify({ gate: ev.gate }),
      });
      emitter.emit({ type: 'TOOL_CALL_END', toolCallId });
      emitter.emit({
        type: 'TOOL_RESULT',
        toolCallId,
        result: { gate: ev.gate, verdict: ev.verdict },
      });
      continue;
    }
    if (ev.kind === 'confidence') {
      emitter.emit({
        type: 'STATE_DELTA',
        patch: [{ op: 'replace', path: '/run/confidence', value: ev.vector }],
      });
      continue;
    }
    if (ev.kind === 'done') {
      emitter.emit({ type: 'TEXT_MESSAGE_END', messageId });
      const decisionKind = (ev.decision && (ev.decision as { kind?: string }).kind) ?? 'answer';
      if (decisionKind === 'refusal') {
        emitter.emit({
          type: 'RUN_ERROR',
          runId,
          error: 'kernel-refusal',
        });
      } else {
        emitter.emit({ type: 'RUN_FINISHED', runId });
      }
      return { runId, messageId };
    }
  }

  // Iterable ended without a `done` event — synthesize a clean close.
  emitter.emit({ type: 'TEXT_MESSAGE_END', messageId });
  emitter.emit({ type: 'RUN_FINISHED', runId });
  return { runId, messageId };
}

/**
 * Structural duck of `KernelStreamEvent` — central-intelligence's
 * actual `KernelStreamEvent` is `readonly`-on-fields, which TS rejects
 * for narrowing in some downstream consumers. We mirror just the
 * shape we use here so the adapter is decoupled from kernel-types
 * evolution.
 */
export type KernelLikeEvent =
  | { readonly kind: 'turn_start'; readonly persona?: unknown }
  | { readonly kind: 'text_delta'; readonly text: string }
  | { readonly kind: 'thought_delta'; readonly text: string }
  | { readonly kind: 'gate_verdict'; readonly gate: string; readonly verdict: unknown }
  | { readonly kind: 'confidence'; readonly vector: unknown }
  | { readonly kind: 'done'; readonly decision: unknown };
