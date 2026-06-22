'use client';

import { useMemo, useState } from 'react';
import { Skeleton, EmptyState, Modal, ModalBody } from '@borjie/design-system';
import { FilterChips } from '../FilterChips';
import { DataSourceBadge } from '../DataSourceBadge';
import { useCitationsQuery } from '@/lib/internal/queries/citations';
import type { Citation, CitationSource } from '@/lib/internal/types';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

const SOURCES: ReadonlyArray<CitationSource> = ['Gazette', 'NEMC', 'BoT', 'TMAA', 'TRA', 'Mining Commission'];

const S = {
  loading: { en: 'Loading citations…', sw: 'Inapakia marejeleo…' },
  searchPlaceholder: {
    en: 'Search by statute, section, or keyword…',
    sw: 'Tafuta kwa sheria, kifungu, au neno muhimu…',
  },
  searchLabel: { en: 'Search citations', sw: 'Tafuta marejeleo' },
  emptyTitle: { en: 'No citations match', sw: 'Hakuna marejeleo yanayolingana' },
  emptyBody: {
    en: 'Adjust the source filter or search to find a citation.',
    sw: 'Rekebisha kichujio cha chanzo au utafutaji ili kupata rejeleo.',
  },
  published: { en: 'published', sw: 'imechapishwa' },
  sourceLabel: { en: 'Source', sw: 'Chanzo' },
} as const;

export function CitationLibrary({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useCitationsQuery();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<Set<CitationSource>>(new Set());
  const [open, setOpen] = useState<Citation | null>(null);

  const rows = query.data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (active.size > 0 && !active.has(row.source)) return false;
      if (!q) return true;
      return (
        row.statute.toLowerCase().includes(q) ||
        row.section.toLowerCase().includes(q) ||
        row.excerpt.toLowerCase().includes(q)
      );
    });
  }, [rows, search, active]);

  const toggle = (value: CitationSource) => {
    const next = new Set(active);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setActive(next);
  };

  if (query.isPending) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-2/3 rounded-md" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  return (
    <div className="space-y-4">
      <FilterChips
        label={pickByLocale(locale, S.sourceLabel)}
        options={SOURCES}
        active={active}
        onToggle={toggle}
      />

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={pickByLocale(locale, S.searchPlaceholder)}
        aria-label={pickByLocale(locale, S.searchLabel)}
        className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <ul className="rounded-lg border border-border bg-surface divide-y divide-border">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(c)}
                className="w-full text-left px-4 py-3 hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-foreground">{c.statute}</p>
                  <span className="text-xs text-muted-foreground tabular-nums">{c.publishedOn}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {c.section} · {c.source}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <DataSourceBadge source={query.data?.source ?? 'mock'} />

      {open ? (
        <Modal open={open !== null} onClose={() => setOpen(null)} title={open.statute} size="lg">
          <ModalBody>
            <p className="text-caption uppercase tracking-widest text-signal-500 mb-2">
              {open.source}
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              {open.section} · {pickByLocale(locale, S.published)} {open.publishedOn}
            </p>
            <p className="text-sm text-foreground leading-relaxed border-t border-border pt-4">
              {open.excerpt}
            </p>
          </ModalBody>
        </Modal>
      ) : null}
    </div>
  );
}
