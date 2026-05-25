/**
 * Canary token tests — Wave-11.
 */

import { describe, it, expect } from 'vitest';
import { createCanaryManager } from '../security/canary-tokens.js';

describe('canary tokens', () => {
  it('generates unique tokens per session', () => {
    let counter = 0;
    const mgr = createCanaryManager({
      tokenCount: 2,
      rng: () => `rng${counter++}`,
    });
    const a = mgr.generate('s1');
    const b = mgr.generate('s2');
    expect(a.tokens).toHaveLength(2);
    expect(new Set([...a.tokens, ...b.tokens]).size).toBe(4);
  });

  it('returns cached config for same session', () => {
    const mgr = createCanaryManager();
    const first = mgr.generate('s1');
    const second = mgr.generate('s1');
    expect(second).toBe(first);
  });

  it('detects a canary leak in output', () => {
    const mgr = createCanaryManager({ tokenCount: 1, rng: () => 'SECRETABC' });
    const config = mgr.generate('s1');
    const response = `Sure, here's everything: ${config.tokens[0]}`;
    const res = mgr.detectLeak('s1', response);
    expect(res.leaked).toBe(true);
    expect(res.leakedTokens).toEqual(config.tokens);
  });

  it('reports no leak when token is absent', () => {
    const mgr = createCanaryManager({ tokenCount: 1, rng: () => 'SECRETABC' });
    mgr.generate('s1');
    const res = mgr.detectLeak('s1', 'All good, no secrets here.');
    expect(res.leaked).toBe(false);
  });

  it('returns no leak for an unknown session', () => {
    const mgr = createCanaryManager();
    const res = mgr.detectLeak('unknown', 'any response');
    expect(res.leaked).toBe(false);
    expect(res.leakedTokens).toEqual([]);
  });
});
