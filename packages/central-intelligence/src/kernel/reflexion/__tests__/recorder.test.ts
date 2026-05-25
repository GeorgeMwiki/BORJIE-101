/**
 * Reflexion recorder — unit tests.
 *
 * Coverage:
 *   1. rejects missing tenantId
 *   2. rejects missing taskId
 *   3. rejects empty / whitespace-only critique
 *   4. success → outcome 'success'; failure → outcome 'failure'
 *   5. clamps importance to [0, 1]
 *   6. defaults importance to 0.5 when omitted
 *   7. truncates 5000-char critique to MAX_CRITIQUE_CHARS (4 000) + …
 *   8. swallows port errors (returns null) without rethrowing
 *   9. defaults userId/sessionId when not provided
 */

import { describe, it, expect } from 'vitest';
import {
  recordReflexion,
  type ReflexionRecorderPort,
  type RecordReflexionArgs,
} from '../reflexion-recorder.js';

interface RecordedCall {
  tenantId: string;
  userId: string;
  sessionId: string;
  taskId: string;
  reflection: string;
  outcome: string;
  importance: number;
}

function makePort(opts: { throwOnce?: boolean } = {}): {
  port: ReflexionRecorderPort;
  calls: RecordedCall[];
  resetThrow: () => void;
} {
  const calls: RecordedCall[] = [];
  const state = { throwNext: opts.throwOnce ?? false };
  const port: ReflexionRecorderPort = {
    async record(args) {
      if (state.throwNext) {
        state.throwNext = false;
        throw new Error('port boom');
      }
      calls.push({ ...args });
      return { id: `rec-${calls.length}` };
    },
  };
  return {
    port,
    calls,
    resetThrow: () => {
      state.throwNext = true;
    },
  };
}

function args(partial: Partial<RecordReflexionArgs> = {}): RecordReflexionArgs {
  return {
    tenantId: 't-1',
    taskId: 'task-1',
    success: true,
    critique: 'next time, double-check the unit number before proceeding',
    ...partial,
  };
}

describe('recordReflexion', () => {
  it('returns null when tenantId is empty', async () => {
    const { port, calls } = makePort();
    const id = await recordReflexion(port, args({ tenantId: '' }));
    expect(id).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null when taskId is empty', async () => {
    const { port, calls } = makePort();
    const id = await recordReflexion(port, args({ taskId: '' }));
    expect(id).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('rejects empty / whitespace-only critique', async () => {
    const { port, calls } = makePort();
    expect(await recordReflexion(port, args({ critique: '' }))).toBeNull();
    expect(
      await recordReflexion(port, args({ critique: '   \n  \t  ' })),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('maps success boolean to outcome literal', async () => {
    const { port, calls } = makePort();
    await recordReflexion(port, args({ success: true }));
    await recordReflexion(port, args({ success: false, taskId: 'task-2' }));
    expect(calls[0]?.outcome).toBe('success');
    expect(calls[1]?.outcome).toBe('failure');
  });

  it('clamps importance to [0, 1]', async () => {
    const { port, calls } = makePort();
    await recordReflexion(port, args({ importance: -3 }));
    await recordReflexion(port, args({ importance: 99, taskId: 'task-3' }));
    await recordReflexion(port, args({ importance: 0.7, taskId: 'task-4' }));
    expect(calls[0]?.importance).toBe(0);
    expect(calls[1]?.importance).toBe(1);
    expect(calls[2]?.importance).toBeCloseTo(0.7, 5);
  });

  it('defaults importance to 0.5 when omitted', async () => {
    const { port, calls } = makePort();
    await recordReflexion(port, args());
    expect(calls[0]?.importance).toBe(0.5);
  });

  it('truncates a 5 000-char critique to <= 4 000 chars with ellipsis', async () => {
    const { port, calls } = makePort();
    const huge = 'x'.repeat(5_000);
    await recordReflexion(port, args({ critique: huge }));
    expect(calls[0]?.reflection.length).toBeLessThanOrEqual(4_000);
    expect(calls[0]?.reflection.endsWith('…')).toBe(true);
  });

  it('swallows port errors and returns null', async () => {
    const port = makePort();
    port.resetThrow();
    const id = await recordReflexion(port.port, args());
    expect(id).toBeNull();
  });

  it('defaults userId to system + sessionId to taskId when omitted', async () => {
    const { port, calls } = makePort();
    await recordReflexion(port, args({ taskId: 'task-99' }));
    expect(calls[0]?.userId).toBe('system');
    expect(calls[0]?.sessionId).toBe('task-99');
  });

  it('preserves explicit userId + sessionId when supplied', async () => {
    const { port, calls } = makePort();
    await recordReflexion(
      port,
      args({ userId: 'u-7', sessionId: 'sess-7', taskId: 'task-100' }),
    );
    expect(calls[0]?.userId).toBe('u-7');
    expect(calls[0]?.sessionId).toBe('sess-7');
    expect(calls[0]?.taskId).toBe('task-100');
  });

  it('returns the row id on success', async () => {
    const { port } = makePort();
    const id = await recordReflexion(port, args());
    expect(id).toBe('rec-1');
  });
});
