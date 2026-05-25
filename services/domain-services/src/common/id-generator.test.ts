/**
 * id-generator tests.
 *
 * These pin the invariants that matter for security:
 *   - IDs are unique across many samples (collisions are vanishingly rare
 *     with a 4-byte CSPRNG suffix + ms timestamp, but we at least verify
 *     1k samples are distinct — a regression to Math.random-based
 *     generation would blow this up)
 *   - Random suffix is valid hex of the right length
 *   - Prefix + timestamp format is preserved so logs stay readable
 */

import { describe, it, expect } from 'vitest';
import { randomHex, prefixedId } from './id-generator.js';

describe('randomHex', () => {
  it('returns twice the byteLength in hex characters', () => {
    expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/);
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is unique across 1000 samples', () => {
    const s = new Set<string>();
    for (let i = 0; i < 1000; i++) s.add(randomHex(8));
    expect(s.size).toBe(1000);
  });

  it('defaults to 4 bytes (8 hex chars)', () => {
    expect(randomHex()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('prefixedId', () => {
  it('produces `prefix_<timestamp>_<hex>` shape', () => {
    const id = prefixedId('inv');
    expect(id).toMatch(/^inv_\d{10,}_[0-9a-f]{8}$/);
  });

  it('respects custom random byte length', () => {
    const id = prefixedId('pay', 8);
    expect(id).toMatch(/^pay_\d{10,}_[0-9a-f]{16}$/);
  });

  it('is unique across 1000 samples', () => {
    const s = new Set<string>();
    for (let i = 0; i < 1000; i++) s.add(prefixedId('cust'));
    expect(s.size).toBe(1000);
  });

  it('preserves different prefixes', () => {
    expect(prefixedId('inv').startsWith('inv_')).toBe(true);
    expect(prefixedId('pay').startsWith('pay_')).toBe(true);
    expect(prefixedId('custX').startsWith('custX_')).toBe(true);
  });
});
