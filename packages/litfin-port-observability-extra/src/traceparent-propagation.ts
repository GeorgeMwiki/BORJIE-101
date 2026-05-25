/**
 * W3C traceparent propagation across BullMQ + Inngest workers.
 *
 * LITFIN ref: src/core/telemetry/trace-propagation.ts — pack and
 * unpack a W3C Trace Context header from job metadata so workers
 * inherit the producing span. Strict parser per RFC.
 *
 * traceparent format: `00-<32 hex traceId>-<16 hex spanId>-<2 hex flags>`
 */

import type { SpanId, TraceId } from './types.js';

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export interface ParsedTraceparent {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly traceFlags: number;
  readonly sampled: boolean;
}

const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);

export const parseTraceparent = (header: string): ParsedTraceparent | null => {
  const m = TRACEPARENT_RE.exec(header.trim());
  if (m === null) return null;
  const [, traceId, spanId, flags] = m;
  if (traceId === undefined || spanId === undefined || flags === undefined) return null;
  if (traceId === ZERO_TRACE || spanId === ZERO_SPAN) return null;
  const flagInt = Number.parseInt(flags, 16);
  return {
    traceId: traceId.toLowerCase() as TraceId,
    spanId: spanId.toLowerCase() as SpanId,
    traceFlags: flagInt,
    sampled: (flagInt & 0x01) === 0x01,
  };
};

export const formatTraceparent = (
  traceId: TraceId,
  spanId: SpanId,
  sampled: boolean = true,
): string => {
  const flags = sampled ? '01' : '00';
  return `00-${traceId.toLowerCase()}-${spanId.toLowerCase()}-${flags}`;
};

// ----------------------------------------------------------------------
// Job-metadata helpers — BullMQ + Inngest share a similar "attach a
// header bag to the job payload" pattern. We standardise the key.
// ----------------------------------------------------------------------

export const TRACE_META_KEY = '__w3c_traceparent';
export const TRACESTATE_META_KEY = '__w3c_tracestate';
export const CORRELATION_META_KEY = '__correlation_id';

export interface JobWithTrace<T> {
  readonly data: T;
  readonly meta: Readonly<Record<string, string>>;
}

export const injectIntoJob = <T>(
  data: T,
  ctx: {
    readonly traceparent?: string;
    readonly tracestate?: string;
    readonly correlationId?: string;
  },
): JobWithTrace<T> => {
  const meta: Record<string, string> = {};
  if (ctx.traceparent !== undefined) meta[TRACE_META_KEY] = ctx.traceparent;
  if (ctx.tracestate !== undefined) meta[TRACESTATE_META_KEY] = ctx.tracestate;
  if (ctx.correlationId !== undefined) meta[CORRELATION_META_KEY] = ctx.correlationId;
  return { data, meta };
};

export const extractFromJob = <T>(
  job: JobWithTrace<T>,
): {
  readonly parsed: ParsedTraceparent | null;
  readonly tracestate?: string;
  readonly correlationId?: string;
} => {
  const tp = job.meta[TRACE_META_KEY];
  const ts = job.meta[TRACESTATE_META_KEY];
  const cid = job.meta[CORRELATION_META_KEY];
  return {
    parsed: tp !== undefined ? parseTraceparent(tp) : null,
    ...(ts !== undefined ? { tracestate: ts } : {}),
    ...(cid !== undefined ? { correlationId: cid } : {}),
  };
};
