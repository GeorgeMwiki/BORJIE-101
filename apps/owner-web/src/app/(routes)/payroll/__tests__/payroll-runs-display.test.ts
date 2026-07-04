/**
 * Track A1 — payroll draft runs must NOT render a fabricated "TZS 0" / "0
 * workers". A `draft` run stores placeholder zeros (total_tzs / worker_count
 * default 0, stamped only at preview time); rendering them as a computed
 * money fact fabricates a figure the estate never produced. A genuinely
 * committed zero-cost period is a REAL zero and must still render as 0.
 *
 * These exercise the pure display helpers directly (no React mount) so the
 * red→green barrier is fast and isolated.
 */
import { describe, it, expect } from 'vitest';
import {
  netTotalDisplay,
  workerCountDisplay,
  type PayrollRunRow,
} from '../PayrollRunsList';

const PLACEHOLDER = '—';

function makeRow(overrides: Partial<PayrollRunRow>): PayrollRunRow {
  return {
    id: 'run-1',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
    status: 'draft',
    ...overrides,
  };
}

describe('payroll runs display helpers', () => {
  describe('draft runs (not computed yet)', () => {
    it('net total renders the placeholder, not a fabricated TZS 0', () => {
      // A draft carries a placeholder zero total_tzs stamped only at preview.
      const draft = makeRow({ status: 'draft', totalTzs: 0, workerCount: 0 });
      const out = netTotalDisplay(draft, 'en');
      expect(out).toBe(PLACEHOLDER);
      expect(out).not.toMatch(/0/);
    });

    it('worker count renders the placeholder, not a fabricated 0', () => {
      const draft = makeRow({ status: 'draft', totalTzs: 0, workerCount: 0 });
      expect(workerCountDisplay(draft)).toBe(PLACEHOLDER);
    });

    it('placeholder is locale-neutral (identical under en and sw)', () => {
      const draft = makeRow({ status: 'draft', totalTzs: '0', workerCount: 0 });
      expect(netTotalDisplay(draft, 'en')).toBe(netTotalDisplay(draft, 'sw'));
    });
  });

  describe('committed runs (genuinely computed)', () => {
    it('a real committed zero-cost period still renders formatted money', () => {
      const committed = makeRow({
        status: 'committed',
        totalTzs: 0,
        workerCount: 0,
        committedAt: '2026-06-30',
      });
      const out = netTotalDisplay(committed, 'en');
      expect(out).not.toBe(PLACEHOLDER);
      expect(out).toMatch(/0/);
    });

    it('a real committed zero worker count still renders "0"', () => {
      const committed = makeRow({
        status: 'committed',
        totalTzs: 0,
        workerCount: 0,
      });
      expect(workerCountDisplay(committed)).toBe('0');
    });

    it('a committed run with a real total renders that money', () => {
      const committed = makeRow({
        status: 'committed',
        totalTzs: '1500000',
        workerCount: 12,
        committedAt: '2026-06-30',
      });
      expect(netTotalDisplay(committed, 'en')).not.toBe(PLACEHOLDER);
      expect(workerCountDisplay(committed)).toBe('12');
    });
  });

  describe('previewed / non-draft runs with an absent total', () => {
    it('an unstamped (null) total renders the placeholder, not TZS 0', () => {
      const previewedNoTotal = makeRow({
        status: 'previewed',
        totalTzs: null,
        workerCount: null,
      });
      expect(netTotalDisplay(previewedNoTotal, 'en')).toBe(PLACEHOLDER);
      expect(workerCountDisplay(previewedNoTotal)).toBe(PLACEHOLDER);
    });

    it('a previewed run WITH a stamped total renders that money', () => {
      const previewed = makeRow({
        status: 'previewed',
        totalTzs: '2400000',
        workerCount: 8,
      });
      expect(netTotalDisplay(previewed, 'en')).not.toBe(PLACEHOLDER);
      expect(workerCountDisplay(previewed)).toBe('8');
    });
  });
});
