/**
 * Session-replay facet bar + filtered-list shell — Central Command
 * Phase C (C4).
 *
 * Three independent facets (date / errors / duration) and a stateful
 * client wrapper that pipes the host page's server-fetched sessions
 * through the pure `search-filter-utils` reducer.
 *
 * The facet bar (`SessionReplayFilters`) is purely presentational; the
 * filter chain lives in the parent `SessionReplayList` component. Both
 * are exported so unit tests + the page host can compose them
 * independently.
 */

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  DEFAULT_FACET_STATE,
  searchAndFilter,
  type DateFacet,
  type DurationFacet,
  type ErrorFacet,
  type FacetState,
  type RecentSessionLike,
} from '@/lib/session-replay/search-filter-utils';
import { SessionReplaySearch } from './_search';

interface SessionReplayFiltersProps {
  readonly value: FacetState;
  readonly onChange: (next: FacetState) => void;
  readonly onReset?: () => void;
}

const DATE_OPTIONS: ReadonlyArray<{ label: string; value: DateFacet }> = [
  { label: 'All', value: 'all' },
  { label: 'Last hour', value: '1h' },
  { label: 'Last 24h', value: '24h' },
  { label: 'Last 7d', value: '7d' },
  { label: 'Last 30d', value: '30d' },
];

const ERROR_OPTIONS: ReadonlyArray<{ label: string; value: ErrorFacet }> = [
  { label: 'Any', value: 'all' },
  { label: 'With errors', value: 'with-errors' },
  { label: 'Error-free', value: 'no-errors' },
];

const DURATION_OPTIONS: ReadonlyArray<{ label: string; value: DurationFacet }> = [
  { label: 'Any', value: 'all' },
  { label: '< 1 min', value: 'under-1m' },
  { label: '1 – 5 min', value: '1-5m' },
  { label: '> 5 min', value: 'over-5m' },
];

export function SessionReplayFilters({
  value,
  onChange,
  onReset,
}: SessionReplayFiltersProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-4 text-xs text-neutral-400">
      <FacetGroup
        label="Date"
        options={DATE_OPTIONS}
        selected={value.date}
        onSelect={(next) => onChange({ ...value, date: next })}
      />
      <FacetGroup
        label="Errors"
        options={ERROR_OPTIONS}
        selected={value.errors}
        onSelect={(next) => onChange({ ...value, errors: next })}
      />
      <FacetGroup
        label="Duration"
        options={DURATION_OPTIONS}
        selected={value.duration}
        onSelect={(next) => onChange({ ...value, duration: next })}
      />
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-border px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Reset filters
        </button>
      ) : null}
    </div>
  );
}

interface FacetGroupProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<{ label: string; value: T }>;
  readonly selected: T;
  readonly onSelect: (next: T) => void;
}

function FacetGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: FacetGroupProps<T>): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="uppercase tracking-wider text-neutral-500">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((opt) => {
          const isActive = opt.value === selected;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              aria-pressed={isActive}
              className={
                'rounded-md border px-2 py-1 text-xs transition-colors ' +
                (isActive
                  ? 'border-signal-500 bg-signal-500/10 text-signal-200'
                  : 'border-border bg-neutral-900 text-neutral-300 hover:bg-neutral-800')
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Client shell — owns the search query + facet state and renders the
// filtered session table. Exported so the (server-component) page can
// host it without lifting state across the boundary.
// ─────────────────────────────────────────────────────────────────────

interface SessionReplayRow extends RecentSessionLike {
  readonly sessionId: string;
}

interface SessionReplayListProps {
  readonly sessions: ReadonlyArray<SessionReplayRow>;
}

export function SessionReplayList({
  sessions,
}: SessionReplayListProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [facets, setFacets] = useState<FacetState>(DEFAULT_FACET_STATE);

  const filtered = useMemo(
    () => searchAndFilter(sessions, query, facets),
    [sessions, query, facets],
  );

  const isFiltered =
    query.trim().length > 0 ||
    facets.date !== 'all' ||
    facets.errors !== 'all' ||
    facets.duration !== 'all';

  function resetAll(): void {
    setQuery('');
    setFacets(DEFAULT_FACET_STATE);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SessionReplaySearch value={query} onChange={setQuery} />
        <div className="text-xs text-neutral-500">
          {filtered.length} of {sessions.length} sessions
        </div>
      </div>
      <SessionReplayFilters
        value={facets}
        onChange={setFacets}
        onReset={isFiltered ? resetAll : undefined}
      />
      {sessions.length === 0 ? (
        <div className="text-sm text-neutral-400">
          No replay sessions recorded in the current window. Visit any
          admin page — the recorder boots from the layout provider and
          flushes a chunk every 30 seconds.
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-neutral-400">
          No sessions match the current filters.
          {isFiltered ? (
            <>
              {' '}
              <button
                type="button"
                onClick={resetAll}
                className="text-signal-500 hover:underline"
              >
                Reset filters
              </button>
              .
            </>
          ) : null}
        </div>
      ) : (
        <table className="w-full text-sm text-neutral-300 border-collapse">
          <thead className="text-neutral-500 uppercase text-xs tracking-wider">
            <tr>
              <th className="text-left py-2 pr-3">Session</th>
              <th className="text-left py-2 pr-3">User</th>
              <th className="text-left py-2 pr-3">Surface</th>
              <th className="text-left py-2 pr-3">First captured</th>
              <th className="text-left py-2 pr-3">Last captured</th>
              <th className="text-left py-2 pr-3">Chunks</th>
              <th className="text-left py-2 pr-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.sessionId} className="border-t border-border">
                <td className="py-2 pr-3 font-mono break-all">{s.sessionId}</td>
                <td className="py-2 pr-3">{s.userId}</td>
                <td className="py-2 pr-3">{s.surface}</td>
                <td className="py-2 pr-3">{s.firstCapturedAt}</td>
                <td className="py-2 pr-3">{s.lastCapturedAt}</td>
                <td className="py-2 pr-3">{s.chunkCount}</td>
                <td className="py-2 pr-3">
                  <Link
                    href={`/session-replay/${encodeURIComponent(s.sessionId)}`}
                    className="text-signal-500 hover:underline"
                  >
                    Play →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
