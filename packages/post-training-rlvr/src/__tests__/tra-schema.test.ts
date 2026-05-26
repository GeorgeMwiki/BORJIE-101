/**
 * `tra-schema` verifier — synthetic traces validate / fail against the
 * stub schema.
 */

import { describe, expect, it } from 'vitest';
import { createTraSchemaVerifier } from '../verifiers/builtins/tra-schema.js';
import type { RlvrTrace } from '../types.js';

function syntheticTraceWith(filing: unknown): RlvrTrace {
  return Object.freeze({
    id: 'trace-tra-1',
    runId: 'run-tra-1',
    tenantId: 'tenant-test',
    prompt: 'Build a TRA royalty return',
    completion: 'Submitted for review',
    toolCalls: [],
    metadata: Object.freeze({ synthetic: true, tra_filing: filing }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

describe('tra-schema verifier', () => {
  it('passes a well-formed filing', async () => {
    const verifier = createTraSchemaVerifier();
    const trace = syntheticTraceWith({
      tin: '1234567890',
      filing_period_iso: '2026-04',
      mineral: 'gold',
      tonnage: 12.5,
      rate_pct: 6,
      declared_amount: 9000,
    });
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('fails when the TIN is malformed', async () => {
    const verifier = createTraSchemaVerifier();
    const trace = syntheticTraceWith({
      tin: 'NOT-A-TIN',
      filing_period_iso: '2026-04',
      mineral: 'gold',
      tonnage: 1,
    });
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
    const evidence = result.evidence as {
      zodIssues: ReadonlyArray<{ path: string }>;
    };
    expect(evidence.zodIssues.some((i) => i.path === 'tin')).toBe(true);
  });

  it('skips when the trace does not declare a filing', () => {
    const verifier = createTraSchemaVerifier();
    const trace: RlvrTrace = Object.freeze({
      id: 't',
      runId: 'r',
      tenantId: 't',
      prompt: '',
      completion: '',
      toolCalls: [],
      metadata: Object.freeze({ synthetic: true }),
      capturedAt: '2026-05-26T00:00:00.000Z',
    });
    expect(verifier.applies(trace)).toBe(false);
  });
});
