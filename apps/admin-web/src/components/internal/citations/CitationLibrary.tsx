'use client';

import { useMemo, useState } from 'react';
import { FilterChips } from '../FilterChips';
import { DataSourceBadge } from '../DataSourceBadge';
import { useCitationsQuery } from '@/lib/internal/queries/citations';
import type { Citation, CitationSource } from '@/lib/mocks/types';

const SOURCES: ReadonlyArray<CitationSource> = ['Gazette', 'NEMC', 'BoT', 'TMAA', 'TRA', 'Tumemadini'];

export function CitationLibrary(): JSX.Element {
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

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading citations…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  return (
    <div className="space-y-4">
      <FilterChips label="Source" options={SOURCES} active={active} onToggle={toggle} />

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by statute, section, or keyword…"
        aria-label="Search citations"
        className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-neutral-500"
      />

      <ul className="rounded-lg border border-border bg-surface divide-y divide-border">
        {filtered.length === 0 ? (
          <li className="px-4 py-6 text-xs text-neutral-500 text-center">No citations match.</li>
        ) : (
          filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(c)}
                className="w-full text-left px-4 py-3 hover:bg-surface-sunken"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-foreground">{c.statute}</p>
                  <span className="text-xs text-neutral-500 tabular-nums">{c.publishedOn}</span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {c.section} · {c.source}
                </p>
              </button>
            </li>
          ))
        )}
      </ul>

      <DataSourceBadge source={query.data?.source ?? 'mock'} />

      {open ? (
        <CitationDetail citation={open} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function CitationDetail({ citation, onClose }: { readonly citation: Citation; readonly onClose: () => void }): JSX.Element {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-[0.62rem] uppercase tracking-widest text-signal-500 mb-1">{citation.source}</p>
            <h3 className="text-lg font-display text-foreground">{citation.statute}</h3>
            <p className="text-xs text-neutral-500">
              {citation.section} · published {citation.publishedOn}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-neutral-500 hover:text-foreground"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <p className="text-sm text-foreground leading-relaxed border-t border-border pt-4">{citation.excerpt}</p>
      </div>
    </div>
  );
}
