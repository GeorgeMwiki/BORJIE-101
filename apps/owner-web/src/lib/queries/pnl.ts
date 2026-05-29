'use client';

/**
 * react-query binding for `GET /api/v1/owner/finance/pnl` —
 * R-FUTURE-3 PnlTable BFF wire. Returns the deterministic per-month
 * P&L envelope the `<PnlTable />` component consumes.
 */

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { PnLRow } from '@/lib/types/finance';

export interface PnlEnvelope {
  readonly rows: ReadonlyArray<PnLRow>;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly month: string;
}

interface ApiResponse {
  readonly success: boolean;
  readonly data?: PnlEnvelope;
}

/**
 * Hook — `month` is `YYYY-MM`. Defaults to the most recent complete
 * month (caller passes today's UTC month for the cockpit "this month"
 * view). The hook is server-component-friendly: caller wraps it in a
 * client boundary; SSR fetches happen via `apiRequest` on the server.
 */
export function usePnl(month: string) {
  return useQuery({
    queryKey: ['owner-finance-pnl', month] as const,
    queryFn: async ({ signal }) => {
      const response = await apiRequest<ApiResponse>(
        `/api/v1/owner/finance/pnl?month=${encodeURIComponent(month)}`,
        { method: 'GET', signal },
      );
      if (!response.success || !response.data) {
        return { rows: [], month, periodStart: '', periodEnd: '' } satisfies PnlEnvelope;
      }
      return response.data;
    },
    staleTime: 60_000,
  });
}

/**
 * Pure helper: produce the canonical `YYYY-MM` string for "this
 * month" in the user's local timezone. Used by the finance page so
 * the cockpit lands on the in-flight month by default.
 */
export function currentMonthYYYYMM(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
