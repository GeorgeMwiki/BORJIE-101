'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/**
 * Accounting query hook — journal feed off the live mining BFF.
 *
 * Live endpoint: GET /api/v1/mining/accounting/ledger
 * (services/api-gateway/src/routes/mining/accounting.hono.ts). The
 * endpoint is authed + RLS-bound and returns a real empty list today —
 * the accounting-journal domain table is not yet modelled, so the panel
 * renders a genuine "no records yet" state (never fabricated). The hook
 * is shaped for the eventual journal row so wiring is a one-line change
 * the day the table lands.
 *
 * Rows are zod-parsed (defence in depth) so a wire-format drift surfaces
 * on react-query's error channel rather than crashing the panel.
 */

const AccountingLedgerRowSchema = z.object({
  id: z.string(),
  postedAt: z.string(),
  account: z.string(),
  description: z.string().nullable().default(null),
  amount: z.string().nullable().default(null),
  currency: z.string().nullable().default(null),
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
