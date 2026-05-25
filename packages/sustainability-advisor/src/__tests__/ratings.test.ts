/**
 * Green-building rating estimator tests — BREEAM, LEED v5, Green Star,
 * EDGE, EPC.
 *
 * Asserts: band-mapping monotonicity, threshold behaviour, weighted
 * scoring, input validation.
 */

import { describe, it, expect } from 'vitest';
import { estimateBreeam, breeamBand } from '../ratings/breeam-estimator.js';
import { estimateLeedV5, leedBand } from '../ratings/leed-v5-estimator.js';
import { estimateGreenStar, greenStarBand } from '../ratings/green-star-estimator.js';
import { estimateEdge } from '../ratings/edge-estimator.js';
import { estimateEpc, ukEpcScore, ukBandFor, euBandFor } from '../ratings/epc-rating.js';

describe('BREEAM v7', () => {
  it('lands a low-carbon, well-built office at "Outstanding" or "Excellent"', () => {
    const r = estimateBreeam({
      operationalCarbonIntensity: 4,
      embodiedIntensityPerM2: 280,
      wasteDiversionPct: 98,
      waterUseLPerPersonDay: 70,
      publicTransportProximity: true,
      indoorEnvIndex: 0.95,
      ecologyNetGainAchieved: true,
      hasCemp: true,
      responsibleSourcingPct: 90,
      innovationCredits: 8,
    });
    expect(['Outstanding', 'Excellent']).toContain(r.estimatedBand);
    expect(r.percent).toBeGreaterThan(70);
  });

  it('returns "Unclassified" for a worst-case scenario', () => {
    const r = estimateBreeam({
      operationalCarbonIntensity: 200,
      embodiedIntensityPerM2: 2000,
      wasteDiversionPct: 0,
      waterUseLPerPersonDay: 300,
      publicTransportProximity: false,
      indoorEnvIndex: 0.1,
      ecologyNetGainAchieved: false,
      hasCemp: false,
      responsibleSourcingPct: 0,
      innovationCredits: 0,
    });
    expect(['Unclassified', 'Pass']).toContain(r.estimatedBand);
  });

  it('band thresholds are monotonic', () => {
    expect(breeamBand(86)).toBe('Outstanding');
    expect(breeamBand(70)).toBe('Excellent');
    expect(breeamBand(55)).toBe('Very Good');
    expect(breeamBand(45)).toBe('Good');
    expect(breeamBand(30)).toBe('Pass');
    expect(breeamBand(29)).toBe('Unclassified');
  });

  it('rejects out-of-range indoor env index', () => {
    expect(() => estimateBreeam({
      operationalCarbonIntensity: 10, embodiedIntensityPerM2: 500,
      wasteDiversionPct: 80, waterUseLPerPersonDay: 100,
      publicTransportProximity: true, indoorEnvIndex: 2,
      ecologyNetGainAchieved: true, hasCemp: true,
      responsibleSourcingPct: 50, innovationCredits: 0,
    })).toThrow(/indoorEnvIndex/);
  });

  it('surfaces next-best inputs when sub-optimal', () => {
    const r = estimateBreeam({
      operationalCarbonIntensity: 50,
      embodiedIntensityPerM2: 800,
      wasteDiversionPct: 70,
      waterUseLPerPersonDay: 110,
      publicTransportProximity: false,
      indoorEnvIndex: 0.6,
      ecologyNetGainAchieved: false,
      hasCemp: false,
      responsibleSourcingPct: 50,
      innovationCredits: 1,
    });
    expect(r.nextBestInputs.length).toBeGreaterThan(0);
  });
});

describe('LEED v5', () => {
  it('Platinum for an aggressively efficient, low-embodied asset', () => {
    const r = estimateLeedV5({
      operationalCarbonIntensity: 3,
      energyReductionPct: 60,
      embodiedIntensityPerM2: 250,
      lowGwpRefrigerants: true,
      iaqMonitoring: true,
      daylightView: 0.95,
      waterReductionPct: 50,
      siteRestorationRatio: 0.5,
      integrativeProcessRun: true,
      innovationCredits: 5,
      regionalPriorityCredits: 4,
    });
    expect(['Platinum', 'Gold']).toContain(r.estimatedBand);
  });

  it('Below Certified for a worst-case', () => {
    const r = estimateLeedV5({
      operationalCarbonIntensity: 200,
      energyReductionPct: 0,
      embodiedIntensityPerM2: 2000,
      lowGwpRefrigerants: false,
      iaqMonitoring: false,
      daylightView: 0,
      waterReductionPct: 0,
      siteRestorationRatio: 0,
      integrativeProcessRun: false,
      innovationCredits: 0,
      regionalPriorityCredits: 0,
    });
    expect(r.estimatedBand).toBe('Below Certified');
  });

  it('leedBand thresholds match published USGBC cutoffs', () => {
    expect(leedBand(80)).toBe('Platinum');
    expect(leedBand(60)).toBe('Gold');
    expect(leedBand(50)).toBe('Silver');
    expect(leedBand(40)).toBe('Certified');
    expect(leedBand(39)).toBe('Below Certified');
  });

  it('rejects out-of-range daylightView', () => {
    expect(() => estimateLeedV5({
      operationalCarbonIntensity: 10, energyReductionPct: 50,
      embodiedIntensityPerM2: 500, lowGwpRefrigerants: true,
      iaqMonitoring: true, daylightView: 1.2,
      waterReductionPct: 20, siteRestorationRatio: 0.2,
      integrativeProcessRun: true, innovationCredits: 0,
      regionalPriorityCredits: 0,
    })).toThrow(/daylightView/);
  });
});

describe('Green Star v1.3', () => {
  it('6 Star (World Leadership) for net-positive carbon site', () => {
    const r = estimateGreenStar({
      operationalCarbonIntensity: -5,
      fossilFuelFree: true,
      netPositiveCarbon: true,
      responsibleProductsPct: 95,
      placeQualityIndex: 0.95,
      peopleEngagementIndex: 0.9,
      natureRestorationRatio: 0.7,
      innovationCredits: 10,
      resilienceClimateAdaptPct: 95,
    });
    expect(['6 Star (World Leadership)', '5 Star (Excellence)']).toContain(r.estimatedBand);
  });

  it('greenStarBand thresholds', () => {
    expect(greenStarBand(75)).toBe('6 Star (World Leadership)');
    expect(greenStarBand(60)).toBe('5 Star (Excellence)');
    expect(greenStarBand(45)).toBe('4 Star (Best Practice)');
    expect(greenStarBand(44)).toBe('Not certified');
  });
});

describe('EDGE v3.1', () => {
  it('returns EDGE Certified for 25/25/25', () => {
    const r = estimateEdge({
      energyReductionPct: 25,
      waterReductionPct: 25,
      materialReductionPct: 25,
      remainingOpCarbonAfterOffsets: 50,
    });
    expect(r.estimatedBand).toBe('EDGE Certified');
  });

  it('lifts to EDGE Advanced when energy ≥40%', () => {
    const r = estimateEdge({
      energyReductionPct: 45,
      waterReductionPct: 25,
      materialReductionPct: 22,
      remainingOpCarbonAfterOffsets: 10,
    });
    expect(r.estimatedBand).toBe('EDGE Advanced');
  });

  it('EDGE Zero Carbon when offsets fully retire', () => {
    const r = estimateEdge({
      energyReductionPct: 45,
      waterReductionPct: 25,
      materialReductionPct: 22,
      remainingOpCarbonAfterOffsets: 0,
    });
    expect(r.estimatedBand).toBe('EDGE Zero Carbon');
  });

  it('Not certified when any dimension is below 20%', () => {
    const r = estimateEdge({
      energyReductionPct: 25,
      waterReductionPct: 15,
      materialReductionPct: 25,
      remainingOpCarbonAfterOffsets: 50,
    });
    expect(r.estimatedBand).toBe('Not certified');
  });
});

describe('EPC banding', () => {
  it('UK EPC A for an ultra-efficient asset', () => {
    const score = ukEpcScore(10, 5);
    expect(ukBandFor(score)).toBe('A');
  });

  it('UK EPC G for a worst-case', () => {
    const score = ukEpcScore(400, 200);
    expect(ukBandFor(score)).toBe('G');
  });

  it('estimateEpc returns expected band ordering', () => {
    const high = estimateEpc({ energyUseKWhPerM2: 30, co2KgPerM2: 5, scheme: 'UK' });
    const mid = estimateEpc({ energyUseKWhPerM2: 200, co2KgPerM2: 40, scheme: 'UK' });
    expect(high.percent).toBeGreaterThan(mid.percent);
  });

  it('EU EPC band drops with rising kWh/m²/yr', () => {
    expect(euBandFor(40)).toBe('A');
    expect(euBandFor(80)).toBe('B');
    expect(euBandFor(140)).toBe('C');
    expect(euBandFor(220)).toBe('D');
    expect(euBandFor(320)).toBe('E');
    expect(euBandFor(440)).toBe('F');
    expect(euBandFor(800)).toBe('G');
  });

  it('rejects negative energy use', () => {
    expect(() => estimateEpc({ energyUseKWhPerM2: -1, co2KgPerM2: 1, scheme: 'UK' }))
      .toThrow(/energyUseKWhPerM2/);
  });
});
