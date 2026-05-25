import { ScreenHeader } from '@/components/ScreenHeader';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { SAFETY_MOCK } from '@/lib/mocks/commercial';

const TONE: Record<string, 'green' | 'amber' | 'red'> = {
  green: 'green',
  amber: 'amber',
  red: 'red',
};

/**
 * O-W-15 — Safety & EHS. Polished stub: critical-controls register +
 * recent incidents. Working action is "Open inspection" per amber/red
 * control.
 */
export default function SafetyPage() {
  return (
    <>
      <ScreenHeader slug="safety" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <SectionCard title="Critical controls">
          <ul className="space-y-2 text-sm">
            {SAFETY_MOCK.criticalControls.map((c) => (
              <li key={`${c.control}-${c.site}`} className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-foreground">{c.control}</div>
                  <div className="text-xs text-neutral-500">{c.site}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={TONE[c.status] ?? 'amber'} label={c.status} />
                  {c.status !== 'green' ? (
                    <button
                      type="button"
                      className="rounded-md border border-warning bg-warning-subtle/30 px-2 py-0.5 text-xs text-warning hover:bg-warning-subtle/50"
                    >
                      Open inspection
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Recent incidents">
          <ul className="space-y-2 text-sm">
            {SAFETY_MOCK.recentIncidents.map((i) => (
              <li key={i.date} className="rounded-md border border-border bg-background px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-foreground">
                    {i.date} · {i.site}
                  </span>
                  <span className="text-xs text-neutral-400">{i.severity}</span>
                </div>
                <div className="mt-1 text-xs italic text-neutral-300">{i.note}</div>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
