/**
 * cot-reservoir persist-boundary scrub coverage — A2b-2 wire #4.
 *
 * Verifies that `createCotReservoir.maybeCapture` runs the Phase-D
 * `scrubCotForPersist` (NOT only the regional `scrubCotText`) before
 * handing the sample to the sink. Persisted rows must never carry
 * raw Anthropic API keys (`sk-ant-…`) or M-Pesa confirmation IDs
 * (`MPESA…`).
 */
import { describe, it, expect } from 'vitest';
import { createCotReservoir, createInMemoryCotReservoirSink } from '../cot-reservoir.js';

describe('createCotReservoir — persist-boundary PII scrub', () => {
  it('redacts Anthropic API keys + M-Pesa confirmation IDs at write', async () => {
    const sink = createInMemoryCotReservoirSink();
    const reservoir = createCotReservoir({ sink, rng: () => 0 });
    const thoughtText =
      'auth bearer sk-ant-api03-EXAMPLEEXAMPLEEXAMPLEEXAMPLE then MPESAQ7X8Y2Z9A confirmed.';
    const result = await reservoir.maybeCapture({
      thoughtId: 'th-1',
      threadId: 'thr-1',
      stakes: 'critical',
      thoughtText,
      capturedAt: new Date().toISOString(),
    });
    expect(result.sampled).toBe(true);
    const samples = sink.samples();
    expect(samples.length).toBe(1);
    expect(samples[0].thoughtText).not.toContain('sk-ant-api03-EXAMPLEEXAMPLEEXAMPLEEXAMPLE');
    expect(samples[0].thoughtText).not.toContain('MPESAQ7X8Y2Z9A');
    // Replacement tokens documented in pii-scrub-cot.ts.
    expect(samples[0].thoughtText).toContain('[redacted-api-key]');
    expect(samples[0].thoughtText).toContain('[redacted-mpesa-txn]');
  });
});
