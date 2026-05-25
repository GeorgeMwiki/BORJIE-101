import { describe, expect, it } from 'vitest';
import {
  CORRELATION_HEADER,
  processCorrelation,
  responseHeaders,
} from '../correlation-id-middleware.js';
import type { CorrelationId } from '../types.js';

describe('correlation-id-middleware', () => {
  it('honours inbound header', () => {
    const out = processCorrelation(
      { inboundHeader: 'parent-cid', mintIfMissing: () => 'minted' },
      { rate: 0.01 },
    );
    expect(out.correlationId).toBe('parent-cid');
    expect(out.inbound).toBe(true);
    expect(out.sampled).toBe(true);
    expect(out.reason).toBe('inbound-respected');
  });

  it('mints when inbound missing', () => {
    const out = processCorrelation(
      { mintIfMissing: () => 'minted-1' },
      { rate: 1 },
    );
    expect(out.correlationId).toBe('minted-1');
    expect(out.inbound).toBe(false);
    expect(out.sampled).toBe(true);
  });

  it('rate=0 produces no sampling', () => {
    const out = processCorrelation(
      { mintIfMissing: () => 'minted' },
      { rate: 0 },
    );
    expect(out.sampled).toBe(false);
  });

  it('always-sample prefix overrides rate=0', () => {
    const out = processCorrelation(
      { mintIfMissing: () => 'vip-abc' },
      { rate: 0, alwaysSamplePrefixes: ['vip-'] },
    );
    expect(out.sampled).toBe(true);
    expect(out.reason).toBe('always-prefix');
  });

  it('inbound header beats always-prefix because parent decided', () => {
    const out = processCorrelation(
      { inboundHeader: 'vip-abc', mintIfMissing: () => 'minted' },
      { rate: 0, alwaysSamplePrefixes: ['vip-'] },
    );
    expect(out.sampled).toBe(true);
    expect(out.inbound).toBe(true);
    expect(out.reason).toBe('inbound-respected');
  });

  it('sampling is deterministic per id', () => {
    const a = processCorrelation({ mintIfMissing: () => 'fixed' }, { rate: 0.5 });
    const b = processCorrelation({ mintIfMissing: () => 'fixed' }, { rate: 0.5 });
    expect(a.sampled).toBe(b.sampled);
  });

  it('responseHeaders builds the right shape', () => {
    const headers = responseHeaders('cid-1' as CorrelationId);
    expect(headers[CORRELATION_HEADER]).toBe('cid-1');
  });

  it('empty inboundHeader counts as missing', () => {
    const out = processCorrelation(
      { inboundHeader: '', mintIfMissing: () => 'minted' },
      { rate: 1 },
    );
    expect(out.inbound).toBe(false);
    expect(out.correlationId).toBe('minted');
  });

  it('rate >1 is clamped (always samples)', () => {
    const out = processCorrelation({ mintIfMissing: () => 'x' }, { rate: 5 });
    expect(out.sampled).toBe(true);
  });

  it('rate <0 is clamped (never samples)', () => {
    const out = processCorrelation({ mintIfMissing: () => 'x' }, { rate: -1 });
    expect(out.sampled).toBe(false);
  });
});
