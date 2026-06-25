/**
 * Non-finite guards for the owner-cockpit formatters.
 *
 * RESIDUAL-DOCTRINE (every formatter has a Number.isFinite guard): a
 * NaN / Infinity / null-coerced figure must NEVER paint `TZS NaNM` /
 * `NaN%` to an owner. Each formatter degrades the non-finite case to an
 * em-dash (the same convention `formatCurrency` uses). These tests pin
 * the guard at the central substrate so every call site inherits it.
 */

import { describe, expect, it } from 'vitest';
import {
  fmtNum,
  fmtPct,
  formatLargeMoney,
  formatMoneyMillions,
} from '../format';

const DASH = '—';
const NON_FINITE = [NaN, Infinity, -Infinity, Number.NaN] as const;

describe('formatMoneyMillions — non-finite guard', () => {
  it.each(NON_FINITE)('renders an em-dash for %s (never "TZS NaNM")', (v) => {
    expect(formatMoneyMillions(v, 'TZS')).toBe(`TZS ${DASH}`);
  });
  it('still formats a finite value', () => {
    expect(formatMoneyMillions(1.2, 'TZS')).toBe('TZS 1.2M');
  });
});

describe('formatLargeMoney — non-finite guard', () => {
  it.each(NON_FINITE)('renders an em-dash for %s', (v) => {
    expect(formatLargeMoney(v, 'TZS', 'en')).toBe(`TZS ${DASH}`);
  });
  it('still formats a finite billion value', () => {
    expect(formatLargeMoney(2_000_000_000, 'TZS', 'en')).toBe('TZS 2.0B');
  });
});

describe('fmtNum — non-finite guard', () => {
  it.each(NON_FINITE)('renders an em-dash for %s', (v) => {
    expect(fmtNum(v)).toBe(DASH);
  });
  it('still formats a finite number', () => {
    expect(fmtNum(1234)).toBe('1,234');
  });
});

describe('fmtPct — non-finite guard', () => {
  it.each(NON_FINITE)('renders an em-dash for %s (never "NaN%")', (v) => {
    expect(fmtPct(v)).toBe(DASH);
  });
  it('still formats a finite ratio', () => {
    expect(fmtPct(0.25)).toBe('25.0%');
  });
});
