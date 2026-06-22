'use client';

import { useMemo } from 'react';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { StatusPill } from '@/components/shared/StatusPill';
import { useLocale, pickByLocale } from '@/lib/locale';
import { formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import type { MaintenanceEvent } from '@/lib/queries/maintenance';
import { fleetMaintenanceStrings as S } from '@/i18n/strings/fleet-maintenance-page';

interface MaintenanceTableProps {
  readonly events: ReadonlyArray<MaintenanceEvent>;
  /** Seeded by the server-resolved session so SSR + first paint agree. */
  readonly locale?: Locale;
}

interface AssetGroup {
  readonly assetId: string;
  readonly rows: ReadonlyArray<MaintenanceEvent>;
}

function groupByAsset(events: ReadonlyArray<MaintenanceEvent>): ReadonlyArray<AssetGroup> {
  const map = new Map<string, MaintenanceEvent[]>();
  for (const event of events) {
    const list = map.get(event.assetId);
    map.set(event.assetId, list ? [...list, event] : [event]);
  }
  return Array.from(map.entries()).map(([assetId, rows]) => ({ assetId, rows }));
}

function durationLabel(event: MaintenanceEvent): string {
  if (event.downtimeHours) {
    return `${Number(event.downtimeHours).toFixed(1)}h`;
  }
  if (event.startedAt && event.completedAt) {
    const ms = new Date(event.completedAt).getTime() - new Date(event.startedAt).getTime();
    return `${(ms / 3_600_000).toFixed(1)}h`;
  }
  return '—';
}

function statusTone(status: MaintenanceEvent['status']): 'green' | 'amber' | 'red' | 'neutral' {
  if (status === 'completed') return 'green';
  if (status === 'in_progress') return 'amber';
  if (status === 'cancelled') return 'neutral';
  return 'red';
}

interface PredictiveFlag {
  readonly tone: 'amber' | 'red' | 'neutral';
  readonly label: string;
}

const DUE_SOON_DAYS = 7;
const SERVICE_INTERVAL_DAYS = 30;

/**
 * Flag the last completed scheduled service for each row. If the next
 * service window (createdAt + interval) is within DUE_SOON_DAYS we
 * show "due soon"; if it has passed we show "overdue".
 */
function predictive(event: MaintenanceEvent, locale: Locale): PredictiveFlag {
  if (event.status !== 'completed' || event.kind !== 'scheduled_service') {
    return { tone: 'neutral', label: '—' };
  }
  const completedAt = event.completedAt ?? event.createdAt;
  const nextDue = new Date(completedAt).getTime() + SERVICE_INTERVAL_DAYS * 86_400_000;
  const days = (nextDue - Date.now()) / 86_400_000;
  if (days < 0) {
    return { tone: 'red', label: pickByLocale(locale, S.flagOverdue) };
  }
  if (days < DUE_SOON_DAYS) {
    return { tone: 'amber', label: pickByLocale(locale, S.flagDueSoon) };
  }
  return { tone: 'neutral', label: '—' };
}

export function MaintenanceTable({ events, locale: seeded }: MaintenanceTableProps) {
  const locale = useLocale(seeded);
  const groups = useMemo(() => groupByAsset(events), [events]);

  if (groups.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-xs text-muted-foreground">
        {pickByLocale(locale, S.tableEmpty)}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{pickByLocale(locale, S.colAsset)}</TableHead>
          <TableHead>{pickByLocale(locale, S.colKind)}</TableHead>
          <TableHead>{pickByLocale(locale, S.colStarted)}</TableHead>
          <TableHead>{pickByLocale(locale, S.colDuration)}</TableHead>
          <TableHead>{pickByLocale(locale, S.colStatus)}</TableHead>
          <TableHead className="text-right">{pickByLocale(locale, S.colCost)}</TableHead>
          <TableHead>{pickByLocale(locale, S.colPredictive)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <GroupRows key={group.assetId} group={group} locale={locale} />
        ))}
      </TableBody>
    </Table>
  );
}

function GroupRows({ group, locale }: { readonly group: AssetGroup; readonly locale: Locale }) {
  const countLabel = pickByLocale(
    locale,
    group.rows.length === 1 ? S.eventCountOne : S.eventCountMany,
  );
  return (
    <>
      <TableRow className="bg-background/40">
        <TableCell colSpan={7} className="text-badge font-semibold text-foreground">
          {group.assetId}
          <span className="ml-2 text-muted-foreground">
            {group.rows.length} {countLabel}
          </span>
        </TableCell>
      </TableRow>
      {group.rows.map((row) => {
        const flag = predictive(row, locale);
        return (
          <TableRow key={row.id}>
            <TableCell className="text-muted-foreground">{row.assetId}</TableCell>
            <TableCell className="text-foreground">{row.kind}</TableCell>
            <TableCell className="text-muted-foreground">
              {(row.startedAt ?? row.createdAt).slice(0, 10)}
            </TableCell>
            <TableCell className="text-foreground">{durationLabel(row)}</TableCell>
            <TableCell>
              <StatusPill tone={statusTone(row.status)} label={row.status} />
            </TableCell>
            <TableCell className="text-right text-foreground">
              {row.costTzs ? formatMoney(Number(row.costTzs), LAUNCH_CURRENCY, locale) : '—'}
            </TableCell>
            <TableCell>
              <StatusPill tone={flag.tone} label={flag.label} />
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
