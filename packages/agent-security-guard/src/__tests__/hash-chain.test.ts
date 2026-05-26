/**
 * Tests for the tamper-evident hash chain (audit/hash-chain.ts).
 *
 * Properties:
 *   - genesisHash() is deterministic (64-hex)
 *   - chainHash is deterministic
 *   - chainHash is sensitive to any field change
 *   - rowHash differs from chainHash(prev, fields) for non-genesis prev
 */
import { describe, it, expect } from 'vitest';
import { chainHash, genesisHash, rowHash } from '../audit/hash-chain.js';

describe('hash-chain', () => {
  it('genesisHash is 64-char hex', () => {
    expect(genesisHash()).toHaveLength(64);
    expect(genesisHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chainHash is deterministic', () => {
    const a = chainHash('aa', { x: 1, y: 'b' });
    const b = chainHash('aa', { x: 1, y: 'b' });
    expect(a).toBe(b);
  });

  it('chainHash differs on any field change', () => {
    const a = chainHash('aa', { x: 1, y: 'b' });
    const b = chainHash('aa', { x: 1, y: 'c' });
    const c = chainHash('aa', { x: 2, y: 'b' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('rowHash mirrors chainHash(genesis, ...)', () => {
    const a = rowHash({ k: 'v' });
    const b = chainHash(genesisHash(), { k: 'v' });
    expect(a).toBe(b);
  });

  it('key order in input does not affect hash', () => {
    const a = chainHash('p', { a: 1, b: 2, c: 3 });
    const b = chainHash('p', { c: 3, a: 1, b: 2 });
    expect(a).toBe(b);
  });
});
