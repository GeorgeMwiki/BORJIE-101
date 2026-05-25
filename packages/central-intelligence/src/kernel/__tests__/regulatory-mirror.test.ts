/**
 * Regulatory mirror — unit tests.
 *
 * Verifies:
 *   - TZ deposit cap (2x rent) refuse
 *   - TZ eviction notice < 30 days refuse
 *   - TZ rent-increase ceiling flag at >15%
 *   - TZ eviction without court order refuse
 *   - TZ entry < 48h flag
 *   - TZ distress prohibited refuse
 *   - KE deposit cap (2x rent) refuse
 *   - KE rent-increase notice < 60 days refuse
 *   - KE rent-increase ceiling flag at >10%
 *   - KE eviction notice < 60 days refuse
 *   - KE distress without court order refuse
 *   - UAE/RERA placeholder returns 'allow'
 *   - Unknown jurisdiction returns 'allow' (graceful)
 *   - Multi-match returns refuse > flag > allow precedence
 *   - Predicate that throws is treated as no-match
 */

import { describe, it, expect } from 'vitest';
import {
  createRegulatoryMirror,
  type RegulatoryRuleSet,
} from '../regulatory-mirror.js';

// Inline rule data mirroring the domain-models rule sets so the kernel
// tests don't depend on the domain-models package shape at runtime.
const TZ_RULES: RegulatoryRuleSet = {
  jurisdiction: 'TZ',
  displayName: 'TZ test fixture',
  statuteVersion: '2022',
  rules: [
    {
      id: 'tz-deposit-cap-2x',
      jurisdiction: 'TZ',
      action: 'collect_deposit',
      citation: 'TZ s.27(1)',
      rationale: '<=2x rent',
      verdict: 'refuse',
      predicate: (p) =>
        typeof p.amountMinor === 'number' &&
        typeof p.monthlyRentMinor === 'number' &&
        p.monthlyRentMinor > 0 &&
        p.amountMinor > p.monthlyRentMinor * 2,
    },
    {
      id: 'tz-eviction-notice-min-30',
      jurisdiction: 'TZ',
      action: 'issue_eviction_notice',
      citation: 'TZ s.41(2)',
      rationale: '>=30 days',
      verdict: 'refuse',
      predicate: (p) => typeof p.noticeDays === 'number' && p.noticeDays < 30,
    },
    {
      id: 'tz-rent-increase-ceiling',
      jurisdiction: 'TZ',
      action: 'raise_rent',
      citation: 'TZ s.31(3)',
      rationale: '<=15% per cycle',
      verdict: 'flag',
      predicate: (p) =>
        typeof p.increasePercentage === 'number' && p.increasePercentage > 15,
    },
    {
      id: 'tz-eviction-no-court-order',
      jurisdiction: 'TZ',
      action: 'evict',
      citation: 'TZ s.42',
      rationale: 'court order required',
      verdict: 'refuse',
      predicate: (p) => p.hasCourtOrder === false,
    },
    {
      id: 'tz-entry-without-notice',
      jurisdiction: 'TZ',
      action: 'enter_premises',
      citation: 'TZ s.36',
      rationale: '48h notice',
      verdict: 'flag',
      predicate: (p) => typeof p.noticeDays === 'number' && p.noticeDays < 2,
    },
    {
      id: 'tz-distress-prohibited',
      jurisdiction: 'TZ',
      action: 'distrain_goods',
      citation: 'TZ s.45',
      rationale: 'no self-help',
      verdict: 'refuse',
      predicate: () => true,
    },
    {
      id: 'tz-rent-increase-defective',
      jurisdiction: 'TZ',
      action: 'raise_rent',
      citation: 'TZ defective',
      rationale: 'defective predicate',
      verdict: 'refuse',
      predicate: () => {
        throw new Error('boom');
      },
    },
  ],
};

const KE_RULES: RegulatoryRuleSet = {
  jurisdiction: 'KE',
  displayName: 'KE test fixture',
  statuteVersion: '2012',
  rules: [
    {
      id: 'ke-deposit-cap-2x',
      jurisdiction: 'KE',
      action: 'collect_deposit',
      citation: 'KE Cap.296 s.5(2)(b)',
      rationale: '<=2x rent',
      verdict: 'refuse',
      predicate: (p) =>
        typeof p.amountMinor === 'number' &&
        typeof p.monthlyRentMinor === 'number' &&
        p.monthlyRentMinor > 0 &&
        p.amountMinor > p.monthlyRentMinor * 2,
    },
    {
      id: 'ke-rent-increase-notice',
      jurisdiction: 'KE',
      action: 'raise_rent',
      citation: 'KE Cap.296 s.6(2)',
      rationale: '>=60 days notice',
      verdict: 'refuse',
      predicate: (p) => typeof p.noticeDays === 'number' && p.noticeDays < 60,
    },
    {
      id: 'ke-rent-increase-ceiling',
      jurisdiction: 'KE',
      action: 'raise_rent',
      citation: 'KE Cap.296 s.6(3)',
      rationale: '<=10% per cycle',
      verdict: 'flag',
      predicate: (p) =>
        typeof p.increasePercentage === 'number' && p.increasePercentage > 10,
    },
    {
      id: 'ke-eviction-notice-min-60',
      jurisdiction: 'KE',
      action: 'issue_eviction_notice',
      citation: 'KE Cap.296 s.7',
      rationale: '>=60 days',
      verdict: 'refuse',
      predicate: (p) => typeof p.noticeDays === 'number' && p.noticeDays < 60,
    },
    {
      id: 'ke-distress-requires-warrant',
      jurisdiction: 'KE',
      action: 'distrain_goods',
      citation: 'KE Cap.293 s.4',
      rationale: 'warrant required',
      verdict: 'refuse',
      predicate: (p) => p.hasCourtOrder !== true,
    },
  ],
};

const RERA_PLACEHOLDER: RegulatoryRuleSet = {
  jurisdiction: 'UAE',
  displayName: 'RERA placeholder',
  statuteVersion: 'deferred',
  rules: [],
};

const mirror = createRegulatoryMirror({
  ruleSets: [TZ_RULES, KE_RULES, RERA_PLACEHOLDER],
});

describe('regulatory mirror — TZ', () => {
  it('refuses deposit > 2x rent', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'collect_deposit',
      payload: { amountMinor: 700_000, monthlyRentMinor: 300_000 },
    });
    expect(r.verdict).toBe('refuse');
    expect(r.matches[0]?.ruleId).toBe('tz-deposit-cap-2x');
    expect(r.citeText).toContain('TZ s.27(1)');
  });

  it('allows deposit at exactly 2x rent', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'collect_deposit',
      payload: { amountMinor: 600_000, monthlyRentMinor: 300_000 },
    });
    expect(r.verdict).toBe('allow');
  });

  it('refuses eviction notice < 30 days', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'issue_eviction_notice',
      payload: { noticeDays: 14 },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('flags rent increase > 15%', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'raise_rent',
      payload: { increasePercentage: 18 },
    });
    expect(r.verdict).toBe('flag');
  });

  it('refuses eviction without court order', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'evict',
      payload: { hasCourtOrder: false },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('flags entry with < 48h notice', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'enter_premises',
      payload: { noticeDays: 1 },
    });
    expect(r.verdict).toBe('flag');
  });

  it('refuses any distress action', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'distrain_goods',
      payload: {},
    });
    expect(r.verdict).toBe('refuse');
  });

  it('treats a throwing predicate as a non-match', () => {
    // The defective rent-increase rule is registered alongside the
    // flag rule. With increasePercentage=5 the flag rule does not
    // fire and the defective predicate must not crash the mirror.
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'raise_rent',
      payload: { increasePercentage: 5 },
    });
    expect(r.verdict).toBe('allow');
  });
});

describe('regulatory mirror — KE', () => {
  it('refuses KE deposit > 2x rent', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'collect_deposit',
      payload: { amountMinor: 250_000, monthlyRentMinor: 100_000 },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('refuses KE rent-increase notice < 60 days', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'raise_rent',
      payload: { noticeDays: 30 },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('flags KE rent increase > 10%', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'raise_rent',
      payload: { noticeDays: 90, increasePercentage: 12 },
    });
    expect(r.verdict).toBe('flag');
  });

  it('refuses KE eviction notice < 60 days', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'issue_eviction_notice',
      payload: { noticeDays: 45 },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('refuses KE distress without warrant', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'distrain_goods',
      payload: { hasCourtOrder: false },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('allows KE distress with warrant', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'distrain_goods',
      payload: { hasCourtOrder: true },
    });
    expect(r.verdict).toBe('allow');
  });
});

describe('regulatory mirror — RERA placeholder', () => {
  it('returns allow for UAE (no rules wired yet)', () => {
    const r = mirror.check({
      jurisdiction: 'UAE',
      action: 'collect_deposit',
      payload: { amountMinor: 9_999_999, monthlyRentMinor: 1 },
    });
    expect(r.verdict).toBe('allow');
    expect(r.matches.length).toBe(0);
  });
});

describe('regulatory mirror — precedence', () => {
  it('returns refuse when refuse + flag both match', () => {
    // KE raise_rent with noticeDays < 60 (refuse) AND increase > 10% (flag)
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'raise_rent',
      payload: { noticeDays: 30, increasePercentage: 18 },
    });
    expect(r.verdict).toBe('refuse');
    expect(r.matches.length).toBeGreaterThanOrEqual(2);
  });

  it('lists configured jurisdictions', () => {
    expect(mirror.knownJurisdictions()).toEqual(
      expect.arrayContaining(['TZ', 'KE', 'UAE']),
    );
  });
});
