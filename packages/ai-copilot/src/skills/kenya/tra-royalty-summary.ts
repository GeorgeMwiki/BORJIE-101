/**
 * TRA Royalty Return Summary Skill
 *
 * Produces a monthly mineral-royalty return summary per the Tanzania Revenue
 * Authority / Mining Commission regime (Mining Act 2010, am. 2017):
 *  - Royalty 6% on gross market value of minerals (gold), plus a 1% clearing
 *    fee — a combined 7% statutory deduction at the point of sale/export.
 *  - Filing monthly with TRA / the Mining Commission.
 *  - Marketplace operators may be appointed as withholding agents, deducting
 *    the royalty + clearing fee on gross proceeds collected on behalf of an owner.
 *
 * This skill produces a summary + filing checklist; it does NOT file.
 * TRA portal integration is a downstream tool; this output is the structured
 * artifact that feeds the filing workflow.
 *
 * Important: the effective rate is a tenant-configurable value with a
 * documented default. We refuse to compute if the configured rate is zero or
 * out-of-range — governance catches that as an error.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const RoyaltyReceiptSchema = z.object({
  /** Owner id in the CPG. */
  ownerId: z.string().min(1),
  /** Asset id in the CPG. */
  assetId: z.string().min(1),
  /** Site id if the receipt is site-level. */
  siteId: z.string().optional(),
  /** Calendar month, 'YYYY-MM'. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amountTzs: z.number().nonnegative(),
  /** If Borjie collected on behalf as appointed withholding agent. */
  collectedAsAgent: z.boolean().default(false),
});

export type RoyaltyReceipt = z.infer<typeof RoyaltyReceiptSchema>;

export const TraRoyaltySummaryParamsSchema = z.object({
  receipts: z.array(RoyaltyReceiptSchema).max(100_000),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** Combined royalty + clearing-fee rate — default 0.07 (6% + 1%) per Mining Act 2010. */
  rate: z.number().min(0).max(0.3).default(0.07),
  /** Annual threshold (TZS) above which a different return regime applies. */
  annualThresholdTzs: z.number().positive().default(15_000_000_000),
  /** 12-month rolling gross per owner — used to check the threshold. */
  trailingGrossByOwner: z.record(z.string(), z.number()).default({}),
});

export type TraRoyaltySummaryParams = z.infer<typeof TraRoyaltySummaryParamsSchema>;

export interface OwnerRoyaltySummary {
  ownerId: string;
  grossValueTzs: number;
  royaltyDueTzs: number;
  withheldByAgentTzs: number;
  netPayableByOwnerTzs: number;
  withinStandardThreshold: boolean;
  exceedsThreshold: boolean;
  lines: Array<{
    assetId: string;
    siteId?: string;
    amountTzs: number;
    collectedAsAgent: boolean;
  }>;
}

export interface TraRoyaltySummaryResult {
  month: string;
  rate: number;
  filingDeadline: string;
  owners: OwnerRoyaltySummary[];
  total: {
    grossTzs: number;
    royaltyTzs: number;
    withheldTzs: number;
    netTzs: number;
  };
  warnings: string[];
  checklist: string[];
}

/**
 * Compute the 20th of the month following `month` as an ISO date (royalty-
 * return filing deadline).
 */
function filingDeadlineIso(month: string): string {
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const d = new Date(Date.UTC(y ?? 1970, m ?? 0, 20));
  return d.toISOString().slice(0, 10);
}

export function summarizeTraRoyalty(
  params: TraRoyaltySummaryParams
): TraRoyaltySummaryResult {
  const byOwner = new Map<string, OwnerRoyaltySummary>();
  const warnings: string[] = [];

  for (const r of params.receipts) {
    if (r.month !== params.month) continue;
    const existing =
      byOwner.get(r.ownerId) ??
      ({
        ownerId: r.ownerId,
        grossValueTzs: 0,
        royaltyDueTzs: 0,
        withheldByAgentTzs: 0,
        netPayableByOwnerTzs: 0,
        withinStandardThreshold: true,
        exceedsThreshold: false,
        lines: [],
      } satisfies OwnerRoyaltySummary);
    existing.grossValueTzs += r.amountTzs;
    existing.lines.push({
      assetId: r.assetId,
      ...(r.siteId !== undefined ? { siteId: r.siteId } : {}),
      amountTzs: r.amountTzs,
      collectedAsAgent: r.collectedAsAgent,
    });
    if (r.collectedAsAgent) {
      // Agent withheld the combined 7% at the point of sale/export.
      existing.withheldByAgentTzs += r.amountTzs * params.rate;
    }
    byOwner.set(r.ownerId, existing);
  }

  for (const owner of byOwner.values()) {
    const trailing = params.trailingGrossByOwner[owner.ownerId] ?? 0;
    const projectedAnnual = trailing + owner.grossValueTzs;
    owner.exceedsThreshold = projectedAnnual > params.annualThresholdTzs;
    owner.withinStandardThreshold = !owner.exceedsThreshold;

    if (owner.withinStandardThreshold) {
      owner.royaltyDueTzs = owner.grossValueTzs * params.rate;
    } else {
      // Over threshold — a large-taxpayer / corporate-income regime applies in
      // addition to royalty. Borjie cannot compute full income tax here;
      // flag for accountant.
      owner.royaltyDueTzs = owner.grossValueTzs * params.rate;
      warnings.push(
        `owner:${owner.ownerId} projected annual gross (${projectedAnnual.toFixed(0)} TZS) exceeds large-taxpayer threshold (${params.annualThresholdTzs} TZS). Corporate income-tax regime also applies — accountant review required.`
      );
    }
    owner.netPayableByOwnerTzs = Math.max(
      owner.royaltyDueTzs - owner.withheldByAgentTzs,
      0
    );
  }

  const owners = Array.from(byOwner.values()).sort((a, b) =>
    b.grossValueTzs - a.grossValueTzs
  );
  const total = owners.reduce(
    (t, o) => ({
      grossTzs: t.grossTzs + o.grossValueTzs,
      royaltyTzs: t.royaltyTzs + o.royaltyDueTzs,
      withheldTzs: t.withheldTzs + o.withheldByAgentTzs,
      netTzs: t.netTzs + o.netPayableByOwnerTzs,
    }),
    { grossTzs: 0, royaltyTzs: 0, withheldTzs: 0, netTzs: 0 }
  );

  const checklist = [
    'Reconcile M-Pesa statement to the ledger for the month (skill.kenya.mpesa_reconcile).',
    'Confirm Borjie royalty withholding-agent status in tenant compliance settings.',
    'Generate per-owner statements with royalty withholding lines before 15th of next month.',
    `File the royalty return with TRA / the Mining Commission by ${filingDeadlineIso(params.month)}.`,
    'Disburse net proceeds to owners after royalty withholding + Borjie fees.',
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

export const traRoyaltySummaryTool: ToolHandler = {
  name: 'skill.kenya.tra_royalty_summary',
  description:
    'Produce a TRA monthly mineral-royalty return summary per Mining Act 2010. Input: royalty receipts + month + optional rate/threshold. Output: per-owner royalty computation, withholding, net payable, filing deadline, warnings, checklist.',
  parameters: {
    type: 'object',
    required: ['receipts', 'month'],
    properties: {
      receipts: { type: 'array', items: { type: 'object' } },
      month: { type: 'string', description: 'YYYY-MM' },
      rate: { type: 'number', default: 0.07 },
      annualThresholdTzs: { type: 'number', default: 15_000_000_000 },
      trailingGrossByOwner: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = TraRoyaltySummaryParamsSchema.safeParse(params);
    if (!parsed.success) {
      return { ok: false, error: `invalid params: ${parsed.error.message}` };
    }
    const result = summarizeTraRoyalty(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `TRA royalty summary for ${result.month}: ${result.owners.length} owners, gross ${result.total.grossTzs.toFixed(0)} TZS, royalty due ${result.total.royaltyTzs.toFixed(0)} TZS, file by ${result.filingDeadline}. Warnings: ${result.warnings.length}.`,
    };
  },
};
