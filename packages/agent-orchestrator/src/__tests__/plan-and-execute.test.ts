import { describe, expect, it } from 'vitest';
import { runPlanAndExecute } from '../single-agent/plan-and-execute.js';
import type {
  Composer,
  Executor,
  Planner,
  StepExecutionResult,
} from '../single-agent/plan-and-execute.js';
import type { Plan, Step, Task } from '../types.js';

function plan(steps: Step[], id = 'p1', task: Task = { id: 't', description: 'd' }): Plan {
  return { id, task, steps };
}

function planner(p: Plan): Planner {
  return {
    async plan() {
      return { plan: p, usage: { inputTokens: 50, outputTokens: 10 } };
    },
  };
}

function exec(behavior: 'ok' | 'fail-step-2' = 'ok'): Executor {
  return {
    async execute(step: Step): Promise<StepExecutionResult> {
      if (behavior === 'fail-step-2' && step.id === 's2') {
        return { stepId: step.id, ok: false, output: null, error: 'boom' };
      }
      return {
        stepId: step.id,
        ok: true,
        output: { ran: step.id },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
}

function composer(): Composer {
  return {
    async compose(_t, _p, results) {
      return { answer: `ran ${results.length} step(s)`, usage: { inputTokens: 5, outputTokens: 5 } };
    },
  };
}

describe('runPlanAndExecute', () => {
  it('runs a 2-step plan in topological order and composes the result', async () => {
    const p = plan([
      { id: 's1', description: 'first', toolName: 'a', dependsOn: [] },
      { id: 's2', description: 'second', toolName: 'b', dependsOn: ['s1'] },
    ]);
    const result = await runPlanAndExecute({
      task: p.task,
      planner: planner(p),
      executor: exec('ok'),
      composer: composer(),
    });
    expect(result.outcome).toBe('success');
    expect(result.answer).toBe('ran 2 step(s)');
    expect(result.brainCalls).toBe(4); // 1 planner + 2 execs + 1 compose
    // Validate trace ordering.
    const planActions = result.trace.filter((e) => e.kind === 'action').map((e) => e.detail);
    expect(planActions[0]).toContain('s1');
    expect(planActions[1]).toContain('s2');
  });

  it('halts on first step failure and returns failed outcome', async () => {
    const p = plan([
      { id: 's1', description: 'a', toolName: 't', dependsOn: [] },
      { id: 's2', description: 'b', toolName: 't', dependsOn: ['s1'] },
      { id: 's3', description: 'c', toolName: 't', dependsOn: ['s2'] },
    ]);
    const result = await runPlanAndExecute({
      task: p.task,
      planner: planner(p),
      executor: exec('fail-step-2'),
      composer: composer(),
    });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/s2 failed/);
  });

  it('rejects a plan with a dependency cycle', async () => {
    const p = plan([
      { id: 'a', description: 'a', toolName: 't', dependsOn: ['b'] },
      { id: 'b', description: 'b', toolName: 't', dependsOn: ['a'] },
    ]);
    const result = await runPlanAndExecute({
      task: p.task,
      planner: planner(p),
      executor: exec('ok'),
      composer: composer(),
    });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/cycle/);
  });

  it('rejects a plan exceeding maxSteps', async () => {
    const steps = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`,
      description: 's',
      toolName: 't',
      dependsOn: [] as ReadonlyArray<string>,
    }));
    const p = plan(steps);
    const result = await runPlanAndExecute({
      task: p.task,
      planner: planner(p),
      executor: exec('ok'),
      composer: composer(),
      maxSteps: 3,
    });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/maxSteps/);
  });

  it('handles an empty plan as success', async () => {
    const p = plan([]);
    const result = await runPlanAndExecute({
      task: p.task,
      planner: planner(p),
      executor: exec('ok'),
      composer: composer(),
    });
    expect(result.outcome).toBe('success');
  });
});
