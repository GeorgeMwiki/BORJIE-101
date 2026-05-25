import { describe, expect, it } from 'vitest';
import { createModelRouter, defaultComplexityScorer } from '../cost-optimization/model-router.js';
import { makeScriptedBrain } from './fixtures.js';

describe('createModelRouter', () => {
  it('routes to fast tier for simple short requests by default', async () => {
    const fast = makeScriptedBrain({ turns: [{ text: 'fast', stopReason: 'end_turn', model: 'fast-m' }] });
    const balanced = makeScriptedBrain({ turns: [{ text: 'bal', stopReason: 'end_turn', model: 'bal-m' }] });
    const powerful = makeScriptedBrain({ turns: [{ text: 'pow', stopReason: 'end_turn', model: 'pow-m' }] });
    const router = createModelRouter({
      brains: { fast: fast.brain, balanced: balanced.brain, powerful: powerful.brain },
      policy: {
        defaultTier: 'fast',
        rules: [{ matcher: { kind: 'complexity-above', threshold: 100 }, tier: 'powerful' }],
      },
    });
    const r = await router.brain.call({ system: 'hi', messages: [] });
    expect(r.text).toBe('fast');
    expect(router.lastTier()).toBe('fast');
  });

  it('routes to powerful when complexity exceeds threshold', async () => {
    const fast = makeScriptedBrain({ turns: [{ text: 'fast', stopReason: 'end_turn' }] });
    const balanced = makeScriptedBrain({ turns: [{ text: 'bal', stopReason: 'end_turn' }] });
    const powerful = makeScriptedBrain({ turns: [{ text: 'pow', stopReason: 'end_turn' }] });
    const router = createModelRouter({
      brains: { fast: fast.brain, balanced: balanced.brain, powerful: powerful.brain },
      policy: {
        defaultTier: 'fast',
        rules: [{ matcher: { kind: 'complexity-above', threshold: 5 }, tier: 'powerful' }],
      },
    });
    const longSys = 'a'.repeat(2000);
    const r = await router.brain.call({ system: longSys, messages: [] });
    expect(r.text).toBe('pow');
    expect(router.lastTier()).toBe('powerful');
  });

  it('honours tag-prefix matchers', async () => {
    const fast = makeScriptedBrain({ turns: [{ text: 'fast', stopReason: 'end_turn' }] });
    const balanced = makeScriptedBrain({ turns: [{ text: 'bal', stopReason: 'end_turn' }] });
    const powerful = makeScriptedBrain({ turns: [{ text: 'pow', stopReason: 'end_turn' }] });
    const routed: string[] = [];
    const router = createModelRouter({
      brains: { fast: fast.brain, balanced: balanced.brain, powerful: powerful.brain },
      policy: {
        defaultTier: 'fast',
        rules: [{ matcher: { kind: 'tag-prefix', prefix: 'judge:' }, tier: 'balanced' }],
      },
      onRoute: (e) => routed.push(e.tier),
    });
    await router.brain.call({ system: 'x', messages: [], traceTag: 'judge:rubric' });
    expect(routed).toEqual(['balanced']);
  });

  it('default scorer rises with system prompt length + tool count', () => {
    const low = defaultComplexityScorer({ system: 'short', messages: [] });
    const high = defaultComplexityScorer({
      system: 'a'.repeat(5000),
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 't1', description: 'd', inputSchema: {} }],
    });
    expect(high).toBeGreaterThan(low);
  });
});
