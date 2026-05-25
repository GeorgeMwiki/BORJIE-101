/**
 * Tests for learning-loop/policy-proposer.
 *
 * Coverage: significant-only filtering, lift/drop direction selection,
 * finance + maintenance patches, no-op when nudge produces same value,
 * proposal status starts as draft, confidence is bounded, custom
 * idGenerator + clock injection, unsupported domain returns nothing.
 */

import { describe, it, expect } from 'vitest';
import { proposeAdjustments } from '../policy-proposer.js';
import type { PatternEvidence } from '../types.js';
import type { AutonomyPolicy } from '../../autonomy/types.js';
import { buildDefaultPolicy } from '../../autonomy/defaults.js';

function evidence(
  partial: Partial<PatternEvidence> & {
    domain: PatternEvidence['domain'];
    actionType: string;
  },
): PatternEvidence {
  return {
    id: partial.id ?? 'pat_x',
    domain: partial.domain,
    actionType: partial.actionType,
    contextFeature: partial.contextFeature ?? 'vendorIsTrusted',
    contextValue: partial.contextValue ?? 'true',
    sampleSize: partial.sampleSize ?? 50,
    successRate: partial.successRate ?? 0.95,
    baselineSuccessRate: partial.baselineSuccessRate ?? 0.7,
    chiSquared: partial.chiSquared ?? 5,
    significant: partial.significant ?? true,
    discoveredAt: partial.discoveredAt ?? '2026-04-01T00:00:00.000Z',
  };
}

function policy(): AutonomyPolicy {
  return buildDefaultPolicy('tenant-1');
}

describe('proposeAdjustments', () => {
  it('returns nothing when given an empty pattern list', () => {
    expect(proposeAdjustments([], policy())).toEqual([]);
  });

  it('skips non-significant evidence', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      significant: false,
    });
    expect(proposeAdjustments([e], policy())).toEqual([]);
  });

  it('skips evidence with insufficient lift / drop', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      successRate: 0.72,
      baselineSuccessRate: 0.7,
    });
    expect(proposeAdjustments([e], policy())).toEqual([]);
  });

  it('proposes a finance "loosen" patch when lift >= 10pp', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      successRate: 0.92,
      baselineSuccessRate: 0.7,
    });
    const proposals = proposeAdjustments([e], policy());
    expect(proposals).toHaveLength(1);
    const refundPatch = proposals[0].proposedPatch.finance?.autoApproveRefundsMinorUnits;
    expect(refundPatch).toBeDefined();
    expect(refundPatch).toBeGreaterThan(
      policy().finance.autoApproveRefundsMinorUnits,
    );
    expect(proposals[0].status).toBe('draft');
    expect(proposals[0].reasoning).toMatch(/loosening/i);
  });

  it('proposes a finance "tighten" patch when drop >= 10pp', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_waiver',
      successRate: 0.4,
      baselineSuccessRate: 0.7,
    });
    const proposals = proposeAdjustments([e], policy());
    expect(proposals).toHaveLength(1);
    const waiverPatch = proposals[0].proposedPatch.finance?.autoApproveWaiversMinorUnits;
    expect(waiverPatch).toBeDefined();
    expect(waiverPatch).toBeLessThan(
      policy().finance.autoApproveWaiversMinorUnits,
    );
    expect(proposals[0].reasoning).toMatch(/tightening/i);
  });

  it('proposes a maintenance "loosen" patch for auto_approve_workorder', () => {
    const e = evidence({
      domain: 'maintenance',
      actionType: 'auto_approve_workorder',
      successRate: 0.95,
      baselineSuccessRate: 0.7,
    });
    const proposals = proposeAdjustments([e], policy());
    expect(proposals).toHaveLength(1);
    expect(
      proposals[0].proposedPatch.maintenance?.autoApproveBelowMinorUnits,
    ).toBeGreaterThan(policy().maintenance.autoApproveBelowMinorUnits);
  });

  it('returns no proposal for unsupported domains', () => {
    const e = evidence({
      domain: 'communications',
      actionType: 'something',
      successRate: 0.95,
      baselineSuccessRate: 0.5,
    });
    expect(proposeAdjustments([e], policy())).toEqual([]);
  });

  it('returns no proposal when current threshold is 0 and tighten direction would not change it', () => {
    const baseline = policy();
    const stripped: AutonomyPolicy = {
      ...baseline,
      finance: { ...baseline.finance, autoApproveWaiversMinorUnits: 0 },
    };
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_waiver',
      successRate: 0.4,
      baselineSuccessRate: 0.7,
    });
    expect(proposeAdjustments([e], stripped)).toEqual([]);
  });

  it('uses an injected idGenerator', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      successRate: 0.95,
      baselineSuccessRate: 0.7,
    });
    let i = 0;
    const proposals = proposeAdjustments([e], policy(), {
      idGenerator: () => `prop-${++i}`,
    });
    expect(proposals[0].id).toBe('prop-1');
  });

  it('uses an injected clock for createdAt', () => {
    const fixed = new Date('2026-05-01T12:00:00.000Z');
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      successRate: 0.95,
      baselineSuccessRate: 0.7,
    });
    const proposals = proposeAdjustments([e], policy(), { now: () => fixed });
    expect(proposals[0].createdAt).toBe(fixed.toISOString());
  });

  it('respects custom thresholds for loosenSuccessLiftPct', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      successRate: 0.75,
      baselineSuccessRate: 0.7,
    });
    const looseProposals = proposeAdjustments([e], policy(), {
      loosenSuccessLiftPct: 0.04, // 4pp lift triggers
    });
    expect(looseProposals.length).toBe(1);
    const strictProposals = proposeAdjustments([e], policy(), {
      loosenSuccessLiftPct: 0.5, // requires 50pp lift
    });
    expect(strictProposals).toEqual([]);
  });

  it('clamps confidence to [0,1] and never exceeds 0.95 cap', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      successRate: 1,
      baselineSuccessRate: 0,
    });
    const [proposal] = proposeAdjustments([e], policy());
    expect(proposal.confidence).toBeLessThanOrEqual(0.95);
    expect(proposal.confidence).toBeGreaterThanOrEqual(0);
  });

  it('attaches the source evidence onto the proposal', () => {
    const e = evidence({
      domain: 'finance',
      actionType: 'auto_approve_refund',
      successRate: 0.95,
      baselineSuccessRate: 0.7,
      id: 'pat_xyz',
    });
    const [proposal] = proposeAdjustments([e], policy());
    expect(proposal.evidence).toHaveLength(1);
    expect(proposal.evidence[0].id).toBe('pat_xyz');
  });
});
