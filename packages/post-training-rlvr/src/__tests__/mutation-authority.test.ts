/**
 * `mutation-authority` verifier — tier respect + approver gate.
 */

import { describe, expect, it } from 'vitest';
import { createMutationAuthorityVerifier } from '../verifiers/builtins/mutation-authority.js';
import type { RlvrTrace } from '../types.js';

function traceWith(mutation: unknown): RlvrTrace {
  return Object.freeze({
    id: 't',
    runId: 'r',
    tenantId: 'tenant-test',
    prompt: '',
    completion: '',
    toolCalls: [],
    metadata: Object.freeze({ synthetic: true, mutation }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

describe('mutation-authority verifier', () => {
  it('passes T2 proposal with owner + second_authoriser approvers', async () => {
    const verifier = createMutationAuthorityVerifier();
    const result = await verifier.verify(
      traceWith({
        proposed_tier: 't2',
        required_tier: 't2',
        approvers: ['owner', 'second_authoriser'],
      }),
    );
    expect(result.verdict).toBe('pass');
  });

  it('fails T2_critical asserted as T0', async () => {
    const verifier = createMutationAuthorityVerifier();
    const result = await verifier.verify(
      traceWith({
        proposed_tier: 't0',
        required_tier: 't2_critical',
        approvers: ['owner'],
      }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
  });

  it('fails when approver gate is unsatisfied', async () => {
    const verifier = createMutationAuthorityVerifier();
    const result = await verifier.verify(
      traceWith({
        proposed_tier: 't2',
        required_tier: 't2',
        approvers: ['owner'], // missing second_authoriser
      }),
    );
    expect(result.verdict).toBe('fail');
  });
});
