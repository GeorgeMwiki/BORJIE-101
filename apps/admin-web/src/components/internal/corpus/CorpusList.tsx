'use client';

import { useState } from 'react';
import { StubBadge } from '../StubBadge';
import { useSupersedeCorpus } from '@/lib/internal/queries/corpus';
import { Toast } from '../Toast';
import type { CorpusEntry } from '@/lib/mocks/types';

function tone(status: CorpusEntry['status']): 'success' | 'info' | 'neutral' {
  if (status === 'Indexed') return 'success';
  if (status === 'Re-ingesting') return 'info';
  return 'neutral';
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

interface CorpusListProps {
  readonly rows: ReadonlyArray<CorpusEntry>;
}

export function CorpusList({ rows }: CorpusListProps): JSX.Element {
  const supersede = useSupersedeCorpus();
  const [toast, setToast] = useState<string | null>(null);

  return (
    <>
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-neutral-500 text-center">No corpus entries yet.</p>
        ) : (
          rows.map((entry) => (
            <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-foreground">{entry.title}</p>
                <p className="text-xs text-neutral-500">
                  {entry.id} · {entry.version} · {entry.chunks} chunks · {formatBytes(entry.bytes)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StubBadge tone={tone(entry.status)}>{entry.status}</StubBadge>
                <button
                  type="button"
                  disabled={entry.status === 'Superseded' || supersede.isPending}
                  onClick={() =>
                    supersede.mutate(entry.id, {
                      onSuccess: () => setToast(`${entry.title} superseded`),
                      onError: (e) => setToast(`Failed: ${e instanceof Error ? e.message : 'unknown'}`),
                    })
                  }
                  className="text-xs text-signal-500 hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Supersede
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <Toast message={toast} tone={supersede.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
