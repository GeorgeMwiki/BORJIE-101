/**
 * Service Charge Reconciliation Skill
 *
 * Kenyan estate service charges typically fund:
 *  - Common-area maintenance (cleaning, security, landscaping)
 *  - Utilities (common electricity, water, backup generator fuel)
 *  - Sinking fund (major repairs/replacements; usually 5-15% of charge)
 *  - Management fees
 *
 * This skill takes a service-charge ledger for a given period and:
 *  1. Decomposes actual expenditure vs budget per category.
 *  2. Computes variance (absolute + %).
 *  3. Flags categories over budget by >= X% (tenant-configurable).
 *  4. Computes sinking-fund contribution/deduction.
 *  5. Produces a per-unit apportionment preview so Finance Junior can draft
 *     invoices fairly.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const ServiceChargeCategorySchema = z.enum([
  'cleaning',
  'security',
  'landscaping',
  'common_electricity',
  'common_water',
  'backup_fuel',
  'repairs_minor',
  'repairs_major',
  'management_fee',
  'sinking_fund',
  'other',
]);

export type ServiceChargeCategory = z.infer<typeof ServiceChargeCategorySchema>;

export const ServiceChargeLineSchema = z.object({
  id: z.string().min(1),
  category: ServiceChargeCategorySchema,
  description: z.string(),
  amountKes: z.number(),
  date: z.string(),
  /** Vendor id in the CPG if applicable. */
  vendorId: z.string().optional(),
});
export type ServiceChargeLine = z.infer<typeof ServiceChargeLineSchema>;

export const CategoryBudgetSchema = z.object({
  category: ServiceChargeCategorySchema,
  budgetKes: z.number().nonnegative(),
});
export type CategoryBudget = z.infer<typeof CategoryBudgetSchema>;

export const ServiceChargeReconcileParamsSchema = z.object({
  propertyId: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  lines: z.array(ServiceChargeLineSchema),
  budget: z.array(CategoryBudgetSchema),
  /** Units for per-unit apportionment. */
  units: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      /** Share factor — typically square metres / bedroom count / flat. */
      shareFactor: z.number().positive(),
    })
  ),
  /** Sinking-fund target percentage of total collected. Default 0.10. */
  sinkingFundPct: z.number().min(0).max(0.5).default(0.1),
  /** Overshoot threshold % to flag. Default 10%. */
  overshootThresholdPct: z.number().min(0).max(2).default(0.1),
});
export type ServiceChargeReconcileParams = z.infer<
  typeof ServiceChargeReconcileParamsSchema
>;

export interface CategoryVariance {
  category: ServiceChargeCategory;
  actualKes: number;
  budgetKes: number;
  varianceKes: number;
  variancePct: number;
  overBudget: boolean;
  flagged: boolean;
}

export interface UnitApportionment {
  unitId: string;
  unitLabel: string;
  shareFactor: number;
  shareRatio: number;
  payableKes: number;
}

export interface ServiceChargeReconcileResult {
  propertyId: string;
  period: string;
  categories: CategoryVariance[];
  totalActualKes: number;
  totalBudgetKes: number;
  sinkingFundDueKes: number;
  apportionments: UnitApportionment[];
  flags: string[];
}

export function reconcileServiceCharge(
  params: ServiceChargeReconcileParams
): ServiceChargeReconcileResult {
  const actuals = new Map<ServiceChargeCategory, number>();
  for (const line of params.lines) {
    actuals.set(line.category, (actuals.get(line.category) ?? 0) + line.amountKes);
  }
  const budgetMap = new Map<ServiceChargeCategory, number>();
  for (const b of params.budget) budgetMap.set(b.category, b.budgetKes);

  const categories: CategoryVariance[] = [];
  const allCats = new Set<ServiceChargeCategory>([
    ...actuals.keys(),
    ...budgetMap.keys(),
  ]);
  const flags: string[] = [];
  for (const cat of allCats) {
    const actualKes = actuals.get(cat) ?? 0;
    const budgetKes = budgetMap.get(cat) ?? 0;
    const varianceKes = actualKes - budgetKes;
    const variancePct = budgetKes === 0 ? (actualKes > 0 ? 1 : 0) : varianceKes / budgetKes;
    const overBudget = varianceKes > 0;
    const flagged = overBudget && variancePct >= params.overshootThresholdPct;
    if (flagged) {
      flags.push(
        `${cat} over budget by ${(variancePct * 100).toFixed(1)}% (${varianceKes.toFixed(0)} KES)`
      );
    }
    categories.push({
      category: cat,
      actualKes,
      budgetKes,
      varianceKes,
      variancePct,
      overBudget,
      flagged,
    });
  }
  categories.sort((a, b) => b.varianceKes - a.varianceKes);

  const totalActualKes = categories.reduce((s, c) => s + c.actualKes, 0);
  const totalBudgetKes = categories.reduce((s, c) => s + c.budgetKes, 0);
  const sinkingFundDueKes = totalBudgetKes * params.sinkingFundPct;

  const totalShare = params.units.reduce((s, u) => s + u.shareFactor, 0);
  const apportionments: UnitApportionment[] = totalShare === 0
    ? []
    : params.units.map((u) => {
        const shareRatio = u.shareFactor / totalShare;
        return {
          unitId: u.id,
          unitLabel: u.label,
          shareFactor: u.shareFactor,
          shareRatio,
          payableKes: (totalActualKes + sinkingFundDueKes) * shareRatio,
        };
      });

  return {
    propertyId: params.propertyId,
    period: params.period,
    categories,
    totalActualKes,
    totalBudgetKes,
    sinkingFundDueKes,
    apportionments,
    flags,
  };
}

export const serviceChargeReconcileTool: ToolHandler = {
  name: 'skill.kenya.service_charge_reconcile',
  description:
    'Reconcile a property service-charge ledger for a period against budget. Returns category variances, sinking-fund allocation, and per-unit apportionment preview.',
  parameters: {
    type: 'object',
    required: ['propertyId', 'period', 'lines', 'budget', 'units'],
    properties: {
      propertyId: { type: 'string' },
      period: { type: 'string', description: 'YYYY-MM' },
      lines: { type: 'array', items: { type: 'object' } },
      budget: { type: 'array', items: { type: 'object' } },
      units: { type: 'array', items: { type: 'object' } },
      sinkingFundPct: { type: 'number', default: 0.1 },
      overshootThresholdPct: { type: 'number', default: 0.1 },
    },
  },
  async execute(params) {
    const parsed = ServiceChargeReconcileParamsSchema.safeParse(params);
    if (!parsed.success)
      return { ok: false, error: `invalid params: ${parsed.error.message}` };
    const result = reconcileServiceCharge(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Service charge for ${result.propertyId} ${result.period}: actual ${result.totalActualKes.toFixed(0)} KES vs budget ${result.totalBudgetKes.toFixed(0)} KES. ${result.flags.length} flag(s). Sinking fund due ${result.sinkingFundDueKes.toFixed(0)} KES.`,
    };
  },
};
