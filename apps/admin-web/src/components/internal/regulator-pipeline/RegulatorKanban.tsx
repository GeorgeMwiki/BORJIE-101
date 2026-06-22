'use client';

import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Skeleton, Alert, Empty } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { useMoveRegulatorChange, useRegulatorPipelineQuery } from '@/lib/internal/queries/regulator-pipeline';
import type { CitationSource, RegulatorChange, RegulatorStage } from '@/lib/internal/types';

const STAGES: ReadonlyArray<{ readonly id: RegulatorStage; readonly label: { en: string; sw: string } }> = [
  { id: 'incoming', label: { en: 'Incoming', sw: 'Zinazoingia' } },
  { id: 'reviewing', label: { en: 'Reviewing', sw: 'Zinazokaguliwa' } },
  { id: 'approved', label: { en: 'Approved', sw: 'Zilizoidhinishwa' } },
  { id: 'pushed', label: { en: 'Pushed to corpus', sw: 'Zilizosukumwa kwenye kundi' } },
];

const S = {
  loading: { en: 'Loading pipeline…', sw: 'Inapakia mtiririko…' },
  emptyTitle: { en: 'No regulatory changes', sw: 'Hakuna mabadiliko ya kisheria' },
  emptyBody: {
    en: 'Incoming gazette, NEMC, and BoT changes appear here as they are ingested.',
    sw: 'Mabadiliko yanayoingia ya gazeti, NEMC, na BoT huonekana hapa yanapopokelewa.',
  },
  empty: { en: 'Empty', sw: 'Tupu' },
  moveTo: { en: 'Move to stage', sw: 'Hamishia hatua' },
} as const;

function sourceTone(source: CitationSource): 'info' | 'success' | 'warn' | 'neutral' {
  if (source === 'Gazette') return 'info';
  if (source === 'NEMC') return 'success';
  if (source === 'BoT') return 'warn';
  return 'neutral';
}

export function RegulatorKanban({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useRegulatorPipelineQuery();
  const move = useMoveRegulatorChange();
  const [toast, setToast] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState<RegulatorStage | null>(null);

  if (query.isPending) {
    return (
      <Skeleton
        className="h-72 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{query.error.message}</Alert>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Empty
          icon={<ClipboardList className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'live'} />
      </div>
    );
  }

  const moveTo = (id: string, stage: RegulatorStage) => {
    const row = rows.find((r) => r.id === id);
    if (!row || row.stage === stage) return;
    move.mutate(
      { id, stage },
      {
        onSuccess: () => setToast(`${row.title} → ${stage}`),
        onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
      },
    );
  };

  const onDragStart = (e: React.DragEvent<HTMLLIElement>, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = (stage: RegulatorStage, e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDraggingOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    moveTo(id, stage);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {STAGES.map((stage) => {
          const items = rows.filter((r) => r.stage === stage.id);
          return (
            <section
              key={stage.id}
              aria-label={pickByLocale(locale, stage.label)}
              onDragOver={(e) => {
                e.preventDefault();
                setDraggingOver(stage.id);
              }}
              onDragLeave={() => setDraggingOver((s) => (s === stage.id ? null : s))}
              onDrop={(e) => onDrop(stage.id, e)}
              className={`rounded-lg border bg-surface p-4 min-h-[18rem] transition-colors ${
                draggingOver === stage.id ? 'border-signal-500' : 'border-border'
              }`}
            >
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center justify-between">
                <span>{pickByLocale(locale, stage.label)}</span>
                <span className="text-muted-foreground tabular-nums">{items.length}</span>
              </h3>
              <ul className="space-y-2">
                {items.length === 0 ? (
                  <li className="text-xs text-muted-foreground italic">
                    {pickByLocale(locale, S.empty)}
                  </li>
                ) : (
                  items.map((item) => (
                    <KanbanCard
                      key={item.id}
                      item={item}
                      locale={locale}
                      busy={move.isPending}
                      onDragStart={onDragStart}
                      onMoveTo={moveTo}
                    />
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'live'} />
      <Toast message={toast} tone={move.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}

interface KanbanCardProps {
  readonly item: RegulatorChange;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly onDragStart: (e: React.DragEvent<HTMLLIElement>, id: string) => void;
  readonly onMoveTo: (id: string, stage: RegulatorStage) => void;
}

function KanbanCard({ item, locale, busy, onDragStart, onMoveTo }: KanbanCardProps): JSX.Element {
  return (
    <li
      draggable
      onDragStart={(e) => onDragStart(e, item.id)}
      className="rounded-md border border-border bg-surface-sunken p-3 cursor-grab active:cursor-grabbing focus-within:ring-2 focus-within:ring-signal-500/40"
    >
      <div className="flex items-center justify-between mb-1">
        <StubBadge tone={sourceTone(item.source)}>{item.source}</StubBadge>
        <span className="text-xs text-muted-foreground">{item.ageHours}h</span>
      </div>
      <p className="text-sm text-foreground">{item.title}</p>
      {/* Keyboard-accessible equivalent of the drag affordance: a native
          <select> lets keyboard / screen-reader users move a card between
          stages without a pointer drag. */}
      <label className="mt-2 block">
        <span className="sr-only">
          {pickByLocale(locale, S.moveTo)}: {item.title}
        </span>
        <select
          value={item.stage}
          disabled={busy}
          onChange={(e) => onMoveTo(item.id, e.target.value as RegulatorStage)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50"
        >
          {STAGES.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {pickByLocale(locale, stage.label)}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}
