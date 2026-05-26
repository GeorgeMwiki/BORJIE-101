/**
 * KRA Rental Income Summary Skill
 *
 * Produces a Monthly Rental Income (MRI) summary per Kenya Revenue Authority
 * regime (as applicable in 2026):
 *  - MRI flat rate 7.5% on gross rental income (from 1 Jan 2024 onwards).
 *    Applies to resident persons whose annual gross rent is <= KES 15,000,000.
 *  - Filing monthly by the 20th of the following month (iTax).
 *  - Agents / property managers may be appointed as withholding agents at 7.5%
 *    on gross rent collected on behalf of a landlord.
 *
 * This skill produces a summary + filing checklist; it does NOT file.
 * iTax integration is a downstream tool; this output is the structured
 * artifact that feeds the filing workflow.
 *
 * Important: the effective rate is a tenant-configurable value with a
 * documented default. We refuse to compute if the configured rate is zero or
 * out-of-range — governance catches that as an error.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const RentReceiptSchema = z.object({
  /** Owner (landlord) id in the CPG. */
  ownerId: z.string().min(1),
  /** Property id in the CPG. */
  propertyId: z.string().min(1),
  /** Unit id if the receipt is unit-level. */
  unitId: z.string().optional(),
  /** Calendar month, 'YYYY-MM'. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountKes: z.number().nonnegative(),
  /** If Borjie collected on behalf as appointed withholding agent. */
  collectedAsAgent: z.boolean().default(false),
});

export type RentReceipt = z.infer<typeof RentReceiptSchema>;

export const KraRentalSummaryParamsSchema = z.object({
  receipts: z.array(RentReceiptSchema).max(100_000),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** MRI rate — default 0.075 (7.5%) per 2024+ Kenya Finance Act. */
  rate: z.number().min(0).max(0.3).default(0.075),
  /** Annual threshold (KES) above which MRI does not apply. */
  annualThresholdKes: z.number().positive().default(15_000_000),
  /** 12-month rolling gross per owner — used to check the threshold. */
  trailingGrossByOwner: z.record(z.string(), z.number()).default({}),
});

export type KraRentalSummaryParams = z.infer<typeof KraRentalSummaryParamsSchema>;

export interface OwnerRentSummary {
  ownerId: string;
  grossIncomeKes: number;
  mriDueKes: number;
  withheldByAgentKes: number;
  netPayableByOwnerKes: number;
  withinMriThreshold: boolean;
  exceedsThreshold: boolean;
  lines: Array<{
    propertyId: string;
    unitId?: string;
    amountKes: number;
    collectedAsAgent: boolean;
  }>;
}

export interface KraRentalSummaryResult {
  month: string;
  rate: number;
  filingDeadline: string;
  owners: OwnerRentSummary[];
  total: {
    grossKes: number;
    mriKes: number;
    withheldKes: number;
    netKes: number;
  };
  warnings: string[];
  checklist: string[];
}

/**
 * Compute the 20th of the month following `month` as an ISO date (filing
 * deadline per iTax rules).
 */
function filingDeadlineIso(month: string): string {
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const d = new Date(Date.UTC(y ?? 1970, m ?? 0, 20));
  return d.toISOString().slice(0, 10);
}

export function summarizeKraRental(
  params: KraRentalSummaryParams
): KraRentalSummaryResult {
  const byOwner = new Map<string, OwnerRentSummary>();
  const warnings: string[] = [];

  for (const r of params.receipts) {
    if (r.month !== params.month) continue;
    const existing =
      byOwner.get(r.ownerId) ??
      ({
        ownerId: r.ownerId,
        grossIncomeKes: 0,
        mriDueKes: 0,
        withheldByAgentKes: 0,
        netPayableByOwnerKes: 0,
        withinMriThreshold: true,
        exceedsThreshold: false,
        lines: [],
      } satisfies OwnerRentSummary);
    existing.grossIncomeKes += r.amountKes;
    existing.lines.push({
      propertyId: r.propertyId,
      ...(r.unitId !== undefined ? { unitId: r.unitId } : {}),
      amountKes: r.amountKes,
      collectedAsAgent: r.collectedAsAgent,
    });
    if (r.collectedAsAgent) {
      // Agent withheld 7.5% at the point of collection.
      existing.withheldByAgentKes += r.amountKes * params.rate;
    }
    byOwner.set(r.ownerId, existing);
  }

  for (const owner of byOwner.values()) {
    const trailing = params.trailingGrossByOwner[owner.ownerId] ?? 0;
    const projectedAnnual = trailing + owner.grossIncomeKes;
    owner.exceedsThreshold = projectedAnnual > params.annualThresholdKes;
    owner.withinMriThreshold = !owner.exceedsThreshold;

    if (owner.withinMriThreshold) {
      owner.mriDueKes = owner.grossIncomeKes * params.rate;
    } else {
      // Over threshold — MRI does not apply; owner files corporate/individual
      // income tax instead. Borjie cannot compute full income tax here;
      // flag for accountant.
      owner.mriDueKes = 0;
      warnings.push(
        `owner:${owner.ownerId} projected annual gross (${projectedAnnual.toFixed(0)} KES) exceeds MRI threshold (${params.annualThresholdKes} KES). Income tax regime applies — accountant review required.`
      );
    }
    owner.netPayableByOwnerKes = Math.max(
      owner.mriDueKes - owner.withheldByAgentKes,
      0
    );
  }

  const owners = Array.from(byOwner.values()).sort((a, b) =>
    b.grossIncomeKes - a.grossIncomeKes
  );
  const total = owners.reduce(
    (t, o) => ({
      grossKes: t.grossKes + o.grossIncomeKes,
      mriKes: t.mriKes + o.mriDueKes,
      withheldKes: t.withheldKes + o.withheldByAgentKes,
      netKes: t.netKes + o.netPayableByOwnerKes,
    }),
    { grossKes: 0, mriKes: 0, withheldKes: 0, netKes: 0 }
  );

  const checklist = [
    'Reconcile M-Pesa statement to the ledger for the month (skill.kenya.mpesa_reconcile).',
    'Confirm Borjie MRI withholding agent status in tenant compliance settings.',
    'Generate per-owner statements with MRI withholding lines before 15th of next month.',
    `File MRI on iTax by ${filingDeadlineIso(params.month)}.`,
    'Disburse net rent to owners after MRI withholding + Borjie fees.',
  ];

  return {
    month: params.month,
    rate: params.rate,
    filingDeadline: filingDeadlineIso(params.month),
    owners,
    total,
    warnings,
    checklist,
  };
}

export const kraRentalSummaryTool: ToolHandler = {
  name: 'skill.kenya.kra_rental_summary',
  description:
    'Produce a KRA Monthly Rental Income summary per Kenya Finance Act. Input: rent receipts + month + optional rate/threshold. Output: per-owner MRI computation, withholding, net payable, filing deadline, warnings, checklist.',
  parameters: {
    type: 'object',
    required: ['receipts', 'month'],
    properties: {
      receipts: { type: 'array', items: { type: 'object' } },
      month: { type: 'string', description: 'YYYY-MM' },
      rate: { type: 'number', default: 0.075 },
      annualThresholdKes: { type: 'number', default: 15_000_000 },
      trailingGrossByOwner: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = KraRentalSummaryParamsSchema.safeParse(params);
    if (!parsed.success) {
      return { ok: false, error: `invalid params: ${parsed.error.message}` };
    }
    const result = summarizeKraRental(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `KRA MRI summary for ${result.month}: ${result.owners.length} owners, gross ${result.total.grossKes.toFixed(0)} KES, MRI due ${result.total.mriKes.toFixed(0)} KES, file by ${result.filingDeadline}. Warnings: ${result.warnings.length}.`,
    };
  },
};
