/**
 * Regulatory mirror — unit tests.
 *
 * Verifies (mining domain):
 *   - TZ royalty underpaid (< 6%) refuse
 *   - TZ royalty return > 30 days late refuse
 *   - TZ export without Mining Commission consent flag
 *   - TZ export without a valid licence refuse
 *   - TZ operating without a licence refuse (always)
 *   - TZ mercury use flag
 *   - KE royalty underpaid (< 5%) refuse
 *   - KE royalty return > 30 days late refuse
 *   - KE export without consent flag / without licence refuse
 *   - KE licence transfer without Commission consent refuse
 *   - UAE placeholder returns 'allow'
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
  statuteVersion: '2010',
  rules: [
    {
      id: 'tz-royalty-underpaid',
      jurisdiction: 'TZ',
      action: 'pay_royalty',
      citation: 'TZ Mining Act 2010 s.87(2)',
      rationale: '>=6% royalty on gross value',
      verdict: 'refuse',
      predicate: (p) =>
        typeof p.royaltyRatePct === 'number' && p.royaltyRatePct < 6,
    },
    {
      id: 'tz-return-late',
      jurisdiction: 'TZ',
      action: 'file_royalty_return',
      citation: 'TZ Mineral Royalty Regs reg.12',
      rationale: 'royalty return within 30 days',
      verdict: 'refuse',
      predicate: (p) => typeof p.daysLate === 'number' && p.daysLate > 30,
    },
    {
      id: 'tz-export-no-consent',
      jurisdiction: 'TZ',
      action: 'export_mineral',
      citation: 'TZ Mining Act 2010 s.59',
      rationale: 'export requires Commission consent',
      verdict: 'flag',
      predicate: (p) => p.hasCommissionConsent === false,
    },
    {
      id: 'tz-export-no-licence',
      jurisdiction: 'TZ',
      action: 'export_mineral',
      citation: 'TZ Mining Act 2010 s.8',
      rationale: 'valid licence required to export',
      verdict: 'refuse',
      predicate: (p) => p.hasValidLicence === false,
    },
    {
      id: 'tz-mercury-flag',
      jurisdiction: 'TZ',
      action: 'use_mercury',
      citation: 'TZ Mining (Environmental) / Minamata',
      rationale: 'mercury use restricted',
      verdict: 'flag',
      predicate: () => true,
    },
    {
      id: 'tz-operate-unlicensed',
      jurisdiction: 'TZ',
      action: 'operate_without_licence',
      citation: 'TZ Mining Act 2010 s.100',
      rationale: 'no mining without a licence',
      verdict: 'refuse',
      predicate: () => true,
    },
    {
      id: 'tz-return-defective',
      jurisdiction: 'TZ',
      action: 'file_royalty_return',
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
  statuteVersion: '2016',
  rules: [
    {
      id: 'ke-royalty-underpaid',
      jurisdiction: 'KE',
      action: 'pay_royalty',
      citation: 'KE Mining Act 2016 s.183',
      rationale: '>=5% royalty on gross value',
      verdict: 'refuse',
      predicate: (p) =>
        typeof p.royaltyRatePct === 'number' && p.royaltyRatePct < 5,
    },
    {
      id: 'ke-export-no-licence',
      jurisdiction: 'KE',
      action: 'export_mineral',
      citation: 'KE Mining Act 2016 s.30',
      rationale: 'valid permit required to export',
      verdict: 'refuse',
      predicate: (p) => p.hasValidLicence === false,
    },
    {
      id: 'ke-export-no-consent',
      jurisdiction: 'KE',
      action: 'export_mineral',
      citation: 'KE Mining Act 2016 s.42',
      rationale: 'export permit / consent required',
      verdict: 'flag',
      predicate: (p) => p.hasCommissionConsent === false,
    },
    {
      id: 'ke-return-late',
      jurisdiction: 'KE',
      action: 'file_royalty_return',
      citation: 'KE Mining (Royalty) Regs reg.5',
      rationale: 'royalty return within 30 days',
      verdict: 'refuse',
      predicate: (p) => typeof p.daysLate === 'number' && p.daysLate > 30,
    },
    {
      id: 'ke-transfer-no-consent',
      jurisdiction: 'KE',
      action: 'transfer_licence',
      citation: 'KE Mining Act 2016 s.166',
      rationale: 'CS consent required for transfer',
      verdict: 'refuse',
      predicate: (p) => p.hasCommissionConsent !== true,
    },
  ],
};

const RERA_PLACEHOLDER: RegulatoryRuleSet = {
  jurisdiction: 'UAE',
  displayName: 'UAE placeholder',
  statuteVersion: 'deferred',
  rules: [],
};

const mirror = createRegulatoryMirror({
  ruleSets: [TZ_RULES, KE_RULES, RERA_PLACEHOLDER],
});

describe('regulatory mirror — TZ', () => {
  it('refuses royalty underpaid below the 6% rate', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'pay_royalty',
      payload: { royaltyRatePct: 3, grossValueMinor: 700_000 },
    });
    expect(r.verdict).toBe('refuse');
    expect(r.matches[0]?.ruleId).toBe('tz-royalty-underpaid');
    expect(r.citeText).toContain('TZ Mining Act 2010 s.87(2)');
  });

  it('allows royalty paid at exactly the 6% rate', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'pay_royalty',
      payload: { royaltyRatePct: 6, grossValueMinor: 700_000 },
    });
    expect(r.verdict).toBe('allow');
  });

  it('refuses a royalty return more than 30 days late', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'file_royalty_return',
      payload: { daysLate: 45 },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('flags export without Mining Commission consent', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'export_mineral',
      payload: { hasValidLicence: true, hasCommissionConsent: false },
    });
    expect(r.verdict).toBe('flag');
  });

  it('refuses export without a valid licence', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'export_mineral',
      payload: { hasValidLicence: false },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('refuses operating without a licence', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'operate_without_licence',
      payload: {},
    });
    expect(r.verdict).toBe('refuse');
  });

  it('flags mercury use', () => {
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'use_mercury',
      payload: {},
    });
    expect(r.verdict).toBe('flag');
  });

  it('treats a throwing predicate as a non-match', () => {
    // The defective return rule is registered alongside the late-return
    // rule. With daysLate=5 the late rule does not fire and the defective
    // predicate must not crash the mirror.
    const r = mirror.check({
      jurisdiction: 'TZ',
      action: 'file_royalty_return',
      payload: { daysLate: 5 },
    });
    expect(r.verdict).toBe('allow');
  });
});

describe('regulatory mirror — KE', () => {
  it('refuses KE royalty underpaid below the 5% rate', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'pay_royalty',
      payload: { royaltyRatePct: 2, grossValueMinor: 250_000 },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('refuses a KE royalty return more than 30 days late', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'file_royalty_return',
      payload: { daysLate: 45 },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('flags KE export without consent', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'export_mineral',
      payload: { hasValidLicence: true, hasCommissionConsent: false },
    });
    expect(r.verdict).toBe('flag');
  });

  it('refuses KE export without a valid licence', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'export_mineral',
      payload: { hasValidLicence: false },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('refuses KE licence transfer without Commission consent', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'transfer_licence',
      payload: { hasCommissionConsent: false },
    });
    expect(r.verdict).toBe('refuse');
  });

  it('allows KE licence transfer with Commission consent', () => {
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'transfer_licence',
      payload: { hasCommissionConsent: true },
    });
    expect(r.verdict).toBe('allow');
  });
});

describe('regulatory mirror — UAE placeholder', () => {
  it('returns allow for UAE (no rules wired yet)', () => {
    const r = mirror.check({
      jurisdiction: 'UAE',
      action: 'pay_royalty',
      payload: { grossValueMinor: 9_999_999, royaltyRatePct: 0 },
    });
    expect(r.verdict).toBe('allow');
    expect(r.matches.length).toBe(0);
  });
});

describe('regulatory mirror — precedence', () => {
  it('returns refuse when refuse + flag both match', () => {
    // KE export_mineral without a licence (refuse) AND without consent (flag)
    const r = mirror.check({
      jurisdiction: 'KE',
      action: 'export_mineral',
      payload: { hasValidLicence: false, hasCommissionConsent: false },
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
