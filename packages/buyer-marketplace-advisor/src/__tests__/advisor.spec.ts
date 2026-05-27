/**
 * Unit + integration tests for the buyer-marketplace-advisor.
 * Covers: happy path per surface, all errors, tenant isolation,
 * scoring filters, FX ladder branches, ETA disruption uplift.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createBuyerMarketplaceAdvisor,
  createInMemoryKycSource,
  createInMemoryLogistics,
  createInMemoryMineCatalog,
  KycBlockedError,
  RouteUnavailableError,
  UnknownBuyerError,
  type BuyerNeed,
  type InMemoryRouteEntry,
  type KycFact,
  type MineProfile,
} from '../index.js';

const TENANT = 'tenant-tz-001';
const OTHER_TENANT = 'tenant-zw-002';

const MINES: ReadonlyArray<MineProfile> = [
  {
    id: 'mine-geita',
    tenantId: TENANT,
    name: 'Geita Gold Mine',
    commodity: 'gold',
    regionId: 'TZ-20',
    location: [32.16, -2.87],
    monthlyOutputTonnes: 500,
    averageGrade: 4.2,
    indicativePriceUsdPerTonne: 65_000_000,
    complianceRisk: 'low',
    baseLeadTimeDays: 18,
  },
  {
    id: 'mine-bulyanhulu',
    tenantId: TENANT,
    name: 'Bulyanhulu',
    commodity: 'gold',
    regionId: 'TZ-15',
    location: [32.5, -3.6],
    monthlyOutputTonnes: 200,
    averageGrade: 5.8,
    indicativePriceUsdPerTonne: 64_000_000,
    complianceRisk: 'low',
    baseLeadTimeDays: 20,
  },
  {
    id: 'mine-otherland',
    tenantId: OTHER_TENANT,
    name: 'Otherland',
    commodity: 'gold',
    regionId: 'ZW-1',
    location: [30, -18],
    monthlyOutputTonnes: 800,
    averageGrade: 3,
    indicativePriceUsdPerTonne: 60_000_000,
    complianceRisk: 'low',
    baseLeadTimeDays: 25,
  },
  {
    id: 'mine-low-grade',
    tenantId: TENANT,
    name: 'Low-Grade Gold',
    commodity: 'gold',
    regionId: 'TZ-15',
    location: [33, -3.5],
    monthlyOutputTonnes: 400,
    averageGrade: 1.0,
    indicativePriceUsdPerTonne: 50_000_000,
    complianceRisk: 'high',
    baseLeadTimeDays: 22,
  },
];

const KYC_FACTS: ReadonlyArray<KycFact> = [
  {
    buyerId: 'buyer-good',
    tenantId: TENANT,
    countryCode: 'CH',
    sanctionsHit: false,
    pepFlag: false,
    adverseMediaCount: 0,
    yearsInBusiness: 15,
    auditedFinancials: true,
    completedTradeUsd: 50_000_000,
  },
  {
    buyerId: 'buyer-mediumrisk',
    tenantId: TENANT,
    countryCode: 'AE',
    sanctionsHit: false,
    pepFlag: true,
    adverseMediaCount: 1,
    yearsInBusiness: 3,
    auditedFinancials: false,
    completedTradeUsd: 100_000,
  },
  {
    buyerId: 'buyer-sanctioned',
    tenantId: TENANT,
    countryCode: 'XX',
    sanctionsHit: true,
    pepFlag: false,
    adverseMediaCount: 0,
    yearsInBusiness: 5,
    auditedFinancials: true,
    completedTradeUsd: 1_000_000,
  },
];

const ROUTES: ReadonlyArray<InMemoryRouteEntry> = [
  {
    originMineId: 'mine-geita',
    destPort: 'dar-es-salaam',
    waypoints: ['mine-geita', 'mwanza-rail', 'dodoma', 'dar-es-salaam'],
    baseDays: 7,
    disruptions: [],
  },
  {
    originMineId: 'mine-bulyanhulu',
    destPort: 'dar-es-salaam',
    waypoints: ['mine-bulyanhulu', 'mwanza', 'dar-es-salaam'],
    baseDays: 8,
    disruptions: [
      { code: 'rail-strike', label: 'TRC rail strike', severity: 'medium' },
    ],
  },
];

function buildAdvisor() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    advisor: createBuyerMarketplaceAdvisor({
      mineCatalog: createInMemoryMineCatalog(MINES),
      kycSource: createInMemoryKycSource(KYC_FACTS),
      logistics: createInMemoryLogistics(ROUTES),
      logger,
    }),
    logger,
  };
}

const NEED: BuyerNeed = {
  buyerId: 'buyer-good',
  tenantId: TENANT,
  commodity: 'gold',
  volumeTonnes: 300,
  minGrade: 3,
  preferredRegions: ['TZ-20'],
  maxPriceUsdPerTonne: 70_000_000,
  destinationPort: 'dar-es-salaam',
};

// ─── recommendMines ─────────────────────────────────────────────────

describe('recommendMines', () => {
  it('ranks mines by fit and never crosses tenants (tenant isolation)', async () => {
    const { advisor, logger } = buildAdvisor();
    const recs = await advisor.recommendMines(NEED);
    expect(recs.length).toBeGreaterThan(0);
    const ids = recs.map((r) => r.mineId);
    expect(ids).toContain('mine-geita');
    expect(ids).not.toContain('mine-otherland');
    // Preferred region mine should rank first (TZ-20).
    expect(recs[0]?.mineId).toBe('mine-geita');
    expect(logger.info).toHaveBeenCalledWith(
      'buyer-advisor.recommend.start',
      expect.any(Object),
    );
  });

  it('excludes mines below the minimum grade floor', async () => {
    const { advisor } = buildAdvisor();
    const recs = await advisor.recommendMines({
      ...NEED,
      minGrade: 4,
    });
    const ids = recs.map((r) => r.mineId);
    expect(ids).not.toContain('mine-low-grade');
  });

  it('rejects malformed input via Zod', async () => {
    const { advisor } = buildAdvisor();
    await expect(
      advisor.recommendMines({
        // missing buyerId/tenantId
        commodity: 'gold',
        volumeTonnes: 100,
      } as unknown as BuyerNeed),
    ).rejects.toThrow();
  });
});

// ─── assessKycRisk ──────────────────────────────────────────────────

describe('assessKycRisk', () => {
  it('returns low band for clean buyer', async () => {
    const { advisor } = buildAdvisor();
    const report = await advisor.assessKycRisk('buyer-good', TENANT);
    expect(report.band).toBe('low');
    expect(report.blockers).toHaveLength(0);
    expect(report.factors.length).toBeGreaterThan(0);
  });

  it('returns medium band for PEP + adverse history', async () => {
    const { advisor } = buildAdvisor();
    const report = await advisor.assessKycRisk('buyer-mediumrisk', TENANT);
    expect(['medium', 'high']).toContain(report.band);
  });

  it('forces high band + blockers when sanctioned', async () => {
    const { advisor } = buildAdvisor();
    const report = await advisor.assessKycRisk('buyer-sanctioned', TENANT);
    expect(report.band).toBe('high');
    expect(report.blockers).toContain('Sanctions list hit');
  });

  it('throws UnknownBuyerError for missing buyer', async () => {
    const { advisor } = buildAdvisor();
    await expect(
      advisor.assessKycRisk('buyer-nobody', TENANT),
    ).rejects.toBeInstanceOf(UnknownBuyerError);
  });

  it('isolates by tenant — same buyerId different tenant is unknown', async () => {
    const { advisor } = buildAdvisor();
    await expect(
      advisor.assessKycRisk('buyer-good', OTHER_TENANT),
    ).rejects.toBeInstanceOf(UnknownBuyerError);
  });
});

// ─── proposePaymentTerms ────────────────────────────────────────────

describe('proposePaymentTerms', () => {
  it('proposes Net-30 for low-risk mid-value trade', async () => {
    const { advisor } = buildAdvisor();
    const proposal = await advisor.proposePaymentTerms({
      buyerId: 'buyer-good',
      tenantId: TENANT,
      totalValueUsd: 250_000,
      buyerRisk: 'low',
      buyerCurrency: 'USD',
      sellerCurrency: 'USD',
      expectedLeadTimeDays: 30,
    });
    expect(proposal.primary).toBe('net-30');
    expect(proposal.depositPct).toBeGreaterThanOrEqual(0);
    expect(proposal.fxHedgeLadder).toHaveLength(0);
  });

  it('forces escrow + large deposit for high-risk buyer', async () => {
    const { advisor } = buildAdvisor();
    const proposal = await advisor.proposePaymentTerms({
      buyerId: 'buyer-sanctioned',
      tenantId: TENANT,
      totalValueUsd: 1_000_000,
      buyerRisk: 'high',
      buyerCurrency: 'USD',
      sellerCurrency: 'USD',
      expectedLeadTimeDays: 45,
    });
    expect(proposal.primary).toBe('escrow');
    expect(proposal.depositPct).toBeGreaterThanOrEqual(50);
  });

  it('builds a 3-rung FX hedge ladder on currency mismatch', async () => {
    const { advisor } = buildAdvisor();
    const proposal = await advisor.proposePaymentTerms({
      buyerId: 'buyer-good',
      tenantId: TENANT,
      totalValueUsd: 600_000,
      buyerRisk: 'low',
      buyerCurrency: 'EUR',
      sellerCurrency: 'USD',
      expectedLeadTimeDays: 60,
    });
    expect(proposal.fxHedgeLadder).toHaveLength(3);
    const instruments = proposal.fxHedgeLadder.map((r) => r.instrument);
    expect(instruments).toEqual(['spot', 'forward', 'option']);
    const totalNotional = proposal.fxHedgeLadder.reduce(
      (s, r) => s + r.notionalUsd,
      0,
    );
    expect(totalNotional).toBeCloseTo(600_000, 0);
  });
});

// ─── estimateEta ────────────────────────────────────────────────────

describe('estimateEta', () => {
  it('returns days + route for known origin/dest', async () => {
    const { advisor } = buildAdvisor();
    const eta = await advisor.estimateEta({
      originMineId: 'mine-geita',
      destPort: 'dar-es-salaam',
      tonnage: 500,
    });
    expect(eta.days).toBeGreaterThan(0);
    expect(eta.route).toContain('dodoma');
    expect(eta.disruptionFlags).toHaveLength(0);
  });

  it('applies disruption uplift + uncertainty', async () => {
    const { advisor } = buildAdvisor();
    const baseline = await advisor.estimateEta({
      originMineId: 'mine-geita',
      destPort: 'dar-es-salaam',
      tonnage: 500,
    });
    const disrupted = await advisor.estimateEta({
      originMineId: 'mine-bulyanhulu',
      destPort: 'dar-es-salaam',
      tonnage: 500,
    });
    expect(disrupted.days).toBeGreaterThan(baseline.days);
    expect(disrupted.uncertainty).toBeGreaterThan(baseline.uncertainty);
    expect(disrupted.disruptionFlags.length).toBeGreaterThan(0);
  });

  it('throws RouteUnavailableError for unknown route', async () => {
    const { advisor } = buildAdvisor();
    await expect(
      advisor.estimateEta({
        originMineId: 'mine-nowhere',
        destPort: 'phantom-port',
        tonnage: 100,
      }),
    ).rejects.toBeInstanceOf(RouteUnavailableError);
  });

  it('large tonnage triggers port-clearance uplift', async () => {
    const { advisor } = buildAdvisor();
    const small = await advisor.estimateEta({
      originMineId: 'mine-geita',
      destPort: 'dar-es-salaam',
      tonnage: 50,
    });
    const big = await advisor.estimateEta({
      originMineId: 'mine-geita',
      destPort: 'dar-es-salaam',
      tonnage: 50_000,
    });
    expect(big.days).toBeGreaterThan(small.days);
  });
});

// ─── KycBlockedError sanity (used by composers) ─────────────────────

describe('error surface', () => {
  it('KycBlockedError carries code + buyer id', () => {
    const err = new KycBlockedError('buyer-x', 'sanctions hit');
    expect(err.code).toBe('KYC_BLOCKED');
    expect(err.details.buyerId).toBe('buyer-x');
  });
});
