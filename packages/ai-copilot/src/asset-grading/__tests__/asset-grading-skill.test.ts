/**
 * asset-grading skill tests.
 *
 * The skill wraps the pure scoring function and returns a structured
 * `asset_grade_card` block for the chat UI.
 */

import { describe, it, expect } from 'vitest';
import {
  gradeAssetTool,
  gradePortfolio,
  GradeAssetParamsSchema,
} from '../../skills/estate/asset-grading.js';

const ASSET = {
  assetId: 'p1',
  tenantId: 't1',
  utilisationRate: 0.9,
  royaltyCollectionRate: 0.95,
  noi: 500_000,
  grossPotentialIncome: 1_000_000,
  expenseRatio: 0.35,
  outstandingRoyaltyRatio: 0.03,
  avgMaintenanceResolutionHours: 24,
  maintenanceCostPerSite: 20_000,
  complianceBreachCount: 0,
  buyerSatisfactionProxy: 0.85,
  downtimeDays: 10,
  capexDebt: 100_000,
  marketPriceRatio: 1.0,
  assetAge: 5,
  siteCount: 15,
};

describe('gradeAssetTool', () => {
  it('has the expected name', () => {
    expect(gradeAssetTool.name).toBe('skill.estate.grade_asset');
  });

  it('returns ok on a valid single-asset call', async () => {
    const r = await gradeAssetTool.execute(
      { mode: 'single', assets: [ASSET] },
      {} as never,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.blocks?.[0]?.type).toBe('asset_grade_card');
    }
  });

  it('returns a portfolio block when mode=portfolio', async () => {
    const r = await gradeAssetTool.execute(
      {
        mode: 'portfolio',
        weightBy: 'site_count',
        assets: [ASSET, { ...ASSET, assetId: 'p2', siteCount: 5 }],
      },
      {} as never,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const payload = (r.blocks?.[0]?.payload ?? {}) as Record<string, unknown>;
      expect(payload.scope).toBe('portfolio');
      expect(payload.totalAssets).toBe(2);
    }
  });

  it('rejects payloads with zero assets', () => {
    expect(() =>
      GradeAssetParamsSchema.parse({ assets: [] }),
    ).toThrow();
  });

  it('rejects weights that do not sum to 1', async () => {
    const r = await gradeAssetTool.execute(
      {
        mode: 'single',
        assets: [ASSET],
        weights: {
          royalty_yield: 0.5,
          opex_efficiency: 0.5,
          maintenance: 0.5,
          recovery: 0.5,
          royalty_compliance: 0.5,
          buyer_quality: 0.5,
        },
      },
      {} as never,
    );
    expect(r.ok).toBe(false);
  });
});

describe('gradePortfolio (pure)', () => {
  it('returns trajectory when previous score is supplied', () => {
    const result = gradePortfolio({
      mode: 'portfolio',
      assets: [ASSET, { ...ASSET, assetId: 'p2', siteCount: 8 }],
      previousPortfolioScore: 70,
    });
    expect(result.portfolio?.trajectory?.direction).toMatch(/up|down|flat/);
  });
});
