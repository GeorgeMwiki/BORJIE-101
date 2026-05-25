/**
 * Tests for the classification scrubber middleware.
 *
 * Exercises the pure-function surface against the real data-classification
 * registry. No mocks — the registry is in-process.
 */

import { describe, it, expect } from 'vitest';
import {
  scrubField,
  scrubPayload,
  scrubIfNotOptedOut,
} from '../classification-scrubber';

describe('scrubField', () => {
  it('masks a phone field (CONFIDENTIAL)', () => {
    const out = scrubField('phone', '+254700000000');
    expect(out).not.toBe('+254700000000');
    expect(typeof out).toBe('string');
  });

  it('masks an email field', () => {
    const out = scrubField('email', 'alice@example.com');
    expect(out).not.toBe('alice@example.com');
    expect(typeof out).toBe('string');
  });

  it('preserves a non-PII field (unknown column)', () => {
    const out = scrubField('not_a_real_column', 'value');
    expect(out).toBe('value');
  });

  it('passes nullish values through unchanged', () => {
    expect(scrubField('phone', null)).toBe(null);
    expect(scrubField('phone', undefined)).toBe(undefined);
  });

  it('respects maskConfidential=false', () => {
    const out = scrubField('phone', '+254700000000', {
      maskConfidential: false,
    });
    expect(out).toBe('+254700000000');
  });

  it('always masks RESTRICTED even when maskConfidential=false', () => {
    const out = scrubField('mpesa_phone', '+254700000000', {
      maskConfidential: false,
    });
    expect(out).not.toBe('+254700000000');
  });
});

describe('scrubPayload', () => {
  it('walks recursive nested objects', () => {
    const input = {
      level1: {
        level2: {
          phone: '+254700000000',
          regular: 'ok',
        },
      },
    };
    const out = scrubPayload(input) as {
      level1: { level2: { phone: string; regular: string } };
    };
    expect(out.level1.level2.phone).not.toBe('+254700000000');
    expect(out.level1.level2.regular).toBe('ok');
  });

  it('walks arrays of objects', () => {
    const input = [
      { email: 'a@b.com', name: 'safe' },
      { email: 'c@d.com', name: 'still-safe' },
    ];
    const out = scrubPayload(input) as Array<{ email: string; name: string }>;
    expect(out[0].email).not.toBe('a@b.com');
    expect(out[1].email).not.toBe('c@d.com');
    expect(out[0].name).toBe('safe');
  });

  it('returns a fresh object — does not mutate input', () => {
    const input = { phone: '+254700000000' };
    const out = scrubPayload(input);
    expect(out).not.toBe(input);
    expect(input.phone).toBe('+254700000000'); // original untouched
  });

  it('passes through primitive inputs', () => {
    expect(scrubPayload('a string')).toBe('a string');
    expect(scrubPayload(42)).toBe(42);
    expect(scrubPayload(null)).toBe(null);
    expect(scrubPayload(undefined)).toBe(undefined);
  });

  it('preserves non-PII keys at every level', () => {
    const input = {
      id: 'cus_1',
      created_at: '2026-01-01',
      meta: { source: 'app', region: 'KE' },
    };
    const out = scrubPayload(input) as typeof input;
    expect(out.id).toBe('cus_1');
    expect(out.created_at).toBe('2026-01-01');
    expect(out.meta.source).toBe('app');
  });
});

describe('scrubIfNotOptedOut', () => {
  it('passes through unchanged when skipScrub=true', () => {
    const input = { phone: '+254700000000' };
    const out = scrubIfNotOptedOut(input, true) as typeof input;
    expect(out.phone).toBe('+254700000000');
  });

  it('scrubs when skipScrub=false / undefined', () => {
    const input = { phone: '+254700000000' };
    expect(
      (scrubIfNotOptedOut(input, false) as typeof input).phone,
    ).not.toBe('+254700000000');
    expect(
      (scrubIfNotOptedOut(input, undefined) as typeof input).phone,
    ).not.toBe('+254700000000');
  });
});
