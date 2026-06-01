'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardHat,
  ShieldCheck,
} from 'lucide-react';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { useIncidents, type IncidentRow } from '@/lib/queries/safety';
import { tailStrings as S } from '@/i18n/strings/tail';

interface SafetySurfaceProps {
  readonly locale?: 'sw' | 'en';
}

interface ToneTokens {
  readonly border: string;
  readonly bg: string;
  readonly text: string;
  readonly dot: string;
}

const LOW_TONE: ToneTokens = {
  border: 'border-border',
  bg: 'bg-surface',
  text: 'text-neutral-300',
  dot: 'bg-neutral-500',
};

const SEVERITY_TONE: Record<string, ToneTokens> = {
  critical: {
    border: 'border-destructive/40',
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    dot: 'bg-destructive',
  },
  high: {
    border: 'border-warning/40',
    bg: 'bg-warning/10',
    text: 'text-warning',
    dot: 'bg-warning',
  },
  medium: {
    border: 'border-info/40',
    bg: 'bg-info/10',
    text: 'text-info',
    dot: 'bg-info',
  },
  low: LOW_TONE,
};

function severityTone(severity: string): ToneTokens {
  return SEVERITY_TONE[severity.toLowerCase()] ?? LOW_TONE;
}

/** Fill the `{n}` token in a relative-time template. */
function fillN(template: string, n: number): string {
  return template.replace('{n}', String(n));
}

function formatRelative(iso: string | null, isSw: boolean): string {
  const c = S.safetySurface;
  if (!iso) return isSw ? c.noTimestamp.sw : c.noTimestamp.en;
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return isSw ? c.justNow.sw : c.justNow.en;
  if (minutes < 60) return fillN(isSw ? c.minutesAgo.sw : c.minutesAgo.en, minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fillN(isSw ? c.hoursAgo.sw : c.hoursAgo.en, hours);
  const days = Math.floor(hours / 24);
  return fillN(isSw ? c.daysAgo.sw : c.daysAgo.en, days);
}

/**
 * Safety surface for the owner cockpit.
 *
 * Pulls the live incidents queue from `/api/v1/mining/incidents`,
 * renders a 4-up KPI strip (open count, critical, high, closed-30d),
 * and a dense incident list with severity pills, kind chips, and
 * relative time stamps. ICA equipment certifications surface as a
 * static panel until the gateway exposes the equipment endpoint.
 */
export function SafetySurface({ locale = 'en' }: SafetySurfaceProps): JSX.Element {
  const isSw = locale === 'sw';
  const openQuery = useIncidents({ status: 'open', limit: 200 });
  const closedQuery = useIncidents({ status: 'closed', limit: 200 });

  const rows = useMemo<readonly IncidentRow[]>(
    () => openQuery.data ?? [],
    [openQuery.data],
  );
  const closed = useMemo<readonly IncidentRow[]>(
    () => closedQuery.data ?? [],
    [closedQuery.data],
  );

  const metrics = useMemo<readonly MetricTile[]>(() => {
    const critical = rows.filter((r) => r.severity.toLowerCase() === 'critical').length;
    const high = rows.filter((r) => r.severity.toLowerCase() === 'high').length;
    const closed30d = closed.filter((r) => {
      if (!r.occurredAt) return false;
      const age = Date.now() - Date.parse(r.occurredAt);
      return age < 30 * 86_400_000;
    }).length;
    return [
      {
        label: isSw
          ? S.safetySurface.openIncidentsLabel.sw
          : S.safetySurface.openIncidentsLabel.en,
        value: String(rows.length),
        sub: isSw
          ? S.safetySurface.openIncidentsSub.sw
          : S.safetySurface.openIncidentsSub.en,
        icon: AlertTriangle,
        tone: rows.length > 5 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw
          ? S.safetySurface.criticalLabel.sw
          : S.safetySurface.criticalLabel.en,
        value: String(critical),
        sub: isSw ? S.safetySurface.criticalSub.sw : S.safetySurface.criticalSub.en,
        icon: AlertTriangle,
        tone: critical > 0 ? ('danger' as const) : ('success' as const),
      },
      {
        label: isSw ? S.safetySurface.highLabel.sw : S.safetySurface.highLabel.en,
        value: String(high),
        sub: isSw ? S.safetySurface.highSub.sw : S.safetySurface.highSub.en,
        icon: HardHat,
        tone: high > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw
          ? S.safetySurface.closed30dLabel.sw
          : S.safetySurface.closed30dLabel.en,
        value: String(closed30d),
        sub: isSw
          ? S.safetySurface.closed30dSub.sw
          : S.safetySurface.closed30dSub.en,
        icon: CheckCircle2,
        tone: 'success' as const,
      },
    ];
  }, [rows, closed, isSw]);

  if (openQuery.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border bg-surface/40"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl border border-border bg-surface/40" />
      </div>
    );
  }

  if (openQuery.isError) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {isSw ? S.safetySurface.loadError.sw : S.safetySurface.loadError.en}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40 lg:col-span-2">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {isSw ? S.safetySurface.incidentQueue.sw : S.safetySurface.incidentQueue.en}
              </h2>
              <p className="text-xs text-neutral-400">
                {isSw
                  ? `${rows.length} ${S.safetySurface.openCountSuffix.sw}`
                  : `${rows.length} ${S.safetySurface.openCountSuffix.en}`}
              </p>
            </div>
          </header>
          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-neutral-400">
              <ShieldCheck className="mx-auto h-8 w-8 text-success" />
              <p className="mt-3 font-medium text-foreground">
                {isSw ? S.safetySurface.zeroOpen.sw : S.safetySurface.zeroOpen.en}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {isSw ? S.safetySurface.cleanRecord.sw : S.safetySurface.cleanRecord.en}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.slice(0, 20).map((row) => {
                const tone = severityTone(row.severity);
                return (
                  <li key={row.id} className="flex items-start gap-3 px-5 py-4">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground capitalize">
                          {row.kind}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-tiny font-medium uppercase tracking-widest ${tone.border} ${tone.bg} ${tone.text}`}
                        >
                          {row.severity}
                        </span>
                        {row.siteId ? (
                          <span className="font-mono text-tiny text-neutral-500">
                            {row.siteId}
                          </span>
                        ) : null}
                      </div>
                      {row.description ? (
                        <p className="mt-1 line-clamp-2 text-xs text-neutral-400">
                          {row.description}
                        </p>
                      ) : null}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-neutral-500">
                      <Clock className="h-3 w-3" />
                      {formatRelative(row.occurredAt, isSw)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">
              {isSw ? S.safetySurface.icaHeading.sw : S.safetySurface.icaHeading.en}
            </h2>
            <p className="text-xs text-neutral-400">
              {isSw ? S.safetySurface.icaCaption.sw : S.safetySurface.icaCaption.en}
            </p>
          </header>
          <ul className="divide-y divide-border/60">
            {[
              {
                key: 'fall-protection',
                en: S.safetySurface.fallProtection.en,
                sw: S.safetySurface.fallProtection.sw,
                ok: true,
              },
              {
                key: 'ground-control',
                en: S.safetySurface.groundControl.en,
                sw: S.safetySurface.groundControl.sw,
                ok: true,
              },
              {
                key: 'gas-detection',
                en: S.safetySurface.gasDetection.en,
                sw: S.safetySurface.gasDetection.sw,
                ok: false,
              },
              {
                key: 'lockout',
                en: S.safetySurface.lockout.en,
                sw: S.safetySurface.lockout.sw,
                ok: true,
              },
              {
                key: 'evacuation',
                en: S.safetySurface.evacuation.en,
                sw: S.safetySurface.evacuation.sw,
                ok: true,
              },
            ].map((control) => (
              <li
                key={control.key}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <span className="text-sm text-foreground">
                  {isSw ? control.sw : control.en}
                </span>
                {control.ok ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-tiny font-medium text-success">
                    <CheckCircle2 className="h-3 w-3" />
                    {isSw ? S.safetySurface.controlOk.sw : S.safetySurface.controlOk.en}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-tiny font-medium text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    {isSw ? S.safetySurface.controlRecert.sw : S.safetySurface.controlRecert.en}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
