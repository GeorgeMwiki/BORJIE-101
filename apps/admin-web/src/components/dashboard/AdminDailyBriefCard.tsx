'use client';

import { AlertOctagon, CheckCircle2, Clock, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAdminDailyBriefOverview } from '@/lib/internal/queries/daily-brief-overview';
import { pickByLocale, useLocale, type Locale } from '@/lib/locale';
import { localizeEnumLabel, ALERT_KIND_LABELS } from '@/lib/internal/enum-labels';

/**
 * Admin daily brief — read-only fleet aggregate over today's daily-
 * brief activity. Surfaces counts of briefs sent / failed / skipped /
 * queued and the top three high-signal alert lines across tenants.
 *
 * Powered by `GET /api/v1/mining/internal/daily-brief-overview`
 * (SUPER_ADMIN-only on the gateway).
 */
export function AdminDailyBriefCard(): JSX.Element {
  const locale = useLocale();
  const { data, isLoading, isError } = useAdminDailyBriefOverview();

  if (isLoading) {
    return <Skeleton />;
  }

  const title = pickByLocale(locale, {
    en: 'Daily brief — fleet',
    sw: 'Muhtasari wa kila siku — meli',
  });

  if (isError || !data) {
    return (
      <article
        className="cockpit-card"
        data-testid="admin-daily-brief-empty"
      >
        <h2 className="cockpit-card-title">{title}</h2>
        <p className="mt-2 text-sm text-neutral-400">
          {pickByLocale(locale, {
            en:
              'Aggregate not yet available. Endpoint may be unwired in this ' +
              'environment.',
            sw:
              'Jumuisho halijapatikana bado. Mwisho unaweza kuwa ' +
              'haujaunganishwa katika mazingira haya.',
          })}
        </p>
      </article>
    );
  }

  const { totals, topAlerts, date } = data;

  return (
    <article className="cockpit-card" data-testid="admin-daily-brief-card">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="cockpit-card-title">{title}</h2>
          <p className="text-xs italic text-neutral-500">
            {pickByLocale(locale, {
              en: 'Fleet aggregate',
              sw: 'Jumuisho la meli',
            })}{' '}
            · {date}
          </p>
        </div>
        <span className="font-mono text-mini uppercase tracking-widest text-signal-500">
          {totals.tenantsActive}{' '}
          {pickByLocale(locale, { en: 'tenants', sw: 'wateja' })}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={pickByLocale(locale, { en: 'Sent', sw: 'Imetumwa' })}
          value={totals.sent}
          icon={Send}
          tone="green"
        />
        <Stat
          label={pickByLocale(locale, { en: 'Queued', sw: 'Imepangwa' })}
          value={totals.queued}
          icon={Clock}
          tone="amber"
        />
        <Stat
          label={pickByLocale(locale, { en: 'Failed', sw: 'Imeshindwa' })}
          value={totals.failed}
          icon={AlertOctagon}
          tone="red"
        />
        <Stat
          label={pickByLocale(locale, { en: 'Skipped', sw: 'Imerukwa' })}
          value={totals.skipped}
          icon={CheckCircle2}
          tone="neutral"
        />
      </dl>

      {topAlerts.length > 0 ? (
        <section className="mt-5 space-y-2.5">
          <p className="font-mono text-tiny uppercase tracking-widest text-neutral-500">
            {pickByLocale(locale, { en: 'Top alerts', sw: 'Arifa kuu' })}
          </p>
          <ul className="space-y-2" data-testid="admin-daily-brief-alerts">
            {topAlerts.slice(0, 3).map((alert) => (
              <li
                key={`${alert.tenantId}-${alert.kind}`}
                className="rounded-xl border border-border bg-background/60 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest text-foreground">
                    {alert.tenantName}
                  </span>
                  <span
                    className={`text-tiny font-semibold uppercase tracking-widest ${severityClass(alert.severity)}`}
                  >
                    {severityLabel(alert.severity, locale)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-200">{alert.summary}</p>
                <p className="mt-1 text-tiny font-mono uppercase tracking-widest text-neutral-500">
                  {localizeEnumLabel(ALERT_KIND_LABELS, alert.kind, locale)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p
          className="mt-5 text-sm text-neutral-400"
          data-testid="admin-daily-brief-no-alerts"
        >
          {pickByLocale(locale, {
            en: 'No high-signal alerts in the last cycle.',
            sw: 'Hakuna arifa za kiwango cha juu katika mzunguko uliopita.',
          })}
        </p>
      )}
    </article>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: LucideIcon;
  readonly tone: 'green' | 'amber' | 'red' | 'neutral';
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-tiny font-mono uppercase tracking-widest text-neutral-500">
          {label}
        </span>
        <Icon className={`h-3.5 w-3.5 ${toneIcon(tone)}`} aria-hidden />
      </div>
      <p className="mt-2 font-display text-2xl font-medium tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}

function Skeleton(): JSX.Element {
  return (
    <article
      className="cockpit-card animate-pulse"
      data-testid="admin-daily-brief-skeleton"
    >
      <div className="h-4 w-44 rounded bg-neutral-800/60" />
      <div className="mt-4 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((idx) => (
          <div key={idx} className="h-16 rounded-xl bg-neutral-800/30" />
        ))}
      </div>
    </article>
  );
}

function severityClass(severity: string): string {
  if (severity === 'critical' || severity === 'high') return 'text-red-400';
  if (severity === 'medium') return 'text-amber-400';
  return 'text-neutral-400';
}

/** Map the raw severity enum to a single-locale label (no raw English under sw). */
function severityLabel(severity: string, locale: Locale): string {
  switch (severity) {
    case 'critical':
      return pickByLocale(locale, { en: 'Critical', sw: 'Hatari' });
    case 'high':
      return pickByLocale(locale, { en: 'High', sw: 'Juu' });
    case 'medium':
      return pickByLocale(locale, { en: 'Medium', sw: 'Wastani' });
    case 'low':
      return pickByLocale(locale, { en: 'Low', sw: 'Chini' });
    default:
      return severity;
  }
}

function toneIcon(tone: 'green' | 'amber' | 'red' | 'neutral'): string {
  if (tone === 'green') return 'text-emerald-500';
  if (tone === 'amber') return 'text-amber-500';
  if (tone === 'red') return 'text-red-500';
  return 'text-neutral-500';
}
