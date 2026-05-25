import { describe, expect, it } from 'vitest';
import { createSwarm } from '../multi-agent/swarm.js';
import { HandoffLoopError } from '../types.js';
import { makeAgent, makeScriptedBrain } from './fixtures.js';

describe('createSwarm', () => {
  it('responds with default agent when no handoff rules apply', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'Hello from default!', stopReason: 'end_turn' }],
    });
    const swarm = createSwarm({
      agents: [makeAgent({ id: 'greeter' })],
      defaultAgent: 'greeter',
      handoffRules: [],
      brain,
    });
    const result = await swarm.run({ id: 't', description: 'hi' });
    expect(result.outcome).toBe('success');
    expect(result.answer).toBe('Hello from default!');
    expect(result.brainCalls).toBe(1);
  });

  it('hands off to another agent when predicate matches', async () => {
    const events: string[] = [];
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'I need to ESCALATE to billing.', stopReason: 'end_turn' },
        { text: 'Billing agent here, all sorted.', stopReason: 'end_turn' },
      ],
    });
    const swarm = createSwarm({
      agents: [
        makeAgent({ id: 'support', name: 'Support' }),
        makeAgent({ id: 'billing', name: 'Billing' }),
      ],
      defaultAgent: 'support',
      handoffRules: [
        {
          fromAgentId: 'support',
          predicate: (msg) =>
            /escalate/i.test(msg) ? { toAgentId: 'billing', reason: 'escalation' } : null,
        },
      ],
      brain,
      onEvent: (ev) => events.push(ev.kind),
    });
    const result = await swarm.run({ id: 't', description: 'help me' });
    expect(result.outcome).toBe('success');
    expect(result.answer).toBe('Billing agent here, all sorted.');
    expect(events).toContain('handoff');
    expect(result.trace.some((e) => e.kind === 'handoff')).toBe(true);
  });

  it('throws HandoffLoopError when the same edge fires twice', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'go to b', stopReason: 'end_turn' },
        { text: 'back to a', stopReason: 'end_turn' },
        { text: 'go to b again', stopReason: 'end_turn' },
      ],
    });
    const swarm = createSwarm({
      agents: [makeAgent({ id: 'a' }), makeAgent({ id: 'b' })],
      defaultAgent: 'a',
      handoffRules: [
        { fromAgentId: 'a', predicate: () => ({ toAgentId: 'b', reason: 'a→b' }) },
        { fromAgentId: 'b', predicate: () => ({ toAgentId: 'a', reason: 'b→a' }) },
      ],
      brain,
    });
    await expect(swarm.run({ id: 't', description: 'x' })).rejects.toThrow(HandoffLoopError);
  });

  it('fails when handoff target is unknown', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'route me', stopReason: 'end_turn' }],
    });
    const swarm = createSwarm({
      agents: [makeAgent({ id: 'a' })],
      defaultAgent: 'a',
      handoffRules: [
        { fromAgentId: 'a', predicate: () => ({ toAgentId: 'ghost', reason: 'nope' }) },
      ],
      brain,
    });
    const r = await swarm.run({ id: 't', description: 'x' });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toMatch(/ghost/);
  });

  it('throws when defaultAgent not in agents list', () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: '', stopReason: 'end_turn' }] });
    expect(() =>
      createSwarm({
        agents: [makeAgent({ id: 'a' })],
        defaultAgent: 'missing',
        handoffRules: [],
        brain,
      }),
    ).toThrow(/defaultAgent/);
  });
});
