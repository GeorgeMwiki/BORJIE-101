import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('slo')!;

interface SloRow {
  readonly id: string;
  readonly tenant: string;
  readonly junior: string;
  readonly p95ms: number;
  readonly errorPct: number;
  readonly spendUsd: number;
  readonly burnPct: number;
}

const ROWS: ReadonlyArray<SloRow> = [
  { id: 's1', tenant: 'Geita Dhahabu Mines', junior: 'Geology', p95ms: 1280, errorPct: 0.4, spendUsd: 482.1, burnPct: 21 },
  { id: 's2', tenant: 'Kahama Shaba Holdings', junior: 'Cost Engineer', p95ms: 980, errorPct: 0.1, spendUsd: 312.5, burnPct: 14 },
  { id: 's3', tenant: 'Mererani Tanzanite Cluster', junior: 'Compliance', p95ms: 2840, errorPct: 1.8, spendUsd: 198.2, burnPct: 78 },
  { id: 's4', tenant: 'Kiwira Coltan Cooperative', junior: 'Sales', p95ms: 410, errorPct: 0.0, spendUsd: 64.8, burnPct: 9 },
];

function burnTone(pct: number) {
  if (pct >= 75) return 'danger' as const;
  if (pct >= 50) return 'warn' as const;
  return 'success' as const;
}

export default function SloPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="platform-card">
          <p className="platform-card-title">Tenants in SLO</p>
          <p className="platform-card-value">3 / 4</p>
        </div>
        <div className="platform-card">
          <p className="platform-card-title">Errors (24h)</p>
          <p className="platform-card-value">0.6%</p>
        </div>
        <div className="platform-card">
          <p className="platform-card-title">Spend (mo)</p>
          <p className="platform-card-value">$1,057.60</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Junior</th>
              <th className="px-4 py-3 font-medium text-right">p95</th>
              <th className="px-4 py-3 font-medium text-right">Error %</th>
              <th className="px-4 py-3 font-medium text-right">Spend</th>
              <th className="px-4 py-3 font-medium">Burn</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-foreground">{row.tenant}</td>
                <td className="px-4 py-3 text-neutral-300">{row.junior}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {row.p95ms} ms
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  {row.errorPct.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-300">
                  ${row.spendUsd.toFixed(2)}
                </td>
                <td className="px-4 py-3">
                  <StubBadge tone={burnTone(row.burnPct)}>{row.burnPct}%</StubBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ScreenShell>
  );
}
