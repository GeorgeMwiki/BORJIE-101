import { describe, expect, it } from 'vitest';
import {
  defineGraph,
  runGraph,
  replayFromCheckpoint,
  createInMemoryCheckpointStore,
  END,
} from '../state-machine/graph.js';
import { makeScriptedBrain } from './fixtures.js';

interface S {
  readonly count: number;
  readonly log: ReadonlyArray<string>;
}

describe('defineGraph / runGraph', () => {
  it('walks a 3-node linear graph end-to-end', async () => {
    const spec = defineGraph<S>({
      nodes: {
        a: async ({ state }) => ({ patch: { count: state.count + 1, log: [...state.log, 'a'] } }),
        b: async ({ state }) => ({ patch: { count: state.count + 10, log: [...state.log, 'b'] } }),
        c: async ({ state }) => ({ patch: { count: state.count + 100, log: [...state.log, 'c'] }, goto: END }),
      },
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      entry: 'a',
    });
    const { brain } = makeScriptedBrain({ turns: [] });
    const updates = [];
    for await (const u of runGraph({ spec, initialState: { count: 0, log: [] }, brain })) {
      updates.push(u);
    }
    expect(updates).toHaveLength(4); // 3 nodes + 1 terminal
    expect(updates.at(-1)?.terminal).toBe(true);
    expect(updates.at(-1)?.state.count).toBe(111);
    expect(updates.at(-1)?.state.log).toEqual(['a', 'b', 'c']);
  });

  it('respects conditional edges', async () => {
    const spec = defineGraph<S>({
      nodes: {
        start: async ({ state }) => ({ patch: { count: state.count + 1, log: [...state.log, 'start'] } }),
        even: async ({ state }) => ({ patch: { log: [...state.log, 'even'] }, goto: END }),
        odd: async ({ state }) => ({ patch: { log: [...state.log, 'odd'] }, goto: END }),
      },
      conditionalEdges: [
        { from: 'start', choose: (s) => (s.count % 2 === 0 ? 'even' : 'odd') },
      ],
      entry: 'start',
    });
    const { brain } = makeScriptedBrain({ turns: [] });
    const updates = [];
    for await (const u of runGraph({ spec, initialState: { count: 0, log: [] }, brain })) {
      updates.push(u);
    }
    expect(updates.at(-1)?.state.log).toEqual(['start', 'odd']); // 0+1=1 odd
  });

  it('checkpoints every step and supports replay', async () => {
    const store = createInMemoryCheckpointStore<S>();
    const spec = defineGraph<S>({
      nodes: {
        a: async ({ state }) => ({ patch: { log: [...state.log, 'a'] } }),
        b: async ({ state }) => ({ patch: { log: [...state.log, 'b'] }, goto: END }),
      },
      edges: [{ from: 'a', to: 'b' }],
      entry: 'a',
    });
    const { brain } = makeScriptedBrain({ turns: [] });
    const runId = 'fixed-run-id';
    const seen = [];
    for await (const u of runGraph({
      spec,
      initialState: { count: 0, log: [] },
      brain,
      runId,
      store,
    })) {
      seen.push(u);
    }
    const replay = await replayFromCheckpoint(runId, store);
    expect(replay.length).toBe(seen.length);
    expect(replay.at(-1)?.terminal).toBe(true);
  });

  it('rejects an entry node that is not defined', () => {
    expect(() =>
      defineGraph<S>({
        nodes: { a: async () => ({ goto: END }) },
        entry: 'missing',
      }),
    ).toThrow(/entry node/);
  });

  it('rejects an edge referencing an unknown node', () => {
    expect(() =>
      defineGraph<S>({
        nodes: { a: async () => ({ goto: END }) },
        edges: [{ from: 'a', to: 'ghost' }],
        entry: 'a',
      }),
    ).toThrow(/unknown node/);
  });

  it('enforces maxSteps to prevent runaway graphs', async () => {
    const spec = defineGraph<S>({
      nodes: {
        loop: async ({ state }) => ({ patch: { count: state.count + 1 } }),
      },
      edges: [{ from: 'loop', to: 'loop' }],
      entry: 'loop',
    });
    const { brain } = makeScriptedBrain({ turns: [] });
    const updates = [];
    for await (const u of runGraph({
      spec,
      initialState: { count: 0, log: [] },
      brain,
      maxSteps: 5,
    })) {
      updates.push(u);
    }
    expect(updates).toHaveLength(5);
    expect(updates.at(-1)?.terminal).toBe(false);
  });
});
