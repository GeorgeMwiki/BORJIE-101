/**
 * AG-UI emitter — unit tests.
 *
 * Coverage:
 *   - SSE handshake comment is emitted on stream start
 *   - emit() frames events as `event: TYPE\ndata: <json>\n\n`
 *   - emit() rejects malformed events without throwing
 *   - emit() no-ops after a terminal RUN_FINISHED / RUN_ERROR
 *   - emit() no-ops after manual close()
 *   - heartbeat is emitted at the configured interval
 *   - heartbeat stops after terminal event
 *   - attachAbortSignal() closes the stream when the signal fires
 *   - OTel sink receives one span per emit (ok + error paths)
 *   - validateAgUiEvent() exhaustive type narrowing
 *   - uuidv7() is monotonic-ish + 36 chars long
 *   - pumpKernelToAgUi() maps kernel events to AG-UI events 1:1
 *
 * The tests intentionally use a synthetic timer port so the heartbeat
 * cadence is deterministic — production wiring uses the real
 * `setInterval` / `clearInterval`.
 */

import { describe, it, expect } from 'vitest';
import {
  createAgUiEmitter,
  pumpKernelToAgUi,
  uuidv7,
  type AgUiOtelSpanRecorder,
  type KernelLikeEvent,
} from '../ag-ui-emitter.js';
import {
  validateAgUiEvent,
  AG_UI_EVENT_TYPES,
  isAgUiEventType,
  isTerminalAgUiEvent,
  type AgUiEvent,
} from '../ag-ui-types.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface FakeTimer {
  readonly install: (fn: () => void, ms: number) => unknown;
  readonly remove: (handle: unknown) => void;
  tick(): void;
  readonly active: number;
}

function makeFakeTimer(): FakeTimer {
  const callbacks: Array<() => void> = [];
  return {
    install(fn) {
      callbacks.push(fn);
      return callbacks.length - 1;
    },
    remove(handle) {
      const idx = handle as number;
      if (idx >= 0 && idx < callbacks.length) {
        callbacks[idx] = () => {};
      }
    },
    tick() {
      const snapshot = [...callbacks];
      callbacks.forEach((cb) => {});
      for (const cb of snapshot) {
        cb();
      }
    },
    get active() {
      return callbacks.length;
    },
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return out;
}

function makeOtel(): { recorder: AgUiOtelSpanRecorder; spans: Array<{ name: string; status: 'ok' | 'error'; err?: string | null }> } {
  const spans: Array<{ name: string; status: 'ok' | 'error'; err?: string | null }> = [];
  return {
    recorder: {
      recordSpan(args) {
        spans.push({
          name: args.name,
          status: args.status,
          err: args.errorMessage ?? null,
        });
      },
    },
    spans,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Type predicates + validator
// ─────────────────────────────────────────────────────────────────────

describe('ag-ui-types — validator + narrowing', () => {
  it('AG_UI_EVENT_TYPES covers exactly 12 event types', () => {
    expect(AG_UI_EVENT_TYPES.length).toBe(12);
  });

  it('isAgUiEventType() rejects unknown strings', () => {
    expect(isAgUiEventType('RUN_STARTED')).toBe(true);
    expect(isAgUiEventType('NOT_A_TYPE')).toBe(false);
    expect(isAgUiEventType(42)).toBe(false);
  });

  it('isTerminalAgUiEvent() returns true only for RUN_FINISHED / RUN_ERROR', () => {
    expect(isTerminalAgUiEvent({ type: 'RUN_FINISHED', runId: 'r' })).toBe(true);
    expect(isTerminalAgUiEvent({ type: 'RUN_ERROR', runId: 'r', error: 'x' })).toBe(true);
    expect(
      isTerminalAgUiEvent({ type: 'TEXT_MESSAGE_END', messageId: 'm' }),
    ).toBe(false);
  });

  it('validateAgUiEvent() rejects non-object payloads', () => {
    expect(validateAgUiEvent(null).ok).toBe(false);
    expect(validateAgUiEvent('not-an-event').ok).toBe(false);
    expect(validateAgUiEvent(42).ok).toBe(false);
  });

  it('validateAgUiEvent() rejects unknown types', () => {
    const v = validateAgUiEvent({ type: 'NOPE' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('unknown-event-type');
  });

  it('validateAgUiEvent() rejects RUN_STARTED without threadId', () => {
    const v = validateAgUiEvent({ type: 'RUN_STARTED', runId: 'r', timestamp: 1 });
    expect(v.ok).toBe(false);
  });

  it('validateAgUiEvent() accepts a well-formed STATE_DELTA', () => {
    const v = validateAgUiEvent({
      type: 'STATE_DELTA',
      patch: [{ op: 'replace', path: '/x', value: 1 }],
    });
    expect(v.ok).toBe(true);
  });

  it('validateAgUiEvent() rejects STATE_DELTA whose patch is not an array', () => {
    const v = validateAgUiEvent({ type: 'STATE_DELTA', patch: 'oops' });
    expect(v.ok).toBe(false);
  });

  it('validateAgUiEvent() rejects RUN_ERROR without error string', () => {
    const v = validateAgUiEvent({ type: 'RUN_ERROR', runId: 'r' });
    expect(v.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// UUIDv7
// ─────────────────────────────────────────────────────────────────────

describe('uuidv7', () => {
  it('produces a 36-char dashed string', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is monotonic when timestamps are monotonic', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    // Compare lexicographically — UUIDv7 is sortable by design.
    expect(b > a).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Emitter — happy path + heartbeat
// ─────────────────────────────────────────────────────────────────────

describe('createAgUiEmitter — framing', () => {
  it('emits the SSE handshake comment immediately', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    emitter.close();
    const text = await readAll(emitter.stream);
    expect(text).toContain(': ag-ui-stream-open');
  });

  it('frames events as SSE `event: TYPE\\ndata: <json>` blocks', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    emitter.emit({
      type: 'RUN_STARTED',
      threadId: 'th',
      runId: 'r1',
      timestamp: 1,
    });
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r1' });
    const text = await readAll(emitter.stream);
    expect(text).toContain('event: RUN_STARTED\n');
    expect(text).toContain('event: RUN_FINISHED\n');
    expect(text).toMatch(/data: \{"type":"RUN_STARTED"/);
  });

  it('records emit count in `state.eventsEmitted`', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    emitter.emit({
      type: 'RUN_STARTED',
      threadId: 'th',
      runId: 'r1',
      timestamp: 1,
    });
    emitter.emit({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' });
    emitter.emit({ type: 'TEXT_MESSAGE_END', messageId: 'm' });
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r1' });
    expect(emitter.state.eventsEmitted).toBe(4);
    expect(emitter.state.terminalEmitted).toBe(true);
    await readAll(emitter.stream);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Emitter — rejection paths
// ─────────────────────────────────────────────────────────────────────

describe('createAgUiEmitter — rejection paths', () => {
  it('rejects malformed events without throwing', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    // Cast through unknown — the validator must reject at runtime even
    // when callers bypass the TS type system.
    emitter.emit({ type: 'NOT_REAL' } as unknown as AgUiEvent);
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r' });
    expect(emitter.state.eventsEmitted).toBe(1);
    expect(emitter.state.eventsRejected).toBe(1);
    expect(emitter.state.lastReason).toBe('unknown-event-type');
    await readAll(emitter.stream);
  });

  it('no-ops after a terminal RUN_FINISHED', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r' });
    emitter.emit({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'm',
      delta: 'late',
    });
    expect(emitter.state.terminalEmitted).toBe(true);
    expect(emitter.state.eventsRejected).toBe(1);
    await readAll(emitter.stream);
  });

  it('no-ops after manual close()', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    emitter.close('test');
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r' });
    expect(emitter.state.eventsRejected).toBe(1);
    expect(emitter.state.closed).toBe(true);
    // close() sets `lastReason`; a subsequent emit() also writes its
    // rejection reason. The contract is "stream is closed" — either
    // reason satisfies callers; we assert the set is bounded.
    expect(['test', 'closed']).toContain(emitter.state.lastReason);
    await readAll(emitter.stream);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Heartbeat
// ─────────────────────────────────────────────────────────────────────

describe('createAgUiEmitter — heartbeat', () => {
  it('emits a heartbeat comment when the timer ticks', async () => {
    const timer = makeFakeTimer();
    const emitter = createAgUiEmitter({
      heartbeatMs: 100,
      setInterval: timer.install,
      clearInterval: timer.remove,
    });
    timer.tick(); // fire one heartbeat
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r' });
    const text = await readAll(emitter.stream);
    expect(text).toContain(': heartbeat');
  });

  it('stops the heartbeat after a terminal event', () => {
    const timer = makeFakeTimer();
    const emitter = createAgUiEmitter({
      heartbeatMs: 100,
      setInterval: timer.install,
      clearInterval: timer.remove,
    });
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r' });
    // After terminal, the emitter has called clearInterval — ticking
    // the timer should be a no-op (already cleared callback).
    timer.tick();
    expect(emitter.state.eventsEmitted).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Abort signal — client-disconnect path
// ─────────────────────────────────────────────────────────────────────

describe('createAgUiEmitter — abort signal', () => {
  it('closes when the abort signal fires', async () => {
    const ctrl = new AbortController();
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    emitter.attachAbortSignal(ctrl.signal);
    ctrl.abort();
    expect(emitter.state.closed).toBe(true);
    expect(emitter.state.lastReason).toBe('client-abort');
    await readAll(emitter.stream);
  });

  it('closes immediately if the signal is already aborted', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    emitter.attachAbortSignal(ctrl.signal);
    expect(emitter.state.closed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// OTel sink
// ─────────────────────────────────────────────────────────────────────

describe('createAgUiEmitter — OTel observability', () => {
  it('records one ok span per accepted event', async () => {
    const { recorder, spans } = makeOtel();
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000, otel: recorder });
    emitter.emit({
      type: 'RUN_STARTED',
      threadId: 'th',
      runId: 'r',
      timestamp: 1,
    });
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r' });
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ name: 'ag-ui.event.RUN_STARTED', status: 'ok', err: null });
    expect(spans[1]).toEqual({ name: 'ag-ui.event.RUN_FINISHED', status: 'ok', err: null });
    await readAll(emitter.stream);
  });

  it('records an error span for malformed events', async () => {
    const { recorder, spans } = makeOtel();
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000, otel: recorder });
    emitter.emit({ type: 'NOT_REAL' } as unknown as AgUiEvent);
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe('error');
    emitter.close();
    await readAll(emitter.stream);
  });

  it('survives an OTel sink that throws', async () => {
    const recorder: AgUiOtelSpanRecorder = {
      recordSpan() {
        throw new Error('otel-broken');
      },
    };
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000, otel: recorder });
    // Should not throw — OTel failure must never affect the wire.
    expect(() =>
      emitter.emit({
        type: 'RUN_STARTED',
        threadId: 'th',
        runId: 'r',
        timestamp: 1,
      }),
    ).not.toThrow();
    emitter.emit({ type: 'RUN_FINISHED', runId: 'r' });
    await readAll(emitter.stream);
  });
});

// ─────────────────────────────────────────────────────────────────────
// pumpKernelToAgUi — kernel → AG-UI translation
// ─────────────────────────────────────────────────────────────────────

async function* kernelScript(...events: KernelLikeEvent[]): AsyncIterable<KernelLikeEvent> {
  for (const ev of events) yield ev;
}

describe('pumpKernelToAgUi', () => {
  it('translates a happy-path kernel stream to AG-UI events 1:1', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    const events: KernelLikeEvent[] = [
      { kind: 'turn_start' },
      { kind: 'text_delta', text: 'hello' },
      { kind: 'text_delta', text: ' world' },
      { kind: 'confidence', vector: { overall: 0.9 } },
      {
        kind: 'done',
        decision: { kind: 'answer', provenance: { thoughtId: 't', sensorId: 's', modelId: 'm', latencyMs: 1 } },
      },
    ];
    const result = await pumpKernelToAgUi(emitter, kernelScript(...events), {
      threadId: 'th',
    });
    expect(result.runId).toMatch(/[0-9a-f-]{36}/);
    // emitted: RUN_STARTED + TEXT_MESSAGE_START + 2x TEXT_MESSAGE_CONTENT +
    // STATE_DELTA + TEXT_MESSAGE_END + RUN_FINISHED = 7
    expect(emitter.state.eventsEmitted).toBe(7);
    expect(emitter.state.terminalEmitted).toBe(true);
    await readAll(emitter.stream);
  });

  it('emits RUN_ERROR when kernel decision is a refusal', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    await pumpKernelToAgUi(
      emitter,
      kernelScript(
        { kind: 'turn_start' },
        { kind: 'done', decision: { kind: 'refusal' } },
      ),
      { threadId: 'th' },
    );
    // RUN_STARTED + TEXT_MESSAGE_START + TEXT_MESSAGE_END + RUN_ERROR
    expect(emitter.state.eventsEmitted).toBe(4);
    expect(emitter.state.terminalEmitted).toBe(true);
    await readAll(emitter.stream);
  });

  it('synthesises a clean RUN_FINISHED when kernel iterable ends without `done`', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    await pumpKernelToAgUi(
      emitter,
      kernelScript({ kind: 'turn_start' }, { kind: 'text_delta', text: 'partial' }),
      { threadId: 'th' },
    );
    // RUN_STARTED + TEXT_MESSAGE_START + 1 content + TEXT_MESSAGE_END + RUN_FINISHED
    expect(emitter.state.eventsEmitted).toBe(5);
    expect(emitter.state.terminalEmitted).toBe(true);
    await readAll(emitter.stream);
  });

  it('translates gate_verdict into a synthetic tool-call quartet', async () => {
    const emitter = createAgUiEmitter({ heartbeatMs: 60_000 });
    await pumpKernelToAgUi(
      emitter,
      kernelScript(
        { kind: 'gate_verdict', gate: 'inviolable', verdict: { passed: false } },
        {
          kind: 'done',
          decision: { kind: 'answer', provenance: { thoughtId: 't', sensorId: 's', modelId: 'm', latencyMs: 1 } },
        },
      ),
      { threadId: 'th' },
    );
    // RUN_STARTED + TEXT_MESSAGE_START + (TOOL_CALL_START + ARGS + END + RESULT)
    // + TEXT_MESSAGE_END + RUN_FINISHED = 8
    expect(emitter.state.eventsEmitted).toBe(8);
    await readAll(emitter.stream);
  });
});
