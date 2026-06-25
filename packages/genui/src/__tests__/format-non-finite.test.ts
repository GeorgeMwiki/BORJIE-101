/**
 * Non-finite guards for the genui KPI/table formatters.
 *
 * RESIDUAL-DOCTRINE (every formatter has a Number.isFinite guard):
 * `Intl.NumberFormat().format(NaN)` does NOT throw — it returns
 * `"$NaN"` / `"NaN"` — so the formatter's `catch` never fired for a bad
 * number and a KPI tile rendered `$NaN` to the user. The explicit
 * Number.isFinite guard degrades the non-finite case to an em-dash.
 */

import { describe, expect, it } from 'vitest';
import { formatCurrency, formatNumber, formatPercent } from '../format';

const DASH = '—';
const NON_FINITE = [NaN, Infinity, -Infinity] as const;

describe('genui formatCurrency — non-finite guard', () => {
  it.each(NON_FINITE)('renders an em-dash for %s (never "$NaN")', (v) => {
    expect(formatCurrency(v, 'USD')).toBe(`USD ${DASH}`);
  });
  it('still formats a finite amount', () => {
    // en-US, 0 fraction digits, code display.
    expect(formatCurrency(1500, 'USD')).toContain('1,500');
  });
});

describe('genui formatNumber — non-finite guard', () => {
  it.each(NON_FINITE)('renders an em-dash for %s', (v) => {
    expect(formatNumber(v)).toBe(DASH);
  });
  it('still formats a finite number', () => {
    expect(formatNumber(1234)).toBe('1,234');
  });
});

describe('genui formatPercent — non-finite guard', () => {
  it.each(NON_FINITE)('renders an em-dash for %s (never "NaN%")', (v) => {
    expect(formatPercent(v)).toBe(DASH);
  });
  it('still formats a finite ratio', () => {
    expect(formatPercent(0.25)).toContain('25');
  });
});
