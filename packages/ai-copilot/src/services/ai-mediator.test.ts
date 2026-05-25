import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  draftDamageMediatorTurn,
  draftNegotiationCounter,
  composeSurveyNarrative,
  composeRiskNarrative,
  draftTenantLetter,
} from './ai-mediator';

const originalKey = process.env.ANTHROPIC_API_KEY;

describe('ai-mediator deterministic fallback (no ANTHROPIC_API_KEY)', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it('damage mediator returns midpoint deduction', async () => {
    const r = await draftDamageMediatorTurn({
      claimedDeductionMinor: 100_000,
      tenantCounterMinor: 40_000,
      findings: [{ component: 'wall', severity: 'major' }],
      priorTurns: [],
      floorMinor: 0,
      ceilingMinor: 150_000,
    });
    expect(r.proposedDeductionMinor).toBe(70_000);
    expect(r.escalate).toBe(false);
  });

  it('negotiation counter never goes below lowerBound', async () => {
    const r = await draftNegotiationCounter({
      listPriceMinor: 1_000_000,
      floorPriceMinor: 800_000,
      lowerBoundMinor: 850_000,
      currentOfferMinor: 900_000,
      prospectReply: 'Can we go lower?',
      toneGuide: 'warm',
      roundCount: 2,
    });
    expect(r.offerMinor).toBeGreaterThanOrEqual(850_000);
  });

  it('survey narrative flags critical findings', async () => {
    const r = await composeSurveyNarrative({
      findings: [{ component: 'roof', severity: 'critical' }],
      criticalPresent: true,
    });
    expect(r.recommendedActions[0]!.priority).toBe('critical');
    expect(r.riskFlags.length).toBeGreaterThan(0);
  });

  it('risk narrative maps score bands to tiers', async () => {
    const low = await composeRiskNarrative({ paymentRiskScore: 80, churnScore: 20 });
    const high = await composeRiskNarrative({ paymentRiskScore: 45, churnScore: 75 });
    expect(low.tier).toBe('low');
    expect(high.tier).toBe('high');
  });

  it('letter drafter produces formal structure', async () => {
    const r = await draftTenantLetter({
      letterType: 'residency_proof',
      customer: { name: 'Salome Juma', unit: 'A-12' },
      purpose: 'bank account',
      orgName: 'Demo Estate Corporation',
    });
    expect(r.subject.toLowerCase()).toContain('residency');
    expect(r.body).toContain('Salome Juma');
  });
});
