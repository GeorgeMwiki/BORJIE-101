/**
 * skill.estate.grade_property — grade one property or the whole portfolio.
 *
 * Triggered when an operator or owner asks:
 *   - "grade my portfolio"
 *   - "how is unit 4B doing?"
 *   - "which properties are underperforming?"
 *
 * The orchestrator routes those utterances here. The skill returns a
 * structured response with a `property_grade_card` blackboard block so
 * the adaptive-renderer can show a visual grade card on the chat UI.
 *
 * Deterministic — the actual scoring math lives in scoring-model.ts.
 * This file is the thin adapter that glues the orchestrator's tool
 * interface to the grading service.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  scoreProperty,
  DEFAULT_GRADING_WEIGHTS,
} from '../../property-grading/scoring-model.js';
import {
  aggregatePortfolioGrade,
  WeightBy,
} from '../../property-grading/portfolio-aggregator.js';
import {
  GradingWeights,
  PropertyGradeInputs,
  PropertyGradeReport,
} from '../../property-grading/property-grading-types.js';

const DimensionWeightsSchema = z
  .object({
    income: z.number().min(0).max(1),
    expense: z.number().min(0).max(1),
    maintenance: z.number().min(0).max(1),
    occupancy: z.number().min(0).max(1),
    compliance: z.number().min(0).max(1),
    tenant: z.number().min(0).max(1),
  })
  .optional();

const PropertyInputsSchema = z.object({
  propertyId: z.string().min(1),
  tenantId: z.string().min(1),
  occupancyRate: z.number().min(0).max(1),
  rentCollectionRate: z.number().min(0).max(1),
  noi: z.number(),
  grossPotentialIncome: z.number().nonnegative(),
  expenseRatio: z.number().min(0).max(1.5),
  arrearsRatio: z.number().min(0).max(1),
  avgMaintenanceResolutionHours: z.number().nonnegative(),
  maintenanceCostPerUnit: z.number().nonnegative(),
  complianceBreachCount: z.number().int().nonnegative(),
  tenantSatisfactionProxy: z.number().min(0).max(1),
  vacancyDurationDays: z.number().nonnegative(),
  capexDebt: z.number().nonnegative(),
  marketRentRatio: z.number().nonnegative(),
  propertyAge: z.number().int().nonnegative(),
  unitCount: z.number().int().positive(),
});

export const GradePropertyParamsSchema = z.object({
  mode: z.enum(['single', 'portfolio']).default('single'),
  weightBy: z.enum(['equal', 'unit_count', 'asset_value']).optional(),
  weights: DimensionWeightsSchema,
  properties: z.array(PropertyInputsSchema).min(1).max(500),
  previousPortfolioScore: z.number().optional(),
});
export type GradePropertyParams = z.infer<typeof GradePropertyParamsSchema>;

export interface GradePropertyResult {
  readonly mode: 'single' | 'portfolio';
  readonly reports: readonly PropertyGradeReport[];
  readonly portfolio?: ReturnType<typeof aggregatePortfolioGrade>;
  readonly block: {
    readonly type: 'property_grade_card';
    readonly version: 1;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

function assertWeightsSumToOne(
  weights: z.infer<typeof DimensionWeightsSchema>,
): void {
  if (!weights) return;
  const sum =
    weights.income +
    weights.expense +
    weights.maintenance +
    weights.occupancy +
    weights.compliance +
    weights.tenant;
  if (Math.abs(sum - 1.0) > 1e-6) {
    throw new Error(`weights must sum to 1.0 — got ${sum}`);
  }
}

export function gradePortfolio(params: GradePropertyParams): GradePropertyResult {
  const parsed = GradePropertyParamsSchema.parse(params);
  assertWeightsSumToOne(parsed.weights);
  const weights: GradingWeights = parsed.weights
    ? {
        income: parsed.weights.income,
        expense: parsed.weights.expense,
        maintenance: parsed.weights.maintenance,
        occupancy: parsed.weights.occupancy,
        compliance: parsed.weights.compliance,
        tenant: parsed.weights.tenant,
      }
    : DEFAULT_GRADING_WEIGHTS;

  const reports = parsed.properties.map((p) =>
    scoreProperty(p as PropertyGradeInputs, weights),
  );

  if (parsed.mode === 'single') {
    const first = reports[0];
    return {
      mode: 'single',
      reports,
      block: buildSingleBlock(first),
    };
  }

  const weightBy: WeightBy = parsed.weightBy ?? 'unit_count';
  const weightsByPropertyId = Object.fromEntries(
    parsed.properties.map((p) => [p.propertyId, p.unitCount]),
  );
  const portfolio = aggregatePortfolioGrade(
    parsed.properties[0].tenantId,
    reports,
    {
      weightBy,
      weightsByPropertyId,
      previousScore: parsed.previousPortfolioScore,
    },
  );
  return {
    mode: 'portfolio',
    reports,
    portfolio,
    block: buildPortfolioBlock(portfolio, reports),
  };
}

function buildSingleBlock(report: PropertyGradeReport): GradePropertyResult['block'] {
  return {
    type: 'property_grade_card',
    version: 1,
    payload: {
      scope: 'single',
      propertyId: report.propertyId,
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
  reports: readonly PropertyGradeReport[],
): GradePropertyResult['block'] {
  return {
    type: 'property_grade_card',
    version: 1,
    payload: {
      scope: 'portfolio',
      tenantId: portfolio.tenantId,
      grade: portfolio.grade,
      score: portfolio.score,
      distribution: portfolio.distribution,
      topStrengths: portfolio.topStrengths.map((r) => ({
        propertyId: r.propertyId,
        grade: r.grade,
        score: r.score,
      })),
      topWeaknesses: portfolio.topWeaknesses.map((r) => ({
        propertyId: r.propertyId,
        grade: r.grade,
        score: r.score,
      })),
      trajectory: portfolio.trajectory,
      totalProperties: reports.length,
      computedAt: portfolio.computedAt,
    },
  };
}

export const gradePropertyTool: ToolHandler = {
  name: 'skill.estate.grade_property',
  description:
    'Grade a single property or roll up a portfolio grade from explicit measurements. ' +
    "Returns a structured 'property_grade_card' block the chat UI renders.",
  parameters: {
    type: 'object',
    required: ['properties'],
    properties: {
      mode: { type: 'string', enum: ['single', 'portfolio'] },
      weightBy: { type: 'string', enum: ['equal', 'unit_count', 'asset_value'] },
      weights: {
        type: 'object',
        properties: {
          income: { type: 'number' },
          expense: { type: 'number' },
          maintenance: { type: 'number' },
          occupancy: { type: 'number' },
          compliance: { type: 'number' },
          tenant: { type: 'number' },
        },
      },
      properties: { type: 'array', items: { type: 'object' } },
      previousPortfolioScore: { type: 'number' },
    },
  },
  async execute(params) {
    const parsed = GradePropertyParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    try {
      const result = gradePortfolio(parsed.data);
      const summary =
        result.mode === 'portfolio' && result.portfolio
          ? `Portfolio grade ${result.portfolio.grade} (${result.portfolio.score}) across ${result.portfolio.totalProperties} properties.`
          : `${result.reports[0].propertyId} graded ${result.reports[0].grade} (${result.reports[0].score}).`;
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
