/**
 * Arrears projection service
 *
 * Computes an arrears-case balance by REPLAYING immutable ledger
 * entries — never mutating them. Produces a snapshot suitable for
 * persistence in `arrears_case_projections` or for live UI queries.
 *
 * Ledger invariant: entries are append-only. Adjustments are new
 * entries with a `related_entry_id` pointing at the entry they
 * correct. The projection honours this by replaying in chronological
 * order and applying adjustments as NEW balance deltas — never by
 * rewriting prior values.
 */
import {
  bucketFor,
  type AgingBucket,
  type ArrearsCaseProjection,
  type ArrearsProjectionLine,
} from './arrears-case';

export interface LedgerReplayEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly invoiceId: string | null;
  readonly entryType:
    | 'charge'
    | 'payment'
    | 'adjustment'
    | 'waiver'
    | 'late_fee'
    | 'writeoff';
  readonly amountMinorUnits: number; // signed: charges +, payments -
  readonly currency: string;
  readonly description: string;
  readonly transactionDate: string; // ISO
  readonly postedAt: string;
  readonly relatedEntryId: string | null;
}

export interface ProjectionInput {
  readonly tenantId: string;
  readonly arrearsCaseId: string;
  readonly customerId: string;
  readonly currency: string;
  readonly entries: readonly LedgerReplayEntry[];
  readonly asOf: Date;
}

interface LineAccumulator {
  invoiceId: string | null;
  description: string;
  charged: number;
  paid: number;
  adjustment: number;
  firstIncurredAt: string;
  sourceEntryIds: string[];
}

function daysBetween(startIso: string, asOf: Date): number {
  const start = new Date(startIso).getTime();
  const diff = asOf.getTime() - start;
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

export interface ArrearsProjectionService {
  project(input: ProjectionInput): ArrearsCaseProjection;
}

export function createArrearsProjectionService(): ArrearsProjectionService {
  return {
    project(input: ProjectionInput): ArrearsCaseProjection {
      // Cross-tenant protection: every entry must belong to the same
      // tenant + customer as the case. Drop any that do not rather than
      // silently leak data.
      const validEntries = input.entries.filter(
        (e) => e.tenantId === input.tenantId && e.customerId === input.customerId
      );

      // Sort chronologically so adjustments apply after their target.
      const sorted = [...validEntries].sort((a, b) => {
        const ta = new Date(a.postedAt).getTime();
        const tb = new Date(b.postedAt).getTime();
        return ta - tb;
      });

      const linesByKey = new Map<string, LineAccumulator>();
      let totalBalance = 0;
      let lastEntryId: string | null = null;

      for (const entry of sorted) {
        const key = entry.invoiceId ?? `__case:${input.arrearsCaseId}`;
        const existing = linesByKey.get(key);
        const base: LineAccumulator =
          existing ?? {
            invoiceId: entry.invoiceId,
            description: entry.description,
            charged: 0,
            paid: 0,
            adjustment: 0,
            firstIncurredAt: entry.transactionDate,
            sourceEntryIds: [],
          };

        // Create NEW accumulator (immutable) rather than mutate.
        const next: LineAccumulator = {
          invoiceId: base.invoiceId,
          description:
            base.description === entry.description
              ? base.description
              : entry.description || base.description,
          charged: base.charged,
          paid: base.paid,
          adjustment: base.adjustment,
          firstIncurredAt: base.firstIncurredAt,
          sourceEntryIds: [...base.sourceEntryIds, entry.id],
        };

        switch (entry.entryType) {
          case 'charge':
          case 'late_fee':
            next.charged = base.charged + entry.amountMinorUnits;
            totalBalance += entry.amountMinorUnits;
            break;
          case 'payment':
            // payment entries are expected to be negative but tolerate
            // absolute positive values by taking abs for display.
            next.paid = base.paid + Math.abs(entry.amountMinorUnits);
            totalBalance -= Math.abs(entry.amountMinorUnits);
            break;
          case 'waiver':
          case 'writeoff':
          case 'adjustment':
            next.adjustment = base.adjustment + entry.amountMinorUnits;
            totalBalance += entry.amountMinorUnits;
            break;
        }

        linesByKey.set(key, next);
        lastEntryId = entry.id;
      }

      const lines: ArrearsProjectionLine[] = Array.from(
        linesByKey.values()
      ).map((acc) => {
        const balance = acc.charged - acc.paid + acc.adjustment;
        const dpd = daysBetween(acc.firstIncurredAt, input.asOf);
        return {
          invoiceId: acc.invoiceId,
          description: acc.description,
          chargedMinorUnits: acc.charged,
          paidMinorUnits: acc.paid,
          adjustmentMinorUnits: acc.adjustment,
          balanceMinorUnits: balance,
          firstIncurredAt: acc.firstIncurredAt,
          daysPastDue: dpd,
          agingBucket: bucketFor(dpd),
          sourceEntryIds: acc.sourceEntryIds,
        };
      });

      const oldestDpd = lines.reduce(
        (max, l) => Math.max(max, l.daysPastDue),
        0
      );
      const aging: AgingBucket = bucketFor(oldestDpd);

      return {
        arrearsCaseId: input.arrearsCaseId,
        tenantId: input.tenantId,
        customerId: input.customerId,
        balanceMinorUnits: totalBalance,
        currency: input.currency,
        daysPastDue: oldestDpd,
        agingBucket: aging,
        lastLedgerEntryId: lastEntryId,
        replayedEntryCount: sorted.length,
        lines,
        asOf: input.asOf.toISOString(),
      };
    },
  };
}
