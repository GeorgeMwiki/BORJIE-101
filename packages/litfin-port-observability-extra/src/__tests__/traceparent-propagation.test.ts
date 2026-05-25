import { describe, expect, it } from 'vitest';
import {
  extractFromJob,
  formatTraceparent,
  injectIntoJob,
  parseTraceparent,
} from '../traceparent-propagation.js';
import type { SpanId, TraceId } from '../types.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736' as TraceId;
const SPAN = '00f067aa0ba902b7' as SpanId;

describe('traceparent', () => {
  it('parses a valid header', () => {
    const out = parseTraceparent(`00-${TRACE}-${SPAN}-01`);
    expect(out).not.toBeNull();
    expect(out?.traceId).toBe(TRACE);
    expect(out?.spanId).toBe(SPAN);
    expect(out?.sampled).toBe(true);
  });

  it('parses unsampled flag', () => {
    const out = parseTraceparent(`00-${TRACE}-${SPAN}-00`);
    expect(out?.sampled).toBe(false);
  });

  it('rejects malformed header', () => {
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00-abc-def-01')).toBeNull();
  });

  it('rejects all-zero traceId', () => {
    const out = parseTraceparent(`00-${'0'.repeat(32)}-${SPAN}-01`);
    expect(out).toBeNull();
  });

  it('rejects all-zero spanId', () => {
    const out = parseTraceparent(`00-${TRACE}-${'0'.repeat(16)}-01`);
    expect(out).toBeNull();
  });

  it('formats round-trip', () => {
    const h = formatTraceparent(TRACE, SPAN, true);
    expect(h).toBe(`00-${TRACE}-${SPAN}-01`);
    const parsed = parseTraceparent(h);
    expect(parsed?.traceId).toBe(TRACE);
  });

  it('lowercases hex on output', () => {
    const TR = '4BF92F3577B34DA6A3CE929D0E0E4736' as TraceId;
    const h = formatTraceparent(TR, SPAN, false);
    expect(h).toBe(`00-${TR.toLowerCase()}-${SPAN}-00`);
  });
});

describe('traceparent job-meta injection', () => {
  it('injectIntoJob attaches all 3 meta keys', () => {
    const job = injectIntoJob(
      { x: 1 },
      { traceparent: 'tp', tracestate: 'ts', correlationId: 'cid' },
    );
    expect(job.data).toEqual({ x: 1 });
    expect(Object.keys(job.meta).length).toBe(3);
  });

  it('extractFromJob parses traceparent', () => {
    const tp = `00-${TRACE}-${SPAN}-01`;
    const job = injectIntoJob({ x: 1 }, { traceparent: tp });
    const out = extractFromJob(job);
    expect(out.parsed).not.toBeNull();
    expect(out.parsed?.traceId).toBe(TRACE);
  });

  it('extractFromJob handles missing meta', () => {
    const job = injectIntoJob({ x: 1 }, {});
    const out = extractFromJob(job);
    expect(out.parsed).toBeNull();
    expect(out.tracestate).toBeUndefined();
    expect(out.correlationId).toBeUndefined();
  });

  it('extractFromJob returns invalid traceparent as null', () => {
    const job = injectIntoJob({ x: 1 }, { traceparent: 'bad' });
    expect(extractFromJob(job).parsed).toBeNull();
  });
});
