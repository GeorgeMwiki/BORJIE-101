import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('analytics')!;

interface FunnelStep {
  readonly label: string;
  readonly count: number;
}

const FUNNEL: ReadonlyArray<FunnelStep> = [
  { label: 'Sign-up started', count: 412 },
  { label: 'Tenant created', count: 286 },
  { label: 'First operator invited', count: 218 },
  { label: 'First decision logged', count: 174 },
  { label: 'Paid plan activated', count: 96 },
];

interface Cohort {
  readonly month: string;
  readonly active: number;
  readonly churned: number;
}

const COHORTS: ReadonlyArray<Cohort> = [
  { month: '2026-01', active: 38, churned: 4 },
  { month: '2026-02', active: 51, churned: 6 },
  { month: '2026-03', active: 62, churned: 3 },
  { month: '2026-04', active: 74, churned: 5 },
  { month: '2026-05', active: 81, churned: 2 },
];

export default function AnalyticsPage(): JSX.Element {
  const max = FUNNEL[0]?.count ?? 1;
  return (
    <ScreenShell screen={SCREEN}>
      <section className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">Activation funnel (90d)</h3>
        <ul className="space-y-2">
          {FUNNEL.map((step) => {
            const pct = Math.round((step.count / max) * 100);
            return (
              <li key={step.label} className="flex items-center gap-4">
                <span className="w-48 text-sm text-neutral-300 shrink-0">{step.label}</span>
                <div className="flex-1 h-2 rounded-full bg-surface-sunken overflow-hidden">
                  <div
                    className="h-full bg-signal-500"
                    style={{ width: `${pct}%` }}
                    aria-label={`${pct} percent`}
                  />
                </div>
                <span className="text-sm text-neutral-300 tabular-nums w-12 text-right">
                  {step.count}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">Cohort retention</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="py-2 font-medium">Cohort</th>
              <th className="py-2 font-medium text-right">Active</th>
              <th className="py-2 font-medium text-right">Churned</th>
              <th className="py-2 font-medium text-right">Retention</th>
            </tr>
          </thead>
          <tbody>
            {COHORTS.map((row) => {
              const total = row.active + row.churned;
              const retention = Math.round((row.active / total) * 100);
              return (
                <tr key={row.month} className="border-t border-border">
                  <td className="py-2 text-foreground">{row.month}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-300">{row.active}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-300">{row.churned}</td>
                  <td className="py-2 text-right tabular-nums text-signal-500">{retention}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </ScreenShell>
  );
}
