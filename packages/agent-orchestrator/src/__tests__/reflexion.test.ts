import { describe, expect, it } from 'vitest';
import { runReflexion } from '../single-agent/reflexion.js';
import type { Critique, ExecutionResult, Task } from '../types.js';

function attempt(answer: string): ExecutionResult {
  return {
    outcome: 'success',
    answer,
    trace: [],
    usage: { inputTokens: 100, outputTokens: 50 },
    brainCalls: 1,
  };
}

function critique(accept: boolean, confidence: number, rationale = 'r', suggestions: string[] = []): Critique {
  return { accept, confidence, rationale, suggestions };
}

describe('runReflexion', () => {
  it('accepts the first attempt when critic approves above threshold', async () => {
    let runs = 0;
    const result = await runReflexion({
      task: { id: 't', description: 'task' },
      runner: {
        async run() {
          runs++;
          return attempt('first-good');
        },
      },
      evaluator: {
        async evaluate() {
          return { critique: critique(true, 0.9) };
        },
      },
    });
    expect(runs).toBe(1);
    expect(result.outcome).toBe('success');
    expect(result.answer).toBe('first-good');
  });

  it('retries with a learning when first attempt is rejected', async () => {
    const tasksSeenLearnings: (string | null)[] = [];
    let runs = 0;
    const evaluations = [
      critique(false, 0.3, 'too short', ['add detail']),
      critique(true, 0.9, 'good'),
    ];
    const answers = ['short', 'detailed answer'];
    let evalIdx = 0;
    let learnings: string[] = [];
    const result = await runReflexion({
      task: { id: 't', description: 'task' },
      runner: {
        async run(_t: Task, learning: string | null) {
          tasksSeenLearnings.push(learning);
          const a = answers[runs] ?? 'fallback';
          runs++;
          return attempt(a);
        },
      },
      evaluator: {
        async evaluate() {
          const c = evaluations[evalIdx];
          evalIdx++;
          return { critique: c ?? critique(true, 1) };
        },
      },
      onLearning: (l) => learnings.push(l),
    });
    expect(runs).toBe(2);
    expect(tasksSeenLearnings[0]).toBeNull();
    expect(tasksSeenLearnings[1]).not.toBeNull();
    expect(tasksSeenLearnings[1]).toMatch(/add detail/);
    expect(learnings).toHaveLength(1);
    expect(result.outcome).toBe('success');
    expect(result.answer).toBe('detailed answer');
  });

  it('returns failed after exhausting maxLoops', async () => {
    const result = await runReflexion({
      task: { id: 't', description: 'task' },
      runner: { async run() { return attempt('never-good'); } },
      evaluator: { async evaluate() { return { critique: critique(false, 0.1) }; } },
      maxLoops: 2,
    });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/exhausted/);
  });

  it('rejects maxLoops < 1', async () => {
    await expect(
      runReflexion({
        task: { id: 't', description: 'task' },
        runner: { async run() { return attempt('x'); } },
        evaluator: { async evaluate() { return { critique: critique(true, 1) }; } },
        maxLoops: 0,
      }),
    ).rejects.toThrow(/maxLoops/);
  });

  it('forwards budget-exhausted outcome from runner without retry', async () => {
    let runs = 0;
    const result = await runReflexion({
      task: { id: 't', description: 'task' },
      runner: {
        async run() {
          runs++;
          return {
            ...attempt('x'),
            outcome: 'budget-exhausted' as const,
          };
        },
      },
      evaluator: { async evaluate() { return { critique: critique(true, 1) }; } },
    });
    expect(runs).toBe(1);
    expect(result.outcome).toBe('budget-exhausted');
  });
});
