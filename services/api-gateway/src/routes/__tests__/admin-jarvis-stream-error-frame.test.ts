/**
 * admin-jarvis-stream — terminal `error` frame handling (D19, HONEST MID-STREAM
 * DEGRADE regression).
 *
 * The kernel emits a TERMINAL `error` KernelStreamEvent (instead of `done`) when
 * the sensor faults mid-turn, so a truncated turn is never presented as
 * complete. `pumpKernelToAgUi` does NOT know that kind — if the `error` frame
 * reached it, its no-`done` fallthrough would emit a SUCCESSFUL `RUN_FINISHED`,
 * fabricating a completed run from a faulted one.
 *
 * `teeSelfModelToAgUi` sits between the egress chokepoint and the pump; this
 * suite proves it intercepts the `error` frame, emits an honest `RUN_ERROR`
 * (generic banner — no raw reason on the wire), and STOPS the stream (never
 * yielding the error frame onward, so the pump can't fabricate success).
 *
 * RED before the fix: the tee had no `error` branch and re-yielded the frame,
 * so no RUN_ERROR was emitted and the frame leaked to the pump.
 */

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { describe, it, expect } from 'vitest';
import {
  teeSelfModelToAgUi,
  GENERIC_RUN_ERROR,
} from '../admin-jarvis-stream.router';

interface Emitted {
  readonly type: string;
  readonly [k: string]: unknown;
}

function collectingEmitter() {
  const events: Emitted[] = [];
  return {
    events,
    emit(event: Emitted) {
      events.push(event);
    },
  };
}

async function* fromArray<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const it of items) yield it;
}

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('teeSelfModelToAgUi — terminal error frame', () => {
  it('emits RUN_ERROR and STOPS the stream on a kernel `error` frame', async () => {
    const emitter = collectingEmitter();
    const source = fromArray([
      { kind: 'turn_start' },
      { kind: 'text_delta', text: 'partial answer' },
      { kind: 'error', reason: 'PROVIDER_TIMEOUT', partial: true },
      // These MUST NOT be yielded — the tee stops at the error frame.
      { kind: 'done', decision: { kind: 'answer' } },
    ] as Array<{ kind: string; [k: string]: unknown }>);

    const yielded = await drain(
      teeSelfModelToAgUi(source, emitter, 'run-err-1'),
    );

    // RUN_ERROR emitted with the GENERIC banner (no raw `reason` on the wire).
    const runError = emitter.events.find((e) => e.type === 'RUN_ERROR');
    expect(runError).toBeDefined();
    expect(runError?.error).toBe(GENERIC_RUN_ERROR);
    expect(runError?.runId).toBe('run-err-1');
    expect(JSON.stringify(emitter.events)).not.toContain('PROVIDER_TIMEOUT');

    // The stream STOPPED at the error frame — neither the error frame nor the
    // trailing `done` reached the pump (they were never yielded).
    const kinds = yielded.map((e) => e.kind);
    expect(kinds).toEqual(['turn_start', 'text_delta']);
    expect(kinds).not.toContain('error');
    expect(kinds).not.toContain('done');
  });

  it('passes through a clean stream (no error) unchanged and emits no RUN_ERROR', async () => {
    const emitter = collectingEmitter();
    const source = fromArray([
      { kind: 'turn_start' },
      { kind: 'text_delta', text: 'hi' },
      { kind: 'done', decision: { kind: 'answer' } },
    ] as Array<{ kind: string; [k: string]: unknown }>);

    const yielded = await drain(teeSelfModelToAgUi(source, emitter, 'run-ok-1'));

    expect(emitter.events.find((e) => e.type === 'RUN_ERROR')).toBeUndefined();
    expect(yielded.map((e) => e.kind)).toEqual([
      'turn_start',
      'text_delta',
      'done',
    ]);
  });

  it('still tees a self_model frame while passing it through', async () => {
    const emitter = collectingEmitter();
    const source = fromArray([
      { kind: 'self_model', selfModel: { posture: 'answering' } },
      { kind: 'done', decision: { kind: 'answer' } },
    ] as Array<{ kind: string; [k: string]: unknown }>);

    const yielded = await drain(teeSelfModelToAgUi(source, emitter, 'run-sm-1'));

    expect(
      emitter.events.some(
        (e) =>
          e.type === 'STATE_DELTA' &&
          JSON.stringify(e).includes('/run/selfModel'),
      ),
    ).toBe(true);
    // self_model is re-yielded (the pump ignores it) — pass-through preserved.
    expect(yielded.map((e) => e.kind)).toEqual(['self_model', 'done']);
  });
});
