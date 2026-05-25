import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('compliance-queue')!;

interface QueueItem {
  readonly id: string;
  readonly tenant: string;
  readonly reason: string;
  readonly waitingHours: number;
  readonly severity: 'Low' | 'Medium' | 'High';
}

const ITEMS: ReadonlyArray<QueueItem> = [
  { id: 'q1', tenant: 'Mererani Tanzanite Cluster', reason: 'NEMC renewal expiring in 14 days; auto-warn fired', waitingHours: 2, severity: 'Medium' },
  { id: 'q2', tenant: 'Geita Dhahabu Mines', reason: 'Royalty calculation diverges from Mining Act s.42 by 0.4%', waitingHours: 6, severity: 'High' },
  { id: 'q3', tenant: 'Kiwira Coltan Cooperative', reason: 'Local content reg.18 documentation incomplete', waitingHours: 18, severity: 'Low' },
  { id: 'q4', tenant: 'Kabanga Nickel Society', reason: 'EIA reg.7 community consent threshold not met', waitingHours: 26, severity: 'High' },
];

function tone(sev: QueueItem['severity']) {
  if (sev === 'High') return 'danger' as const;
  if (sev === 'Medium') return 'warn' as const;
  return 'neutral' as const;
}

export default function ComplianceQueuePage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="info">{ITEMS.length} awaiting human approval</StubBadge>}
    >
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {ITEMS.map((item) => (
          <article key={item.id} className="px-4 py-4">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <p className="text-sm text-foreground">{item.tenant}</p>
                <p className="text-xs text-neutral-400">{item.reason}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StubBadge tone={tone(item.severity)}>{item.severity}</StubBadge>
                <span className="text-xs text-neutral-500">{item.waitingHours}h</span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                className="rounded-md bg-success/20 px-3 py-1 text-xs font-medium text-success hover:bg-success/30"
              >
                Approve
              </button>
              <button
                type="button"
                className="rounded-md bg-danger/20 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/30"
              >
                Reject
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-surface-sunken"
              >
                Request more evidence
              </button>
            </div>
          </article>
        ))}
      </div>
    </ScreenShell>
  );
}
