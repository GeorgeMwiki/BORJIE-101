import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { AbTestActions } from '@/components/internal/ab-tests/AbTestActions';

const SCREEN = findScreen('ab-tests')!;

interface ExperimentRow {
  readonly id: string;
  readonly variant: string;
  readonly junior: string;
  readonly goldenScore: number;
  readonly canaryTenants: number;
  readonly status: 'Running' | 'Won' | 'Lost';
}

const EXPERIMENTS: ReadonlyArray<ExperimentRow> = [
  { id: 'ab_geo_v18', variant: 'geology v18-rc vs v17', junior: 'Geology', goldenScore: 0.871, canaryTenants: 3, status: 'Running' },
  { id: 'ab_sales_v5', variant: 'sales v5-rc vs v4', junior: 'Sales', goldenScore: 0.701, canaryTenants: 2, status: 'Running' },
  { id: 'ab_comp_v10', variant: 'compliance v10-rc vs v9', junior: 'Compliance', goldenScore: 0.823, canaryTenants: 4, status: 'Won' },
  { id: 'ab_fx_v12', variant: 'fx v12-rc vs v11', junior: 'FX / Treasury', goldenScore: 0.794, canaryTenants: 1, status: 'Lost' },
];

function tone(status: ExperimentRow['status']) {
  if (status === 'Won') return 'success' as const;
  if (status === 'Lost') return 'danger' as const;
  return 'info' as const;
}

export default function AbTestsPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <button
          type="button"
          disabled
          title="Experiment creation lands once the A/B framework router is mounted (SCRUB-4: needs POST /internal/ab-tests)"
          className="rounded-md bg-signal-500/40 px-3 py-1.5 text-xs font-medium text-primary-foreground opacity-50 cursor-not-allowed"
        >
          New experiment
        </button>
      }
    >
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Variant</th>
              <th className="px-4 py-3 font-medium">Junior</th>
              <th className="px-4 py-3 font-medium text-right">Golden score</th>
              <th className="px-4 py-3 font-medium text-right">Canary tenants</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {EXPERIMENTS.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{row.variant}</td>
                <td className="px-4 py-3 text-neutral-300">{row.junior}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {row.goldenScore.toFixed(3)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {row.canaryTenants}
                </td>
                <td className="px-4 py-3">
                  <StubBadge tone={tone(row.status)}>{row.status}</StubBadge>
                </td>
                <td className="px-4 py-3 text-right">
                  {row.status === 'Won' ? (
                    <AbTestActions id={row.id} variant={row.variant} />
                  ) : (
                    <span className="text-xs text-neutral-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
