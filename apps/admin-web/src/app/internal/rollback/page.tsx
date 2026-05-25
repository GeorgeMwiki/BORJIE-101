import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('rollback')!;

interface Promotion {
  readonly id: string;
  readonly kind: 'Prompt' | 'Model' | 'Corpus';
  readonly subject: string;
  readonly promotedAt: string;
  readonly canRevert: boolean;
}

const PROMOTIONS: ReadonlyArray<Promotion> = [
  { id: 'pr_201', kind: 'Prompt', subject: 'Geology v17 → v18', promotedAt: '2026-05-25 09:14', canRevert: true },
  { id: 'pr_200', kind: 'Model', subject: 'Compliance: opus-4-7 swap', promotedAt: '2026-05-24 18:20', canRevert: true },
  { id: 'pr_199', kind: 'Corpus', subject: 'Mining Act 2010 consolidated v7.1', promotedAt: '2026-05-24 10:02', canRevert: true },
  { id: 'pr_198', kind: 'Prompt', subject: 'Sales v3 → v4', promotedAt: '2026-05-20 08:00', canRevert: false },
];

export default function RollbackPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="warn">All reverts emit audit + notify channel</StubBadge>}
    >
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {PROMOTIONS.map((row) => (
          <div key={row.id} className="px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StubBadge tone="info">{row.kind}</StubBadge>
                <span className="text-xs text-neutral-500 tabular-nums">{row.promotedAt}</span>
              </div>
              <p className="text-sm text-foreground">{row.subject}</p>
            </div>
            <button
              type="button"
              disabled={!row.canRevert}
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {row.canRevert ? 'Revert now' : 'Window closed'}
            </button>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}
