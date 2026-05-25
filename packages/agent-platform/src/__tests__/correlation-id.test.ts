/**
 * Tests for correlation-id.ts — extraction priority, header generation,
 * and forwarding semantics.
 */
import { describe, expect, it } from 'vitest';
import {
  correlationHeaders,
  forwardHeaders,
  getCorrelationId,
} from '../correlation-id.js';

describe('getCorrelationId priority order', () => {
  it('prefers lowercase x-request-id over alternatives', () => {
    const id = getCorrelationId({
      'x-request-id': 'lower',
      'X-Request-Id': 'upper',
      'x-correlation-id': 'corr',
    });
    expect(id).toBe('lower');
  });

  it('falls back to title-case X-Request-Id', () => {
    const id = getCorrelationId({
      'X-Request-Id': 'upper',
      'x-correlation-id': 'corr',
    });
    expect(id).toBe('upper');
  });

  it('falls back to lowercase x-correlation-id when no request-id', () => {
    const id = getCorrelationId({ 'x-correlation-id': 'corr' });
    expect(id).toBe('corr');
  });

  it('falls back to title-case X-Correlation-Id', () => {
    const id = getCorrelationId({ 'X-Correlation-Id': 'corr-upper' });
    expect(id).toBe('corr-upper');
  });

  it('generates a UUID v4-like id when no headers present', () => {
    const id = getCorrelationId({});
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('generates a different id on each call when headers absent', () => {
    const a = getCorrelationId({});
    const b = getCorrelationId({});
    expect(a).not.toBe(b);
  });
});

describe('correlationHeaders', () => {
  it('exposes the id under both lower and title case keys', () => {
    const h = correlationHeaders('cid-1');
    expect(h['X-Request-Id']).toBe('cid-1');
    expect(h['X-Correlation-Id']).toBe('cid-1');
  });

  it('returns a frozen object', () => {
    const h = correlationHeaders('cid-2');
    expect(Object.isFrozen(h)).toBe(true);
  });
});

describe('forwardHeaders', () => {
  it('merges extra headers without dropping correlation entries', () => {
    const h = forwardHeaders('cid-3', { 'X-Custom': 'a', Authorization: 'Bearer x' });
    expect(h['X-Request-Id']).toBe('cid-3');
    expect(h['X-Correlation-Id']).toBe('cid-3');
    expect(h['X-Custom']).toBe('a');
    expect(h['Authorization']).toBe('Bearer x');
  });

  it('returns only correlation headers when no extras passed', () => {
    const h = forwardHeaders('cid-4');
    expect(Object.keys(h).sort()).toEqual(['X-Correlation-Id', 'X-Request-Id']);
  });

  it('extra headers can override correlation header keys', () => {
    // The spread order means extra headers come after correlation, so
    // an extra X-Request-Id supplied by the caller wins.
    const h = forwardHeaders('cid-orig', { 'X-Request-Id': 'cid-extra' });
    expect(h['X-Request-Id']).toBe('cid-extra');
    expect(h['X-Correlation-Id']).toBe('cid-orig');
  });
});
