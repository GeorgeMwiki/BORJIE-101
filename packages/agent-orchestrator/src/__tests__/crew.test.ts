import { describe, expect, it } from 'vitest';
import { createCrewWorkflow } from '../multi-agent/crew.js';
import { makeAgent, makeScriptedBrain } from './fixtures.js';

describe('createCrewWorkflow', () => {
  it('runs tasks sequentially and threads context', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'task A done', stopReason: 'end_turn' },
        { text: 'task B done', stopReason: 'end_turn' },
      ],
    });
    const crew = createCrewWorkflow({
      agents: [makeAgent({ id: 'w1' }), makeAgent({ id: 'w2' })],
      tasks: [
        { id: 't1', description: 'first', assignedTo: 'w1', expectedOutput: 'string' },
        { id: 't2', description: 'second', assignedTo: 'w2', expectedOutput: 'string' },
      ],
      process: 'sequential',
      brain,
    });
    const { result, perTask } = await crew.run();
    expect(result.outcome).toBe('success');
    expect(perTask).toHaveLength(2);
    expect(perTask[0]?.taskId).toBe('t1');
    expect(perTask[1]?.taskId).toBe('t2');
    expect(result.answer).toContain('task B done');
  });

  it('hierarchical mode invokes manager + worker per task', async () => {
    // Per task: manager refines, then worker executes.
    const { brain, allRequests } = makeScriptedBrain({
      turns: [
        { text: 'refined: do A precisely', stopReason: 'end_turn' },
        { text: 'A done', stopReason: 'end_turn' },
        { text: 'refined: do B precisely', stopReason: 'end_turn' },
        { text: 'B done', stopReason: 'end_turn' },
      ],
    });
    const crew = createCrewWorkflow({
      agents: [
        makeAgent({ id: 'mgr', role: 'supervisor' }),
        makeAgent({ id: 'w1' }),
        makeAgent({ id: 'w2' }),
      ],
      tasks: [
        { id: 't1', description: 'A', assignedTo: 'w1', expectedOutput: 'string' },
        { id: 't2', description: 'B', assignedTo: 'w2', expectedOutput: 'string' },
      ],
      process: 'hierarchical',
      managerId: 'mgr',
      brain,
    });
    const { result, perTask } = await crew.run();
    expect(result.outcome).toBe('success');
    expect(perTask).toHaveLength(2);
    expect(result.brainCalls).toBe(4);
    expect(allRequests().some((r) => r.traceTag?.startsWith('crew:manager:'))).toBe(true);
  });

  it('throws when hierarchical mode missing managerId', () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: 'x', stopReason: 'end_turn' }] });
    expect(() =>
      createCrewWorkflow({
        agents: [makeAgent({ id: 'a' })],
        tasks: [{ id: 't1', description: 'd', assignedTo: 'a', expectedOutput: 'x' }],
        process: 'hierarchical',
        brain,
      }),
    ).toThrow(/managerId required/);
  });

  it('throws when a task is assigned to an unknown agent', () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: 'x', stopReason: 'end_turn' }] });
    expect(() =>
      createCrewWorkflow({
        agents: [makeAgent({ id: 'a' })],
        tasks: [{ id: 't1', description: 'd', assignedTo: 'ghost', expectedOutput: 'x' }],
        process: 'sequential',
        brain,
      }),
    ).toThrow(/ghost/);
  });
});
