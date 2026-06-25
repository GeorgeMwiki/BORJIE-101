'use client';

import { useMemo, useState } from 'react';
import { Skeleton, Alert, SimpleTabs, type TabItem } from '@borjie/design-system';
import { useTenantQuery } from '@/lib/internal/queries/tenants';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { TenantStatusBadge } from './TenantStatusBadge';
import { TenantOverviewTab } from './tabs/TenantOverviewTab';
import { TenantUsersTab } from './tabs/TenantUsersTab';
import { TenantBillingTab } from './tabs/TenantBillingTab';
import { TenantAuditTab } from './tabs/TenantAuditTab';
import { TenantImpersonateTab } from './tabs/TenantImpersonateTab';

interface TenantDetailProps {
  readonly tenantId: string;
  readonly initialLocale?: Locale;
}

const S = {
  loading: { en: 'Loading tenant…', sw: 'Inapakia mteja…' },
  notFound: { en: 'Tenant not found', sw: 'Mteja hakupatikana' },
  overview: { en: 'Overview', sw: 'Muhtasari' },
  users: { en: 'Users', sw: 'Watumiaji' },
  billing: { en: 'Billing', sw: 'Bili' },
  audit: { en: 'Audit', sw: 'Ukaguzi' },
  impersonate: { en: 'Impersonate', sw: 'Jifanye' },
  planSuffix: { en: 'plan', sw: 'mpango' },
} as const;

export function TenantDetail({ tenantId, initialLocale }: TenantDetailProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const { data: tenant, isPending, isError, error } = useTenantQuery(tenantId);
  const [tab, setTab] = useState<string>('overview');

  const tabs = useMemo<TabItem[]>(() => {
    if (!tenant) return [];
    return [
      {
        id: 'overview',
        label: pickByLocale(locale, S.overview),
        content: <TenantOverviewTab tenant={tenant} initialLocale={locale} />,
      },
      {
        id: 'users',
        label: pickByLocale(locale, S.users),
        content: <TenantUsersTab tenantId={tenant.id} initialLocale={locale} />,
      },
      {
        id: 'billing',
        label: pickByLocale(locale, S.billing),
        content: <TenantBillingTab tenant={tenant} initialLocale={locale} />,
      },
      {
        id: 'audit',
        label: pickByLocale(locale, S.audit),
        content: <TenantAuditTab tenantId={tenant.id} initialLocale={locale} />,
      },
      {
        id: 'impersonate',
        label: pickByLocale(locale, S.impersonate),
        content: (
          <TenantImpersonateTab
            tenantId={tenant.id}
            tenantName={tenant.name}
            initialLocale={locale}
          />
        ),
      },
    ];
  }, [tenant, locale]);

  if (isPending) {
    return (
      <div className="space-y-6" aria-label={pickByLocale(locale, S.loading)}>
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }
  if (isError) {
    return (
      <Alert variant="error" title={pickByLocale(locale, S.notFound)}>
        {error.message}
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-display text-foreground">{tenant.name}</h2>
          <p className="text-sm text-muted-foreground">
            {tenant.commodity} · {tenant.region}, {tenant.country} · {tenant.plan}{' '}
            {pickByLocale(locale, S.planSuffix)}
          </p>
        </div>
        <TenantStatusBadge status={tenant.status} initialLocale={locale} />
      </div>

      <SimpleTabs tabs={tabs} value={tab} onChange={setTab} variant="underline" />
    </div>
  );
}
