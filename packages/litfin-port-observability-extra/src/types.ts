/**
 * Shared types for litfin-port-observability-extra.
 */

export type TenantId = string & { readonly __brand: 'TenantId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };
export type TraceId = string & { readonly __brand: 'TraceId' };
export type SpanId = string & { readonly __brand: 'SpanId' };
export type SlobId = string & { readonly __brand: 'SlobId' };

export interface ObsClock {
  readonly now: () => number;
}

export const DEFAULT_OBS_CLOCK: ObsClock = { now: () => Date.now() };

export interface IdGen {
  readonly traceId: () => TraceId;
  readonly spanId: () => SpanId;
  readonly correlationId: () => CorrelationId;
}

const hex = (len: number): string => {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
};

export const DEFAULT_ID_GEN: IdGen = {
  traceId: () => hex(32) as TraceId,
  spanId: () => hex(16) as SpanId,
  correlationId: () => `corr-${hex(16)}` as CorrelationId,
};
