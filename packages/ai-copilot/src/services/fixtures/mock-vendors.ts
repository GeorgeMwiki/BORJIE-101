/**
 * Mock vendor fixtures — SCAFFOLDED 9
 *
 * Extracted from `vendor-matcher.ts` per the task spec ("relocate
 * `getMockVendors` to fixtures — don't delete"). Used in dev, tests, and
 * whenever a real repository isn't wired up yet.
 */

import type { VendorProfile, VendorSpecialty } from '../vendor-matcher.js';

export function getMockVendors(): VendorProfile[] {
  return [
    {
      id: 'vendor-001',
      name: 'Premium Property Services',
      specialties: ['PLUMBING', 'ELECTRICAL', 'HVAC', 'GENERAL_MAINTENANCE'] as VendorSpecialty[],
      serviceArea: ['Nairobi', 'Kiambu'],
      ratings: { overall: 4.8, quality: 4.9, reliability: 4.7, communication: 4.8, value: 4.5 },
      metrics: { completedJobs: 250, averageResponseTime: 2, onTimeCompletion: 95, repeatCallRate: 5 },
      availability: {
        nextAvailable: new Date().toISOString(),
        emergencyAvailable: true,
        weekendAvailable: true,
      },
      pricing: { hourlyRate: 2500, callOutFee: 500, emergencyMultiplier: 1.5 },
    },
    {
      id: 'vendor-002',
      name: 'Quick Fix Maintenance',
      specialties: ['GENERAL_MAINTENANCE', 'CARPENTRY', 'PAINTING'] as VendorSpecialty[],
      serviceArea: ['Nairobi'],
      ratings: { overall: 4.2, quality: 4.0, reliability: 4.3, communication: 4.5, value: 4.8 },
      metrics: { completedJobs: 180, averageResponseTime: 4, onTimeCompletion: 88, repeatCallRate: 12 },
      availability: {
        nextAvailable: new Date().toISOString(),
        emergencyAvailable: false,
        weekendAvailable: true,
      },
      pricing: { hourlyRate: 1500, callOutFee: 300 },
    },
  ];
}
