'use client';

import type { Blocker, ShiftReport } from '@/lib/mocks/site-cockpit';
import { StatusPill } from '@/components/shared/StatusPill';
import { fmtDate, fmtNum } from '@/lib/format';

interface ShiftReportCardProps {
  readonly latest: ShiftReport;
  readonly blockers: ReadonlyArray<Blocker>;
  readonly photos: ReadonlyArray<{ readonly id: string; readonly caption: string }>;
}

const SEVERITY_TO_TONE: Record<Blocker['severity'], 'green' | 'amber' | 'red'> = {
  low: 'green',
  medium: 'amber',
  high: 'red',
};

export function ShiftReportCard({ latest, blockers, photos }: ShiftReportCardProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <article className="rounded-md border border-border bg-surface px-4 py-4 lg:col-span-1">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Latest shift
        </div>
        <div className="mt-1 text-base font-display text-foreground">
          {fmtDate(latest.date)} · {latest.shift} shift
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Tonnes mined" value={fmtNum(latest.tonnesMined)} />
          <Stat label="Head grade" value={`${latest.headGradeGpt.toFixed(2)} g/t`} />
          <Stat label="Grammes" value={fmtNum(latest.grammesRecovered)} />
          <Stat
            label="Variance"
            value={`${latest.varianceVsPlanPct > 0 ? '+' : ''}${latest.varianceVsPlanPct}%`}
          />
        </div>
        <div className="mt-3 text-xs text-neutral-400">
          Supervisor: {latest.supervisor}
        </div>
        <p className="mt-2 text-xs italic text-neutral-300">{latest.notes}</p>
      </article>
      <article className="rounded-md border border-border bg-surface px-4 py-4 lg:col-span-1">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Blockers · {blockers.length}
        </div>
        <ul className="mt-2 space-y-2 text-sm">
          {blockers.map((b) => (
            <li key={b.id} className="flex items-start gap-2">
              <StatusPill tone={SEVERITY_TO_TONE[b.severity]} label={b.severity} />
              <div>
                <div className="text-foreground">{b.title}</div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  owner: {b.owner}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </article>
      <article className="rounded-md border border-border bg-surface px-4 py-4 lg:col-span-1">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Photos · {photos.length}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {photos.map((p) => (
            <div
              key={p.id}
              className="flex aspect-square flex-col justify-end rounded-md border border-border bg-background p-2 text-[10px] text-neutral-400"
            >
              {p.caption}
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-display text-foreground">{value}</div>
    </div>
  );
}
