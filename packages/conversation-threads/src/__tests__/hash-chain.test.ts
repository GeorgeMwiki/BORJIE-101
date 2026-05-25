/**
 * Tests for hash-chain.ts.
 *
 * Covers:
 *   - canonicalJson stability across key order
 *   - hash determinism + sensitivity to every input
 *   - verifyMessageChain accepts a valid chain, rejects a tampered one
 */
import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  canonicalJson,
  computeMessageHash,
  verifyMessageChain,
  type MessageHashRow,
} from '../hash-chain.js';

describe('canonicalJson', () => {
  it('serialises a flat object deterministically regardless of key order', () => {
    const a = { c: 1, a: 2, b: 3 };
    const b = { a: 2, b: 3, c: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('handles arrays in order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles nested objects', () => {
    const v = { outer: { z: 1, a: 2 }, list: [1, { y: 2, x: 1 }] };
    expect(canonicalJson(v)).toBe(
      '{"list":[1,{"x":1,"y":2}],"outer":{"a":2,"z":1}}',
    );
  });

  it('handles null and primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('hi')).toBe('"hi"');
    expect(canonicalJson(true)).toBe('true');
  });
});

describe('computeMessageHash', () => {
  const base = {
    prevHash: GENESIS_HASH,
    threadId: 'thr_1',
    role: 'user',
    contentJsonb: { type: 'text', text: 'hello' },
    createdAtIso: '2026-05-22T10:00:00.000Z',
  };

  it('returns the same hash twice for the same inputs', () => {
    expect(computeMessageHash(base)).toBe(computeMessageHash(base));
  });

  it('is sensitive to every field', () => {
    const base2 = { ...base };
    const h0 = computeMessageHash(base2);
    const h1 = computeMessageHash({ ...base2, prevHash: 'a'.repeat(64) });
    const h2 = computeMessageHash({ ...base2, threadId: 'thr_2' });
    const h3 = computeMessageHash({ ...base2, role: 'assistant' });
    const h4 = computeMessageHash({
      ...base2,
      contentJsonb: { type: 'text', text: 'world' },
    });
    const h5 = computeMessageHash({
      ...base2,
      createdAtIso: '2026-05-23T10:00:00.000Z',
    });
    expect(new Set([h0, h1, h2, h3, h4, h5]).size).toBe(6);
  });

  it('returns a 64-character hex string', () => {
    const h = computeMessageHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyMessageChain', () => {
  function buildChain(n: number): {
    chainRootHash: string;
    messages: MessageHashRow[];
  } {
    const chainRootHash = 'r'.repeat(64);
    const messages: MessageHashRow[] = [];
    let prev = chainRootHash;
    for (let i = 0; i < n; i += 1) {
      const role = i % 2 === 0 ? 'user' : 'assistant';
      const createdAt = new Date(2026, 4, 22, 10, i);
      const content = { type: 'text', text: `msg ${i}` };
      const hash = computeMessageHash({
        prevHash: prev,
        threadId: 'thr_1',
        role,
        contentJsonb: content,
        createdAtIso: createdAt.toISOString(),
      });
      messages.push({
        threadId: 'thr_1',
        role,
        contentJsonb: content,
        createdAt,
        prevHash: prev,
        hash,
      });
      prev = hash;
    }
    return { chainRootHash, messages };
  }

  it('accepts a valid chain', () => {
    const { chainRootHash, messages } = buildChain(5);
    expect(verifyMessageChain({ chainRootHash, messages }).valid).toBe(true);
  });

  it('accepts an empty chain', () => {
    const r = verifyMessageChain({
      chainRootHash: GENESIS_HASH,
      messages: [],
    });
    expect(r.valid).toBe(true);
    expect(r.brokenAt).toBe(-1);
  });

  it('detects a tampered message body', () => {
    const { chainRootHash, messages } = buildChain(4);
    const tampered = messages.map((m, idx) => {
      if (idx === 2) {
        return { ...m, contentJsonb: { type: 'text', text: 'TAMPERED' } };
      }
      return m;
    });
    const r = verifyMessageChain({ chainRootHash, messages: tampered });
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(2);
    expect(r.reason).toContain('hash mismatch');
  });

  it('detects a tampered prev_hash', () => {
    const { chainRootHash, messages } = buildChain(3);
    const tampered = messages.map((m, idx) =>
      idx === 1 ? { ...m, prevHash: 'x'.repeat(64) } : m,
    );
    const r = verifyMessageChain({ chainRootHash, messages: tampered });
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(1);
    expect(r.reason).toContain('prev_hash mismatch');
  });

  it('detects a tampered hash', () => {
    const { chainRootHash, messages } = buildChain(3);
    const tampered = messages.map((m, idx) =>
      idx === 0 ? { ...m, hash: 'y'.repeat(64) } : m,
    );
    const r = verifyMessageChain({ chainRootHash, messages: tampered });
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
  });

  it('detects a chain whose first prev_hash does not match the root', () => {
    const { messages } = buildChain(2);
    const r = verifyMessageChain({
      chainRootHash: 'wrong-root',
      messages,
    });
    expect(r.valid).toBe(false);
    expect(r.brokenAt).toBe(0);
  });
});
