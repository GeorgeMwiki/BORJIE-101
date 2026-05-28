'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * Bindings for `/api/v1/mining/internal/daily-brief-overview` — the
 * fleet aggregate that powers `<AdminDailyBriefCard>` on the admin
 * cockpit. SUPER_ADMIN-only on the gateway.
 */

export interface DailyBriefOverviewTotals {
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
  readonly queued: number;
  readonly tenantsActive: number;
}

export interface DailyBriefOverviewAlert {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly severity: string;
  readonly kind: string;
  readonly summary: string;
}

export interface DailyBriefOverviewPerTenant {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly plan: string | null;
  readonly dispatched: number;
  readonly failed: number;
  readonly skipped: number;
  readonly snapshotId: string | null;
  readonly hasSnapshot: boolean;
}

export interface DailyBriefOverview {
  readonly date: string;
  readonly totals: DailyBriefOverviewTotals;
  readonly topAlerts: ReadonlyArray<DailyBriefOverviewAlert>;
  readonly perTenant: ReadonlyArray<DailyBriefOverviewPerTenant>;
}

const overviewKey = ['admin-daily-brief-overview'] as const;

export function useAdminDailyBriefOverview() {
  return useQuery({
    queryKey: overviewKey,
    queryFn: async (): Promise<DailyBriefOverview> => {
      const res = await apiClient.get<DailyBriefOverview>(
        '/daily-brief-overview',
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
