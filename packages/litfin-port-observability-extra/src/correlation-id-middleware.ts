/**
 * Correlation-id middleware (with sampling).
 *
 * LITFIN ref: src/core/telemetry/correlation-middleware.ts — Hono /
 * Fastify request hook that:
 *   1. picks up an inbound `x-correlation-id` if present
 *   2. otherwise mints one
 *   3. decides sampling (record vs. drop) deterministically based on
 *      a hash of the id so the same correlation always samples
 *      identically — useful for correlated trace/log/metric records.
 */

import type { CorrelationId } from './types.js';

export const CORRELATION_HEADER = 'x-correlation-id';

export interface SamplingConfig {
  /** Fraction in [0,1]. 1 means always sample. */
  readonly rate: number;
  /** Always sample these correlation prefixes (e.g. for VIP tenants). */
  readonly alwaysSamplePrefixes?: readonly string[];
}

const fnv1a32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
};

export interface SampledCorrelation {
  readonly correlationId: CorrelationId;
  readonly sampled: boolean;
  readonly inbound: boolean;
  /** Reason for the sampling decision — useful for log enrichment. */
  readonly reason: 'rate' | 'always-prefix' | 'inbound-respected';
}

export interface CorrelationInput {
  readonly inboundHeader?: string;
  readonly mintIfMissing: () => string;
}

export const processCorrelation = (
  input: CorrelationInput,
  sampling: SamplingConfig,
): SampledCorrelation => {
  const inbound = input.inboundHeader !== undefined && input.inboundHeader.length > 0;
  const cid = (inbound ? (input.inboundHeader ?? '') : input.mintIfMissing()) as CorrelationId;
  // If the inbound caller said "sample this", honour it (e.g. parent decided).
  // We treat any inbound id as a hint that the upstream already chose to sample.
  if (inbound) {
    return { correlationId: cid, sampled: true, inbound: true, reason: 'inbound-respected' };
  }
  for (const prefix of sampling.alwaysSamplePrefixes ?? []) {
    if (cid.startsWith(prefix)) {
      return { correlationId: cid, sampled: true, inbound: false, reason: 'always-prefix' };
    }
  }
  const h = fnv1a32(cid);
  const bucket = (h >>> 0) / 0xffffffff;
  const sampled = bucket < Math.max(0, Math.min(1, sampling.rate));
  return { correlationId: cid, sampled, inbound: false, reason: 'rate' };
};

export interface CorrelationResponseHeaders {
  readonly [CORRELATION_HEADER]: CorrelationId;
}

export const responseHeaders = (cid: CorrelationId): CorrelationResponseHeaders => ({
  [CORRELATION_HEADER]: cid,
});
