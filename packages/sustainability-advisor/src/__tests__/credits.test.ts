/**
 * Carbon credit valuator + EU Taxonomy alignment tests.
 */

import { describe, it, expect } from 'vitest';
import {
  valuateCarbonCredits,
  createStubCarbonPriceFeed,
  STUB_SPOT_USD,
} from '../credits/carbon-credit-valuator.js';
import { assessEuTaxonomy } from '../credits/eu-taxonomy-alignment.js';

describe('carbon credit valuator', () => {
  it('returns spot total = price × tonnes via stub feed', async () => {
    const q = await valuateCarbonCredits({
      standard: 'VCS',
      tonnesCO2e: 1000,
      currency: 'USD',
    });
    expect(q.spotPrice).toBe(STUB_SPOT_USD.VCS);
    expect(q.spotTotal).toBeCloseTo(STUB_SPOT_USD.VCS * 1000, 2);
  });

  it('priced in KES applies stub FX', async () => {
    const q = await valuateCarbonCredits({
      standard: 'GoldStandard',
      tonnesCO2e: 10,
      currency: 'KES',
    });
    expect(q.spotPrice).toBeGreaterThan(800); // 9 * 129 = 1161
  });

  it('returns forward curve when tenors requested', async () => {
    const q = await valuateCarbonCredits({
      standard: 'EU_ETS',
      tonnesCO2e: 1,
      currency: 'EUR',
      forwardTenors: ['Dec-26', 'Dec-30'],
    });
    expect(Object.keys(q.forwards).length).toBeGreaterThan(0);
    expect(q.forwards['Dec-30']).toBeGreaterThan(q.forwards['Dec-26']!);
  });

  it('rejects negative tonnes', async () => {
    await expect(valuateCarbonCredits({
      standard: 'VCS',
      tonnesCO2e: -1,
      currency: 'USD',
    })).rejects.toThrow(/tonnesCO2e/);
  });

  it('stub feed throws for unknown FX', async () => {
    const feed = createStubCarbonPriceFeed();
    await expect(feed.spot('VCS', 'ZZZ')).rejects.toThrow(/no FX/);
  });

  it('quality grade is attached for voluntary standards', async () => {
    const q = await valuateCarbonCredits({
      standard: 'Article_6_4',
      tonnesCO2e: 5,
      currency: 'USD',
    });
    expect(q.qualityGrade).toBe('A');
  });

  it('EU_ETS has no quality grade (compliance market)', async () => {
    const q = await valuateCarbonCredits({
      standard: 'EU_ETS',
      tonnesCO2e: 5,
      currency: 'EUR',
    });
    expect(q.qualityGrade).toBeNull();
  });
});

describe('EU Taxonomy alignment', () => {
  it('7.7 acquisition: aligned when EPC A pre-2021', () => {
    const r = assessEuTaxonomy({
      activity: '7.7',
      yearBuilt: 1995,
      epcBand: 'A',
      inTop15PctOfStock: false,
      meetsNzebMinus10: false,
      wasteDiversionPct: 80,
      waterFittingsCompliant: true,
      vocLowEmissions: true,
      biodiversityScreenPasses: true,
      adaptationAssessmentDone: true,
      minimumSafeguards: true,
    });
    expect(r.aligned).toBe(true);
    expect(r.substantialContribution).toBe(true);
  });

  it('7.7 acquisition: not aligned when EPC D pre-2021 and not top 15%', () => {
    const r = assessEuTaxonomy({
      activity: '7.7',
      yearBuilt: 2010,
      epcBand: 'D',
      inTop15PctOfStock: false,
      meetsNzebMinus10: false,
      wasteDiversionPct: 80,
      waterFittingsCompliant: true,
      vocLowEmissions: true,
      biodiversityScreenPasses: true,
      adaptationAssessmentDone: true,
      minimumSafeguards: true,
    });
    expect(r.substantialContribution).toBe(false);
    expect(r.aligned).toBe(false);
  });

  it('7.1 new build: requires NZEB-10%', () => {
    const r = assessEuTaxonomy({
      activity: '7.1',
      yearBuilt: 2025,
      epcBand: 'A',
      inTop15PctOfStock: true,
      meetsNzebMinus10: true,
      wasteDiversionPct: 85,
      waterFittingsCompliant: true,
      vocLowEmissions: true,
      biodiversityScreenPasses: true,
      adaptationAssessmentDone: true,
      minimumSafeguards: true,
    });
    expect(r.aligned).toBe(true);
  });

  it('DNSH failure on water still passes substantial contribution', () => {
    const r = assessEuTaxonomy({
      activity: '7.7',
      yearBuilt: 2010,
      epcBand: 'A',
      inTop15PctOfStock: true,
      meetsNzebMinus10: false,
      wasteDiversionPct: 90,
      waterFittingsCompliant: false,
      vocLowEmissions: true,
      biodiversityScreenPasses: true,
      adaptationAssessmentDone: true,
      minimumSafeguards: true,
    });
    expect(r.substantialContribution).toBe(true);
    expect(r.dnsh.water.passes).toBe(false);
    expect(r.aligned).toBe(false);
  });

  it('Minimum safeguards failure blocks alignment', () => {
    const r = assessEuTaxonomy({
      activity: '7.7',
      yearBuilt: 2010,
      epcBand: 'A',
      inTop15PctOfStock: true,
      meetsNzebMinus10: false,
      wasteDiversionPct: 90,
      waterFittingsCompliant: true,
      vocLowEmissions: true,
      biodiversityScreenPasses: true,
      adaptationAssessmentDone: true,
      minimumSafeguards: false,
    });
    expect(r.minimumSafeguards).toBe(false);
    expect(r.aligned).toBe(false);
  });

  it('7.3 EE installation: substantial contribution intrinsic', () => {
    const r = assessEuTaxonomy({
      activity: '7.3',
      yearBuilt: 2000,
      epcBand: 'G',
      inTop15PctOfStock: false,
      meetsNzebMinus10: false,
      wasteDiversionPct: 70,
      waterFittingsCompliant: true,
      vocLowEmissions: true,
      biodiversityScreenPasses: true,
      adaptationAssessmentDone: true,
      minimumSafeguards: true,
    });
    expect(r.substantialContribution).toBe(true);
    expect(r.aligned).toBe(true);
  });

  it('rationale chronicles every DNSH outcome', () => {
    const r = assessEuTaxonomy({
      activity: '7.7',
      yearBuilt: 1995,
      epcBand: 'A',
      inTop15PctOfStock: true,
      meetsNzebMinus10: false,
      wasteDiversionPct: 50,
      waterFittingsCompliant: true,
      vocLowEmissions: true,
      biodiversityScreenPasses: true,
      adaptationAssessmentDone: true,
      minimumSafeguards: true,
    });
    expect(r.rationale.some((s) => s.includes('circular_economy'))).toBe(true);
    expect(r.rationale.some((s) => s.includes('FAIL'))).toBe(true);
    expect(r.aligned).toBe(false);
  });
});
