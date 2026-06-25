'use client';

import { useMemo } from 'react';
import { AlertOctagon, Briefcase, HardHat, Users } from 'lucide-react';
import { Skeleton } from '@borjie/design-system';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { useHeadcount } from '@/lib/queries/people';
import { useIncidents } from '@/lib/queries/safety';
import { useShiftRoster, type RosterWorker } from '@/lib/queries/shift-planner';
import { tailStrings as S } from '@/i18n/strings/tail';
import { workforceSafetyStrings as W } from '@/i18n/strings/workforce-safety-surface';

interface PeopleSurfaceProps {
  readonly locale?: 'sw' | 'en';
}

/**
 * Localize the raw incident `kind` token to the active locale. Shares the
 * canonical `S.incident.kind` map with the safety surface so the same enum
 * value never renders two ways. Unknown values fall back to a localized
 * placeholder, never the raw English token (zero-mix canon).
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

/**
 * A worker is "on shift" when one of their trailing-72h shift records is
 * currently in progress (started, not yet ended). Derived from the REAL
 * roster projection — never a hardcoded status.
 */
function isWorkerOnShift(worker: RosterWorker, nowMs: number): boolean {
  return worker.last72hShifts.some((shift) => {
    const start = Date.parse(shift.startISO);
    const end = Date.parse(shift.endISO);
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return start <= nowMs && nowMs < end;
  });
}

/**
 * People surface for the owner cockpit.
 *
 * Pulls live headcount from `/api/v1/mining/attendance/headcount`, the
 * live workforce roster from `/api/v1/mining/shift-planner/roster`, and
 * live incidents from `/api/v1/mining/incidents`. Every figure and row is
 * sourced from the gateway — no fabricated supervisors, no invented fuel
 * trend. When a feed is empty the surface renders an honest empty state.
 */
export function PeopleSurface({ locale = 'en' }: PeopleSurfaceProps): JSX.Element {
  const isSw = locale === 'sw';
  const headcount = useHeadcount();
  const incidents = useIncidents({ limit: 50 });
  const roster = useShiftRoster();

  const onShift = useMemo(() => {
    const rows = headcount.data?.perSite ?? [];
    return rows.reduce((acc, row) => acc + row.headcount, 0);
  }, [headcount.data]);

  const workers = useMemo<readonly RosterWorker[]>(
    () => roster.data?.workers ?? [],
    [roster.data],
  );

  const openIncidents = useMemo(
    () =>
      (incidents.data ?? []).filter((row) => row.status === 'open').length,
    [incidents.data],
  );

  const metrics = useMemo<readonly MetricTile[]>(
    () => [
      {
        label: isSw ? S.peopleSurface.onShiftLabel.sw : S.peopleSurface.onShiftLabel.en,
        value: String(onShift),
        sub: isSw ? S.peopleSurface.onShiftSub.sw : S.peopleSurface.onShiftSub.en,
        icon: Users,
        tone: 'default' as const,
      },
      {
        label: isSw ? W.people.rosterLabel.sw : W.people.rosterLabel.en,
        value: String(workers.length),
        sub: isSw ? W.people.rosterSub.sw : W.people.rosterSub.en,
        icon: HardHat,
      },
      {
        label: isSw
          ? S.peopleSurface.openIncidentsLabel.sw
          : S.peopleSurface.openIncidentsLabel.en,
        value: String(openIncidents),
        sub: isSw
          ? S.peopleSurface.openIncidentsSub.sw
          : S.peopleSurface.openIncidentsSub.en,
        icon: AlertOctagon,
        tone: openIncidents > 0 ? ('warning' as const) : ('success' as const),
      },
    ],
    [onShift, openIncidents, workers.length, isSw],
  );

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={3} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40 lg:col-span-2">
          <header className="border-b border-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Briefcase className="h-4 w-4 text-signal-500" />
              {isSw ? W.people.rosterHeading.sw : W.people.rosterHeading.en}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isSw ? W.people.rosterCaption.sw : W.people.rosterCaption.en}
            </p>
          </header>
          {roster.isPending ? (
            <div className="space-y-2 px-5 py-4">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
            </div>
          ) : roster.isError ? (
            <div className="px-5 py-6 text-xs text-muted-foreground">
              {isSw ? W.people.rosterLoadError.sw : W.people.rosterLoadError.en}
            </div>
          ) : workers.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <HardHat className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">
                {isSw ? W.people.rosterEmptyTitle.sw : W.people.rosterEmptyTitle.en}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isSw ? W.people.rosterEmptyBody.sw : W.people.rosterEmptyBody.en}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {workers.map((worker) => {
                const nowMs = Date.now();
                const onShiftNow = isWorkerOnShift(worker, nowMs);
                const certCount = worker.certifications.length;
                const certWord =
                  certCount === 1
                    ? isSw
                      ? W.people.certSuffixOne.sw
                      : W.people.certSuffixOne.en
                    : isSw
                      ? W.people.certSuffix.sw
                      : W.people.certSuffix.en;
                return (
                  <li
                    key={worker.id}
                    className="flex items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {worker.name}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {certCount} {certWord}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-badge font-medium ${
                        onShiftNow
                          ? 'border-success/40 bg-success-subtle text-success'
                          : 'border-border bg-surface text-muted-foreground'
                      }`}
                    >
                      {onShiftNow
                        ? isSw
                          ? W.people.onShiftBadge.sw
                          : W.people.onShiftBadge.en
                        : isSw
                          ? W.people.offShiftBadge.sw
                          : W.people.offShiftBadge.en}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
            <header className="border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertOctagon className="h-4 w-4 text-warning" />
                {isSw
                  ? S.peopleSurface.incidentFeedHeading.sw
                  : S.peopleSurface.incidentFeedHeading.en}
              </h2>
            </header>
            {incidents.isPending ? (
              <div className="space-y-2 px-5 py-4">
                <Skeleton className="h-8 rounded-lg" />
                <Skeleton className="h-8 rounded-lg" />
              </div>
            ) : (incidents.data ?? []).length === 0 ? (
              <div className="px-5 py-6 text-xs text-muted-foreground">
                {isSw ? S.peopleSurface.noIncidents.sw : S.peopleSurface.noIncidents.en}
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {(incidents.data ?? []).slice(0, 5).map((row) => (
                  <li key={row.id} className="px-5 py-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">
                        {incidentKindLabel(row.kind, isSw)}
                      </span>
                      <span className="font-mono uppercase text-warning">
                        {incidentSeverityLabel(row.severity, isSw)}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {row.siteId ??
                        (isSw
                          ? S.peopleSurface.unassigned.sw
                          : S.peopleSurface.unassigned.en)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
