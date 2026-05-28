/**
 * Risk Scanner — rule catalog unit tests.
 *
 * Covers >= 10 individual rules (12 covered here). Each test pins:
 *   1. detect() returns true on the trigger state.
 *   2. detect() returns false on the negation state.
 *   3. evaluate() produces a Risk with the expected severity / kind.
 *
 * State is hand-crafted — no DB. Resolvers are exercised via the
 * scanner.test.ts integration test against the override surface.
 */

import { describe, it, expect } from 'vitest';
import { RISK_RULES } from '../scan-rules';
import { buildScannerState } from '../scanner';
import type { RiskRule, RiskScannerState } from '../types';

function findRule(id: string): RiskRule {
  const rule = RISK_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`rule not found: ${id}`);
  return rule;
}

async function baseState(
  overrides: Partial<RiskScannerState>,
): Promise<RiskScannerState> {
  return await buildScannerState('tenant-test', {
    db: null,
    stateOverride: overrides,
  });
}

describe('risk-scanner rule catalog', () => {
  describe('catalog wiring', () => {
    it('exports >= 30 rules', () => {
      expect(RISK_RULES.length).toBeGreaterThanOrEqual(30);
    });
    it('rule ids are globally unique', () => {
      const seen = new Set<string>();
      for (const r of RISK_RULES) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
    });
    it('every rule covers a valid kind', () => {
      const kinds = new Set([
        'cash_flow',
        'regulatory',
        'operational',
        'hr',
        'compliance',
        'counterparty',
        'market',
        'estate',
        'security',
        'reputational',
        'tax',
        'legal',
      ]);
      for (const r of RISK_RULES) {
        expect(kinds.has(r.kind)).toBe(true);
      }
    });
  });

  describe('cash.runway_below_90d', () => {
    const rule = findRule('cash.runway_below_90d');

    it('fires on runway 45d', async () => {
      const s = await baseState({ cashRunwayDays: 45 });
      expect(rule.detect(s)).toBe(true);
      const r = rule.evaluate(s);
      expect(r.kind).toBe('cash_flow');
      expect(r.severity).toBe('high');
      expect(r.headline.en).toContain('45');
      expect(r.headline.sw).toContain('45');
    });
    it('escalates to critical under 30d', async () => {
      const s = await baseState({ cashRunwayDays: 12 });
      expect(rule.evaluate(s).severity).toBe('critical');
    });
    it('does not fire at 120d', async () => {
      const s = await baseState({ cashRunwayDays: 120 });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('regulatory.nemc_eia_expiring_30d', () => {
    const rule = findRule('regulatory.nemc_eia_expiring_30d');

    it('fires at 23 days', async () => {
      const s = await baseState({ nemcEiaDaysToExpiry: 23 });
      expect(rule.detect(s)).toBe(true);
      const r = rule.evaluate(s);
      expect(r.kind).toBe('regulatory');
      expect(r.severity).toBe('high');
      expect(r.mitigationActions.map((m) => m.action)).toContain(
        'draft_nemc_eia_renewal',
      );
    });
    it('escalates to critical inside 7 days', async () => {
      const s = await baseState({ nemcEiaDaysToExpiry: 5 });
      expect(rule.evaluate(s).severity).toBe('critical');
    });
    it('does not fire at 60 days', async () => {
      const s = await baseState({ nemcEiaDaysToExpiry: 60 });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('regulatory.tra_filing_overdue', () => {
    const rule = findRule('regulatory.tra_filing_overdue');

    it('fires when overdue > 0', async () => {
      const s = await baseState({
        traFilingDaysOverdue: 4,
        traPenaltyAccrualTzs: 1_200_000,
      });
      expect(rule.detect(s)).toBe(true);
      const r = rule.evaluate(s);
      expect(r.exposureTzs).toBe(1_200_000);
    });
    it('does not fire when null', async () => {
      const s = await baseState({ traFilingDaysOverdue: null });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('operational.fuel_inventory_below_safety', () => {
    const rule = findRule('operational.fuel_inventory_below_safety');

    it('fires when 5 days remaining', async () => {
      const s = await baseState({ fuelDaysRemaining: 5 });
      expect(rule.detect(s)).toBe(true);
      expect(rule.evaluate(s).severity).toBe('high');
    });
    it('critical when 2 days remaining', async () => {
      const s = await baseState({ fuelDaysRemaining: 2 });
      expect(rule.evaluate(s).severity).toBe('critical');
    });
    it('does not fire at 14 days', async () => {
      const s = await baseState({ fuelDaysRemaining: 14 });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('hr.ica_cert_expired_active_duty', () => {
    const rule = findRule('hr.ica_cert_expired_active_duty');

    it('fires when one operator working with expired cert', async () => {
      const s = await baseState({ operatorsWithExpiredIcaActive: 1 });
      expect(rule.detect(s)).toBe(true);
      expect(rule.evaluate(s).severity).toBe('critical');
    });
    it('does not fire when zero', async () => {
      const s = await baseState({ operatorsWithExpiredIcaActive: 0 });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('hr.payroll_readiness_gap', () => {
    const rule = findRule('hr.payroll_readiness_gap');

    it('fires when cash < payroll within 7 days', async () => {
      const s = await baseState({
        payrollDueInDays: 5,
        payrollAmountTzs: 100_000_000,
        cashOnHandTzs: 60_000_000,
      });
      expect(rule.detect(s)).toBe(true);
      const r = rule.evaluate(s);
      expect(r.severity).toBe('critical');
      expect(r.exposureTzs).toBe(40_000_000);
    });
    it('does not fire when cash sufficient', async () => {
      const s = await baseState({
        payrollDueInDays: 5,
        payrollAmountTzs: 100_000_000,
        cashOnHandTzs: 120_000_000,
      });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('compliance.regulator_stop_work_risk', () => {
    const rule = findRule('compliance.regulator_stop_work_risk');

    it('fires when nemc + osha + open incidents', async () => {
      const s = await baseState({
        nemcAmber: true,
        oshaAmber: true,
        openIncidents: 1,
      });
      expect(rule.detect(s)).toBe(true);
      expect(rule.evaluate(s).severity).toBe('critical');
    });
    it('does not fire without incidents', async () => {
      const s = await baseState({
        nemcAmber: true,
        oshaAmber: true,
        openIncidents: 0,
      });
      expect(rule.detect(s)).toBe(false);
    });
    it('does not fire when only one amber', async () => {
      const s = await baseState({
        nemcAmber: true,
        oshaAmber: false,
        openIncidents: 3,
      });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('counterparty.buyer_default_signal', () => {
    const rule = findRule('counterparty.buyer_default_signal');

    it('fires on 2+ late payments', async () => {
      const s = await baseState({
        buyerLatePayments: [
          {
            buyerId: 'b1',
            buyerName: 'Acme Trading',
            latePaymentCount: 3,
            crbScoreDelta: -5,
          },
        ],
      });
      expect(rule.detect(s)).toBe(true);
      expect(rule.evaluate(s).headline.en).toContain('Acme Trading');
    });
    it('fires on CRB drop alone', async () => {
      const s = await baseState({
        buyerLatePayments: [
          {
            buyerId: 'b2',
            buyerName: 'Beta Off-take',
            latePaymentCount: 0,
            crbScoreDelta: -30,
          },
        ],
      });
      expect(rule.detect(s)).toBe(true);
    });
    it('does not fire on clean buyer', async () => {
      const s = await baseState({
        buyerLatePayments: [
          {
            buyerId: 'b3',
            buyerName: 'Clean Co',
            latePaymentCount: 0,
            crbScoreDelta: 0,
          },
        ],
      });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('market.lbma_fix_dropping', () => {
    const rule = findRule('market.lbma_fix_dropping');

    it('fires at -2.5 sigma', async () => {
      const s = await baseState({
        lbmaFixDelta30dSigma: -2.5,
        monthlyRevenueTzs: 500_000_000,
      });
      expect(rule.detect(s)).toBe(true);
      const r = rule.evaluate(s);
      expect(r.kind).toBe('market');
      expect(r.exposureTzs).toBe(25_000_000);
    });
    it('does not fire at -1 sigma', async () => {
      const s = await baseState({ lbmaFixDelta30dSigma: -1 });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('estate.succession_plan_stale', () => {
    const rule = findRule('estate.succession_plan_stale');

    it('fires when overdue 400d and principal 70', async () => {
      const s = await baseState({
        successionReviewOverdueDays: 400,
        principalOwnerAgeYears: 70,
      });
      expect(rule.detect(s)).toBe(true);
      expect(rule.evaluate(s).severity).toBe('high');
    });
    it('does not fire when principal under 65', async () => {
      const s = await baseState({
        successionReviewOverdueDays: 400,
        principalOwnerAgeYears: 50,
      });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('estate.insurance_lapsing_30d', () => {
    const rule = findRule('estate.insurance_lapsing_30d');

    it('fires with policy at 12 days', async () => {
      const s = await baseState({
        insurancePoliciesExpiring30d: [
          { policyId: 'p1', policyKind: 'pit-liability', daysToExpiry: 12 },
        ],
      });
      expect(rule.detect(s)).toBe(true);
      const r = rule.evaluate(s);
      expect(r.severity).toBe('critical');
      expect(r.headline.en).toContain('pit-liability');
    });
    it('does not fire when empty', async () => {
      const s = await baseState({ insurancePoliciesExpiring30d: [] });
      expect(rule.detect(s)).toBe(false);
    });
  });

  describe('legal.contract_expiring_critical', () => {
    const rule = findRule('legal.contract_expiring_critical');

    it('fires when contract <60d with no renewal', async () => {
      const s = await baseState({
        top3ContractsExpiring60d: [
          {
            contractId: 'c1',
            counterpartyName: 'Top Buyer Ltd',
            daysToExpiry: 25,
            annualValueTzs: 2_000_000_000,
            hasRenewalInFlight: false,
          },
        ],
      });
      expect(rule.detect(s)).toBe(true);
      const r = rule.evaluate(s);
      expect(r.severity).toBe('critical');
      expect(r.exposureTzs).toBe(2_000_000_000);
    });
    it('does not fire when renewal in flight', async () => {
      const s = await baseState({
        top3ContractsExpiring60d: [
          {
            contractId: 'c1',
            counterpartyName: 'Top Buyer Ltd',
            daysToExpiry: 25,
            annualValueTzs: 2_000_000_000,
            hasRenewalInFlight: true,
          },
        ],
      });
      expect(rule.detect(s)).toBe(false);
    });
  });
});
