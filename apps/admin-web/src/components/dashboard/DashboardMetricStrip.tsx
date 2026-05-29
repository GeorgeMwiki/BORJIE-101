'use client';

import { Building2, Users, Activity, AlertOctagon, type LucideIcon } from 'lucide-react';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';

/**
 * DashboardMetricStrip — four-up KPI row at the top of the admin cockpit.
 *
 * Mirrors LitFin's StatCard composition: small icon tile, label,
 * tabular numeric value, footer descriptor. Numbers derive from the
 * live tenant query for now (active count + total); session / latency /
 * error-budget slots stay stubbed until their respective brain
 * services land (tracked in PRODUCTION_READINESS.md).
 */

interface Metric {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly labelSw: string;
  readonly value: string;
  readonly footer: string;
  readonly tone: 'neutral' | 'success' | 'warning' | 'danger';
}

const TONE_RING: Record<Metric['tone'], string> = {
  neutral: 'border-t-border',
  success: 'border-t-success/50',
  warning: 'border-t-warning/50',
  danger: 'border-t-danger/50',
};

const TONE_ICON: Record<Metric['tone'], string> = {
  neutral: 'bg-signal-500/10 text-signal-500',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

export function DashboardMetricStrip(): JSX.Element {
  const tenants = useTenantsQuery();
  const rows = tenants.data?.rows ?? [];
  const total = rows.length;
  const active = rows.filter((r) => r.status === 'Active').length;

  const metrics: ReadonlyArray<Metric> = [
    {
      icon: Building2,
      label: 'Total tenants',
      labelSw: 'Wapangaji jumla',
      value: total.toLocaleString('en-US'),
      footer: `${active.toLocaleString('en-US')} active · ${total - active} other`,
      tone: 'neutral',
    },
    {
      icon: Users,
      label: 'Active sessions',
      labelSw: 'Vipindi vinavyoendelea',
      value: '—',
      footer: 'Wired once realtime presence ships',
      tone: 'neutral',
    },
    {
      icon: Activity,
      label: 'Avg latency',
      labelSw: 'Muda wa wastani',
      value: '—',
      footer: 'OTel rollup pending',
      tone: 'success',
    },
    {
      icon: AlertOctagon,
      label: 'Error budget',
      labelSw: 'Bajeti ya makosa',
      value: '—',
      footer: 'Sentry release-health pending',
      tone: 'warning',
    },
  ];

  return (
    <section
      aria-label="Platform KPIs"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <div
            key={m.label}
            className={`rounded-lg border border-t-2 border-border bg-surface p-5 shadow-sm transition-shadow hover:shadow-md ${TONE_RING[m.tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${TONE_ICON[m.tone]}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-3 text-tiny font-mono uppercase tracking-widest text-neutral-500">
              {m.label}
            </div>
            <div className="text-mini text-neutral-500/80">{m.labelSw}</div>
            <div className="mt-2 font-display text-3xl tabular-nums text-foreground">
              {m.value}
            </div>
            <p className="mt-2 text-xs text-neutral-400">{m.footer}</p>
          </div>
        );
      })}
    </section>
  );
}
