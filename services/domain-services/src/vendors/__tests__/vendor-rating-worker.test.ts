/**
 * vendor-rating-worker — aggregation + recompute loop (SCAFFOLDED 9)
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateVendorOutcomes,
  runVendorRatingRecompute,
} from '../vendor-rating-worker.js';
import type {
  VendorProfileDto,
  VendorRatingUpdate,
  VendorRepositoryPort,
  VendorWorkOrderOutcomeDto,
} from '../vendor-repository.interface.js';

function makeOutcome(overrides: Partial<VendorWorkOrderOutcomeDto>): VendorWorkOrderOutcomeDto {
  return {
    workOrderId: 'wo1',
    vendorId: 'v1',
    tenantId: 't1',
    completedAt: new Date('2026-03-01'),
    ratingOverall: 4,
    ratingQuality: 4,
    ratingCommunication: 4,
    firstResponseMinutes: 120,
    scheduledAt: new Date('2026-02-28T10:00:00Z'),
    actualStartAt: new Date('2026-02-28T10:00:00Z'),
    actualCompletionAt: new Date('2026-02-28T12:00:00Z'),
    costActual: 1000,
    costEstimated: 1000,
    wasReopened: false,
    ...overrides,
  };
}

describe('aggregateVendorOutcomes', () => {
  it('returns zeros for empty sample', () => {
    const agg = aggregateVendorOutcomes([]);
    expect(agg.sampleSize).toBe(0);
    expect(agg.ratings.quality).toBe(0);
  });

  it('averages quality across sample', () => {
    const agg = aggregateVendorOutcomes([
      makeOutcome({ ratingQuality: 3 }),
      makeOutcome({ ratingQuality: 5 }),
    ]);
    expect(agg.ratings.quality).toBe(4);
  });

  it('computes on-time percentage', () => {
    const agg = aggregateVendorOutcomes([
      // Completed exactly at scheduled time — counts as on-time (<=).
      makeOutcome({
        scheduledAt: new Date('2026-02-28T12:00:00Z'),
        actualCompletionAt: new Date('2026-02-28T12:00:00Z'),
      }),
      // Completed before scheduled — on time.
      makeOutcome({
        scheduledAt: new Date('2026-02-28T12:00:00Z'),
        actualCompletionAt: new Date('2026-02-28T10:00:00Z'),
      }),
      // Completed after scheduled — late.
      makeOutcome({
        scheduledAt: new Date('2026-02-28T10:00:00Z'),
        actualCompletionAt: new Date('2026-02-28T14:00:00Z'),
      }),
    ]);
    expect(agg.metrics.onTimeCompletionPct).toBeCloseTo((2 / 3) * 100, 1);
  });

  it('counts repeats', () => {
    const agg = aggregateVendorOutcomes([
      makeOutcome({ wasReopened: false }),
      makeOutcome({ wasReopened: true }),
    ]);
    expect(agg.metrics.repeatCallRatePct).toBe(50);
  });
});

describe('runVendorRatingRecompute', () => {
  function buildRepo(
    vendors: VendorProfileDto[],
    outcomes: Record<string, VendorWorkOrderOutcomeDto[]>
  ): { repo: VendorRepositoryPort; updates: VendorRatingUpdate[] } {
    const updates: VendorRatingUpdate[] = [];
    const repo: VendorRepositoryPort = {
      findCandidates: async () => [],
      findById: async () => null,
      findAllActive: async () => vendors,
      listRecentOutcomes: async ({ vendorId }) => outcomes[vendorId] ?? [],
      updateRatingAggregate: async (u) => {
        updates.push(u);
      },
    };
    return { repo, updates };
  }

  const vendor: VendorProfileDto = {
    id: 'v1',
    tenantId: 't1',
    vendorCode: 'VND-0001',
    name: 'Test',
    status: 'active',
    categories: ['plumbing'],
    serviceAreas: ['Nairobi'],
    ratings: { overall: 0, quality: 0, reliability: 0, communication: 0, value: 0 },
    metrics: { completedJobs: 0, averageResponseTimeHours: 0, onTimeCompletionPct: 0, repeatCallRatePct: 0 },
    isPreferred: false,
    emergencyAvailable: false,
    afterHoursAvailable: false,
    ratingLastComputedAt: null,
    ratingSampleSize: 0,
    hourlyRate: 2000,
    currency: 'KES',
  };

  it('updates vendors with outcomes in the window', async () => {
    const { repo, updates } = buildRepo([vendor], {
      v1: [makeOutcome({}), makeOutcome({ ratingQuality: 5 })],
    });
    const summary = await runVendorRatingRecompute(repo, { tenantId: 't1' });
    expect(summary.vendorsUpdated).toBe(1);
    expect(updates.length).toBe(1);
    expect(updates[0]?.sampleSize).toBe(2);
  });

  it('skips vendors with no outcomes and counts them', async () => {
    const { repo, updates } = buildRepo([vendor], { v1: [] });
    const summary = await runVendorRatingRecompute(repo, { tenantId: 't1' });
    expect(summary.vendorsSkippedNoData).toBe(1);
    expect(updates.length).toBe(0);
  });

  it('captures per-vendor errors without aborting', async () => {
    const repo: VendorRepositoryPort = {
      findCandidates: async () => [],
      findById: async () => null,
      findAllActive: async () => [vendor],
      listRecentOutcomes: async () => {
        throw new Error('db down');
      },
      updateRatingAggregate: async () => undefined,
    };
    const summary = await runVendorRatingRecompute(repo, { tenantId: 't1' });
    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0]?.vendorId).toBe('v1');
  });
});
