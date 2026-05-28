'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  FileCheck,
  Filter,
  Search,
  Sparkles,
} from 'lucide-react';
import { useLicencesList } from '@/lib/queries/licence';

interface RawLicence {
  readonly id?: string;
  readonly number?: string;
  readonly kind?: string;
  readonly mineral?: string;
  readonly status?: string;
  readonly expiryDate?: string;
  readonly dormancyScore?: number;
  readonly siteName?: string;
}

type StatusFilter = 'all' | 'active' | 'pending' | 'expiring' | 'expired';

const STATUS_LABELS: Record<StatusFilter, { readonly en: string; readonly sw: string }> = {
  all: { en: 'All', sw: 'Zote' },
  active: { en: 'Active', sw: 'Hai' },
  pending: { en: 'Pending', sw: 'Inasubiri' },
  expiring: { en: 'Expiring', sw: 'Inakaribia' },
  expired: { en: 'Expired', sw: 'Imekwisha' },
};

interface LicenceRow {
  readonly id: string;
  readonly number: string;
  readonly kind: string;
  readonly mineral: string;
  readonly status: string;
  readonly daysToExpiry: number | null;
  readonly siteName: string | null;
  readonly dormancyScore: number | null;
}

function daysBetween(iso: string | undefined): number | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  return Math.floor((target - Date.now()) / 86_400_000);
}

function adapt(raw: RawLicence): LicenceRow {
  const id = raw.id ?? raw.number ?? 'unknown';
  return {
    id,
    number: raw.number ?? id,
    kind: (raw.kind ?? 'Licence').toUpperCase(),
    mineral: raw.mineral ?? 'unspecified',
    status: (raw.status ?? 'unknown').toLowerCase(),
    daysToExpiry: daysBetween(raw.expiryDate),
    siteName: raw.siteName ?? null,
    dormancyScore:
      typeof raw.dormancyScore === 'number' ? raw.dormancyScore : null,
  };
}

function classifyExpiry(days: number | null): StatusFilter {
  if (days === null) return 'pending';
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'active';
}

function statusPill(status: StatusFilter): { readonly className: string; readonly label: string } {
  switch (status) {
    case 'active':
      return {
        className: 'border-success/40 bg-success/10 text-success',
        label: 'Active',
      };
    case 'expiring':
      return {
        className: 'border-warning/40 bg-warning/10 text-warning',
        label: 'Expiring soon',
      };
    case 'expired':
      return {
        className: 'border-destructive/40 bg-destructive/10 text-destructive',
        label: 'Expired',
      };
    case 'pending':
      return {
        className: 'border-info/40 bg-info/10 text-info',
        label: 'In review',
      };
    default:
      return {
        className: 'border-border bg-surface text-neutral-300',
        label: 'Unknown',
      };
  }
}

function countdownLabel(days: number | null, isSw: boolean): string {
  if (days === null) return isSw ? 'Bila tarehe' : 'No expiry set';
  if (days < 0) {
    return isSw
      ? `Imekwisha siku ${Math.abs(days)} zilizopita`
      : `Expired ${Math.abs(days)} days ago`;
  }
  if (days === 0) return isSw ? 'Inaisha leo' : 'Expires today';
  return isSw ? `Siku ${days} zimebaki` : `${days} days remaining`;
}

interface LicencesListProps {
  readonly locale?: 'sw' | 'en';
}

/**
 * Institutional licences table. Pulls every PML / ML / SML the active
 * tenant holds and renders a dense, filterable, sortable list with
 * status pills, day-precise next-action chips, and a row-click that
 * opens the licence cockpit (drawer pattern).
 *
 * Live endpoint: GET /api/v1/mining/licences.
 */
export function LicencesList({ locale = 'en' }: LicencesListProps): JSX.Element {
  const isSw = locale === 'sw';
  const query = useLicencesList();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const adapted = useMemo<readonly LicenceRow[]>(() => {
    const raw = (query.data ?? []) as ReadonlyArray<RawLicence>;
    return raw.map(adapt);
  }, [query.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return adapted.filter((row) => {
      if (filter !== 'all' && classifyExpiry(row.daysToExpiry) !== filter) {
        return false;
      }
      if (term.length === 0) return true;
      return (
        row.number.toLowerCase().includes(term) ||
        row.mineral.toLowerCase().includes(term) ||
        (row.siteName?.toLowerCase().includes(term) ?? false)
      );
    });
  }, [adapted, search, filter]);

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <div className="h-12 animate-pulse rounded-xl border border-border bg-surface/40" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-surface/40" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {isSw
          ? 'Imeshindwa kupakia leseni. Geuza kuingia tena au angalia muunganisho.'
          : 'Failed to load licences. Reauthenticate or retry the gateway.'}
      </div>
    );
  }

  if (adapted.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface/40 p-10 text-center">
        <FileCheck className="mx-auto h-8 w-8 text-neutral-500" />
        <h3 className="mt-4 font-display text-xl text-foreground">
          {isSw ? 'Hakuna leseni bado' : 'No licences yet'}
        </h3>
        <p className="mt-2 text-sm text-neutral-400">
          {isSw
            ? 'Sajili leseni yako ya kwanza kupitia onboarding ya Akili Kuu.'
            : 'Register the first licence via the Master Brain onboarding flow.'}
        </p>
      </div>
    );
  }

  const counts: Record<StatusFilter, number> = {
    all: adapted.length,
    active: adapted.filter((r) => classifyExpiry(r.daysToExpiry) === 'active').length,
    pending: adapted.filter((r) => classifyExpiry(r.daysToExpiry) === 'pending').length,
    expiring: adapted.filter((r) => classifyExpiry(r.daysToExpiry) === 'expiring').length,
    expired: adapted.filter((r) => classifyExpiry(r.daysToExpiry) === 'expired').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface/40 p-4">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                isSw ? 'Tafuta nambari, madini, eneo' : 'Search number, mineral, site'
              }
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-neutral-500 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
            />
          </div>
          <div className="hidden items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-neutral-400 sm:inline-flex">
            <Filter className="h-3 w-3" />
            {filtered.length} / {adapted.length}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => {
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
                {isSw ? STATUS_LABELS[key].sw : STATUS_LABELS[key].en}
                <span className="rounded-full bg-background/60 px-1.5 text-[10px] text-neutral-500">
                  {counts[key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
        <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 md:grid">
          <div className="col-span-3">{isSw ? 'Leseni' : 'Licence'}</div>
          <div className="col-span-2">{isSw ? 'Madini' : 'Mineral'}</div>
          <div className="col-span-3">{isSw ? 'Eneo / Mgodi' : 'Site'}</div>
          <div className="col-span-2">{isSw ? 'Hali' : 'Status'}</div>
          <div className="col-span-2 text-right">
            {isSw ? 'Hatua inayofuata' : 'Next action'}
          </div>
        </div>
        <ul className="divide-y divide-border/60">
          {filtered.map((row) => {
            const tone = classifyExpiry(row.daysToExpiry);
            const pill = statusPill(tone);
            return (
              <li key={row.id}>
                <Link
                  href={`/licence?id=${encodeURIComponent(row.id)}`}
                  className="group grid grid-cols-1 gap-3 px-5 py-4 transition-colors hover:bg-surface md:grid-cols-12 md:items-center md:gap-4"
                >
                  <div className="col-span-3 min-w-0">
                    <div className="truncate font-mono text-sm font-medium text-foreground">
                      {row.kind} {row.number}
                    </div>
                    {row.dormancyScore !== null ? (
                      <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-neutral-500">
                        Dormancy{' '}
                        <span
                          className={
                            row.dormancyScore > 0.5
                              ? 'text-warning'
                              : 'text-neutral-400'
                          }
                        >
                          {Math.round(row.dormancyScore * 100)}%
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="col-span-2 text-sm capitalize text-neutral-300">
                    {row.mineral}
                  </div>
                  <div className="col-span-3 min-w-0 truncate text-sm text-neutral-300">
                    {row.siteName ?? (isSw ? 'Hakitajwa' : 'Not assigned')}
                  </div>
                  <div className="col-span-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${pill.className}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          tone === 'active'
                            ? 'bg-success'
                            : tone === 'expiring'
                              ? 'bg-warning'
                              : tone === 'expired'
                                ? 'bg-destructive'
                                : 'bg-info'
                        }`}
                      />
                      {pill.label}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-center justify-between gap-2 md:justify-end">
                    <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                      <CalendarClock className="h-3.5 w-3.5" />
                      {countdownLabel(row.daysToExpiry, isSw)}
                    </span>
                    <ArrowRight className="hidden h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5 md:inline" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        {filtered.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-neutral-500">
            {isSw
              ? 'Hakuna leseni inayolingana na vichungi vyako vya sasa.'
              : 'No licences match the current filters.'}
          </div>
        ) : null}
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-signal-500/30 bg-signal-500/5 p-4 text-xs text-neutral-300">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-signal-500" />
        <p className="leading-relaxed">
          {isSw
            ? 'Akili Kuu inaangalia kila leseni kwa hatari ya kuanguka kwa dormancy na inafanya rasimu ya pakiti ya kuongeza muda siku 60 kabla ya tarehe ya mwisho.'
            : 'Master Brain monitors every licence for dormancy-forfeiture risk and drafts the renewal pack 60 days before the expiry cliff.'}
        </p>
      </div>
    </div>
  );
}
