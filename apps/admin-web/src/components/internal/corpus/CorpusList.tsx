'use client';

import { useState } from 'react';
import { EmptyState } from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { useSupersedeCorpus } from '@/lib/internal/queries/corpus';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type { CorpusEntry } from '@/lib/internal/types';
import { localizeApiError } from '@borjie/error-catalog';
import { localizeEnumLabel, CORPUS_STATUS_LABELS } from '@/lib/internal/enum-labels';

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

const S = {
  emptyTitle: { en: 'No corpus entries yet', sw: 'Hakuna maingizo ya hifadhi bado' },
  emptyBody: {
    en: 'Drop a dossier above to index the first corpus entry.',
    sw: 'Dondosha jalada hapo juu ili kuorodhesha ingizo la kwanza la hifadhi.',
  },
  chunks: { en: 'chunks', sw: 'vipande' },
  supersede: { en: 'Supersede', sw: 'Badilisha' },
  superseded: { en: 'superseded', sw: 'imebadilishwa' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
} as const;

interface CorpusListProps {
  readonly rows: ReadonlyArray<CorpusEntry>;
  readonly initialLocale?: Locale;
}

export function CorpusList({ rows, initialLocale }: CorpusListProps): JSX.Element {
  const locale = useLocale(initialLocale);
  const supersede = useSupersedeCorpus();
  const [toast, setToast] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-surface divide-y divide-border">
        {rows.map((entry) => (
          <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">{entry.title}</p>
              <p className="text-xs text-muted-foreground">
                {entry.id} · {entry.version} · {entry.chunks}{' '}
                {pickByLocale(locale, S.chunks)} · {formatBytes(entry.bytes)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StubBadge tone={tone(entry.status)}>
                {localizeEnumLabel(CORPUS_STATUS_LABELS, entry.status, locale)}
              </StubBadge>
              <button
                type="button"
                disabled={entry.status === 'Superseded' || supersede.isPending}
                onClick={() =>
                  supersede.mutate(entry.id, {
                    onSuccess: () =>
                      setToast(`${entry.title} ${pickByLocale(locale, S.superseded)}`),
                    onError: (e) =>
                      setToast(
                        `${pickByLocale(locale, S.failed)}: ${
                          localizeApiError(e, locale)
                        }`,
                      ),
                  })
                }
                className="text-xs text-signal-500 hover:underline disabled:opacity-40 disabled:no-underline"
              >
                {pickByLocale(locale, S.supersede)}
              </button>
            </div>
          </div>
        ))}
      </div>
      <Toast message={toast} tone={supersede.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </>
  );
}
