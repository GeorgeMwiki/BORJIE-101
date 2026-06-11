/**
 * Unit tests for the data-binding layer — the ledger/entity → view
 * mapping that funnels money through formatCurrency and selects a single
 * language. These are the hard-rail guarantees made machine-checkable.
 */

import { describe, expect, it } from 'vitest';
import {
  bindMoney,
  bindNumber,
  bindCitations,
  bindLedgerTotal,
  selectLabels,
  localeTag,
  type LedgerLine,
} from '../data-binding.js';
import type { Citation } from '../../types.js';

describe('bindMoney — multi-currency via formatCurrency', () => {
  it('formats in the supplied currency (never hard-coded)', () => {
    const tzs = bindMoney(1_234_567, 'TZS', 'en');
    expect(tzs).toContain('TZS');
    expect(tzs).toContain('1,234,567');
  });

  it('honours a different currency for KE/UG/NG expansion', () => {
    expect(bindMoney(1000, 'KES', 'en')).toContain('KES');
    expect(bindMoney(1000, 'NGN', 'en')).toContain('NGN');
    expect(bindMoney(1000, 'UGX', 'en')).toContain('UGX');
  });

  it('rounds to currency minor units before formatting', () => {
    // 100.005 rounds to 100.01 (banker-safe via roundMoney).
    expect(bindMoney(100.005, 'USD', 'en')).toContain('100.01');
  });

  it('throws when currency is missing (no silent default — hard rail)', () => {
    expect(() => bindMoney(1, '', 'en')).toThrow(/currency/i);
    // @ts-expect-error — proving the runtime guard, not the type guard.
    expect(() => bindMoney(1, undefined, 'en')).toThrow(/currency/i);
  });
});

describe('selectLabels — EN/SW absolute toggle', () => {
  const labels = { en: { title: 'Statement' }, sw: { title: 'Taarifa' } };
  it('returns exactly one language, never a mix', () => {
    expect(selectLabels('en', labels)).toEqual({ title: 'Statement' });
    expect(selectLabels('sw', labels)).toEqual({ title: 'Taarifa' });
  });
  it('localeTag groups Swahili as sw-TZ, English as en', () => {
    expect(localeTag('sw')).toBe('sw-TZ');
    expect(localeTag('en')).toBe('en');
  });
});

describe('bindNumber — non-monetary grouping', () => {
  it('groups large quantities', () => {
    expect(bindNumber(12_500, 'en')).toBe('12,500');
  });
});

describe('bindLedgerTotal — read-only ledger → document model', () => {
  const lines: ReadonlyArray<LedgerLine> = [
    { ref: 'L1', date: '2026-01-01', description: 'rent', amount: 100_000 },
    { ref: 'L2', date: '2026-01-02', description: 'fee', amount: 50_000 },
    { ref: 'L3', date: '2026-01-03', description: 'adj', amount: -7_500 },
  ];
  it('sums lines and binds the total as money', () => {
    const out = bindLedgerTotal(lines, 'TZS', 'en');
    expect(out.total).toBe(142_500);
    expect(out.formatted).toContain('142,500');
    expect(out.formatted).toContain('TZS');
  });
  it('handles an empty ledger as zero', () => {
    const out = bindLedgerTotal([], 'TZS', 'en');
    expect(out.total).toBe(0);
  });
});

describe('bindCitations — evidence chain projection', () => {
  it('projects citations to the compact template shape', () => {
    const citations: ReadonlyArray<Citation> = [
      {
        id: 'C1',
        claim: 'TZS 100,000',
        source: { kind: 'ledger_entry', ref: 'ledger:abc' },
      },
    ];
    expect(bindCitations(citations)).toEqual([
      { id: 'C1', claim: 'TZS 100,000', ref: 'ledger:abc' },
    ]);
  });
});
