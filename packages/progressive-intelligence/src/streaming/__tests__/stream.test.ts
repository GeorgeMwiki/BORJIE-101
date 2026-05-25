import { describe, expect, it } from 'vitest';
import type { Brain, BrainChunk, StreamingEvent } from '../../types.js';
import { encodeSse, streamInference, streamInferenceAsSse } from '../stream.js';

function chunkBrain(chunks: BrainChunk[]): Brain {
  return {
    stream() {
      return {
        async *[Symbol.asyncIterator]() {
          for (const c of chunks) yield c;
        },
      };
    },
  };
}

function throwingBrain(): Brain {
  return {
    stream() {
      throw new Error('brain-down');
    },
  };
}

const fixedClock = () => new Date('2026-05-24T10:00:00Z');

describe('streamInference', () => {
  it('emits start meta + tokens + done', async () => {
    const brain = chunkBrain([
      { kind: 'token', text: 'hello ' },
      { kind: 'token', text: 'world' },
      { kind: 'done' },
    ]);
    const events: StreamingEvent[] = [];
    for await (const ev of streamInference({
      request: { prompt: 'hi' },
      brain,
      now: fixedClock,
    })) {
      events.push(ev);
    }
    // start meta + 2 tokens + done emitted by mapChunk (the trailing
    // "stream-ended" inside the try block is overwritten because we
    // return after seeing done).
    expect(events[0]?.kind).toBe('meta');
    expect(events.slice(1, 3).map((e) => e.kind)).toEqual(['token', 'token']);
    expect(events.at(-1)?.kind).toBe('done');
    const ids = events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('emits an error event when the brain throws', async () => {
    const events: StreamingEvent[] = [];
    for await (const ev of streamInference({
      request: { prompt: 'x' },
      brain: throwingBrain(),
      now: fixedClock,
    })) {
      events.push(ev);
    }
    expect(events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('respects resumeFromId — first event id is resume+2', async () => {
    const brain = chunkBrain([{ kind: 'token', text: 'tok' }, { kind: 'done' }]);
    const events: StreamingEvent[] = [];
    for await (const ev of streamInference({
      request: { prompt: 'x' },
      brain,
      now: fixedClock,
      resumeFromId: 10,
    })) {
      events.push(ev);
    }
    // start meta gets id 11, token 12, done 13
    expect(events[0]?.id).toBe(11);
    expect(events[1]?.id).toBe(12);
    expect(events.at(-1)?.id).toBe(13);
  });
});

describe('encodeSse', () => {
  it('emits standard SSE frame', () => {
    const ev: StreamingEvent = {
      id: 42,
      kind: 'token',
      data: 'hello',
      ts: '2026-05-24T10:00:00.000Z',
    };
    const frame = encodeSse(ev);
    expect(frame).toContain('id: 42');
    expect(frame).toContain('event: token');
    expect(frame).toContain('data: hello');
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('splits multi-line data', () => {
    const ev: StreamingEvent = {
      id: 1,
      kind: 'token',
      data: 'line1\nline2',
      ts: 't',
    };
    const frame = encodeSse(ev);
    expect(frame).toContain('data: line1');
    expect(frame).toContain('data: line2');
  });

  it('includes meta as a separate data line', () => {
    const ev: StreamingEvent = {
      id: 1,
      kind: 'done',
      data: 'done',
      ts: 't',
      meta: { tokens: 10 },
    };
    const frame = encodeSse(ev);
    expect(frame).toContain('"meta":{"tokens":10}');
  });
});

describe('streamInferenceAsSse', () => {
  it('yields SSE-formatted strings end-to-end', async () => {
    const brain = chunkBrain([{ kind: 'token', text: 'x' }, { kind: 'done' }]);
    const frames: string[] = [];
    for await (const f of streamInferenceAsSse({
      request: { prompt: 'hi' },
      brain,
      now: fixedClock,
    })) {
      frames.push(f);
    }
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.every((f) => f.includes('event: '))).toBe(true);
    expect(frames.every((f) => f.endsWith('\n\n'))).toBe(true);
  });
});
