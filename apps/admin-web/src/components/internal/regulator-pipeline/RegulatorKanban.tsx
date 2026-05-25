'use client';

import { useState } from 'react';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { useMoveRegulatorChange, useRegulatorPipelineQuery } from '@/lib/internal/queries/regulator-pipeline';
import type { CitationSource, RegulatorChange, RegulatorStage } from '@/lib/mocks/types';

const STAGES: ReadonlyArray<{ readonly id: RegulatorStage; readonly label: string }> = [
  { id: 'incoming', label: 'Incoming' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'approved', label: 'Approved' },
  { id: 'pushed', label: 'Pushed to corpus' },
];

function sourceTone(source: CitationSource): 'info' | 'success' | 'warn' | 'neutral' {
  if (source === 'Gazette') return 'info';
  if (source === 'NEMC') return 'success';
  if (source === 'BoT') return 'warn';
  return 'neutral';
}

export function RegulatorKanban(): JSX.Element {
  const query = useRegulatorPipelineQuery();
  const move = useMoveRegulatorChange();
  const [toast, setToast] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState<RegulatorStage | null>(null);

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading pipeline…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  const rows = query.data?.rows ?? [];

  const onDragStart = (e: React.DragEvent<HTMLLIElement>, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = (stage: RegulatorStage, e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDraggingOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const row = rows.find((r) => r.id === id);
    if (!row || row.stage === stage) return;
    move.mutate(
      { id, stage },
      {
        onSuccess: () => setToast(`${row.title} → ${stage}`),
        onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {STAGES.map((stage) => {
          const items = rows.filter((r) => r.stage === stage.id);
          return (
            <section
              key={stage.id}
              aria-label={stage.label}
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
              <h3 className="text-xs uppercase tracking-wider text-neutral-500 mb-3 flex items-center justify-between">
                <span>{stage.label}</span>
                <span className="text-neutral-400 tabular-nums">{items.length}</span>
              </h3>
              <ul className="space-y-2">
                {items.length === 0 ? (
                  <li className="text-xs text-neutral-500 italic">Empty</li>
                ) : (
                  items.map((item) => <KanbanCard key={item.id} item={item} onDragStart={onDragStart} />)
                )}
              </ul>
            </section>
          );
        })}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
      <Toast message={toast} tone={move.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </div>
  );
}

interface KanbanCardProps {
  readonly item: RegulatorChange;
  readonly onDragStart: (e: React.DragEvent<HTMLLIElement>, id: string) => void;
}

function KanbanCard({ item, onDragStart }: KanbanCardProps): JSX.Element {
  return (
    <li
      draggable
      onDragStart={(e) => onDragStart(e, item.id)}
      className="rounded-md border border-border bg-surface-sunken p-3 cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-center justify-between mb-1">
        <StubBadge tone={sourceTone(item.source)}>{item.source}</StubBadge>
        <span className="text-xs text-neutral-500">{item.ageHours}h</span>
      </div>
      <p className="text-sm text-foreground">{item.title}</p>
    </li>
  );
}
