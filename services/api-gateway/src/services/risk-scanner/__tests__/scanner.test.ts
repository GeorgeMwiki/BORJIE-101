/**
 * Risk Scanner — scanner ranking / dedup / locale / symmetry tests.
 *
 * Covers:
 *   - evaluateRisks ranks by severity * 1/timeToImpact
 *   - dedup by ruleId (defensive)
 *   - locale-bilingual content present
 *   - kindFilter / minSeverity / scopeIds filtering
 *   - countRulesByKind sums to total
 *   - scan with empty state returns []
 *   - the symmetry rule: a critical risk outranks a less-urgent risk
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateRisks,
  scanRisks,
  countRulesByKind,
  buildScannerState,
  SEVERITY_WEIGHT,
} from '../index';

describe('risk-scanner — scanner', () => {
  describe('evaluateRisks ranking + filtering', () => {
    it('returns empty when no rule fires', async () => {
      const state = await buildScannerState('t-empty', { db: null });
      expect(evaluateRisks(state).length).toBe(0);
    });

    it('ranks critical-+-short-ttd above medium-+-long-ttd', async () => {
      const state = await buildScannerState('t-rank', {
        db: null,
        stateOverride: {
          operatorsWithExpiredIcaActive: 2, // critical, ttd=1
          lbmaFixDelta30dSigma: -2.5, // medium, ttd=14
        },
      });
      const risks = evaluateRisks(state);
      expect(risks.length).toBeGreaterThanOrEqual(2);
      expect(risks[0]?.severity).toBe('critical');
      expect(risks[0]?.ruleId).toBe('hr.ica_cert_expired_active_duty');
    });

    it('respects kindFilter', async () => {
      const state = await buildScannerState('t-filter', {
        db: null,
        stateOverride: {
          cashRunwayDays: 30,
          nemcEiaDaysToExpiry: 10,
        },
      });
      const risks = evaluateRisks(state, { kindFilter: ['regulatory'] });
      expect(risks.length).toBe(1);
      expect(risks[0]?.kind).toBe('regulatory');
    });

    it('respects minSeverity floor', async () => {
      const state = await buildScannerState('t-floor', {
        db: null,
        stateOverride: {
          fuelDaysRemaining: 5, // high
          csrGrievances60d: 4, // medium
        },
      });
      const highOrAbove = evaluateRisks(state, { minSeverity: 'high' });
      for (const r of highOrAbove) {
        expect(SEVERITY_WEIGHT[r.severity]).toBeGreaterThanOrEqual(
          SEVERITY_WEIGHT.high,
        );
      }
    });

    it('caps at limit', async () => {
      const state = await buildScannerState('t-limit', {
        db: null,
        stateOverride: {
          cashRunwayDays: 30,
          nemcEiaDaysToExpiry: 10,
          fuelDaysRemaining: 5,
          operatorsWithExpiredIcaActive: 1,
          csrGrievances60d: 5,
          cdaMilestonesOverdue: 2,
        },
      });
      const risks = evaluateRisks(state, { limit: 3 });
      expect(risks.length).toBe(3);
    });

    it('produces bilingual headlines and narratives', async () => {
      const state = await buildScannerState('t-locale', {
        db: null,
        stateOverride: { nemcEiaDaysToExpiry: 20 },
      });
      const risks = evaluateRisks(state);
      const r = risks[0]!;
      expect(r.headline.en).toBeTruthy();
      expect(r.headline.sw).toBeTruthy();
      expect(r.narrative.en).toBeTruthy();
      expect(r.narrative.sw).toBeTruthy();
      // Header should not contain em-dashes per coding rule.
      expect(r.headline.en).not.toContain('—');
      expect(r.narrative.en).not.toContain('—');
    });

    it('every emitted risk carries at least one citation and mitigation', async () => {
      const state = await buildScannerState('t-citations', {
        db: null,
        stateOverride: {
          cashRunwayDays: 45,
          nemcEiaDaysToExpiry: 20,
          operatorsWithExpiredIcaActive: 2,
        },
      });
      const risks = evaluateRisks(state, { limit: 10 });
      expect(risks.length).toBeGreaterThan(0);
      for (const r of risks) {
        expect(r.citations.length).toBeGreaterThanOrEqual(1);
        expect(r.mitigationActions.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('dedup by ruleId is stable', async () => {
      const state = await buildScannerState('t-dedup', {
        db: null,
        stateOverride: { nemcEiaDaysToExpiry: 20 },
      });
      const risks = evaluateRisks(state);
      const ids = new Set(risks.map((r) => r.ruleId));
      expect(ids.size).toBe(risks.length);
    });

    it('symmetry: critical hr risk outranks high-regulatory risk when both fire', async () => {
      // Mirrors the "tie-breaker: prefer risk over opportunity" rule —
      // here the same logic is verified within the risk catalog: a
      // critical / ttd=1 risk wins over a high / ttd=23 one.
      const state = await buildScannerState('t-symmetry', {
        db: null,
        stateOverride: {
          operatorsWithExpiredIcaActive: 3, // critical, ttd=1
          nemcEiaDaysToExpiry: 23, // high, ttd=23
        },
      });
      const risks = evaluateRisks(state);
      expect(risks[0]?.severity).toBe('critical');
      expect(risks[0]?.kind).toBe('hr');
    });
  });

  describe('scanRisks integration with null db', () => {
    it('returns [] when db is null and no overrides', async () => {
      const risks = await scanRisks('tenant-a', { db: null });
      expect(risks.length).toBe(0);
    });

    it('honours stateOverride end-to-end', async () => {
      const risks = await scanRisks(
        'tenant-a',
        {
          db: null,
          stateOverride: {
            fuelDaysRemaining: 2,
          },
        },
        { limit: 1 },
      );
      expect(risks.length).toBe(1);
      expect(risks[0]?.kind).toBe('operational');
      expect(risks[0]?.severity).toBe('critical');
    });
  });

  describe('countRulesByKind', () => {
    it('every kind has at least one rule', () => {
      const counts = countRulesByKind();
      expect(counts.cash_flow).toBeGreaterThanOrEqual(1);
      expect(counts.regulatory).toBeGreaterThanOrEqual(1);
      expect(counts.operational).toBeGreaterThanOrEqual(1);
      expect(counts.hr).toBeGreaterThanOrEqual(1);
      expect(counts.compliance).toBeGreaterThanOrEqual(1);
      expect(counts.counterparty).toBeGreaterThanOrEqual(1);
      expect(counts.market).toBeGreaterThanOrEqual(1);
      expect(counts.estate).toBeGreaterThanOrEqual(1);
      expect(counts.security).toBeGreaterThanOrEqual(1);
      expect(counts.reputational).toBeGreaterThanOrEqual(1);
      expect(counts.tax).toBeGreaterThanOrEqual(1);
      expect(counts.legal).toBeGreaterThanOrEqual(1);
    });
  });
});
