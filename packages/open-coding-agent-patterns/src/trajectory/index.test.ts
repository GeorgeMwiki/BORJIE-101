import { describe, expect, it } from 'vitest';

import {
  createTrajectoryRecorder,
  deserializeTrajectory,
  instrumentBrain,
  instrumentSandbox,
  replayTrajectory,
  serializeTrajectory,
} from './index.js';
import { createMockBrain } from '../__tests__/fixtures/setup.js';
import type {
  AgentTrajectory,
  BrainResponse,
  SandboxCommand,
  SandboxExecutionResult,
  SandboxPort,
  TrajectoryEvent,
} from '../types.js';

function fakeSandbox(result: SandboxExecutionResult): SandboxPort {
  return {
    kind: 'local-subprocess',
    exec: async (_cmd: SandboxCommand): Promise<SandboxExecutionResult> => result,
  };
}

describe('trajectory :: createTrajectoryRecorder', () => {
  it('records events with monotonically increasing seq + timestamps', () => {
    let t = 1000;
    const rec = createTrajectoryRecorder({
      sessionId: 'sess-1',
      now: () => {
        const out = t;
        t += 10;
        return out;
      },
    });
    rec.record('brain-call', { prompt: 'a' });
    rec.record('sandbox-exec', { cmd: 'ls' });
    const snap = rec.snapshot();
    expect(snap.sessionId).toBe('sess-1');
    expect(snap.events).toHaveLength(2);
    expect(snap.events[0]?.seq).toBe(1);
    expect(snap.events[1]?.seq).toBe(2);
    expect(snap.events[0]!.at).toBeLessThan(snap.events[1]!.at);
  });

  it('reset clears events + restarts seq', () => {
    const rec = createTrajectoryRecorder({ sessionId: 's' });
    rec.record('brain-call', {});
    rec.reset();
    rec.record('brain-call', {});
    expect(rec.snapshot().events).toHaveLength(1);
    expect(rec.snapshot().events[0]?.seq).toBe(1);
  });
});

describe('trajectory :: instrumentBrain', () => {
  it('records both prompt and response', async () => {
    const rec = createTrajectoryRecorder({ sessionId: 's' });
    const inner = createMockBrain({ responses: ['hello world'] });
    const wrapped = instrumentBrain(inner, rec);
    const res = await wrapped.generate({ prompt: 'say hi' });
    expect(res.text).toBe('hello world');
    const events = rec.snapshot().events;
    expect(events).toHaveLength(2);
    expect(events[0]?.payload['prompt']).toBe('say hi');
    expect(events[1]?.payload['responseText']).toBe('hello world');
  });
});

describe('trajectory :: instrumentSandbox', () => {
  it('records the command + exit code', async () => {
    const rec = createTrajectoryRecorder({ sessionId: 's' });
    const inner = fakeSandbox({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      truncated: false,
    });
    const wrapped = instrumentSandbox(inner, rec);
    const res = await wrapped.exec({ cmd: 'echo hi', cwd: '/' });
    expect(res.exitCode).toBe(0);
    const events = rec.snapshot().events;
    expect(events).toHaveLength(2);
    expect(events[0]?.payload['cmd']).toBe('echo hi');
    expect(events[1]?.payload['exitCode']).toBe(0);
  });
});

describe('trajectory :: replayTrajectory', () => {
  function makeTrajectory(events: ReadonlyArray<TrajectoryEvent>): AgentTrajectory {
    return Object.freeze({
      sessionId: 's',
      startedAt: 0,
      endedAt: 100,
      events: Object.freeze(events),
    });
  }

  it('reports matches when replayed brain returns identical text', async () => {
    const traj = makeTrajectory([
      { seq: 1, at: 1, kind: 'brain-call', payload: { prompt: 'p' } },
      { seq: 2, at: 2, kind: 'brain-call', payload: { prompt: 'p', responseText: 'r' } },
    ]);
    const report = await replayTrajectory({
      trajectory: traj,
      brainReplay: async (params): Promise<BrainResponse> => ({
        text: params.expected ?? '',
      }),
    });
    expect(report.matches).toBe(1);
    expect(report.mismatches).toBe(0);
  });

  it('reports mismatches when brain output diverges', async () => {
    const traj = makeTrajectory([
      { seq: 1, at: 1, kind: 'brain-call', payload: { prompt: 'p' } },
      { seq: 2, at: 2, kind: 'brain-call', payload: { prompt: 'p', responseText: 'old' } },
    ]);
    const report = await replayTrajectory({
      trajectory: traj,
      brainReplay: async () => ({ text: 'new-different' }),
    });
    expect(report.mismatches).toBe(1);
    expect(report.diff[0]?.reason).toContain('brain response text differs');
  });

  it('reports matches for sandbox-exec replay with same exit code', async () => {
    const traj = makeTrajectory([
      { seq: 1, at: 1, kind: 'sandbox-exec', payload: { cmd: 'ls' } },
      {
        seq: 2,
        at: 2,
        kind: 'sandbox-exec',
        payload: { cmd: 'ls', exitCode: 0, durationMs: 1, timedOut: false },
      },
    ]);
    const report = await replayTrajectory({
      trajectory: traj,
      sandbox: fakeSandbox({
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        truncated: false,
      }),
    });
    expect(report.matches).toBe(1);
    expect(report.mismatches).toBe(0);
  });

  it('reports mismatches when sandbox exit code drifts', async () => {
    const traj = makeTrajectory([
      { seq: 1, at: 1, kind: 'sandbox-exec', payload: { cmd: 'ls' } },
      {
        seq: 2,
        at: 2,
        kind: 'sandbox-exec',
        payload: { cmd: 'ls', exitCode: 0, durationMs: 1, timedOut: false },
      },
    ]);
    const report = await replayTrajectory({
      trajectory: traj,
      sandbox: fakeSandbox({
        stdout: '',
        stderr: '',
        exitCode: 1,
        durationMs: 1,
        timedOut: false,
        truncated: false,
      }),
    });
    expect(report.mismatches).toBe(1);
    expect(report.diff[0]?.reason).toContain('sandbox exit');
  });
});

describe('trajectory :: serialize + deserialize round-trip', () => {
  it('preserves event shape', () => {
    const traj: AgentTrajectory = {
      sessionId: 's',
      startedAt: 1,
      endedAt: 2,
      events: Object.freeze([
        Object.freeze({
          seq: 1,
          at: 1,
          kind: 'brain-call' as const,
          payload: Object.freeze({ prompt: 'hello' }),
        }),
      ]),
    };
    const json = serializeTrajectory(traj);
    const back = deserializeTrajectory(json);
    expect(back.sessionId).toBe('s');
    expect(back.events[0]?.kind).toBe('brain-call');
    expect(back.events[0]?.payload['prompt']).toBe('hello');
  });
});
