import { describe, expect, it } from 'vitest';
import { pickVendor, type VendorRecord } from '../tools/pick-vendor.js';

const VENDORS: ReadonlyArray<VendorRecord> = [
  {
    id: 'v1',
    name: 'Aqua Plumb',
    capabilityTags: ['plumber', 'emergency-water'],
    serviceAreas: ['Dar-Kinondoni', 'Dar-Ilala'],
    historicalQuality: 0.92,
    slaCompliance: 0.95,
    costBand: 3,
    emergencyAvailable: true,
  },
  {
    id: 'v2',
    name: 'CheapFix Ltd',
    capabilityTags: ['plumber'],
    serviceAreas: ['Dar-Kinondoni'],
    historicalQuality: 0.55,
    slaCompliance: 0.6,
    costBand: 1,
  },
  {
    id: 'v3',
    name: 'Old Vendor',
    capabilityTags: ['plumber'],
    serviceAreas: ['Dar-Kinondoni'],
    historicalQuality: 0.7,
    slaCompliance: 0.7,
    costBand: 2,
    offboarded: true,
  },
  {
    id: 'v4',
    name: 'ElectroMax',
    capabilityTags: ['electrician'],
    serviceAreas: ['Dar-Kinondoni'],
    historicalQuality: 0.85,
    slaCompliance: 0.9,
    costBand: 3,
  },
  {
    id: 'v5',
    name: 'OutOfArea Plumb',
    capabilityTags: ['plumber', 'emergency-water'],
    serviceAreas: ['Arusha'],
    historicalQuality: 0.98,
    slaCompliance: 0.98,
    costBand: 4,
    emergencyAvailable: true,
  },
];

describe('pickVendor', () => {
  it('returns top vendor by quality+SLA when category matches', () => {
    const r = pickVendor({
      vendors: VENDORS,
      requiredSkills: ['plumber'],
      propertyLocation: 'Dar-Kinondoni',
      urgency: 'medium',
      category: 'plumbing',
    });
    expect(r.top[0]?.vendorId).toBe('v1');
    expect(r.top.length).toBeLessThanOrEqual(3);
  });

  it('filters offboarded vendors', () => {
    const r = pickVendor({
      vendors: VENDORS,
      requiredSkills: ['plumber'],
      propertyLocation: 'Dar-Kinondoni',
      urgency: 'medium',
      category: 'plumbing',
    });
    expect(r.filteredOut.find(f => f.vendorId === 'v3')?.reason).toBe('offboarded');
    expect(r.top.find(t => t.vendorId === 'v3')).toBeUndefined();
  });

  it('filters out-of-service-area vendors', () => {
    const r = pickVendor({
      vendors: VENDORS,
      requiredSkills: ['plumber'],
      propertyLocation: 'Dar-Kinondoni',
      urgency: 'medium',
      category: 'plumbing',
    });
    expect(r.filteredOut.find(f => f.vendorId === 'v5')?.reason).toContain('out-of-service-area');
  });

  it('filters out non-emergency vendors when urgency=emergency', () => {
    const r = pickVendor({
      vendors: VENDORS,
      requiredSkills: ['plumber', 'emergency-water'],
      propertyLocation: 'Dar-Kinondoni',
      urgency: 'emergency',
      category: 'plumbing',
    });
    expect(r.top.find(t => t.vendorId === 'v2')).toBeUndefined();
    expect(r.top[0]?.vendorId).toBe('v1');
  });

  it('returns empty top when no vendor matches required skill', () => {
    const r = pickVendor({
      vendors: VENDORS,
      requiredSkills: ['mason'],
      propertyLocation: 'Dar-Kinondoni',
      urgency: 'medium',
      category: 'structural',
    });
    expect(r.top.length).toBe(0);
  });

  it('respects custom weights', () => {
    // Heavily weight cost — cheap vendor should rise
    const r = pickVendor({
      vendors: VENDORS,
      requiredSkills: ['plumber'],
      propertyLocation: 'Dar-Kinondoni',
      urgency: 'medium',
      category: 'plumbing',
      weights: { history: 0.0, sla: 0.0, cost: 1.0 },
    });
    expect(r.top[0]?.vendorId).toBe('v2');
  });
});
