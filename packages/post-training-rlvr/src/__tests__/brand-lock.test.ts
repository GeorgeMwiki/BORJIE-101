/**
 * `brand-lock` verifier — default checker plus injected checker.
 */

import { describe, expect, it } from 'vitest';
import { createBrandLockVerifier } from '../verifiers/builtins/brand-lock.js';
import type { RlvrTrace } from '../types.js';

function traceWith(fragment: unknown): RlvrTrace {
  return Object.freeze({
    id: 't',
    runId: 'r',
    tenantId: 'tenant-test',
    prompt: '',
    completion: '',
    toolCalls: [],
    metadata: Object.freeze({ synthetic: true, ui_fragment: fragment }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

describe('brand-lock verifier', () => {
  it('passes a token-only fragment with the default checker', async () => {
    const verifier = createBrandLockVerifier();
    const trace = traceWith(
      'export const Btn = () => <button className="bg-primary">Buy</button>',
    );
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('fails a fragment containing hex literals', async () => {
    const verifier = createBrandLockVerifier();
    const trace = traceWith('<div style={{ color: "#ff0000" }}>boom</div>');
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
    const evidence = result.evidence as {
      ruleIds: ReadonlyArray<string>;
    };
    expect(evidence.ruleIds).toContain('brand/no-hex-literals');
  });

  it('respects an injected checker', async () => {
    const verifier = createBrandLockVerifier({
      checker: async () => [
        { ruleId: 'custom/forbidden', message: 'nope' },
      ],
    });
    const trace = traceWith('any source');
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('fail');
  });
});
