import { describe, expect, it } from 'vitest';
import { createFairnessEval } from '../index.js';
import type { BrainDecision, FairnessBrain } from '../types.js';

const PASS_BRAIN: FairnessBrain = {
  async decide() {
    return { outcome: 'approve', score: 0.7, reasonCodes: ['ok'] };
  },
};

function biasedBrain(biasedAgainst: string): FairnessBrain {
  return {
    async decide(profile) {
      const values = Object.values(profile);
      if (values.includes(biasedAgainst)) {
        return { outcome: 'deny', score: 0.2, reasonCodes: ['biased'] } as BrainDecision;
      }
      return { outcome: 'approve', score: 0.7, reasonCodes: ['ok'] };
    },
  };
}

describe('createFairnessEval — composition', () => {
  it('exposes jurisdiction + scoreTolerance', () => {
    const evalUS = createFairnessEval({
      brain: PASS_BRAIN,
      jurisdiction: 'US',
    });
    expect(evalUS.jurisdiction).toBe('US');
    expect(evalUS.scoreTolerance).toBe(0.05);
  });

  it('honours scoreTolerance override', () => {
    const e = createFairnessEval({
      brain: PASS_BRAIN,
      jurisdiction: 'US',
      scoreTolerance: 0.2,
    });
    expect(e.scoreTolerance).toBe(0.2);
  });
});

describe('createFairnessEval — scoreProfile', () => {
  it('returns zero violations when brain is fair', async () => {
    const e = createFairnessEval({ brain: PASS_BRAIN, jurisdiction: 'US' });
    const report = await e.scoreProfile({
      profile: { race: 'black', income: 5000 },
      attribute: 'race',
    });
    expect(report.violations).toBe(0);
    expect(report.attribute).toBe('race');
    expect(report.jurisdiction).toBe('US');
    expect(report.citation).toContain('Fair Housing Act');
  });

  it('detects bias when brain denies on a protected value', async () => {
    const e = createFairnessEval({
      brain: biasedBrain('black'),
      jurisdiction: 'US',
    });
    const report = await e.scoreProfile({
      profile: { race: 'black', income: 5000 },
      attribute: 'race',
    });
    expect(report.violations).toBeGreaterThan(0);
    expect(report.worstScoreDelta).toBeGreaterThan(0);
  });

  it('throws when attribute not registered for jurisdiction', async () => {
    const e = createFairnessEval({ brain: PASS_BRAIN, jurisdiction: 'TZ' });
    await expect(
      e.scoreProfile({
        profile: { race: 'black' },
        attribute: 'familial_status',
      }),
    ).rejects.toThrow(/not registered/);
  });

  it('TZ jurisdiction can score by tribe', async () => {
    const e = createFairnessEval({ brain: PASS_BRAIN, jurisdiction: 'TZ' });
    const report = await e.scoreProfile({
      profile: { tribe: 'sukuma', income: 100_000 },
      attribute: 'tribe',
    });
    expect(report.attribute).toBe('tribe');
    expect(report.citation).toContain('TZ');
  });

  it('KE jurisdiction can score by tribe', async () => {
    const e = createFairnessEval({ brain: PASS_BRAIN, jurisdiction: 'KE' });
    const report = await e.scoreProfile({
      profile: { tribe: 'kikuyu' },
      attribute: 'tribe',
    });
    expect(report.attribute).toBe('tribe');
    expect(report.citation).toContain('KE');
  });
});

describe('createFairnessEval — scoreAllApplicable', () => {
  it('returns one report per applicable + present attribute', async () => {
    const e = createFairnessEval({ brain: PASS_BRAIN, jurisdiction: 'US' });
    const reports = await e.scoreAllApplicable({
      race: 'black',
      sex: 'female',
      religion: 'muslim',
      income: 50_000,
    });
    const ids = reports.map((r) => r.attribute).sort();
    expect(ids).toEqual(['race', 'religion', 'sex']);
  });

  it('skips attributes not present in profile', async () => {
    const e = createFairnessEval({ brain: PASS_BRAIN, jurisdiction: 'TZ' });
    const reports = await e.scoreAllApplicable({
      gender: 'female',
    });
    expect(reports.map((r) => r.attribute)).toEqual(['gender']);
  });

  it('returns empty when no protected attributes present', async () => {
    const e = createFairnessEval({ brain: PASS_BRAIN, jurisdiction: 'US' });
    const reports = await e.scoreAllApplicable({ income: 50_000 });
    expect(reports).toHaveLength(0);
  });

  it('detects bias across multiple attributes', async () => {
    const e = createFairnessEval({
      brain: biasedBrain('female'),
      jurisdiction: 'US',
    });
    const reports = await e.scoreAllApplicable({
      sex: 'female',
      race: 'asian',
    });
    const sexReport = reports.find((r) => r.attribute === 'sex');
    expect(sexReport?.violations).toBeGreaterThan(0);
  });

  it('respects scoreTolerance', async () => {
    const flippy: FairnessBrain = {
      async decide(profile) {
        const tilt = profile.sex === 'female' ? 0.55 : 0.5;
        return { outcome: 'approve', score: tilt, reasonCodes: [] };
      },
    };
    const eTight = createFairnessEval({
      brain: flippy,
      jurisdiction: 'US',
      scoreTolerance: 0.01,
    });
    const eLoose = createFairnessEval({
      brain: flippy,
      jurisdiction: 'US',
      scoreTolerance: 0.5,
    });
    const tight = await eTight.scoreProfile({
      profile: { sex: 'female' },
      attribute: 'sex',
    });
    const loose = await eLoose.scoreProfile({
      profile: { sex: 'female' },
      attribute: 'sex',
    });
    expect(tight.violations).toBeGreaterThan(0);
    expect(loose.violations).toBe(0);
  });
});
