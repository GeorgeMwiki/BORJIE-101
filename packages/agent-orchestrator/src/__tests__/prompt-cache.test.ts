import { describe, expect, it } from 'vitest';
import { createPromptCacheManager } from '../cost-optimization/prompt-cache.js';
import { makeScriptedBrain } from './fixtures.js';

describe('createPromptCacheManager', () => {
  it('marks the first request as creation and subsequent identical ones as reuse', async () => {
    const tags: string[] = [];
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'a', stopReason: 'end_turn' },
        { text: 'b', stopReason: 'end_turn' },
        { text: 'c', stopReason: 'end_turn' },
      ],
      onRequest: (req) => req.traceTag && tags.push(req.traceTag),
    });
    const cache = createPromptCacheManager({ brain });
    await cache.brain.call({ system: 'sys1', messages: [] });
    await cache.brain.call({ system: 'sys1', messages: [] });
    await cache.brain.call({ system: 'sys2', messages: [] });
    expect(tags[0]).toMatch(/:first/);
    expect(tags[1]).toMatch(/:reuse/);
    expect(tags[2]).toMatch(/:first/);
    const s = cache.stats();
    expect(s.creations).toBe(2);
    expect(s.reuses).toBe(1);
    expect(s.distinctKeys).toBe(2);
  });

  it('signature varies with tool catalogue', () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: 'x', stopReason: 'end_turn' }] });
    const cache = createPromptCacheManager({ brain });
    const sigA = cache.signature({ system: 's', messages: [], tools: [{ name: 'a', description: 'd', inputSchema: {} }] });
    const sigB = cache.signature({ system: 's', messages: [], tools: [{ name: 'b', description: 'd', inputSchema: {} }] });
    expect(sigA).not.toEqual(sigB);
  });

  it('reset clears state', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'x', stopReason: 'end_turn' }, { text: 'x', stopReason: 'end_turn' }],
    });
    const cache = createPromptCacheManager({ brain });
    await cache.brain.call({ system: 's', messages: [] });
    expect(cache.stats().creations).toBe(1);
    cache.reset();
    expect(cache.stats().creations).toBe(0);
    await cache.brain.call({ system: 's', messages: [] });
    expect(cache.stats().creations).toBe(1);
  });
});
