/**
 * Mr. Mwikila handler — royalty filing prep.
 *
 * At month-end (or on cron-tick when the current day is the last day
 * of the month), aggregates `shift_reports` + `sales` for the
 * just-closed month and drafts the royalty filing. Default tier T1
 * (owner one-tap approves before submission).
 *
 * Pure logic; ports for sales / production totals + the region rate
 * are injected.
 */

import type { MwikilaHandler, MwikilaHandlerProposal } from '../handler-runtime.js';

export interface RoyaltyFilingPorts {
  monthlyTotals(args: {
    readonly tenantId: string;
    readonly periodStartIso: string;
    readonly periodEndIso: string;
  }): Promise<{
    readonly grossSalesTzs: number;
    readonly productionTonnes: number;
    readonly mineralKind: string;
    readonly regionCode: string;
    readonly regionRoyaltyRatePct: number;
  } | null>;
  hasExistingDraft(args: {
    readonly tenantId: string;
    readonly periodStartIso: string;
  }): Promise<boolean>;
}

export interface RoyaltyFilingOptions {
  /** Default minimum gross sales to bother drafting (skip empty months). */
  readonly minimumGrossSalesTzs?: number;
}

const DEFAULT_MIN_GROSS = 100_000;

export function computeRoyaltyDueTzs(
  grossSalesTzs: number,
  rate: number,
): number {
  return Math.max(0, Math.round((grossSalesTzs * rate) / 100));
}

export function buildRoyaltyFilingProposal(
  totals: {
    readonly grossSalesTzs: number;
    readonly productionTonnes: number;
    readonly mineralKind: string;
    readonly regionCode: string;
    readonly regionRoyaltyRatePct: number;
  },
  periodStartIso: string,
  periodEndIso: string,
): MwikilaHandlerProposal {
  const royaltyDue = computeRoyaltyDueTzs(
    totals.grossSalesTzs,
    totals.regionRoyaltyRatePct,
  );
  return {
    actionKind: 'royalty.monthly_filing_prep',
    category: 'royalty-filing',
    summary: `Drafted royalty filing for ${totals.mineralKind} (${periodStartIso.slice(0, 7)}): TZS ${royaltyDue.toLocaleString()}.`,
    summarySw: `Rasimu ya ufungaji wa mrabaha ya ${totals.mineralKind} (${periodStartIso.slice(0, 7)}): TZS ${royaltyDue.toLocaleString()}.`,
    rationale:
      `Aggregated gross sales (TZS ${totals.grossSalesTzs.toLocaleString()}) ` +
      `and applied the ${totals.regionCode} regional royalty rate of ` +
      `${totals.regionRoyaltyRatePct}%. Owner reviews + signs.`,
    payload: {
      periodStartIso,
      periodEndIso,
      mineralKind: totals.mineralKind,
      regionCode: totals.regionCode,
      regionRoyaltyRatePct: totals.regionRoyaltyRatePct,
      grossSalesTzs: totals.grossSalesTzs,
      productionTonnes: totals.productionTonnes,
      royaltyDueTzs: royaltyDue,
    },
    amountTzs: royaltyDue,
    currency: 'TZS',
  };
}

export function createRoyaltyFilingHandler(
  ports: RoyaltyFilingPorts,
  opts: RoyaltyFilingOptions = {},
): MwikilaHandler {
  const minGross = opts.minimumGrossSalesTzs ?? DEFAULT_MIN_GROSS;
  return Object.freeze({
    actionKind: 'royalty.monthly_filing_prep',
    category: 'royalty-filing',
    async propose({ tenantId, now }) {
      const periodStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const periodEnd = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
      );
      const periodStartIso = periodStart.toISOString();
      const periodEndIso = periodEnd.toISOString();

      const exists = await ports.hasExistingDraft({
        tenantId,
        periodStartIso,
      });
      if (exists) return null;

      const totals = await ports.monthlyTotals({
        tenantId,
        periodStartIso,
        periodEndIso,
      });
      if (totals === null) return null;
      if (totals.grossSalesTzs < minGross) return null;

      return buildRoyaltyFilingProposal(totals, periodStartIso, periodEndIso);
    },
  });
}
