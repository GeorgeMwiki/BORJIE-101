'use client';

import { Button, Skeleton } from '@borjie/design-system';
import { useTenantCurrent } from '@/lib/queries/tenant';
import { EmptyState } from '@/components/shared/EmptyState';
import { useT } from '@/i18n/t.client';
import { useLocale, type Locale } from '@/lib/locale';
import { localizeError } from '@/lib/api-client';

/**
 * Plan + billing panel — wired to the LIVE current-tenant read
 * (GET /api/v1/tenants/current via useTenantCurrent). Shows the owner's
 * subscription plan, status, and seat/unit limits. Honest states: a
 * loading skeleton, a real error message, and "—" placeholders for any
 * field the gateway omits (never fabricated).
 *
 * Locale-strict: ALL copy resolves through `useT(initialLocale)` (the
 * single locale source). The previous version rendered an English heading
 * AND a Swahili subtitle on the same surface (EN/SW mixing) — the canon
 * forbids that; one language per active locale now.
 *
 * Scope note: detailed RBAC role assignment + autonomy-policy controls
 * are separate, not-yet-built owner endpoints — see the gateway-wave list.
 */
function valueOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

interface PlanBillingPanelProps {
  /**
   * Server-resolved locale, threaded from the settings page so `useT` SEEDS
   * the first client render to the active language (no EN-under-SW
   * split-brain frame).
   */
  readonly initialLocale?: Locale;
}

export function PlanBillingPanel({ initialLocale }: PlanBillingPanelProps = {}) {
  const t = useT(initialLocale);
  const locale = useLocale(initialLocale);
  const { data, isLoading, isError, error, refetch } = useTenantCurrent();

  if (isLoading) {
    return <Skeleton className="h-chart-sm rounded-lg border border-border" />;
  }
  if (isError) {
    return (
      <EmptyState
        title={t('planBilling.loadErrorTitle')}
        description={
          error ? localizeError(error, locale) : t('planBilling.tryAgain')
        }
        hint="GET /api/v1/tenants/current"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            {t('planBilling.retry')}
          </Button>
        }
      />
    );
  }

  const sub = data?.subscription;
  const rows: ReadonlyArray<{ readonly label: string; readonly value: string }> =
    [
      { label: t('planBilling.plan'), value: valueOrDash(sub?.plan) },
      {
        label: t('planBilling.status'),
        value: valueOrDash(sub?.status ?? data?.status),
      },
      { label: t('planBilling.maxUnits'), value: valueOrDash(sub?.maxUnits) },
      { label: t('planBilling.maxUsers'), value: valueOrDash(sub?.maxUsers) },
      {
        label: t('planBilling.billingContact'),
        value: valueOrDash(data?.contactEmail),
      },
    ];

  return (
    <section className="rounded-md border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg text-foreground">
          {t('planBilling.heading')}
        </h2>
        <span className="text-xs text-muted-foreground">{valueOrDash(data?.name)}</span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between border-b border-border/60 py-1.5"
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="text-sm font-medium text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">{t('planBilling.rbacNote')}</p>
    </section>
  );
}
