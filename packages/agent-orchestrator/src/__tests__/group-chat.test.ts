import { describe, expect, it } from 'vitest';
import { createGroupChat, DEFAULT_TERMINATOR } from '../multi-agent/group-chat.js';
import { makeAgent, makeScriptedBrain } from './fixtures.js';

describe('createGroupChat', () => {
  it('runs round-robin until terminator emitted', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'first agent', stopReason: 'end_turn' },
        { text: 'second agent', stopReason: 'end_turn' },
        { text: `third agent ${DEFAULT_TERMINATOR}`, stopReason: 'end_turn' },
      ],
    });
    const chat = createGroupChat({
      agents: [
        makeAgent({ id: 'a1' }),
        makeAgent({ id: 'a2' }),
        makeAgent({ id: 'a3' }),
      ],
      mode: { kind: 'round-robin' },
      brain,
      maxRounds: 10,
    });
    const { result, state } = await chat.run({ id: 't', description: 'kickoff' });
    expect(result.outcome).toBe('success');
    expect(state.finished).toBe(true);
    expect(state.finishReason).toMatch(/TERMINATE/);
    expect(state.round).toBe(3);
  });

  it('enforces maxRounds when no terminator appears', async () => {
    const { brain } = makeScriptedBrain({
      turns: Array(10).fill({ text: 'rambling', stopReason: 'end_turn' as const }),
    });
    const chat = createGroupChat({
      agents: [makeAgent({ id: 'a' }), makeAgent({ id: 'b' })],
      mode: { kind: 'round-robin' },
      brain,
      maxRounds: 4,
    });
    const { state } = await chat.run({ id: 't', description: 'x' });
    expect(state.finished).toBe(false);
    expect(state.round).toBe(4);
    expect(state.finishReason).toMatch(/maxRounds/);
  });

  it('manager-routed mode delegates speaker selection to manager', async () => {
    // Sequence: manager says "a", a speaks, manager says "b", b speaks (with TERMINATE)
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'a', stopReason: 'end_turn' },         // manager picks a
        { text: 'agent a speaks', stopReason: 'end_turn' },
        { text: 'b', stopReason: 'end_turn' },         // manager picks b
        { text: `agent b speaks ${DEFAULT_TERMINATOR}`, stopReason: 'end_turn' },
      ],
    });
    const chat = createGroupChat({
      agents: [
        makeAgent({ id: 'a' }),
        makeAgent({ id: 'b' }),
        makeAgent({ id: 'mgr' }),
      ],
      mode: { kind: 'manager-routed', managerAgentId: 'mgr' },
      brain,
      maxRounds: 6,
    });
    const { state } = await chat.run({ id: 't', description: 'hi' });
    expect(state.finished).toBe(true);
    expect(state.messages.some((m) => m.agentId === 'a')).toBe(true);
    expect(state.messages.some((m) => m.agentId === 'b')).toBe(true);
  });

  it('respects custom shouldStop predicate', async () => {
    const { brain } = makeScriptedBrain({
      turns: Array(10).fill({ text: 'msg', stopReason: 'end_turn' as const }),
    });
    const chat = createGroupChat({
      agents: [makeAgent({ id: 'x' })],
      mode: { kind: 'round-robin' },
      brain,
      maxRounds: 10,
      shouldStop: (s) => s.round >= 2,
    });
    const { state } = await chat.run({ id: 't', description: 'go' });
    expect(state.round).toBe(2);
    expect(state.finishReason).toMatch(/shouldStop/);
  });

  it('throws when manager-routed without a known manager agent', () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: '', stopReason: 'end_turn' }] });
    expect(() =>
      createGroupChat({
        agents: [makeAgent({ id: 'a' })],
        mode: { kind: 'manager-routed', managerAgentId: 'ghost' },
        brain,
        maxRounds: 5,
      }),
    ).toThrow(/managerAgentId/);
  });
});
