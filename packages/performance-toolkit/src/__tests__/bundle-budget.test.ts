import { describe, expect, it } from 'vitest';
import {
  APP_BUDGETS,
  checkAllBudgets,
  checkBundleBudget,
  parseStatsToSizes,
} from '../bundle-budget/check-bundle-budget.js';

describe('APP_BUDGETS', () => {
  it('exposes the canonical six per-app caps', () => {
    expect(Object.keys(APP_BUDGETS)).toContain('landing');
    expect(Object.keys(APP_BUDGETS)).toContain('ownerPortalDashboard');
    expect(Object.keys(APP_BUDGETS)).toContain('estateManagerDashboard');
    expect(Object.keys(APP_BUDGETS)).toContain('adminPlatformPortal');
    expect(Object.keys(APP_BUDGETS)).toContain('customerApp');
  });

  it('landing is tightest (100 KB cap, LCP-critical)', () => {
    expect(APP_BUDGETS.landing.maxKB).toBe(100);
  });
});

describe('checkBundleBudget', () => {
  const budget = { entry: 'main', maxKB: 200, warnKB: 150 };

  it('ok when under warn', () => {
    expect(checkBundleBudget(budget, { main: 100 }).status).toBe('ok');
  });

  it('warn when between warn and cap', () => {
    expect(checkBundleBudget(budget, { main: 175 }).status).toBe('warn');
  });

  it('error when over cap', () => {
    expect(checkBundleBudget(budget, { main: 250 }).status).toBe('error');
  });

  it('missing when entry not in sizes map', () => {
    expect(checkBundleBudget(budget, {}).status).toBe('missing');
  });
});

describe('checkAllBudgets', () => {
  it('summarises pass/warn/fail counts', () => {
    const r = checkAllBudgets(
      [
        { entry: 'a', maxKB: 100, warnKB: 80 },
        { entry: 'b', maxKB: 100, warnKB: 80 },
        { entry: 'c', maxKB: 100, warnKB: 80 },
      ],
      { a: 50, b: 90, c: 120 },
    );
    expect(r.passed).toBe(1);
    expect(r.warned).toBe(1);
    expect(r.failed).toBe(1);
  });
});

describe('parseStatsToSizes', () => {
  it('extracts gzipSize when available', () => {
    const sizes = parseStatsToSizes({
      chunks: [
        { name: 'main', gzipSize: 102400 },
        { name: 'vendor', gzipSize: 51200 },
      ],
    });
    expect(sizes.main).toBe(100);
    expect(sizes.vendor).toBe(50);
  });

  it('falls back to size when gzipSize missing', () => {
    const sizes = parseStatsToSizes({
      chunks: [{ name: 'main', size: 204800 }],
    });
    expect(sizes.main).toBe(200);
  });

  it('uses fileName stripped of extension when name missing', () => {
    const sizes = parseStatsToSizes({
      chunks: [{ fileName: 'main.js', gzipSize: 1024 }],
    });
    expect(sizes.main).toBe(1);
  });
});
