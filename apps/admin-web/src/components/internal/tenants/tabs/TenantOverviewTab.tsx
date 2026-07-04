'use client';

import { Card, Skeleton, Alert } from '@borjie/design-system';
import { formatCurrency } from '@/lib/api';
import { bcp47For } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { useTenantOperatorSummaryQuery } from '@/lib/internal/queries/tenant-detail';
import type { Tenant } from '@/lib/internal/types';

interface TenantOverviewTabProps {
  readonly tenant: Tenant;
  readonly initialLocale?: Locale;
}

interface Panel {
  readonly title: string;
  readonly value: string;
  readonly hint: string;
}

const S = {
  activeOperators: { en: 'Active operators', sw: 'Waendeshaji hai' },
  decisions24h: { en: '24h decisions', sw: 'Maamuzi ya saa 24' },
  openTickets: { en: 'Open tickets', sw: 'Tikiti wazi' },
  arr: { en: 'ARR', sw: 'Mapato ya mwaka' },
  planSuffix: { en: 'plan', sw: 'mpango' },
  operatorsHint: { en: 'active memberships', sw: 'wanachama hai' },
  decisionsHint: { en: 'last 24 hours', sw: 'saa 24 zilizopita' },
  ticketsHint: { en: 'unresolved escalations', sw: 'matatizo yasiyotatuliwa' },
  loading: { en: 'Loading tenant summary…', sw: 'Inapakia muhtasari wa mteja…' },
  unavailable: { en: 'Summary unavailable', sw: 'Muhtasari haupatikani' },
} as const;

/**
 * The operator / 24h-decision / open-ticket counts are LIVE per-tenant rollups
 * from GET /mining/internal/tenants/:id/operator-summary; ARR is always-real
 * tenant data and renders even while the rollup loads. No placeholders.
 */
export function TenantOverviewTab({
  tenant,
  initialLocale,
}: TenantOverviewTabProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const { data, isPending, isError, error } = useTenantOperatorSummaryQuery(
    tenant.id,
  );

  const arrPanel: Panel = {
    title: pickByLocale(locale, S.arr),
    value:
      tenant.arr === null
        ? pickByLocale(locale, { en: '—', sw: '—' })
        : formatCurrency(tenant.arr, tenant.currency, bcp47For(locale)),
    hint: `${tenant.plan} ${pickByLocale(locale, S.planSuffix)}`,
  };

  const arrCard = (
    <Card className="rounded-2xl p-6 transition-colors hover:border-border-strong">
      <p className="platform-card-title">{arrPanel.title}</p>
      <p className="platform-card-value">{arrPanel.value}</p>
      <p className="text-xs text-muted-foreground mt-1">{arrPanel.hint}</p>
    </Card>
  );

  if (isPending) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            className="h-28 w-full rounded-2xl"
            aria-label={pickByLocale(locale, S.loading)}
          />
        ))}
        {arrCard}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" title={pickByLocale(locale, S.unavailable)}>
        {error.message}
      </Alert>
    );
  }

  const panels: ReadonlyArray<Panel> = [
    {
      title: pickByLocale(locale, S.activeOperators),
      value: String(data.activeOperators),
      hint: pickByLocale(locale, S.operatorsHint),
    },
    {
      title: pickByLocale(locale, S.decisions24h),
      value: String(data.decisions24h),
      hint: pickByLocale(locale, S.decisionsHint),
    },
    {
      title: pickByLocale(locale, S.openTickets),
      value: String(data.openTickets),
      hint: pickByLocale(locale, S.ticketsHint),
    },
    arrPanel,
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {panels.map((panel) => (
        <Card
          key={panel.title}
          className="rounded-2xl p-6 transition-colors hover:border-border-strong"
        >
          <p className="platform-card-title">{panel.title}</p>
          <p className="platform-card-value">{panel.value}</p>
          <p className="text-xs text-muted-foreground mt-1">{panel.hint}</p>
        </Card>
      ))}
    </div>
  );
}
