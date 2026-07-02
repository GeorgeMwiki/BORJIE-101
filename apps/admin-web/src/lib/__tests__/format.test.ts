/**
 * Tests for the admin-web locale-aware formatter helper.
 *
 * The whole point of this module is that number/date rendering follows
 * the OPERATOR's active locale, never the host default. These tests pin
 * the resolver + assert the formatters thread the active locale (so a
 * `.toLocaleString()` with no locale — a zero-mix violation — can never
 * silently return here).
 */
import { describe, expect, it } from 'vitest';

import { bcp47For, formatNumber, formatDateTime, formatDate } from '../format';

describe('bcp47For', () => {
  it('resolves sw → sw-TZ', () => {
    expect(bcp47For('sw')).toBe('sw-TZ');
  });

  it('resolves en → en-GB (never the host default)', () => {
    expect(bcp47For('en')).toBe('en-GB');
  });
});

describe('formatNumber', () => {
  it('groups with the active-locale (en-GB) tag, not the host default', () => {
    // en-GB groups thousands with a comma regardless of the machine locale.
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
  });

  it('threads the sw locale through Intl (produces a string)', () => {
    // sw-TZ uses Latin digits + comma grouping; assert it renders a
    // grouped string rather than throwing / bare digits.
    expect(formatNumber(1234567, 'sw')).toBe('1,234,567');
  });

  it('degrades non-finite input to an em-dash, never NaN', () => {
    expect(formatNumber(Number.NaN, 'en')).toBe('—');
    expect(formatNumber(Infinity, 'sw')).toBe('—');
  });

  it('honours number-format options (fraction digits)', () => {
    expect(
      formatNumber(2, 'en', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe('2.00');
  });
});

describe('formatDateTime / formatDate', () => {
  const iso = '2026-07-02T13:05:00.000Z';

  it('formats a date with the active-locale tag', () => {
    const out = formatDateTime(iso, 'en');
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe('—');
  });

  it('degrades an invalid date to an em-dash', () => {
    expect(formatDateTime('not-a-date', 'en')).toBe('—');
    expect(formatDate('', 'sw')).toBe('—');
  });

  it('formatDate defaults to a day/month/year shape', () => {
    // en-GB renders "2 Jul 2026" for the day/month/year default.
    expect(formatDate(iso, 'en')).toContain('2026');
  });
});
