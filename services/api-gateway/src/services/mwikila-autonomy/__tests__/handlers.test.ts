/**
 * Mr. Mwikila handlers — pure-logic unit tests.
 *
 * Each handler's propose() is exercised against injected port stubs
 * across the happy path + the early-exit branches.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildLicenseRenewalProposal,
  buildMarketplaceCounterProposal,
  buildPayrollProposal,
  buildRoyaltyFilingProposal,
  buildShiftScheduleProposal,
  computeCounterPriceTzs,
  computePayrollRow,
  computeRoyaltyDueTzs,
  createLicenseRenewalHandler,
  createMarketplaceCounterHandler,
  createPayrollHandler,
  createRoyaltyFilingHandler,
  createShiftSchedulerHandler,
  pickClosestWindow,
} from '../handlers/index.js';

// ─── helpers ─────────────────────────────────────────────────────

const tenantId = 'tenant-xyz';
const actingOnUserId = 'user-owner';
const fixedNow = new Date('2026-05-29T08:00:00.000Z');

// ─── shift scheduler ─────────────────────────────────────────────

describe('shift scheduler', () => {
  it('returns null when no workers are active', async () => {
    const handler = createShiftSchedulerHandler({
      listActiveWorkforce: vi.fn().mockResolvedValue([]),
      listSiteCapacity: vi.fn().mockResolvedValue([
        { siteId: 'site-A', siteName: 'A', minWorkersPerShift: 1, maxWorkersPerShift: 3 },
      ]),
      hasOverlappingSchedule: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('returns null when an overlapping schedule already exists', async () => {
    const handler = createShiftSchedulerHandler({
      listActiveWorkforce: vi.fn().mockResolvedValue([
        { id: 'w1', fullName: 'W1', availabilityDays: [1, 2, 3] },
      ]),
      listSiteCapacity: vi.fn().mockResolvedValue([
        { siteId: 'site-A', siteName: 'A', minWorkersPerShift: 1, maxWorkersPerShift: 3 },
      ]),
      hasOverlappingSchedule: vi.fn().mockResolvedValue(true),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('drafts a 7-day round-robin schedule on the happy path', async () => {
    const handler = createShiftSchedulerHandler({
      listActiveWorkforce: vi.fn().mockResolvedValue([
        { id: 'w1', fullName: 'W1', availabilityDays: [0, 1, 2, 3, 4, 5, 6] },
        { id: 'w2', fullName: 'W2', availabilityDays: [0, 1, 2, 3, 4, 5, 6] },
      ]),
      listSiteCapacity: vi.fn().mockResolvedValue([
        { siteId: 'site-A', siteName: 'A', minWorkersPerShift: 1, maxWorkersPerShift: 2 },
      ]),
      hasOverlappingSchedule: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).not.toBeNull();
    expect(result?.actionKind).toBe('shifts.weekly_schedule_draft');
    expect(result?.category).toBe('shifts');
    const payload = result!.payload as { assignments: ReadonlyArray<unknown> };
    expect(payload.assignments).toHaveLength(7);
  });

  it('buildShiftScheduleProposal returns null when no available workers per day', () => {
    const result = buildShiftScheduleProposal(
      [{ id: 'w1', fullName: 'W1', availabilityDays: [] }],
      [
        { siteId: 'site-A', siteName: 'A', minWorkersPerShift: 1, maxWorkersPerShift: 1 },
      ],
      fixedNow.toISOString(),
      3,
    );
    expect(result).toBeNull();
  });
});

// ─── royalty filing prep ─────────────────────────────────────────

describe('royalty filing prep', () => {
  it('computeRoyaltyDueTzs applies rate as a percent', () => {
    expect(computeRoyaltyDueTzs(1_000_000, 5)).toBe(50_000);
    expect(computeRoyaltyDueTzs(0, 7)).toBe(0);
  });

  it('skips when an existing draft is already in place', async () => {
    const handler = createRoyaltyFilingHandler({
      monthlyTotals: vi.fn().mockResolvedValue({
        grossSalesTzs: 5_000_000,
        productionTonnes: 8,
        mineralKind: 'gold',
        regionCode: 'TZ-GE',
        regionRoyaltyRatePct: 6,
      }),
      hasExistingDraft: vi.fn().mockResolvedValue(true),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('skips when monthly totals are below the minimum gross sales', async () => {
    const handler = createRoyaltyFilingHandler({
      monthlyTotals: vi.fn().mockResolvedValue({
        grossSalesTzs: 50_000,
        productionTonnes: 1,
        mineralKind: 'gold',
        regionCode: 'TZ-GE',
        regionRoyaltyRatePct: 6,
      }),
      hasExistingDraft: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('drafts a filing on the happy path', async () => {
    const handler = createRoyaltyFilingHandler({
      monthlyTotals: vi.fn().mockResolvedValue({
        grossSalesTzs: 10_000_000,
        productionTonnes: 12.5,
        mineralKind: 'gold',
        regionCode: 'TZ-GE',
        regionRoyaltyRatePct: 6,
      }),
      hasExistingDraft: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).not.toBeNull();
    expect((result!.payload as { royaltyDueTzs: number }).royaltyDueTzs).toBe(600_000);
    expect(result!.amountTzs).toBe(600_000);
  });

  it('buildRoyaltyFilingProposal carries the correct rationale + payload', () => {
    const p = buildRoyaltyFilingProposal(
      {
        grossSalesTzs: 4_000_000,
        productionTonnes: 5,
        mineralKind: 'diamond',
        regionCode: 'TZ-MW',
        regionRoyaltyRatePct: 5,
      },
      '2026-04-01T00:00:00.000Z',
      '2026-04-30T23:59:59.000Z',
    );
    expect(p.payload).toMatchObject({
      mineralKind: 'diamond',
      regionRoyaltyRatePct: 5,
      royaltyDueTzs: 200_000,
    });
  });
});

// ─── license renewal ─────────────────────────────────────────────

describe('license renewal reminders', () => {
  it('pickClosestWindow returns the smallest window covering daysToExpiry', () => {
    expect(pickClosestWindow(7, [1, 3, 7, 14])).toBe(7);
    expect(pickClosestWindow(3, [1, 3, 7])).toBe(3);
    expect(pickClosestWindow(60, [1, 3, 7])).toBeNull();
  });

  it('returns null when no licenses are expiring', async () => {
    const handler = createLicenseRenewalHandler({
      listExpiringLicenses: vi.fn().mockResolvedValue([]),
      reminderAlreadyFired: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('skips a license whose reminder already fired for this window', async () => {
    const handler = createLicenseRenewalHandler({
      listExpiringLicenses: vi.fn().mockResolvedValue([
        {
          id: 'lic-1',
          licenseKind: 'mining-license',
          licenseRef: 'ML-001',
          issuingAuthority: 'TMA',
          expiresAt: new Date(fixedNow.getTime() + 7 * 86_400_000).toISOString(),
        },
      ]),
      reminderAlreadyFired: vi.fn().mockResolvedValue(true),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('fires reminder on the happy path', async () => {
    const handler = createLicenseRenewalHandler({
      listExpiringLicenses: vi.fn().mockResolvedValue([
        {
          id: 'lic-1',
          licenseKind: 'mining-license',
          licenseRef: 'ML-001',
          issuingAuthority: 'TMA',
          expiresAt: new Date(fixedNow.getTime() + 14 * 86_400_000).toISOString(),
        },
      ]),
      reminderAlreadyFired: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).not.toBeNull();
    expect((result!.payload as { windowDay: number }).windowDay).toBe(14);
  });

  it('buildLicenseRenewalProposal carries bilingual labels', () => {
    const p = buildLicenseRenewalProposal(
      {
        id: 'lic-1',
        licenseKind: 'mining-license',
        licenseRef: 'ML-001',
        issuingAuthority: 'TMA',
        expiresAt: '2026-06-15T00:00:00.000Z',
      },
      14,
      14,
    );
    expect(p.summary).toContain('14 days');
    expect(p.summarySw).toContain('siku 14');
  });
});

// ─── payroll prep ────────────────────────────────────────────────

describe('payroll prep', () => {
  it('computePayrollRow caps overtime at 0 when hoursWorked ≤ standard', () => {
    const c = computePayrollRow({
      userId: 'u1',
      fullName: 'U1',
      baseMonthlyTzs: 300_000,
      hourlyOvertimeTzs: 4_000,
      standardMonthlyHours: 160,
      hoursWorked: 150,
    });
    expect(c.overtimeHours).toBe(0);
    expect(c.overtimeTzs).toBe(0);
    expect(c.grossTzs).toBe(300_000);
  });

  it('computePayrollRow pays overtime above standard', () => {
    const c = computePayrollRow({
      userId: 'u1',
      fullName: 'U1',
      baseMonthlyTzs: 300_000,
      hourlyOvertimeTzs: 4_000,
      standardMonthlyHours: 160,
      hoursWorked: 170,
    });
    expect(c.overtimeHours).toBe(10);
    expect(c.overtimeTzs).toBe(40_000);
    expect(c.grossTzs).toBe(340_000);
  });

  it('skips when an existing batch is in place', async () => {
    const handler = createPayrollHandler({
      monthlyPayrollRoll: vi.fn().mockResolvedValue([]),
      hasExistingBatch: vi.fn().mockResolvedValue(true),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('drafts a batch on the happy path', async () => {
    const handler = createPayrollHandler({
      monthlyPayrollRoll: vi.fn().mockResolvedValue([
        {
          userId: 'u1',
          fullName: 'U1',
          baseMonthlyTzs: 300_000,
          hourlyOvertimeTzs: 4_000,
          standardMonthlyHours: 160,
          hoursWorked: 165,
        },
      ]),
      hasExistingBatch: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).not.toBeNull();
    expect((result!.payload as { totalGrossTzs: number }).totalGrossTzs).toBe(320_000);
  });

  it('buildPayrollProposal carries the worker breakdown', () => {
    const p = buildPayrollProposal(
      [
        {
          userId: 'u1',
          fullName: 'U1',
          baseTzs: 300_000,
          overtimeTzs: 20_000,
          overtimeHours: 5,
          grossTzs: 320_000,
        },
      ],
      '2026-04-01T00:00:00.000Z',
      '2026-04-30T23:59:59.000Z',
    );
    expect(p.amountTzs).toBe(320_000);
    expect((p.payload as { workers: ReadonlyArray<unknown> }).workers).toHaveLength(1);
  });
});

// ─── marketplace counter ─────────────────────────────────────────

describe('marketplace counter', () => {
  it('computeCounterPriceTzs returns max(floor, buyer * (1+uplift))', () => {
    expect(computeCounterPriceTzs(100_000, 110_000, 0.05)).toBe(110_000);
    expect(computeCounterPriceTzs(100_000, 90_000, 0.05)).toBe(105_000);
    expect(computeCounterPriceTzs(100_000, 100_000, 0)).toBe(100_000);
  });

  it('returns null when no open buyer offers', async () => {
    const handler = createMarketplaceCounterHandler({
      listOpenBuyerOffers: vi.fn().mockResolvedValue([]),
      getSellerTargets: vi.fn().mockResolvedValue({
        tenantId,
        targetFloorByMineral: { gold: 100_000 },
        targetUpliftPct: 0.05,
      }),
      hasAlreadyCountered: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('skips offers whose mineral has no floor', async () => {
    const handler = createMarketplaceCounterHandler({
      listOpenBuyerOffers: vi.fn().mockResolvedValue([
        {
          offerId: 'off-1',
          mineralKind: 'tanzanite',
          tonnesRemaining: 1,
          buyerPriceTzs: 1_000_000,
          buyerName: 'Buyer A',
          counterpartyTenantId: 'tenant-buyer',
        },
      ]),
      getSellerTargets: vi.fn().mockResolvedValue({
        tenantId,
        targetFloorByMineral: { gold: 100_000 },
        targetUpliftPct: 0.05,
      }),
      hasAlreadyCountered: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('skips already-countered offers', async () => {
    const handler = createMarketplaceCounterHandler({
      listOpenBuyerOffers: vi.fn().mockResolvedValue([
        {
          offerId: 'off-1',
          mineralKind: 'gold',
          tonnesRemaining: 1,
          buyerPriceTzs: 100_000,
          buyerName: 'Buyer A',
          counterpartyTenantId: 'tenant-buyer',
        },
      ]),
      getSellerTargets: vi.fn().mockResolvedValue({
        tenantId,
        targetFloorByMineral: { gold: 100_000 },
        targetUpliftPct: 0.05,
      }),
      hasAlreadyCountered: vi.fn().mockResolvedValue(true),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).toBeNull();
  });

  it('drafts a counter on the happy path', async () => {
    const handler = createMarketplaceCounterHandler({
      listOpenBuyerOffers: vi.fn().mockResolvedValue([
        {
          offerId: 'off-1',
          mineralKind: 'gold',
          tonnesRemaining: 10,
          buyerPriceTzs: 100_000,
          buyerName: 'Buyer A',
          counterpartyTenantId: 'tenant-buyer',
        },
      ]),
      getSellerTargets: vi.fn().mockResolvedValue({
        tenantId,
        targetFloorByMineral: { gold: 90_000 },
        targetUpliftPct: 0.05,
      }),
      hasAlreadyCountered: vi.fn().mockResolvedValue(false),
    });
    const result = await handler.propose({
      tenantId,
      actingOnUserId,
      now: fixedNow,
    });
    expect(result).not.toBeNull();
    expect(result!.targetRelation).toBe('counterparty');
    expect((result!.payload as { counterPriceTzs: number }).counterPriceTzs).toBe(105_000);
  });

  it('buildMarketplaceCounterProposal carries the bilingual summary', () => {
    const p = buildMarketplaceCounterProposal(
      {
        offerId: 'off-1',
        mineralKind: 'gold',
        tonnesRemaining: 5,
        buyerPriceTzs: 100_000,
        buyerName: 'Buyer A',
        counterpartyTenantId: 'tenant-buyer',
      },
      120_000,
      0.05,
    );
    expect(p.summary).toContain('120,000');
    expect(p.summarySw).toContain('120,000');
  });
});
