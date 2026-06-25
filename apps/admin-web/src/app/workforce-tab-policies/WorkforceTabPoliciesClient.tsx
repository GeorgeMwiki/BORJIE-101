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
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale` — including the catalog tab labels, which carry
 * `{en, sw}` and previously hard-rendered `.en` regardless of locale.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  WORKFORCE_ROLE_IDS,
  WORKFORCE_TAB_CATALOG,
  listTabsAllowedForRole,
  type WorkforceRoleId,
} from '@borjie/persona-runtime';
import {
  Card,
  Skeleton,
  Alert,
  Empty,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { api } from '@/lib/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

interface PolicyDistribution {
  readonly role: string;
  readonly tabId: string;
  readonly tenantCount: number;
}

interface PolicySummary {
  readonly totalTenants: number;
  readonly distribution: ReadonlyArray<PolicyDistribution>;
}

const S = {
  reportingPre: { en: 'tenant', sw: 'mteja' },
  reportingPlural: { en: 'tenants', sw: 'wateja' },
  reportingBody: {
    en: 'reporting workforce tab configs. Each cell shows how many tenants enable that tab for the role.',
    sw: 'wanaoripoti mipangilio ya vichupo vya wafanyakazi. Kila kisanduku huonyesha ni wateja wangapi wanaowezesha kichupo hicho kwa jukumu.',
  },
  emptyTitle: {
    en: 'No workforce tabs configured yet',
    sw: 'Hakuna vichupo vya wafanyakazi vilivyosanidiwa bado',
  },
  emptyBody: {
    en: 'Reach out to pilot owners to enable the per-role catalog from their cockpit.',
    sw: 'Wasiliana na wamiliki wa majaribio kuwezesha katalogi ya kila-jukumu kutoka kwenye chumba chao cha uendeshaji.',
  },
  colRole: { en: 'Role', sw: 'Jukumu' },
} as const;

export function WorkforceTabPoliciesClient({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
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
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-xl border border-border" />
        <Skeleton className="h-64 w-full rounded-xl border border-border" />
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
      <Card variant="outline" className="p-4 text-sm text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">{totalTenants}</span>{' '}
          {totalTenants === 1
            ? pickByLocale(locale, S.reportingPre)
            : pickByLocale(locale, S.reportingPlural)}{' '}
          {pickByLocale(locale, S.reportingBody)}
        </p>
        {error ? (
          <Alert variant="warning" className="mt-2">
            {error}
          </Alert>
        ) : null}
      </Card>

      {totalTenants === 0 ? (
        <Empty
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <Card variant="outline" padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colRole)}</TableHead>
                {WORKFORCE_TAB_CATALOG.map((tab) => (
                  <TableHead key={tab.id} title={tab.id}>
                    {pickByLocale(locale, tab.label)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {WORKFORCE_ROLE_IDS.map((role) => {
                const allowedForRole = new Set(
                  listTabsAllowedForRole(role as WorkforceRoleId).map(
                    (t) => t.id,
                  ),
                );
                return (
                  <TableRow key={role}>
                    <TableCell className="font-medium text-foreground">
                      {role}
                    </TableCell>
                    {WORKFORCE_TAB_CATALOG.map((tab) => {
                      if (!allowedForRole.has(tab.id)) {
                        return (
                          <TableCell
                            key={tab.id}
                            className="text-center text-muted-foreground"
                          >
                            —
                          </TableCell>
                        );
                      }
                      const count = lookup.get(`${role}::${tab.id}`) ?? 0;
                      return (
                        <TableCell key={tab.id} className="text-center">
                          <div className="text-foreground">{count}</div>
                          <div className="text-tiny text-muted-foreground">
                            {coveragePercent(count)}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
