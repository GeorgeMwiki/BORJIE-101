'use client';

import { useMemo, useState } from 'react';
import { Skeleton, EmptyState, Input } from '@borjie/design-system';
import { DataSourceBadge } from '../DataSourceBadge';
import { VirtualList } from '../decision-log/VirtualList';
import { useAuditLogQuery } from '@/lib/internal/queries/audit-log';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';
import type { AuditEvent } from '@/lib/internal/types';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { localizeApiError } from '@borjie/error-catalog';

const SELECT_CLASS =
  'rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground';

const S = {
  loading: { en: 'Loading audit log…', sw: 'Inapakia kumbukumbu ya ukaguzi…' },
  allTenants: { en: 'All tenants', sw: 'Wateja wote' },
  filterTenant: { en: 'Filter by tenant', sw: 'Chuja kwa mteja' },
  searchPlaceholder: { en: 'Actor or action…', sw: 'Mhusika au tendo…' },
  searchLabel: { en: 'Search audit log', sw: 'Tafuta kumbukumbu ya ukaguzi' },
  fromDate: { en: 'From date', sw: 'Kuanzia tarehe' },
  toDate: { en: 'To date', sw: 'Hadi tarehe' },
  events: { en: 'events', sw: 'matukio' },
  emptyTitle: { en: 'No matching events', sw: 'Hakuna matukio yanayolingana' },
  emptyBody: {
    en: 'Adjust the filters or date range to see audit events.',
    sw: 'Rekebisha vichujio au kipindi cha tarehe ili kuona matukio ya ukaguzi.',
  },
  listLabel: { en: 'Audit events', sw: 'Matukio ya ukaguzi' },
} as const;

export function AuditLogViewer({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useAuditLogQuery();
  const tenantsQuery = useTenantsQuery();
  const tenants = tenantsQuery.data?.rows ?? [];
  const [tenantId, setTenantId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const rows = query.data?.rows ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toMs = to ? Date.parse(to) + 24 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
    return rows.filter((row) => {
      if (tenantId && row.tenantId !== tenantId) return false;
      const at = Date.parse(row.at);
      if (at < fromMs || at > toMs) return false;
      if (q && !row.actor.toLowerCase().includes(q) && !row.action.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tenantId, search, from, to]);

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-[560px] w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{localizeApiError(query.error, locale)}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-lg border border-border bg-surface p-4">
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          aria-label={pickByLocale(locale, S.filterTenant)}
          className={SELECT_CLASS}
        >
          <option value="">{pickByLocale(locale, S.allTenants)}</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Input
          type="search"
          placeholder={pickByLocale(locale, S.searchPlaceholder)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={pickByLocale(locale, S.searchLabel)}
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label={pickByLocale(locale, S.fromDate)}
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label={pickByLocale(locale, S.toDate)}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length.toLocaleString()} {pickByLocale(locale, S.events)}
        </span>
        <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
      ) : (
        <VirtualList<AuditEvent>
          items={filtered}
          rowHeight={40}
          height={560}
          ariaLabel={pickByLocale(locale, S.listLabel)}
          render={(evt) => (
            <div className="px-4 py-2 font-mono text-xs flex items-center gap-3 h-full">
              <span className="text-muted-foreground tabular-nums shrink-0">
                {evt.at.replace('T', ' ').slice(0, 16)}
              </span>
              <span className="text-muted-foreground shrink-0 w-48 truncate">{evt.tenant}</span>
              <span className="text-signal-500 shrink-0 w-24 truncate">{evt.actor}</span>
              <span className="text-foreground truncate">
                {evt.action}
                {evt.target ? ` — ${evt.target}` : ''}
              </span>
            </div>
          )}
        />
      )}
    </div>
  );
}
