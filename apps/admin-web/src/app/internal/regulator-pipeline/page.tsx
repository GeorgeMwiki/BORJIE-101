import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('regulator-pipeline')!;

interface PipelineItem {
  readonly id: string;
  readonly source: 'Gazette' | 'NEMC' | 'BoT' | 'TMAA';
  readonly title: string;
  readonly stage: 'Ingested' | 'In review' | 'Pushed to corpus';
  readonly age: string;
}

const STAGES: ReadonlyArray<{ readonly id: PipelineItem['stage']; readonly label: string }> = [
  { id: 'Ingested', label: 'Ingested' },
  { id: 'In review', label: 'In review' },
  { id: 'Pushed to corpus', label: 'Pushed to corpus' },
];

const ITEMS: ReadonlyArray<PipelineItem> = [
  { id: 'r1', source: 'Gazette', title: 'GN. 318 — Royalty rate amendment (gold)', stage: 'Ingested', age: '2h' },
  { id: 'r2', source: 'NEMC', title: 'EIA reg.7 — community consent threshold', stage: 'In review', age: '11h' },
  { id: 'r3', source: 'BoT', title: 'Circular 12/2026 — FX repatriation window', stage: 'In review', age: '1d' },
  { id: 'r4', source: 'TMAA', title: 'PML-2026-042 grant notice', stage: 'Pushed to corpus', age: '2d' },
];

function tone(source: PipelineItem['source']) {
  if (source === 'Gazette') return 'info' as const;
  if (source === 'NEMC') return 'success' as const;
  if (source === 'BoT') return 'warn' as const;
  return 'neutral' as const;
}

export default function RegulatorPipelinePage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STAGES.map((stage) => {
          const items = ITEMS.filter((i) => i.stage === stage.id);
          return (
            <section
              key={stage.id}
              className="rounded-lg border border-border bg-surface p-4"
              aria-label={stage.label}
            >
              <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-3">
                {stage.label} ({items.length})
              </h3>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-md border border-border bg-surface-sunken p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <StubBadge tone={tone(item.source)}>{item.source}</StubBadge>
                      <span className="text-xs text-neutral-500">{item.age}</span>
                    </div>
                    <p className="text-sm text-foreground">{item.title}</p>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="text-xs text-neutral-500 italic">Empty</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </ScreenShell>
  );
}
