'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2 } from 'lucide-react';
import { EmptyState, Input, Skeleton, Alert } from '@borjie/design-system';
import { DataTable } from '../DataTable';
import { FilterChips } from '../FilterChips';
import { Pagination } from '../Pagination';
import { DataSourceBadge } from '../DataSourceBadge';
import { TenantStatusBadge } from './TenantStatusBadge';
import { TenantActions } from './TenantActions';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';
import { formatCurrency } from '@/lib/api';
import { bcp47For } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type { Tenant, TenantPlan, TenantStatus } from '@/lib/internal/types';
import { localizeApiError } from '@borjie/error-catalog';

const PLANS: ReadonlyArray<TenantPlan> = ['Starter', 'Growth', 'Enterprise'];
const STATUSES: ReadonlyArray<TenantStatus> = ['Active', 'Trial', 'Past due', 'Suspended'];
const PAGE_SIZE = 10;

/**
 * Closed {en,sw} map for the Status filter chips. The `TenantStatus` union
 * members are English carrier literals used as the filter VALUE; only the
 * visible chip text is localized so the raw English key never renders under
 * the sw locale (which would be language mixing). One canonical sw term each,
 * mirroring TenantStatusBadge's STATUS_LABELS glossary (no term drift).
 */
const STATUS_LABELS: Record<TenantStatus, { readonly en: string; readonly sw: string }> = {
  Active: { en: 'Active', sw: 'Hai' },
  Trial: { en: 'Trial', sw: 'Jaribio' },
  'Past due': { en: 'Past due', sw: 'Imepitwa na muda' },
  Suspended: { en: 'Suspended', sw: 'Imesimamishwa' },
};

function formatRelative(
  iso: string,
  locale: Locale,
  now: number = Date.now(),
): string {
  const diffMs = now - Date.parse(iso);
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return pickByLocale(locale, { en: 'just now', sw: 'sasa hivi' });
  if (mins < 60)
    return pickByLocale(locale, { en: `${mins}m ago`, sw: `dakika ${mins} zilizopita` });
  const hours = Math.round(mins / 60);
  if (hours < 24)
    return pickByLocale(locale, { en: `${hours}h ago`, sw: `saa ${hours} zilizopita` });
  const days = Math.round(hours / 24);
  return pickByLocale(locale, { en: `${days}d ago`, sw: `siku ${days} zilizopita` });
}

export function TenantDirectory({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const router = useRouter();
  // Seed from the server-resolved cookie to avoid the first-paint split-brain.
  const locale = useLocale(initialLocale);
  const query = useTenantsQuery();
  const [planFilter, setPlanFilter] = useState<Set<TenantPlan>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<TenantStatus>>(new Set());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const rows = query.data?.rows ?? [];
  // The tenants query is LIVE-only (it throws on failure rather than falling
  // back to fixtures) — so the data source is always 'live' once loaded. The
  // previous `?? 'mock'` default mislabelled real rows as fabricated.
  const source = query.data?.source ?? 'live';
  const hasFilters = planFilter.size > 0 || statusFilter.size > 0 || search.trim() !== '';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (planFilter.size > 0 && !planFilter.has(row.plan)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(row.status)) return false;
      if (q && !row.name.toLowerCase().includes(q) && !row.commodity.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, planFilter, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const columns = useMemo<ColumnDef<Tenant, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: pickByLocale(locale, { en: 'Tenant', sw: 'Mteja' }),
        cell: (ctx) => <span className="text-foreground font-medium">{ctx.row.original.name}</span>,
      },
      {
        accessorKey: 'plan',
        header: pickByLocale(locale, { en: 'Plan', sw: 'Mpango' }),
      },
      {
        accessorKey: 'country',
        header: pickByLocale(locale, { en: 'Country', sw: 'Nchi' }),
      },
      {
        accessorKey: 'status',
        header: pickByLocale(locale, { en: 'Status', sw: 'Hali' }),
        cell: (ctx) => (
          <TenantStatusBadge status={ctx.row.original.status} initialLocale={locale} />
        ),
        sortingFn: (a, b) => a.original.status.localeCompare(b.original.status),
      },
      {
        accessorKey: 'arr',
        header: pickByLocale(locale, { en: 'ARR', sw: 'Mapato ya mwaka' }),
        cell: (ctx) => (
          <span className="tabular-nums">
            {formatCurrency(ctx.row.original.arr, ctx.row.original.currency, bcp47For(locale))}
          </span>
        ),
      },
      {
        accessorKey: 'lastActiveAt',
        header: pickByLocale(locale, { en: 'Last active', sw: 'Alipokuwa hai mwisho' }),
        cell: (ctx) => (
          <span className="text-xs text-muted-foreground">
            {formatRelative(ctx.row.original.lastActiveAt, locale)}
          </span>
        ),
        sortingFn: (a, b) => Date.parse(a.original.lastActiveAt) - Date.parse(b.original.lastActiveAt),
      },
      {
        id: 'actions',
        header: () => (
          <span className="sr-only">
            {pickByLocale(locale, { en: 'Actions', sw: 'Vitendo' })}
          </span>
        ),
        enableSorting: false,
        cell: (ctx) => <TenantActions tenant={ctx.row.original} initialLocale={locale} />,
      },
    ],
    [locale]
  );

  const toggle =
    <T extends TenantPlan | TenantStatus>(setter: (v: Set<T>) => void, current: Set<T>) =>
    (value: T) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      setter(next);
      setPage(0);
    };

  if (query.isPending) {
    return (
      <Skeleton
        className="h-64 w-full rounded-lg"
        aria-label={pickByLocale(locale, {
          en: 'Loading tenants…',
          sw: 'Inapakia wateja…',
        })}
      />
    );
  }
  if (query.isError) {
    return (
      <Alert variant="error">
        {pickByLocale(locale, {
          en: `Failed to load tenants: ${localizeApiError(query.error, locale)}`,
          sw: `Imeshindwa kupakia wateja: ${localizeApiError(query.error, locale)}`,
        })}
      </Alert>
    );
  }

  // Honest empty state: the live endpoint returned zero tenants and no
  // filter is narrowing the view — render an explicit empty state rather
  // than a bare table (and never fabricated demo rows).
  if (rows.length === 0 && !hasFilters) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title={pickByLocale(locale, {
            en: 'No tenants yet',
            sw: 'Hakuna wateja bado',
          })}
          description={pickByLocale(locale, {
            en: 'Tenants appear here once they are provisioned. Nothing is fabricated — this directory reflects the live gateway.',
            sw: 'Wateja huonekana hapa mara wanaposajiliwa. Hakuna kinachotungwa — orodha hii inaonyesha lango hai.',
          })}
        />
        <div className="flex justify-end">
          <DataSourceBadge source={source} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label={pickByLocale(locale, { en: 'Plan', sw: 'Mpango' })}
          options={PLANS}
          active={planFilter}
          onToggle={toggle(setPlanFilter, planFilter)}
        />
        <FilterChips
          label={pickByLocale(locale, { en: 'Status', sw: 'Hali' })}
          options={STATUSES}
          active={statusFilter}
          onToggle={toggle(setStatusFilter, statusFilter)}
          renderLabel={(value) => pickByLocale(locale, STATUS_LABELS[value])}
        />
      </div>

      <div className="flex items-center gap-3">
        <Input
          type="search"
          inputSize="sm"
          className="flex-1"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={pickByLocale(locale, {
            en: 'Search by tenant or commodity…',
            sw: 'Tafuta kwa mteja au madini…',
          })}
          aria-label={pickByLocale(locale, {
            en: 'Search tenants',
            sw: 'Tafuta wateja',
          })}
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {pickByLocale(locale, {
            en: `${filtered.length} match`,
            sw: `${filtered.length} zinazolingana`,
          })}
        </span>
      </div>

      <DataTable
        ariaLabel={pickByLocale(locale, {
          en: 'Tenant directory',
          sw: 'Orodha ya wateja',
        })}
        columns={columns}
        rows={paged}
        initialSort={[{ id: 'lastActiveAt', desc: true }]}
        onRowClick={(t) => router.push(`/internal/tenants/${t.id}`)}
        emptyState={
          <span>
            {pickByLocale(locale, {
              en: 'No tenants match the current filters.',
              sw: 'Hakuna wateja wanaolingana na vichujio vya sasa.',
            })}
          </span>
        }
      />

      <div className="flex items-center justify-between">
        <DataSourceBadge source={source} />
        <Pagination page={page} pageCount={pageCount} onChange={setPage} />
      </div>
    </div>
  );
}
