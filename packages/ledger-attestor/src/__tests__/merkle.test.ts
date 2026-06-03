/**
 * Merkle tree regression — determinism, tamper-sensitivity, order.
 */
import { describe, it, expect } from 'vitest';
import { computeMerkleRoot, hashLeaf, EMPTY_MERKLE_ROOT } from '../merkle.js';

describe('computeMerkleRoot', () => {
  it('returns the empty sentinel for no leaves', () => {
    expect(computeMerkleRoot([])).toBe(EMPTY_MERKLE_ROOT);
  });

  it('is deterministic across calls', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e'];
    expect(computeMerkleRoot(leaves)).toBe(computeMerkleRoot(leaves));
  });

  it('a single leaf root equals that leaf hash (lone node promotes)', () => {
    expect(computeMerkleRoot(['only'])).toBe(hashLeaf('only'));
  });

  it('changes when any single leaf is tampered', () => {
    const base = computeMerkleRoot(['a', 'b', 'c', 'd']);
    const tampered = computeMerkleRoot(['a', 'b', 'X', 'd']);
    expect(tampered).not.toBe(base);
  });

  it('is order-sensitive (append order is load-bearing)', () => {
    const forward = computeMerkleRoot(['a', 'b', 'c']);
    const swapped = computeMerkleRoot(['a', 'c', 'b']);
    expect(swapped).not.toBe(forward);
  });

  it('distinguishes a leaf from an internal node (domain separation)', () => {
    // Two leaves vs one leaf whose value is the concat of two hashes —
    // the 0x00/0x01 prefixes must keep these distinct.
    const twoLeaves = computeMerkleRoot(['x', 'y']);
    const oneLeaf = computeMerkleRoot([hashLeaf('x') + hashLeaf('y')]);
    expect(twoLeaves).not.toBe(oneLeaf);
  });

  it('handles odd leaf counts without duplicating the tail', () => {
    // 3 leaves: level0 = [h(a),h(b),h(c)]; pair (a,b), promote c.
    // Adding a 4th leaf equal to c must NOT yield the same root.
    const odd = computeMerkleRoot(['a', 'b', 'c']);
    const evenDupTail = computeMerkleRoot(['a', 'b', 'c', 'c']);
    expect(odd).not.toBe(evenDupTail);
  });

  it('produces a 64-char hex root', () => {
    expect(computeMerkleRoot(['a', 'b'])).toMatch(/^[0-9a-f]{64}$/);
  });
});
