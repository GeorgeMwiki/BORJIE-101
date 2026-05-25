import { describe, expect, it } from 'vitest';
import { createSupervisorTeam } from '../multi-agent/supervisor.js';
import { makeAgent, makeScriptedBrain } from './fixtures.js';

describe('createSupervisorTeam', () => {
  it('plans → routes to workers → composes final answer', async () => {
    const plan = JSON.stringify({
      subtasks: [
        { description: 'price the property', workerId: 'pricer' },
        { description: 'draft the listing copy', workerId: 'copywriter' },
      ],
    });
    const { brain } = makeScriptedBrain({
      turns: [
        { text: plan, stopReason: 'end_turn' },
        { text: 'price = 250k', stopReason: 'end_turn' },
        { text: 'copy = sunny villa', stopReason: 'end_turn' },
        { text: 'Final: list at 250k with copy "sunny villa".', stopReason: 'end_turn' },
      ],
    });
    const team = createSupervisorTeam({
      supervisor: makeAgent({ id: 'ceo', role: 'supervisor' }),
      workers: [
        makeAgent({ id: 'pricer', role: 'specialist' }),
        makeAgent({ id: 'copywriter', role: 'specialist' }),
      ],
      brain,
    });
    const result = await team.run({ id: 't', description: 'list this property' });
    expect(result.outcome).toBe('success');
    expect(result.answer).toMatch(/250k/);
    expect(result.brainCalls).toBe(4);
    expect(result.trace.some((e) => e.kind === 'handoff')).toBe(true);
  });

  it('fails when supervisor returns unparseable plan', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'no json here', stopReason: 'end_turn' }],
    });
    const team = createSupervisorTeam({
      supervisor: makeAgent({ id: 'ceo' }),
      workers: [makeAgent({ id: 'w1' })],
      brain,
    });
    const result = await team.run({ id: 't', description: 'x' });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/parseable plan/);
  });

  it('enforces maxSubtasks limit', async () => {
    const big = JSON.stringify({
      subtasks: Array(20).fill({ description: 'd', workerId: 'w1' }),
    });
    const { brain } = makeScriptedBrain({
      turns: [{ text: big, stopReason: 'end_turn' }],
    });
    const team = createSupervisorTeam({
      supervisor: makeAgent({ id: 'ceo' }),
      workers: [makeAgent({ id: 'w1' })],
      brain,
      maxSubtasks: 3,
    });
    const r = await team.run({ id: 't', description: 'x' });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toMatch(/maxSubtasks/);
  });

  it('honours handoffPolicy override when supplied', async () => {
    const plan = JSON.stringify({
      subtasks: [{ description: 'do it', workerId: 'w1' }],
    });
    const { brain } = makeScriptedBrain({
      turns: [
        { text: plan, stopReason: 'end_turn' },
        { text: 'overridden', stopReason: 'end_turn' },
        { text: 'final', stopReason: 'end_turn' },
      ],
    });
    let policyCalled = false;
    const team = createSupervisorTeam({
      supervisor: makeAgent({ id: 'ceo' }),
      workers: [makeAgent({ id: 'w1' }), makeAgent({ id: 'w2' })],
      brain,
      handoffPolicy: (_sub, candidates) => {
        policyCalled = true;
        return candidates[1]?.id ?? null;
      },
    });
    await team.run({ id: 't', description: 'x' });
    expect(policyCalled).toBe(true);
  });
});
