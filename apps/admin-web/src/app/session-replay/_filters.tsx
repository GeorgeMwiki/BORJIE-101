/**
 * Session-replay facet bar + filtered-list shell — Central Command
 * Phase C (C4).
 *
 * Three independent facets (date / errors / duration) and a stateful
 * client wrapper that pipes the host page's server-fetched sessions
 * through the pure `search-filter-utils` reducer.
 *
 * Rendered on design-system primitives + semantic tokens. SINGLE LANGUAGE
 * PER LOCALE (canon): every user-facing string resolves to the active
 * locale via `pickByLocale`, seeded from the server-resolved cookie
 * (`initialLocale`) so SSR + the first client paint agree (no split-brain
 * frame). The facet bar (`SessionReplayFilters`) is purely presentational;
 * the filter chain lives in the parent `SessionReplayList`.
 */

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import {
  DEFAULT_FACET_STATE,
  searchAndFilter,
  type DateFacet,
  type DurationFacet,
  type ErrorFacet,
  type FacetState,
  type RecentSessionLike,
} from '@/lib/session-replay/search-filter-utils';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { SessionReplaySearch } from './_search';

type LocalizedString = { readonly en: string; readonly sw: string };

const S = {
  date: { en: 'Date', sw: 'Tarehe' },
  errors: { en: 'Errors', sw: 'Hitilafu' },
  duration: { en: 'Duration', sw: 'Muda' },
  reset: { en: 'Reset filters', sw: 'Weka upya vichujio' },
  of: { en: 'of', sw: 'kati ya' },
  sessions: { en: 'sessions', sw: 'vipindi' },
  emptyNoneTitle: {
    en: 'No replay sessions recorded',
    sw: 'Hakuna vipindi vya kuchezea vilivyorekodiwa',
  },
  emptyNoneBody: {
    en: 'Visit any admin page — the recorder boots from the layout provider and flushes a chunk every 30 seconds.',
    sw: 'Tembelea ukurasa wowote wa admin — kinasa huwasha kutoka kwa mtoaji wa muundo na hutuma kipande kila sekunde 30.',
  },
  emptyFilteredTitle: {
    en: 'No sessions match the current filters',
    sw: 'Hakuna vipindi vinavyolingana na vichujio vya sasa',
  },
  emptyFilteredBody: {
    en: 'Reset the facets or clear the search to see more sessions.',
    sw: 'Weka upya vipengele au futa utafutaji kuona vipindi zaidi.',
  },
  colSession: { en: 'Session', sw: 'Kipindi' },
  colUser: { en: 'User', sw: 'Mtumiaji' },
  colSurface: { en: 'Surface', sw: 'Uso' },
  colFirst: { en: 'First captured', sw: 'Ilinaswa kwanza' },
  colLast: { en: 'Last captured', sw: 'Ilinaswa mwisho' },
  colChunks: { en: 'Chunks', sw: 'Vipande' },
  play: { en: 'Play →', sw: 'Cheza →' },
} as const;

interface SessionReplayFiltersProps {
  readonly value: FacetState;
  readonly onChange: (next: FacetState) => void;
  readonly onReset?: () => void;
  readonly locale: Locale;
}

const DATE_OPTIONS: ReadonlyArray<{ label: LocalizedString; value: DateFacet }> = [
  { label: { en: 'All', sw: 'Zote' }, value: 'all' },
  { label: { en: 'Last hour', sw: 'Saa iliyopita' }, value: '1h' },
  { label: { en: 'Last 24h', sw: 'Saa 24 zilizopita' }, value: '24h' },
  { label: { en: 'Last 7d', sw: 'Siku 7 zilizopita' }, value: '7d' },
  { label: { en: 'Last 30d', sw: 'Siku 30 zilizopita' }, value: '30d' },
];

const ERROR_OPTIONS: ReadonlyArray<{ label: LocalizedString; value: ErrorFacet }> = [
  { label: { en: 'Any', sw: 'Yoyote' }, value: 'all' },
  { label: { en: 'With errors', sw: 'Zenye hitilafu' }, value: 'with-errors' },
  { label: { en: 'Error-free', sw: 'Bila hitilafu' }, value: 'no-errors' },
];

const DURATION_OPTIONS: ReadonlyArray<{
  label: LocalizedString;
  value: DurationFacet;
}> = [
  { label: { en: 'Any', sw: 'Yoyote' }, value: 'all' },
  { label: { en: '< 1 min', sw: '< dakika 1' }, value: 'under-1m' },
  { label: { en: '1 – 5 min', sw: 'dakika 1 – 5' }, value: '1-5m' },
  { label: { en: '> 5 min', sw: '> dakika 5' }, value: 'over-5m' },
];

export function SessionReplayFilters({
  value,
  onChange,
  onReset,
  locale,
}: SessionReplayFiltersProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-4 text-xs text-muted-foreground">
      <FacetGroup
        label={pickByLocale(locale, S.date)}
        options={DATE_OPTIONS}
        selected={value.date}
        onSelect={(next) => onChange({ ...value, date: next })}
        locale={locale}
      />
      <FacetGroup
        label={pickByLocale(locale, S.errors)}
        options={ERROR_OPTIONS}
        selected={value.errors}
        onSelect={(next) => onChange({ ...value, errors: next })}
        locale={locale}
      />
      <FacetGroup
        label={pickByLocale(locale, S.duration)}
        options={DURATION_OPTIONS}
        selected={value.duration}
        onSelect={(next) => onChange({ ...value, duration: next })}
        locale={locale}
      />
      {onReset ? (
        <Button type="button" onClick={onReset} variant="outline" size="sm">
          {pickByLocale(locale, S.reset)}
        </Button>
      ) : null}
    </div>
  );
}

interface FacetGroupProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<{ label: LocalizedString; value: T }>;
  readonly selected: T;
  readonly onSelect: (next: T) => void;
  readonly locale: Locale;
}

function FacetGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
  locale,
}: FacetGroupProps<T>): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="uppercase tracking-wider text-muted-foreground">
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
                'rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                (isActive
                  ? 'border-signal-500 bg-signal-500/10 text-signal-200'
                  : 'border-border bg-surface-sunken text-muted-foreground hover:bg-muted')
              }
            >
              {pickByLocale(locale, opt.label)}
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
  readonly initialLocale?: Locale;
}

export function SessionReplayList({
  sessions,
  initialLocale,
}: SessionReplayListProps): JSX.Element {
  const locale = useLocale(initialLocale);
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
        <div className="text-xs text-muted-foreground">
          {filtered.length} {pickByLocale(locale, S.of)} {sessions.length}{' '}
          {pickByLocale(locale, S.sessions)}
        </div>
      </div>
      <SessionReplayFilters
        value={facets}
        onChange={setFacets}
        locale={locale}
        {...(isFiltered ? { onReset: resetAll } : {})}
      />
      {sessions.length === 0 ? (
        <Empty
          title={pickByLocale(locale, S.emptyNoneTitle)}
          description={pickByLocale(locale, S.emptyNoneBody)}
        />
      ) : filtered.length === 0 ? (
        <Empty
          title={pickByLocale(locale, S.emptyFilteredTitle)}
          description={pickByLocale(locale, S.emptyFilteredBody)}
          {...(isFiltered
            ? { action: { label: pickByLocale(locale, S.reset), onClick: resetAll } }
            : {})}
        />
      ) : (
        <Card variant="outline" padding="none" className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pickByLocale(locale, S.colSession)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colUser)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colSurface)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colFirst)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colLast)}</TableHead>
                <TableHead>{pickByLocale(locale, S.colChunks)}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow key={s.sessionId}>
                  <TableCell className="break-all font-mono">
                    {s.sessionId}
                  </TableCell>
                  <TableCell>{s.userId}</TableCell>
                  <TableCell>{s.surface}</TableCell>
                  <TableCell>{s.firstCapturedAt}</TableCell>
                  <TableCell>{s.lastCapturedAt}</TableCell>
                  <TableCell>{s.chunkCount}</TableCell>
                  <TableCell>
                    <Link
                      href={`/session-replay/${encodeURIComponent(s.sessionId)}`}
                      className="text-signal-500 hover:underline"
                    >
                      {pickByLocale(locale, S.play)}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
