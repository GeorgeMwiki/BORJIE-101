'use client';

import { useMemo } from 'react';
import { StatusPill } from '@/components/shared/StatusPill';
import type { MaintenanceEvent } from '@/lib/queries/maintenance';

interface MaintenanceTableProps {
  readonly events: ReadonlyArray<MaintenanceEvent>;
}

interface AssetGroup {
  readonly assetId: string;
  readonly rows: ReadonlyArray<MaintenanceEvent>;
}

function groupByAsset(events: ReadonlyArray<MaintenanceEvent>): ReadonlyArray<AssetGroup> {
  const map = new Map<string, MaintenanceEvent[]>();
  for (const event of events) {
    const list = map.get(event.assetId);
    if (list) {
      map.set(event.assetId, [...list, event]);
    } else {
      map.set(event.assetId, [event]);
    }
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
function predictive(event: MaintenanceEvent): PredictiveFlag {
  if (event.status !== 'completed' || event.kind !== 'scheduled_service') {
    return { tone: 'neutral', label: '—' };
  }
  const completedAt = event.completedAt ?? event.createdAt;
  const nextDue = new Date(completedAt).getTime() + SERVICE_INTERVAL_DAYS * 86_400_000;
  const now = Date.now();
  const days = (nextDue - now) / 86_400_000;
  if (days < 0) return { tone: 'red', label: 'overdue / imechelewa' };
  if (days < DUE_SOON_DAYS) return { tone: 'amber', label: 'due soon / hivi karibuni' };
  return { tone: 'neutral', label: '—' };
}

export function MaintenanceTable({ events }: MaintenanceTableProps) {
  const groups = useMemo(() => groupByAsset(events), [events]);

  if (groups.length === 0) {
    return (
      <p className="px-5 py-6 text-center text-xs text-neutral-500">
        No maintenance events in the last 30 days. / Hakuna matengenezo siku 30 zilizopita.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-surface/60 text-left text-neutral-400">
          <tr>
            <th className="px-3 py-2 font-medium">Asset / Mali</th>
            <th className="px-3 py-2 font-medium">Kind / Aina</th>
            <th className="px-3 py-2 font-medium">Started / Imeanza</th>
            <th className="px-3 py-2 font-medium">Duration / Muda</th>
            <th className="px-3 py-2 font-medium">Status / Hali</th>
            <th className="px-3 py-2 font-medium">Cost (TZS)</th>
            <th className="px-3 py-2 font-medium">Predictive</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRows key={group.assetId} group={group} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ group }: { readonly group: AssetGroup }) {
  return (
    <>
      <tr className="border-t border-border bg-background/40">
        <td colSpan={7} className="px-3 py-1.5 text-[11px] font-semibold text-foreground">
          {group.assetId}
          <span className="ml-2 text-neutral-500">
            {group.rows.length} event{group.rows.length === 1 ? '' : 's'}
          </span>
        </td>
      </tr>
      {group.rows.map((row) => {
        const flag = predictive(row);
        return (
          <tr key={row.id} className="border-t border-border">
            <td className="px-3 py-2 text-neutral-400">{row.assetId}</td>
            <td className="px-3 py-2 text-foreground">{row.kind}</td>
            <td className="px-3 py-2 text-neutral-400">
              {(row.startedAt ?? row.createdAt).slice(0, 10)}
            </td>
            <td className="px-3 py-2 text-foreground">{durationLabel(row)}</td>
            <td className="px-3 py-2">
              <StatusPill tone={statusTone(row.status)} label={row.status} />
            </td>
            <td className="px-3 py-2 text-right text-foreground">
              {row.costTzs ? Number(row.costTzs).toLocaleString() : '—'}
            </td>
            <td className="px-3 py-2">
              <StatusPill tone={flag.tone} label={flag.label} />
            </td>
          </tr>
        );
      })}
    </>
  );
}
