import { describe, it, expect } from 'vitest';
import {
  StrategicAdvisor,
  CANONICAL_QUESTION_KEYS,
} from '../../autonomy/index.js';

describe('StrategicAdvisor', () => {
  const advisor = new StrategicAdvisor();

  it('matches the refurbish-or-sell canonical question', async () => {
    const report = await advisor.advise(
      'tenant_x',
      'Should we refurbish or sell Block X?',
    );
    expect(report.canonicalKey).toBe('refurbish_or_sell_block');
    expect(report.options.length).toBeGreaterThanOrEqual(3);
    expect(report.skillsInvoked).toContain('dcf_valuation');
  });

  it('matches raise-rents canonical question and uses context in rationale', async () => {
    const report = await advisor.advise(
      'tenant_x',
      'Should we raise rents 5% or 10% across the portfolio?',
      { occupancyPct: 91, arrearsRatioPct: 9 },
    );
    expect(report.canonicalKey).toBe('raise_rents_portfolio');
    expect(report.rationale).toContain('91');
    expect(report.rationale).toContain('9');
  });

  it('matches hire-or-automate canonical question', async () => {
    const report = await advisor.advise(
      'tenant_x',
      'Should we hire more station masters or invest in more automation?',
    );
    expect(report.canonicalKey).toBe('hire_or_automate');
    expect(report.options.length).toBeGreaterThanOrEqual(3);
  });

  it('matches consolidate-small-properties canonical question', async () => {
    const report = await advisor.advise(
      'tenant_x',
      'Should we consolidate our 3 smallest properties?',
    );
    expect(report.canonicalKey).toBe('consolidate_small_properties');
    expect(report.skillsInvoked).toContain('dcf_valuation');
  });

  it('matches renegotiate-top-tenants canonical question', async () => {
    const report = await advisor.advise(
      'tenant_x',
      'Should we renegotiate with our top 5 tenants for longer leases at a discount?',
    );
    expect(report.canonicalKey).toBe('renegotiate_top_tenants');
    expect(report.nextSteps.length).toBeGreaterThan(0);
  });

  it('returns a generic report for unknown questions', async () => {
    const report = await advisor.advise('tenant_x', 'What time is it?');
    expect(report.canonicalKey).toBeNull();
    expect(report.options.length).toBeGreaterThanOrEqual(3);
    expect(report.recommendation).toContain('Pilot');
  });

  it('exports five canonical question keys', () => {
    expect(CANONICAL_QUESTION_KEYS).toHaveLength(5);
  });

  it('every canonical report carries rationale + risks + nextSteps', async () => {
    const questions: Record<string, string> = {
      refurbish_or_sell_block: 'Should we refurbish or sell Block X?',
      raise_rents_portfolio: 'Should we raise rents 5% or 10% across the portfolio?',
      hire_or_automate:
        'Should we hire more station masters or invest in more automation?',
      consolidate_small_properties: 'Should we consolidate our 3 smallest properties?',
      renegotiate_top_tenants:
        'Should we renegotiate with our top 5 tenants for longer leases at a discount?',
    };
    for (const q of Object.values(questions)) {
      const r = await advisor.advise('t', q);
      expect(r.rationale.length).toBeGreaterThan(20);
      expect(r.risks.length).toBeGreaterThan(0);
      expect(r.nextSteps.length).toBeGreaterThan(0);
    }
  });
});
