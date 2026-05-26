/**
 * `citation-resolves` verifier — offline tests with an injected fetcher.
 * Synthetic traces clearly labelled.
 */

import { describe, expect, it } from 'vitest';
import { createCitationResolvesVerifier } from '../verifiers/builtins/citation-resolves.js';
import type {
  Fetcher,
} from '../verifiers/builtins/citation-resolves.js';
import type { RlvrTrace } from '../types.js';

function syntheticTrace(
  citations: ReadonlyArray<{ url: string; claim: string }>,
): RlvrTrace {
  return Object.freeze({
    id: 'trace-synthetic-1',
    runId: 'run-synthetic-1',
    tenantId: 'tenant-test',
    prompt: 'What does the Mining Act 2010 say about royalty rates?',
    completion: 'Section 87 sets out the royalty schedule.',
    toolCalls: [],
    metadata: Object.freeze({
      synthetic: true,
      citations: Object.freeze(citations.map((c) => Object.freeze(c))),
    }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

describe('citation-resolves verifier', () => {
  it('passes when every cited URL resolves and body contains the claim', async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => 'preamble Section 87 royalty schedule trailer',
    });
    const verifier = createCitationResolvesVerifier({ fetcher });
    const trace = syntheticTrace([
      {
        url: 'https://example.org/mining-act',
        claim: 'Section 87 royalty schedule',
      },
    ]);
    expect(verifier.applies(trace)).toBe(true);
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('fails when the URL does not resolve', async () => {
    const fetcher: Fetcher = async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });
    const verifier = createCitationResolvesVerifier({ fetcher });
    const trace = syntheticTrace([
      { url: 'https://example.org/missing', claim: 'anything' },
    ]);
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
  });

  it('partial credit when only some citations match', async () => {
    let callCount = 0;
    const fetcher: Fetcher = async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          callCount === 1 ? 'matching text here' : 'no match',
      };
    };
    const verifier = createCitationResolvesVerifier({ fetcher });
    const trace = syntheticTrace([
      { url: 'https://a.test', claim: 'matching text' },
      { url: 'https://b.test', claim: 'absent claim' },
    ]);
    const result = await verifier.verify(trace);
    expect(result.verdict).toBe('partial');
    expect(result.reward).toBeCloseTo(0.5);
  });

  it('does not apply when the trace has no citations', () => {
    const verifier = createCitationResolvesVerifier({
      fetcher: async () => ({
        ok: true,
        status: 200,
        text: async () => '',
      }),
    });
    const trace = syntheticTrace([]);
    expect(verifier.applies(trace)).toBe(false);
  });
});
