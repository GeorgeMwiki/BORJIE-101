'use client';

import { useState } from 'react';
import { useTenantQuery } from '@/lib/internal/queries/tenants';
import { TenantStatusBadge } from './TenantStatusBadge';
import { TenantTabs, type TenantTab } from './TenantTabs';
import { TenantOverviewTab } from './tabs/TenantOverviewTab';
import { TenantUsersTab } from './tabs/TenantUsersTab';
import { TenantBillingTab } from './tabs/TenantBillingTab';
import { TenantAuditTab } from './tabs/TenantAuditTab';
import { TenantImpersonateTab } from './tabs/TenantImpersonateTab';

interface TenantDetailProps {
  readonly tenantId: string;
}

export function TenantDetail({ tenantId }: TenantDetailProps): JSX.Element {
  const { data: tenant, isPending, isError, error } = useTenantQuery(tenantId);
  const [tab, setTab] = useState<TenantTab>('overview');

  if (isPending) return <p className="text-sm text-neutral-500">Loading tenant…</p>;
  if (isError) return <p className="text-sm text-danger">Tenant not found: {error.message}</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-display text-foreground">{tenant.name}</h2>
          <p className="text-sm text-neutral-400">
            {tenant.commodity} · {tenant.region}, {tenant.country} · {tenant.plan} plan
          </p>
        </div>
        <TenantStatusBadge status={tenant.status} />
      </div>

      <TenantTabs active={tab} onChange={setTab} />

      {tab === 'overview' && <TenantOverviewTab tenant={tenant} />}
      {tab === 'users' && <TenantUsersTab tenantId={tenant.id} />}
      {tab === 'billing' && <TenantBillingTab tenant={tenant} />}
      {tab === 'audit' && <TenantAuditTab tenantId={tenant.id} />}
      {tab === 'impersonate' && <TenantImpersonateTab tenantId={tenant.id} tenantName={tenant.name} />}
    </div>
  );
}
