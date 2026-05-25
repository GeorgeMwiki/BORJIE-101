import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('decision-log')!;

interface DecisionRow {
  readonly id: string;
  readonly at: string;
  readonly tenant: string;
  readonly junior: string;
  readonly question: string;
  readonly evidenceCount: number;
}

const DECISIONS: ReadonlyArray<DecisionRow> = [
  { id: 'd_2811', at: '2026-05-25 09:14', tenant: 'Geita Dhahabu Mines', junior: 'Geology', question: 'Recommend next drill spacing for Pit 4 (50m vs 25m)?', evidenceCount: 7 },
  { id: 'd_2810', at: '2026-05-25 08:51', tenant: 'Kahama Shaba Holdings', junior: 'Cost Engineer', question: 'Diesel hedging window for Q3 strip-ratio change?', evidenceCount: 5 },
  { id: 'd_2809', at: '2026-05-25 08:30', tenant: 'Mererani Tanzanite Cluster', junior: 'Compliance', question: 'Is NEMC renewal still valid given amended EIA reg.7?', evidenceCount: 11 },
  { id: 'd_2808', at: '2026-05-25 08:02', tenant: 'Kiwira Coltan Cooperative', junior: 'Sales', question: 'Match 2.4t coltan parcel to current open buyer list?', evidenceCount: 4 },
];

export default function DecisionLogPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="info">Evidence chain immutable</StubBadge>}
    >
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {DECISIONS.map((row) => (
          <article key={row.id} className="px-4 py-4">
            <div className="flex items-start justify-between mb-1">
              <p className="text-sm text-foreground">{row.question}</p>
              <span className="text-xs text-neutral-500 tabular-nums">{row.at}</span>
            </div>
            <p className="text-xs text-neutral-500">
              {row.tenant} · {row.junior} · {row.evidenceCount} evidence items
            </p>
            <button type="button" className="mt-2 text-xs text-signal-500 hover:underline">
              Open evidence chain →
            </button>
          </article>
        ))}
      </div>
    </ScreenShell>
  );
}
