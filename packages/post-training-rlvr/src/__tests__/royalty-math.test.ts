/**
 * `royalty-math` verifier — covers exact match, within-ε, shaped partial,
 * out-of-range full fail.
 */

import { describe, expect, it } from 'vitest';
import { createRoyaltyMathVerifier } from '../verifiers/builtins/royalty-math.js';
import type { RlvrTrace } from '../types.js';

function traceWith(royalty: unknown): RlvrTrace {
  return Object.freeze({
    id: 't',
    runId: 'r',
    tenantId: 'tenant-test',
    prompt: '',
    completion: '',
    toolCalls: [],
    metadata: Object.freeze({ synthetic: true, royalty }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

describe('royalty-math verifier', () => {
  it('passes when declaration matches tonnage * unit_price * rate_pct / 100', async () => {
    const verifier = createRoyaltyMathVerifier();
    const trace = traceWith({
      tonnage: 100,
      unit_price: 50,
      rate_pct: 6,
      declared_amount: 300,
    });
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('shaped partial reward for declarations within tolerance band', async () => {
    const verifier = createRoyaltyMathVerifier({ epsilon: 0.05 });
    // expected = 100 * 50 * 0.06 = 300. Declared 320 → relative error 0.066.
    const trace = traceWith({
      tonnage: 100,
      unit_price: 50,
      rate_pct: 6,
      declared_amount: 320,
    });
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('partial');
    expect(result.reward).toBeGreaterThan(0);
    expect(result.reward).toBeLessThan(1);
  });

  it('fails when relative error exceeds 100%', async () => {
    const verifier = createRoyaltyMathVerifier();
    const trace = traceWith({
      tonnage: 100,
      unit_price: 50,
      rate_pct: 6,
      declared_amount: 1200,
    });
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
  });

  it('skips when royalty payload is missing', () => {
    const verifier = createRoyaltyMathVerifier();
    const trace = traceWith(undefined);
    expect(verifier.applies(trace)).toBe(false);
  });
});
