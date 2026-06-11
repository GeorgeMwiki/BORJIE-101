import { describe, it, expect } from 'vitest';
import {
  checkLimitState,
  classifyConsequence,
  evaluateSurveillance,
} from '../structural-engine.js';

describe('structural-engine — §6 Eurocode limit-state', () => {
  it('applies EN 1990 partial factors 1.35 Gk + 1.5 Qk', () => {
    const r = checkLimitState('eurocode', {
      permanent_action: 100, // 135
      variable_action: 50, // 75 → design action 210
      design_resistance: 300,
      sls_deflection_mm: 10,
      sls_deflection_limit_mm: 20,
    });
    expect(r.factors).toEqual({ permanent: 1.35, variable: 1.5 });
    expect(r.design_action).toBe(210);
    expect(r.uls_utilisation).toBe(0.7);
    expect(r.sls_utilisation).toBe(0.5);
    expect(r.verdict).toBe('pass');
  });

  it('applies ACI 318 factors 1.2 D + 1.6 L', () => {
    const r = checkLimitState('aci318', {
      permanent_action: 100, // 120
      variable_action: 50, // 80 → 200
      design_resistance: 300,
      sls_deflection_mm: 5,
      sls_deflection_limit_mm: 20,
    });
    expect(r.factors).toEqual({ permanent: 1.2, variable: 1.6 });
    expect(r.design_action).toBe(200);
  });

  it('fails when ULS utilisation exceeds 1', () => {
    const r = checkLimitState('eurocode', {
      permanent_action: 200,
      variable_action: 100,
      design_resistance: 300, // demand 420 > 300
      sls_deflection_mm: 1,
      sls_deflection_limit_mm: 20,
    });
    expect(r.uls_pass).toBe(false);
    expect(r.verdict).toBe('fail');
  });

  it('flags marginal when utilisation sits in the EoR-review band', () => {
    const r = checkLimitState('eurocode', {
      permanent_action: 100,
      variable_action: 50, // demand 210
      design_resistance: 215, // util 0.977 → marginal
      sls_deflection_mm: 1,
      sls_deflection_limit_mm: 20,
    });
    expect(r.uls_pass).toBe(true);
    expect(r.verdict).toBe('marginal');
  });

  it('rejects non-positive resistance', () => {
    expect(() =>
      checkLimitState('eurocode', {
        permanent_action: 1,
        variable_action: 1,
        design_resistance: 0,
        sls_deflection_mm: 1,
        sls_deflection_limit_mm: 1,
      }),
    ).toThrow(/design_resistance/);
  });
});

describe('structural-engine — §7.1 GISTM consequence classification', () => {
  it('classifies Extreme on >=100 potential loss of life and requires ITRB', () => {
    const c = classifyConsequence({
      potential_loss_of_life: 270,
      damage_band: 'catastrophic',
      construction_method: 'upstream',
    });
    expect(c.consequence_class).toBe('extreme');
    expect(c.itrb_required).toBe(true);
    expect(c.required_roles).toContain('Independent Tailings Review Board (ITRB)');
    expect(c.upstream_method_flag).toBe(true);
    expect(c.public_disclosure_required).toBe(true);
  });

  it('takes the worse of life-ladder and damage-band', () => {
    const c = classifyConsequence({
      potential_loss_of_life: 0, // low by life
      damage_band: 'severe', // very_high by damage
      construction_method: 'downstream',
    });
    expect(c.consequence_class).toBe('very_high');
    expect(c.itrb_required).toBe(true);
  });

  it('low-consequence facility does not require ITRB', () => {
    const c = classifyConsequence({
      potential_loss_of_life: 0,
      damage_band: 'minor',
      construction_method: 'centreline',
    });
    expect(c.consequence_class).toBe('low');
    expect(c.itrb_required).toBe(false);
    expect(c.required_roles).not.toContain('Independent Tailings Review Board (ITRB)');
  });
});

describe('structural-engine — §7.2 observational-method surveillance', () => {
  it('bands green when all readings are below trigger', () => {
    const s = evaluateSurveillance([
      { instrument: 'piezometer', id: 'PZ1', value: 5, trigger_level: 10, action_level: 15 },
    ]);
    expect(s.band).toBe('green');
    expect(s.action_required).toBe(false);
  });

  it('bands red and requires action on an action-level exceedance', () => {
    const s = evaluateSurveillance([
      { instrument: 'piezometer', id: 'PZ1', value: 8, trigger_level: 10, action_level: 15 },
      { instrument: 'inclinometer', id: 'IN1', value: 20, trigger_level: 10, action_level: 15 },
    ]);
    expect(s.band).toBe('red');
    expect(s.action_required).toBe(true);
    expect(s.exceedances).toContainEqual({ id: 'IN1', band: 'red' });
  });

  it('throws on empty readings', () => {
    expect(() => evaluateSurveillance([])).toThrow(/at least one reading/);
  });
});
