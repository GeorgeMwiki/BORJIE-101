'use client';

/**
 * WorkforceTabPoliciesClient — admin-web aggregate view.
 *
 * Wave WORKFORCE-FIXED-TABS. Fetches the cross-tenant tab-policy
 * distribution from the internal admin endpoint (read-only). Renders
 * a (role × tab id) matrix where each cell shows the count of tenants
 * who have that tab enabled for the role plus the % of fleet coverage.
 *
 * The endpoint is intentionally lightweight — it aggregates the
 * workforce_role_tab_configs table on the server so the admin never
 * pulls raw rows. Empty state (no tenants yet) renders cleanly.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  WORKFORCE_ROLE_IDS,
  WORKFORCE_TAB_CATALOG,
  listTabsAllowedForRole,
  type WorkforceRoleId,
} from '@borjie/persona-runtime';
import { api } from '@/lib/api';

interface PolicyDistribution {
  readonly role: string;
  readonly tabId: string;
  readonly tenantCount: number;
}

interface PolicySummary {
  readonly totalTenants: number;
  readonly distribution: ReadonlyArray<PolicyDistribution>;
}

export function WorkforceTabPoliciesClient(): JSX.Element {
  const [summary, setSummary] = useState<PolicySummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.get<PolicySummary>(
      '/internal/workforce/tab-policy-summary',
    );
    if (res.success && res.data) {
      setSummary(res.data);
    } else {
      setSummary({ totalTenants: 0, distribution: [] });
      if (res.error && res.error !== 'Network error') {
        setError(res.error);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading fleet…
      </div>
    );
  }

  const totalTenants = summary?.totalTenants ?? 0;
  const lookup = new Map<string, number>();
  for (const entry of summary?.distribution ?? []) {
    lookup.set(`${entry.role}::${entry.tabId}`, entry.tenantCount);
  }

  function coveragePercent(count: number): string {
    if (totalTenants === 0) return '0%';
    return `${Math.round((count / totalTenants) * 100)}%`;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
        <p>
          <span className="font-semibold text-neutral-100">
            {totalTenants}
          </span>{' '}
          tenant{totalTenants === 1 ? '' : 's'} reporting workforce tab
          configs. Each cell shows how many tenants enable that tab for the
          role.
        </p>
        {totalTenants === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">
            No tenants have configured workforce tabs yet. Reach out to pilot
            owners to enable the per-role catalog from their cockpit.
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-xs text-amber-400">{error}</p>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="px-3 py-2 font-semibold">Role</th>
              {WORKFORCE_TAB_CATALOG.map((tab) => (
                <th key={tab.id} className="px-2 py-2 font-semibold" title={tab.id}>
                  {tab.label.en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WORKFORCE_ROLE_IDS.map((role) => {
              const allowedForRole = new Set(
                listTabsAllowedForRole(role as WorkforceRoleId).map((t) => t.id),
              );
              return (
                <tr
                  key={role}
                  className="border-b border-neutral-800/60 text-neutral-200"
                >
                  <td className="px-3 py-2 font-medium">{role}</td>
                  {WORKFORCE_TAB_CATALOG.map((tab) => {
                    if (!allowedForRole.has(tab.id)) {
                      return (
                        <td
                          key={tab.id}
                          className="px-2 py-2 text-center text-neutral-700"
                        >
                          —
                        </td>
                      );
                    }
                    const count = lookup.get(`${role}::${tab.id}`) ?? 0;
                    return (
                      <td key={tab.id} className="px-2 py-2 text-center">
                        <div className="text-neutral-100">{count}</div>
                        <div className="text-tiny text-neutral-500">
                          {coveragePercent(count)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
