import { describe, it, expect } from 'vitest';
import { scoreAttempt } from '../runner/scorers.js';
import type { BfclAttempt, BfclTask } from '../runner/types.js';

const simpleTask: BfclTask = {
  id: 't1',
  category: 'simple',
  prompt: 'p',
  tools: [{ name: 'f', description: 'd', parameters: {} }],
  groundTruth: { kind: 'expected-call', toolName: 'f', args: { x: 1, y: 'a' } },
};

function attempt(over: Partial<BfclAttempt> = {}): BfclAttempt {
  return {
    taskId: 't1',
    category: 'simple',
    producedCall: { toolName: 'f', args: { x: 1, y: 'a' } },
    latencyMs: 1,
    raw: '',
    ...over,
  };
}

describe('scoreAttempt — simple', () => {
  it('passes when name + args match exactly', () => {
    const s = scoreAttempt(simpleTask, attempt());
    expect(s.pass).toBe(true);
    expect(s.score).toBe(1);
  });

  it('fails when tool name mismatches', () => {
    const s = scoreAttempt(simpleTask, attempt({ producedCall: { toolName: 'g', args: { x: 1, y: 'a' } } }));
    expect(s.pass).toBe(false);
    expect(s.score).toBe(0);
  });

  it('partial-credit when one arg matches and one drifts', () => {
    const s = scoreAttempt(simpleTask, attempt({ producedCall: { toolName: 'f', args: { x: 1, y: 'b' } } }));
    expect(s.score).toBeCloseTo(0.5, 5);
    expect(s.pass).toBe(false);
  });

  it('penalises hallucinated extra args', () => {
    const s = scoreAttempt(simpleTask, attempt({ producedCall: { toolName: 'f', args: { x: 1, y: 'a', z: 'hallucinated' } } }));
    expect(s.score).toBeLessThan(1);
  });
});

describe('scoreAttempt — irrelevant', () => {
  const task: BfclTask = {
    id: 't2',
    category: 'irrelevant',
    prompt: 'p',
    tools: [],
    groundTruth: { kind: 'no-call', rationaleHint: 'h' },
  };
  it('passes when no call made', () => {
    const s = scoreAttempt(task, { taskId: 't2', category: 'irrelevant', producedCall: null, latencyMs: 0, raw: '' });
    expect(s.pass).toBe(true);
  });
  it('fails when a call IS made', () => {
    const s = scoreAttempt(task, {
      taskId: 't2',
      category: 'irrelevant',
      producedCall: { toolName: 'whatever', args: {} },
      latencyMs: 0,
      raw: '',
    });
    expect(s.pass).toBe(false);
  });
});

describe('scoreAttempt — parallel', () => {
  const task: BfclTask = {
    id: 't3',
    category: 'parallel',
    prompt: 'p',
    tools: [
      { name: 'a', description: '', parameters: {} },
      { name: 'b', description: '', parameters: {} },
    ],
    groundTruth: {
      kind: 'expected-calls',
      calls: [
        { toolName: 'a', args: { k: 1 } },
        { toolName: 'b', args: { k: 2 } },
      ],
    },
  };

  it('passes when all calls match (order-independent)', () => {
    const s = scoreAttempt(task, {
      taskId: 't3',
      category: 'parallel',
      producedCall: [
        { toolName: 'b', args: { k: 2 } },
        { toolName: 'a', args: { k: 1 } },
      ],
      latencyMs: 0,
      raw: '',
    });
    expect(s.pass).toBe(true);
  });

  it('fails when call count mismatches', () => {
    const s = scoreAttempt(task, {
      taskId: 't3',
      category: 'parallel',
      producedCall: [{ toolName: 'a', args: { k: 1 } }],
      latencyMs: 0,
      raw: '',
    });
    expect(s.pass).toBe(false);
  });
});

describe('scoreAttempt — multi_turn', () => {
  const task: BfclTask = {
    id: 't4',
    category: 'multi_turn',
    prompt: 'p',
    tools: [],
    groundTruth: {
      kind: 'multi-turn-trace',
      turns: [
        { toolName: 'lookup', args: { id: 1 }, response: { ok: true } },
        { toolName: 'commit', args: { id: 1, value: 'x' }, response: { ok: true } },
      ],
    },
  };

  it('passes when the FINAL call matches', () => {
    const s = scoreAttempt(task, {
      taskId: 't4',
      category: 'multi_turn',
      producedCall: { toolName: 'commit', args: { id: 1, value: 'x' } },
      latencyMs: 0,
      raw: '',
    });
    expect(s.pass).toBe(true);
  });
});
