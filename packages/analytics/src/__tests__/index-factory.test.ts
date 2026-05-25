import { describe, expect, it } from 'vitest';
import { createAnalytics } from '../index.js';

describe('createAnalytics', () => {
  it('returns a frozen instance with optional ports preserved', () => {
    const inst = createAnalytics();
    expect(Object.isFrozen(inst)).toBe(true);
    expect(inst.brain).toBeUndefined();
    expect(inst.realtime).toBeUndefined();
  });

  it('passes brain through when supplied', () => {
    const brain = { async completeJson() { return { content: '{}' }; } };
    const inst = createAnalytics({ brain });
    expect(inst.brain).toBe(brain);
  });
});
