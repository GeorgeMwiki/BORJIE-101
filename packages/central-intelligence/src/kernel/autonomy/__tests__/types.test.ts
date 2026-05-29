/**
 * Mr. Mwikila autonomy — tier / delegation resolver unit tests.
 *
 * Verifies:
 *   - DELEGATION_CATEGORIES contains the 12 spec categories
 *   - CATEGORY_DEFAULT_TIER picks the safer default
 *   - resolveDelegation falls back to defaults when no owner row
 *   - resolveDelegation honours owner row tier + windows + envelope
 *   - tierAllowsImmediateExecution true only for T2/T3
 *   - tierAllowsReversal true only for T2
 *   - tierRank monotonically rises 0..3
 */

import { describe, it, expect } from 'vitest';

import {
  CATEGORY_DEFAULT_REVERSAL_HOURS,
  CATEGORY_DEFAULT_TIER,
  DELEGATION_CATEGORIES,
  effectiveTier,
  resolveDelegation,
  tierAllowsImmediateExecution,
  tierAllowsReversal,
  tierRank,
  type DelegationPref,
} from '../types.js';

describe('autonomy.types', () => {
  it('exposes exactly the 12 spec categories', () => {
    expect(DELEGATION_CATEGORIES).toHaveLength(12);
    expect(DELEGATION_CATEGORIES).toContain('shifts');
    expect(DELEGATION_CATEGORIES).toContain('worker-discipline');
    expect(DELEGATION_CATEGORIES).toContain('capex');
    expect(DELEGATION_CATEGORIES).toContain('marketplace-counters');
  });

  it('picks T0 default for HR-sensitive categories', () => {
    expect(CATEGORY_DEFAULT_TIER['worker-hires']).toBe('T0');
    expect(CATEGORY_DEFAULT_TIER['worker-discipline']).toBe('T0');
    expect(CATEGORY_DEFAULT_TIER.capex).toBe('T0');
  });

  it('picks T2 default for low-stakes routine categories', () => {
    expect(CATEGORY_DEFAULT_TIER.shifts).toBe('T2');
    expect(CATEGORY_DEFAULT_TIER['license-renewal-reminders']).toBe('T2');
    expect(CATEGORY_DEFAULT_TIER['inventory-orders']).toBe('T2');
    expect(CATEGORY_DEFAULT_TIER['marketplace-counters']).toBe('T2');
  });

  it('reversal window defaults to 4h for marketplace-counters, 24h otherwise', () => {
    expect(CATEGORY_DEFAULT_REVERSAL_HOURS['marketplace-counters']).toBe(4);
    expect(CATEGORY_DEFAULT_REVERSAL_HOURS.shifts).toBe(24);
    expect(CATEGORY_DEFAULT_REVERSAL_HOURS['payroll-prep']).toBe(24);
  });

  it('tierRank is monotonic 0..3', () => {
    expect(tierRank('T0')).toBe(0);
    expect(tierRank('T1')).toBe(1);
    expect(tierRank('T2')).toBe(2);
    expect(tierRank('T3')).toBe(3);
  });

  it('tierAllowsImmediateExecution true only for T2/T3', () => {
    expect(tierAllowsImmediateExecution('T0')).toBe(false);
    expect(tierAllowsImmediateExecution('T1')).toBe(false);
    expect(tierAllowsImmediateExecution('T2')).toBe(true);
    expect(tierAllowsImmediateExecution('T3')).toBe(true);
  });

  it('tierAllowsReversal true only for T2', () => {
    expect(tierAllowsReversal('T0')).toBe(false);
    expect(tierAllowsReversal('T1')).toBe(false);
    expect(tierAllowsReversal('T2')).toBe(true);
    expect(tierAllowsReversal('T3')).toBe(false);
  });

  it('effectiveTier returns category default when owner tier is null', () => {
    expect(effectiveTier(null, 'shifts')).toBe('T2');
    expect(effectiveTier(null, 'capex')).toBe('T0');
  });

  it('effectiveTier honours owner-set tier when present', () => {
    expect(effectiveTier('T1', 'shifts')).toBe('T1');
    expect(effectiveTier('T3', 'shifts')).toBe('T3');
  });

  it('resolveDelegation falls back to defaults when pref is null', () => {
    const r = resolveDelegation(null, 'shifts');
    expect(r.tier).toBe('T2');
    expect(r.reversalWindowHours).toBe(24);
    expect(r.envelopeThresholdTzs).toBe(null);
    expect(r.source).toBe('default');
  });

  it('resolveDelegation honours owner-set tier + windows', () => {
    const pref: DelegationPref = {
      tenantId: 'tenant-x',
      category: 'shifts',
      tier: 'T1',
      reversalWindowHours: 12,
      envelopeThresholdTzs: 2_500_000,
      setByUserId: 'user-owner',
      setAt: '2026-05-29T00:00:00Z',
      notes: null,
    };
    const r = resolveDelegation(pref, 'shifts');
    expect(r.tier).toBe('T1');
    expect(r.reversalWindowHours).toBe(12);
    expect(r.envelopeThresholdTzs).toBe(2_500_000);
    expect(r.source).toBe('owner');
  });

  it('resolveDelegation falls back when pref category mismatches', () => {
    const pref: DelegationPref = {
      tenantId: 'tenant-x',
      category: 'shifts',
      tier: 'T3',
      reversalWindowHours: null,
      envelopeThresholdTzs: null,
      setByUserId: 'user-owner',
      setAt: '2026-05-29T00:00:00Z',
      notes: null,
    };
    // Asked for capex, pref is for shifts — must use default.
    const r = resolveDelegation(pref, 'capex');
    expect(r.tier).toBe('T0');
    expect(r.source).toBe('default');
  });

  it('resolveDelegation uses category default window when owner row leaves it null', () => {
    const pref: DelegationPref = {
      tenantId: 'tenant-x',
      category: 'marketplace-counters',
      tier: 'T2',
      reversalWindowHours: null,
      envelopeThresholdTzs: null,
      setByUserId: 'user-owner',
      setAt: '2026-05-29T00:00:00Z',
      notes: null,
    };
    const r = resolveDelegation(pref, 'marketplace-counters');
    expect(r.reversalWindowHours).toBe(4);
  });
});
