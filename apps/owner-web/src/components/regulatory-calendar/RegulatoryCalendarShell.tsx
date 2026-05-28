'use client';

import { useMemo, useState } from 'react';
import { CalendarClock, Scale } from 'lucide-react';
import {
  useRegulatoryFilings,
  type RegulatoryFilingRow,
} from '@/lib/queries/ops';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';

const REGULATOR_OPTIONS: ReadonlyArray<{
  readonly value: string;
  readonly labelEn: string;
}> = [
  { value: '', labelEn: 'All regulators' },
  { value: 'mining_commission', labelEn: 'Mining Commission' },
  { value: 'tra', labelEn: 'TRA' },
  { value: 'nemc', labelEn: 'NEMC' },
  { value: 'bot', labelEn: 'BoT' },
  { value: 'brela', labelEn: 'BRELA' },
  { value: 'osha', labelEn: 'OSHA' },
  { value: 'tbs', labelEn: 'TBS' },
  { value: 'tcra', labelEn: 'TCRA' },
  { value: 'lhrc', labelEn: 'LHRC' },
];

const STATUS_TONE: Record<string, string> = {
  scheduled: 'border-info/40 bg-info/5 text-info',
  drafting: 'border-warning/40 bg-warning/5 text-warning',
  submitted: 'border-signal-500/40 bg-signal-500/5 text-signal-500',
  accepted: 'border-success/40 bg-success/5 text-success',
  rejected: 'border-destructive/40 bg-destructive/5 text-destructive',
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export function RegulatoryCalendarShell() {
  const [regulator, setRegulator] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data, isLoading } = useRegulatoryFilings({
    regulator: regulator || undefined,
    status: statusFilter || undefined,
  });
  const filings = data?.data?.filings ?? [];

  const tiles: ReadonlyArray<MetricTile> = useMemo(() => {
    const total = filings.length;
    const overdue = filings.filter((f) => f.status === 'overdue').length;
    const submitted = filings.filter(
      (f) => f.status === 'submitted' || f.status === 'accepted',
    ).length;
    const scheduled = filings.filter((f) => f.status === 'scheduled').length;
    return [
      { label: 'Filings', value: String(total), icon: Scale },
      {
        label: 'Overdue',
        value: String(overdue),
        tone: overdue > 0 ? 'danger' : 'default',
      },
      { label: 'Submitted', value: String(submitted), tone: 'success' },
      { label: 'Scheduled', value: String(scheduled) },
    ];
  }, [filings]);

  const grouped = useMemo(() => groupByMonth(filings), [filings]);

  return (
    <section className="flex flex-col gap-6">
      <MetricStrip tiles={tiles} />

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={regulator}
          onChange={(e) => setRegulator(e.target.value)}
          className="rounded-xl border border-border bg-surface/40 px-3 py-2 text-sm text-foreground"
        >
          {REGULATOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.labelEn}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-border bg-surface/40 px-3 py-2 text-sm text-foreground"
        >
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="drafting">Drafting</option>
          <option value="submitted">Submitted</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-neutral-500">Loading filings</p>
      ) : filings.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center text-sm text-neutral-400">
          No filings calendared yet. Ask the brain to add the next one.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(({ key, label, items }) => (
            <div key={key} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <CalendarClock className="h-4 w-4 text-neutral-500" />
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                  {label}
                </h3>
                <div className="flex-1 border-t border-dashed border-border/60" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((f) => (
                  <FilingCard key={f.id} filing={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FilingCard({ filing }: { readonly filing: RegulatoryFilingRow }) {
  const dueDate = new Date(filing.dueAt);
  const daysRemaining = Math.ceil(
    (dueDate.getTime() - Date.now()) / 86_400_000,
  );
  const tone =
    STATUS_TONE[filing.status] ?? 'border-border bg-surface text-neutral-300';
  return (
    <article className={`flex flex-col gap-2 rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
          {filing.regulator.replace(/_/g, ' ')}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.12em]">
          {filing.status}
        </span>
      </div>
      <p className="text-sm font-medium text-foreground">{filing.filingType}</p>
      <p className="text-xs text-neutral-400">
        Due {dueDate.toLocaleDateString()} ·{' '}
        {daysRemaining > 0
          ? `${daysRemaining} days`
          : daysRemaining === 0
            ? 'today'
            : `${Math.abs(daysRemaining)} days late`}
      </p>
      {filing.referenceNo ? (
        <p className="text-[10px] font-mono text-neutral-500">
          ref {filing.referenceNo}
        </p>
      ) : null}
    </article>
  );
}

function groupByMonth(filings: ReadonlyArray<RegulatoryFilingRow>): ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly items: ReadonlyArray<RegulatoryFilingRow>;
}> {
  const buckets = new Map<string, RegulatoryFilingRow[]>();
  for (const f of filings) {
    const d = new Date(f.dueAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const existing = buckets.get(key);
    if (existing) existing.push(f);
    else buckets.set(key, [f]);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const [year, month] = key.split('-');
      const label = new Date(
        Number(year),
        Number(month) - 1,
        1,
      ).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
      return { key, label, items };
    });
}
