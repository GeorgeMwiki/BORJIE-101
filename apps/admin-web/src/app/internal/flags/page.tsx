import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { MOCK_FLAGS } from '@/lib/internal/mock-data';

const SCREEN = findScreen('flags')!;

export default function FlagsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {MOCK_FLAGS.map((flag) => (
          <div key={flag.key} className="px-4 py-4 flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-mono text-foreground">{flag.key}</p>
              <p className="text-xs text-neutral-400">{flag.description}</p>
            </div>
            <div className="flex items-center gap-4 w-72">
              <div className="flex-1">
                <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden">
                  <div
                    className="h-full bg-signal-500"
                    style={{ width: `${flag.rolloutPct}%` }}
                    aria-label={`Rollout ${flag.rolloutPct} percent`}
                  />
                </div>
              </div>
              <span className="text-xs text-neutral-300 tabular-nums w-10 text-right">
                {flag.rolloutPct}%
              </span>
              <button
                type="button"
                className="text-xs text-signal-500 hover:underline shrink-0"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </ScreenShell>
  );
}
