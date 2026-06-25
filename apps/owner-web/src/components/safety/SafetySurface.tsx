'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HardHat,
  ShieldCheck,
} from 'lucide-react';
import { Skeleton } from '@borjie/design-system';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { useIncidents, type IncidentRow } from '@/lib/queries/safety';
import { tailStrings as S } from '@/i18n/strings/tail';
import { workforceSafetyStrings as W } from '@/i18n/strings/workforce-safety-surface';

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
  text: 'text-muted-foreground',
  dot: 'bg-muted-foreground/60',
};

const SEVERITY_TONE: Record<string, ToneTokens> = {
  critical: {
    border: 'border-danger/40',
    bg: 'bg-danger-subtle',
    text: 'text-danger',
    dot: 'bg-danger',
  },
  high: {
    border: 'border-warning/40',
    bg: 'bg-warning-subtle',
    text: 'text-warning',
    dot: 'bg-warning',
  },
  medium: {
    border: 'border-info/40',
    bg: 'bg-info-subtle',
    text: 'text-info',
    dot: 'bg-info',
  },
  low: LOW_TONE,
};

function severityTone(severity: string): ToneTokens {
  return SEVERITY_TONE[severity.toLowerCase()] ?? LOW_TONE;
}

/**
 * Localize the raw `kind` token returned by /api/v1/mining/incidents to
 * the active locale. Unknown values fall back to a localized placeholder,
 * never the raw English enum token (zero-mix canon).
 */
function incidentKindLabel(kind: string, isSw: boolean): string {
  const map = S.incident.kind;
  const leaf = map[kind.toLowerCase() as keyof typeof map] ?? map.unknown;
  return isSw ? leaf.sw : leaf.en;
}

/** Localize the raw incident `severity` token to the active locale. */
function incidentSeverityLabel(severity: string, isSw: boolean): string {
  const map = S.incident.severity;
  const leaf = map[severity.toLowerCase() as keyof typeof map] ?? map.unknown;
  return isSw ? leaf.sw : leaf.en;
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
 * relative time stamps. ICA equipment-certification statuses render an
 * honest "not yet connected" state until the gateway exposes a real
 * equipment-certification endpoint — never fabricated OK/recert rows.
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
            <Skeleton key={i} className="h-24 rounded-2xl border border-border" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl border border-border" />
      </div>
    );
  }

  if (openQuery.isError) {
    return (
      <div className="rounded-2xl border border-danger/40 bg-danger-subtle p-6 text-sm text-danger">
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
              <p className="text-xs text-muted-foreground">
                {isSw
                  ? `${rows.length} ${S.safetySurface.openCountSuffix.sw}`
                  : `${rows.length} ${S.safetySurface.openCountSuffix.en}`}
              </p>
            </div>
          </header>
          {rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              <ShieldCheck className="mx-auto h-8 w-8 text-success" />
              <p className="mt-3 font-medium text-foreground">
                {isSw ? S.safetySurface.zeroOpen.sw : S.safetySurface.zeroOpen.en}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
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
                        <span className="text-sm font-medium text-foreground">
                          {incidentKindLabel(row.kind, isSw)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-tiny font-medium uppercase tracking-widest ${tone.border} ${tone.bg} ${tone.text}`}
                        >
                          {incidentSeverityLabel(row.severity, isSw)}
                        </span>
                        {row.siteId ? (
                          <span className="font-mono text-tiny text-muted-foreground">
                            {row.siteId}
                          </span>
                        ) : null}
                      </div>
                      {row.description ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {row.description}
                        </p>
                      ) : null}
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
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
            <p className="text-xs text-muted-foreground">
              {isSw ? S.safetySurface.icaCaption.sw : S.safetySurface.icaCaption.en}
            </p>
          </header>
          <div className="px-5 py-10 text-center">
            <HardHat className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <p className="mt-3 text-sm font-medium text-foreground">
              {isSw ? W.safety.icaPendingTitle.sw : W.safety.icaPendingTitle.en}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSw ? W.safety.icaPendingBody.sw : W.safety.icaPendingBody.en}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
