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

function formatRelative(iso: string | null, isSw: boolean): string {
  if (!iso) return isSw ? 'Bila tarehe' : 'No timestamp';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return isSw ? 'sasa hivi' : 'just now';
  if (minutes < 60) return isSw ? `dakika ${minutes} zilizopita` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isSw ? `saa ${hours} zilizopita` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isSw ? `siku ${days} zilizopita` : `${days}d ago`;
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
        label: isSw ? 'Matukio yaliyo wazi' : 'Open incidents',
        value: String(rows.length),
        sub: isSw ? 'Yanahitaji uchunguzi' : 'Pending investigation',
        icon: AlertTriangle,
        tone: rows.length > 5 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw ? 'Kiwango cha juu kabisa' : 'Critical severity',
        value: String(critical),
        sub: isSw ? 'Hatari ya papo hapo' : 'Imminent risk',
        icon: AlertTriangle,
        tone: critical > 0 ? ('danger' as const) : ('success' as const),
      },
      {
        label: isSw ? 'Kiwango cha juu' : 'High severity',
        value: String(high),
        sub: isSw ? 'Hatua ya haraka' : 'Urgent action',
        icon: HardHat,
        tone: high > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw ? 'Yaliyofungwa siku 30' : 'Closed 30d',
        value: String(closed30d),
        sub: isSw ? 'Mzunguko wa ufungaji' : 'Closure throughput',
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
        {isSw
          ? 'Imeshindwa kupakia matukio. Geuza muunganisho na ujaribu tena.'
          : 'Failed to load incidents. Check the gateway and retry.'}
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
                {isSw ? 'Foleni ya matukio' : 'Incident queue'}
              </h2>
              <p className="text-xs text-neutral-400">
                {isSw
                  ? `${rows.length} matukio yamefunguliwa`
                  : `${rows.length} open across the portfolio`}
              </p>
            </div>
          </header>
          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-neutral-400">
              <ShieldCheck className="mx-auto h-8 w-8 text-success" />
              <p className="mt-3 font-medium text-foreground">
                {isSw ? 'Hakuna tukio lililo wazi.' : 'Zero open incidents.'}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {isSw
                  ? 'Vipigo vya mafanikio kwa tarehe ya leo.'
                  : 'Clean safety record for today.'}
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
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest ${tone.border} ${tone.bg} ${tone.text}`}
                        >
                          {row.severity}
                        </span>
                        {row.siteId ? (
                          <span className="font-mono text-[10px] text-neutral-500">
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
              {isSw ? 'Vidhibiti vya ICA' : 'ICA critical controls'}
            </h2>
            <p className="text-xs text-neutral-400">
              {isSw
                ? 'Hali ya vifaa muhimu na uthibitisho'
                : 'Equipment certification + status'}
            </p>
          </header>
          <ul className="divide-y divide-border/60">
            {[
              {
                key: 'fall-protection',
                en: 'Fall protection harnesses',
                sw: 'Mikanda ya kuzuia kuanguka',
                ok: true,
              },
              {
                key: 'ground-control',
                en: 'Underground ground control',
                sw: 'Udhibiti wa ardhi chini ya ardhi',
                ok: true,
              },
              {
                key: 'gas-detection',
                en: 'Portable gas detection',
                sw: 'Vifaa vya kugundua gesi',
                ok: false,
              },
              {
                key: 'lockout',
                en: 'Equipment lockout / tagout',
                sw: 'Kufunga vifaa wakati wa matengenezo',
                ok: true,
              },
              {
                key: 'evacuation',
                en: 'Emergency evacuation drill',
                sw: 'Mazoezi ya kutoroka',
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
                  <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                    <CheckCircle2 className="h-3 w-3" />
                    {isSw ? 'Hai' : 'OK'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    {isSw ? 'Mukaguzi' : 'Recert due'}
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
