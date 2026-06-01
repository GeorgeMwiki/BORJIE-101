/**
 * skill.estate.grade_asset — grade one mineral asset or the whole portfolio.
 *
 * Triggered when an operator or owner asks:
 *   - "grade my portfolio"
 *   - "how is the Geita site doing?"
 *   - "which assets are underperforming?"
 *
 * The orchestrator routes those utterances here. The skill returns a
 * structured response with an `asset_grade_card` blackboard block so
 * the adaptive-renderer can show a visual grade card on the chat UI.
 *
 * Deterministic — the actual scoring math lives in scoring-model.ts.
 * This file is the thin adapter that glues the orchestrator's tool
 * interface to the grading service.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  scoreAsset,
  DEFAULT_GRADING_WEIGHTS,
} from '../../asset-grading/scoring-model.js';
import {
  aggregatePortfolioGrade,
  WeightBy,
} from '../../asset-grading/portfolio-aggregator.js';
import {
  GradingWeights,
  AssetGradeInputs,
  AssetGradeReport,
} from '../../asset-grading/asset-grading-types.js';

const DimensionWeightsSchema = z
  .object({
    royalty_yield: z.number().min(0).max(1),
    opex_efficiency: z.number().min(0).max(1),
    maintenance: z.number().min(0).max(1),
    recovery: z.number().min(0).max(1),
    royalty_compliance: z.number().min(0).max(1),
    buyer_quality: z.number().min(0).max(1),
  })
  .optional();

const AssetInputsSchema = z.object({
  assetId: z.string().min(1),
  tenantId: z.string().min(1),
  utilisationRate: z.number().min(0).max(1),
  royaltyCollectionRate: z.number().min(0).max(1),
  noi: z.number(),
  grossPotentialIncome: z.number().nonnegative(),
  expenseRatio: z.number().min(0).max(1.5),
  outstandingRoyaltyRatio: z.number().min(0).max(1),
  avgMaintenanceResolutionHours: z.number().nonnegative(),
  maintenanceCostPerSite: z.number().nonnegative(),
  complianceBreachCount: z.number().int().nonnegative(),
  buyerSatisfactionProxy: z.number().min(0).max(1),
  downtimeDays: z.number().nonnegative(),
  capexDebt: z.number().nonnegative(),
  marketPriceRatio: z.number().nonnegative(),
  assetAge: z.number().int().nonnegative(),
  siteCount: z.number().int().positive(),
});

export const GradeAssetParamsSchema = z.object({
  mode: z.enum(['single', 'portfolio']).default('single'),
  weightBy: z.enum(['equal', 'site_count', 'asset_value']).optional(),
  weights: DimensionWeightsSchema,
  assets: z.array(AssetInputsSchema).min(1).max(500),
  previousPortfolioScore: z.number().optional(),
});
export type GradeAssetParams = z.infer<typeof GradeAssetParamsSchema>;

export interface GradeAssetResult {
  readonly mode: 'single' | 'portfolio';
  readonly reports: readonly AssetGradeReport[];
  readonly portfolio?: ReturnType<typeof aggregatePortfolioGrade>;
  readonly block: {
    readonly type: 'asset_grade_card';
    readonly version: 1;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

function assertWeightsSumToOne(
  weights: z.infer<typeof DimensionWeightsSchema>,
): void {
  if (!weights) return;
  const sum =
    weights.royalty_yield +
    weights.opex_efficiency +
    weights.maintenance +
    weights.recovery +
    weights.royalty_compliance +
    weights.buyer_quality;
  if (Math.abs(sum - 1.0) > 1e-6) {
    throw new Error(`weights must sum to 1.0 — got ${sum}`);
  }
}

export function gradePortfolio(params: GradeAssetParams): GradeAssetResult {
  const parsed = GradeAssetParamsSchema.parse(params);
  assertWeightsSumToOne(parsed.weights);
  const weights: GradingWeights = parsed.weights
    ? {
        royalty_yield: parsed.weights.royalty_yield,
        opex_efficiency: parsed.weights.opex_efficiency,
        maintenance: parsed.weights.maintenance,
        recovery: parsed.weights.recovery,
        royalty_compliance: parsed.weights.royalty_compliance,
        buyer_quality: parsed.weights.buyer_quality,
      }
    : DEFAULT_GRADING_WEIGHTS;

  const reports = parsed.assets.map((p) =>
    scoreAsset(p as AssetGradeInputs, weights),
  );

  if (parsed.mode === 'single') {
    const first = reports[0];
    if (first === undefined) {
      throw new Error('asset-grading: single mode requires at least one asset');
    }
    return {
      mode: 'single',
      reports,
      block: buildSingleBlock(first),
    };
  }

  const weightBy: WeightBy = parsed.weightBy ?? 'site_count';
  const weightsByAssetId = Object.fromEntries(
    parsed.assets.map((p) => [p.assetId, p.siteCount]),
  );
  const firstAsset = parsed.assets[0];
  if (firstAsset === undefined) {
    throw new Error('asset-grading: portfolio mode requires at least one asset');
  }
  const portfolio = aggregatePortfolioGrade(
    firstAsset.tenantId,
    reports,
    {
      weightBy,
      weightsByAssetId,
      ...(parsed.previousPortfolioScore !== undefined ? { previousScore: parsed.previousPortfolioScore } : {}),
    },
  );
  return {
    mode: 'portfolio',
    reports,
    portfolio,
    block: buildPortfolioBlock(portfolio, reports),
  };
}

function buildSingleBlock(report: AssetGradeReport): GradeAssetResult['block'] {
  return {
    type: 'asset_grade_card',
    version: 1,
    payload: {
      scope: 'single',
      assetId: report.assetId,
      tenantId: report.tenantId,
      grade: report.grade,
      score: report.score,
      dimensions: report.dimensions,
      reasons: report.reasons,
      computedAt: report.computedAt,
    },
  };
}

function buildPortfolioBlock(
  portfolio: ReturnType<typeof aggregatePortfolioGrade>,
  reports: readonly AssetGradeReport[],
): GradeAssetResult['block'] {
  return {
    type: 'asset_grade_card',
    version: 1,
    payload: {
      scope: 'portfolio',
      tenantId: portfolio.tenantId,
      grade: portfolio.grade,
      score: portfolio.score,
      distribution: portfolio.distribution,
      topStrengths: portfolio.topStrengths.map((r) => ({
        assetId: r.assetId,
        grade: r.grade,
        score: r.score,
      })),
      topWeaknesses: portfolio.topWeaknesses.map((r) => ({
        assetId: r.assetId,
        grade: r.grade,
        score: r.score,
      })),
      trajectory: portfolio.trajectory,
      totalAssets: reports.length,
      computedAt: portfolio.computedAt,
    },
  };
}

export const gradeAssetTool: ToolHandler = {
  name: 'skill.estate.grade_asset',
  description:
    'Grade a single mineral asset or roll up a portfolio grade from explicit measurements. ' +
    "Returns a structured 'asset_grade_card' block the chat UI renders.",
  parameters: {
    type: 'object',
    required: ['assets'],
    properties: {
      mode: { type: 'string', enum: ['single', 'portfolio'] },
      weightBy: { type: 'string', enum: ['equal', 'site_count', 'asset_value'] },
      weights: {
        type: 'object',
        properties: {
          royalty_yield: { type: 'number' },
          opex_efficiency: { type: 'number' },
          maintenance: { type: 'number' },
          recovery: { type: 'number' },
          royalty_compliance: { type: 'number' },
          buyer_quality: { type: 'number' },
        },
      },
      assets: { type: 'array', items: { type: 'object' } },
      previousPortfolioScore: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = GradeAssetParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    try {
      const result = gradePortfolio(parsed.data);
      const firstReport = result.reports[0];
      const summary =
        result.mode === 'portfolio' && result.portfolio
          ? `Portfolio grade ${result.portfolio.grade} (${result.portfolio.score}) across ${result.portfolio.totalAssets} assets.`
          : firstReport
            ? `${firstReport.assetId} graded ${firstReport.grade} (${firstReport.score}).`
            : 'No reports generated.';
      return {
        ok: true,
        data: result,
        evidenceSummary: summary,
        blocks: [result.block],
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
};
