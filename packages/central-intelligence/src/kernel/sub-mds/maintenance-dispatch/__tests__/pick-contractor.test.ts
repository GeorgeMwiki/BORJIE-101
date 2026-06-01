import { describe, expect, it } from 'vitest';
import { pickContractor, type ContractorRecord } from '../tools/pick-contractor.js';

const CONTRACTORS: ReadonlyArray<ContractorRecord> = [
  {
    id: 'v1',
    name: 'PumpPro Services',
    capabilityTags: ['pump-tech', 'emergency-dewatering'],
    serviceAreas: ['Geita', 'Kahama'],
    historicalQuality: 0.92,
    slaCompliance: 0.95,
    costBand: 3,
    emergencyAvailable: true,
  },
  {
    id: 'v2',
    name: 'CheapFix Ltd',
    capabilityTags: ['pump-tech'],
    serviceAreas: ['Geita'],
    historicalQuality: 0.55,
    slaCompliance: 0.6,
    costBand: 1,
  },
  {
    id: 'v3',
    name: 'Old Contractor',
    capabilityTags: ['pump-tech'],
    serviceAreas: ['Geita'],
    historicalQuality: 0.7,
    slaCompliance: 0.7,
    costBand: 2,
    offboarded: true,
  },
  {
    id: 'v4',
    name: 'ElectroMax',
    capabilityTags: ['electrician'],
    serviceAreas: ['Geita'],
    historicalQuality: 0.85,
    slaCompliance: 0.9,
    costBand: 3,
  },
  {
    id: 'v5',
    name: 'OutOfArea Pumps',
    capabilityTags: ['pump-tech', 'emergency-dewatering'],
    serviceAreas: ['Mwanza'],
    historicalQuality: 0.98,
    slaCompliance: 0.98,
    costBand: 4,
    emergencyAvailable: true,
  },
];

describe('pickContractor', () => {
  it('returns top contractor by quality+SLA when category matches', () => {
    const r = pickContractor({
      contractors: CONTRACTORS,
      requiredSkills: ['pump-tech'],
      siteLocation: 'Geita',
      urgency: 'medium',
      category: 'pumping',
    });
    expect(r.top[0]?.contractorId).toBe('v1');
    expect(r.top.length).toBeLessThanOrEqual(3);
  });

  it('filters offboarded contractors', () => {
    const r = pickContractor({
      contractors: CONTRACTORS,
      requiredSkills: ['pump-tech'],
      siteLocation: 'Geita',
      urgency: 'medium',
      category: 'pumping',
    });
    expect(r.filteredOut.find(f => f.contractorId === 'v3')?.reason).toBe('offboarded');
    expect(r.top.find(t => t.contractorId === 'v3')).toBeUndefined();
  });

  it('filters out-of-service-area contractors', () => {
    const r = pickContractor({
      contractors: CONTRACTORS,
      requiredSkills: ['pump-tech'],
      siteLocation: 'Geita',
      urgency: 'medium',
      category: 'pumping',
    });
    expect(r.filteredOut.find(f => f.contractorId === 'v5')?.reason).toContain('out-of-service-area');
  });

  it('filters out non-emergency contractors when urgency=emergency', () => {
    const r = pickContractor({
      contractors: CONTRACTORS,
      requiredSkills: ['pump-tech', 'emergency-dewatering'],
      siteLocation: 'Geita',
      urgency: 'emergency',
      category: 'pumping',
    });
    expect(r.top.find(t => t.contractorId === 'v2')).toBeUndefined();
    expect(r.top[0]?.contractorId).toBe('v1');
  });

  it('returns empty top when no contractor matches required skill', () => {
    const r = pickContractor({
      contractors: CONTRACTORS,
      requiredSkills: ['rigger'],
      siteLocation: 'Geita',
      urgency: 'medium',
      category: 'structural',
    });
    expect(r.top.length).toBe(0);
  });

  it('respects custom weights', () => {
    // Heavily weight cost — cheap contractor should rise
    const r = pickContractor({
      contractors: CONTRACTORS,
      requiredSkills: ['pump-tech'],
      siteLocation: 'Geita',
      urgency: 'medium',
      category: 'pumping',
      weights: { history: 0.0, sla: 0.0, cost: 1.0 },
    });
    expect(r.top[0]?.contractorId).toBe('v2');
  });
});
