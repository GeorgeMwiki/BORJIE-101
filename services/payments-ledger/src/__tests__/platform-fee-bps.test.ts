/**
 * Regression tests for the HIGH fix: float-math → integer-bps for the
 * platform fee (see .audit/deep-audit-2026-05-20.md item HIGH#8).
 *
 * DA4: the previous version of this file mocked ~100 lines of express /
 * pino / orchestration ceremony to dynamic-import `server.ts` just to
 * read out a pure function. The fee math now lives in
 * `../lib/platform-fee.ts` and the test imports it directly — mock-free.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  calculatePlatformFeeMinor,
  resolvePlatformFeeBps,
} from '../lib/platform-fee';

describe('calculatePlatformFeeMinor', () => {
  it('computes 5% (500 bps) of 100_00 minor as 500 minor (5.00)', () => {
    expect(calculatePlatformFeeMinor(100_00, 500)).toBe(500);
  });

  it('computes 0% (0 bps) as 0 regardless of amount', () => {
    expect(calculatePlatformFeeMinor(123_456_789, 0)).toBe(0);
  });

  it('computes 100% (10000 bps) of any amount as the amount itself', () => {
    expect(calculatePlatformFeeMinor(75_000, 10_000)).toBe(75_000);
  });

  it('truncates fractional minor units with Math.floor (never silently rounds up)', () => {
    // 0.5% of 199 = 0.995 → floor → 0
    expect(calculatePlatformFeeMinor(199, 50)).toBe(0);
    // 0.5% of 200 = 1.0 → 1
    expect(calculatePlatformFeeMinor(200, 50)).toBe(1);
    // 0.5% of 201 = 1.005 → floor → 1
    expect(calculatePlatformFeeMinor(201, 50)).toBe(1);
  });

  it('is host-stable for the canonical 5% fee on a 7,500 KES rent payment', () => {
    // 750_000 minor (KES 7,500) at 500 bps = 37,500 minor = KES 375.00.
    expect(calculatePlatformFeeMinor(750_000, 500)).toBe(37_500);
  });

  it('throws on non-integer amountMinor', () => {
    expect(() => calculatePlatformFeeMinor(100.5, 500)).toThrowError(
      /non-negative integer/,
    );
  });

  it('throws on negative amountMinor', () => {
    expect(() => calculatePlatformFeeMinor(-100, 500)).toThrowError(
      /non-negative integer/,
    );
  });

  it('throws on bps outside [0, 10000]', () => {
    expect(() => calculatePlatformFeeMinor(100, -1)).toThrowError(/bps/);
    expect(() => calculatePlatformFeeMinor(100, 10_001)).toThrowError(/bps/);
    expect(() => calculatePlatformFeeMinor(100, 1.5)).toThrowError(/bps/);
  });
});

describe('resolvePlatformFeeBps', () => {
  afterEach(() => {
    delete process.env.PLATFORM_FEE_BPS;
    delete process.env.PLATFORM_FEE_PERCENT;
  });

  it('returns the default 500 bps (5%) when no env vars are set', () => {
    expect(resolvePlatformFeeBps({})).toBe(500);
  });

  it('prefers PLATFORM_FEE_BPS when both env vars are set', () => {
    expect(
      resolvePlatformFeeBps({ PLATFORM_FEE_BPS: '250', PLATFORM_FEE_PERCENT: '99' }),
    ).toBe(250);
  });

  it('converts legacy PLATFORM_FEE_PERCENT to bps and logs deprecation', () => {
    const warns: Array<{ meta: Record<string, unknown>; msg: string }> = [];
    const result = resolvePlatformFeeBps(
      { PLATFORM_FEE_PERCENT: '2.5' },
      { warn: (meta, msg) => warns.push({ meta, msg }) },
    );
    expect(result).toBe(250);
    expect(warns).toHaveLength(1);
    expect(warns[0]?.msg).toMatch(/DEPRECATED/i);
  });

  it('throws on invalid PLATFORM_FEE_BPS', () => {
    expect(() => resolvePlatformFeeBps({ PLATFORM_FEE_BPS: 'abc' })).toThrowError(
      /PLATFORM_FEE_BPS_INVALID/,
    );
    expect(() => resolvePlatformFeeBps({ PLATFORM_FEE_BPS: '10001' })).toThrowError(
      /PLATFORM_FEE_BPS_INVALID/,
    );
  });

  it('throws on invalid PLATFORM_FEE_PERCENT', () => {
    expect(() =>
      resolvePlatformFeeBps({ PLATFORM_FEE_PERCENT: '101' }),
    ).toThrowError(/PLATFORM_FEE_PERCENT_INVALID/);
  });
});
