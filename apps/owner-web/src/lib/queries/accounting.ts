'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Accounting query hook — journal feed off the live mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/accounting/ledger
 * (services/api-gateway/src/routes/mining/accounting.hono.ts) → the real
 * `listLedgerLines` projection over `ledger_entries` (populated by
 * LedgerService.post). Each row is keyed { id, journalId, accountId, type,
 * direction, amountMinorUnits (BIGINT minor units), balanceAfterMinorUnits,
 * currency, effectiveDate, postedAt, description, paymentIntentId }. This
 * schema declares only the fields the panel renders; the projection may be
 * empty (no money moved yet → honest "no records" state) OR non-empty (any
 * royalty/sale/settlement post), so the shape MUST match the real row — the
 * prior schema read `account`/`amount` (which the projection never returns),
 * blanking every amount and CRASHING the panel on the first real ledger line.
 *
 * Rows are zod-parsed (defence in depth) so a wire-format drift surfaces
 * on react-query's error channel rather than crashing the panel.
 */

const AccountingLedgerRowSchema = z.object({
  id: z.string(),
  postedAt: z.string(),
  accountId: z.string(),
  description: z.string().nullable().default(null),
  // BIGINT minor units — render via formatMoney(amount / 10**decimals, currency).
  amountMinorUnits: z.number(),
  currency: z.string(),
});

export type AccountingLedgerRow = z.infer<typeof AccountingLedgerRowSchema>;

const AccountingLedgerListSchema = z.array(AccountingLedgerRowSchema);

export const accountingKeys = {
  ledger: (range?: string) => ['accounting', 'ledger', range ?? 'all'] as const,
};

export function useAccountingLedger(opts?: {
  readonly range?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: accountingKeys.ledger(opts?.range),
    queryFn: async ({ signal }): Promise<ReadonlyArray<AccountingLedgerRow>> => {
      const qs = new URLSearchParams();
      if (opts?.range) qs.set('range', opts.range);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/accounting/ledger?${qs.toString()}`,
        { signal },
      );
      return AccountingLedgerListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}
