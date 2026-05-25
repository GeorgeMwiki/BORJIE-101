import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_JUNIORS } from '@/lib/mocks/juniors';
import { JuniorActions } from '@/components/internal/juniors/JuniorActions';

const SCREEN = findScreen('juniors')!;

function tone(status: string) {
  if (status === 'Active') return 'success' as const;
  if (status === 'Canary') return 'info' as const;
  return 'danger' as const;
}

export default function JuniorsPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <button
          type="button"
          className="rounded-md bg-signal-500 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-signal-500/90"
        >
          New junior template
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {MOCK_JUNIORS.map((junior) => (
          <article
            key={junior.id}
            className="rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-base font-display text-foreground">{junior.name}</h3>
              <StubBadge tone={tone(junior.status)}>{junior.status}</StubBadge>
            </div>
            <p className="text-xs text-neutral-400 mb-3">{junior.role}</p>
            <p className="text-xs text-neutral-500 mb-4 font-mono">{junior.model}</p>
            <div className="flex gap-2">
              <JuniorActions junior={junior} />
            </div>
          </article>
        ))}
      </div>
    </ScreenShell>
  );
}
