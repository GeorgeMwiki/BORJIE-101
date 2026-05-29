'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, MapPin, Mountain, Search } from 'lucide-react';
import { useSitesList, type MiningSite } from '@/lib/queries/sites';

interface SitesListProps {
  readonly locale?: 'sw' | 'en';
}

type PhaseFilter = 'all' | 'production' | 'development' | 'exploration' | 'standby';

const PHASE_LABELS: Record<PhaseFilter, { readonly sw: string; readonly en: string }> = {
  all: { sw: 'Zote', en: 'All' },
  production: { sw: 'Uzalishaji', en: 'Production' },
  development: { sw: 'Maendeleo', en: 'Development' },
  exploration: { sw: 'Uchunguzi', en: 'Exploration' },
  standby: { sw: 'Pumzika', en: 'Standby' },
};

function phaseOf(phase: string | undefined): PhaseFilter {
  const lower = (phase ?? '').toLowerCase();
  if (lower.includes('prod')) return 'production';
  if (lower.includes('dev')) return 'development';
  if (lower.includes('expl')) return 'exploration';
  if (lower.includes('stand')) return 'standby';
  return 'all';
}

function phaseToneClasses(phase: PhaseFilter): { readonly dot: string; readonly text: string } {
  if (phase === 'production') return { dot: 'bg-success', text: 'text-success' };
  if (phase === 'development') return { dot: 'bg-signal-500', text: 'text-signal-500' };
  if (phase === 'exploration') return { dot: 'bg-info', text: 'text-info' };
  if (phase === 'standby') return { dot: 'bg-warning', text: 'text-warning' };
  return { dot: 'bg-neutral-500', text: 'text-neutral-400' };
}

/**
 * Institutional sites table. Pulls every mining site under the active
 * tenant from `GET /api/v1/mining/sites`. Search across name +
 * licence ID + phase; filter chips group by phase; row click routes
 * into the site cockpit with `?siteId=...`.
 */
export function SitesList({ locale = 'en' }: SitesListProps): JSX.Element {
  const isSw = locale === 'sw';
  const query = useSitesList();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PhaseFilter>('all');

  const rows = useMemo<readonly MiningSite[]>(() => query.data ?? [], [query.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((site) => {
      if (filter !== 'all' && phaseOf(site.phase) !== filter) return false;
      if (term.length === 0) return true;
      return (
        site.name.toLowerCase().includes(term) ||
        (site.licenceId?.toLowerCase().includes(term) ?? false) ||
        (site.phase?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [rows, search, filter]);

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <div className="h-12 animate-pulse rounded-xl border border-border bg-surface/40" />
        <div className="h-48 animate-pulse rounded-xl border border-border bg-surface/40" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {isSw
          ? 'Imeshindwa kupakia migodi. Geuza kuingia tena au jaribu tena.'
          : 'Failed to load sites. Reauthenticate or retry the gateway.'}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-10 text-center">
        <Mountain className="mx-auto h-8 w-8 text-neutral-500" />
        <h3 className="mt-4 font-display text-xl text-foreground">
          {isSw ? 'Hakuna migodi bado' : 'No sites registered yet'}
        </h3>
        <p className="mt-2 text-sm text-neutral-400">
          {isSw
            ? 'Ongeza mgodi kupitia ramani ya leseni au onboarding ya Akili Kuu.'
            : 'Add a site via the licence map or the Master Brain onboarding flow.'}
        </p>
      </div>
    );
  }

  const counts: Record<PhaseFilter, number> = {
    all: rows.length,
    production: rows.filter((r) => phaseOf(r.phase) === 'production').length,
    development: rows.filter((r) => phaseOf(r.phase) === 'development').length,
    exploration: rows.filter((r) => phaseOf(r.phase) === 'exploration').length,
    standby: rows.filter((r) => phaseOf(r.phase) === 'standby').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface/40 p-4">
        <div className="relative w-full max-w-md sm:w-auto sm:min-w-column-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isSw ? 'Tafuta jina, leseni, awamu' : 'Search name, licence, phase'}
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-neutral-500 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(PHASE_LABELS) as PhaseFilter[]).map((key) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-signal-500/60 bg-signal-500/10 text-signal-500'
                    : 'border-border bg-background text-neutral-400 hover:text-foreground'
                }`}
              >
                {isSw ? PHASE_LABELS[key].sw : PHASE_LABELS[key].en}
                <span className="rounded-full bg-background/60 px-1.5 text-tiny text-neutral-500">
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
        <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
          <div className="col-span-4">{isSw ? 'Mgodi' : 'Site'}</div>
          <div className="col-span-2">{isSw ? 'Awamu' : 'Phase'}</div>
          <div className="col-span-2">{isSw ? 'Hali' : 'Status'}</div>
          <div className="col-span-3">{isSw ? 'Leseni husika' : 'Linked licence'}</div>
          <div className="col-span-1 text-right">{isSw ? 'Fungua' : 'Open'}</div>
        </div>
        <ul className="divide-y divide-border/60">
          {filtered.map((site) => {
            const phase = phaseOf(site.phase);
            const tone = phaseToneClasses(phase);
            return (
              <li key={site.id}>
                <Link
                  href={`/site-cockpit?siteId=${encodeURIComponent(site.id)}`}
                  className="group grid grid-cols-1 gap-3 px-5 py-4 transition-colors hover:bg-surface md:grid-cols-12 md:items-center md:gap-4"
                >
                  <div className="col-span-4 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                      <span className="truncate">{site.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-tiny uppercase tracking-widest text-neutral-500">
                      ID {site.id}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${tone.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      {site.phase ?? (isSw ? 'Haijabainishwa' : 'Unspecified')}
                    </span>
                  </div>
                  <div className="col-span-2 text-xs capitalize text-neutral-300">
                    {site.status ?? '-'}
                  </div>
                  <div className="col-span-3 truncate font-mono text-xs text-neutral-400">
                    {site.licenceId ?? '-'}
                  </div>
                  <div className="col-span-1 flex justify-start md:justify-end">
                    <ArrowRight className="h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-neutral-500">
            {isSw
              ? 'Hakuna mgodi unaolingana na vichungi vya sasa.'
              : 'No sites match the current filters.'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
