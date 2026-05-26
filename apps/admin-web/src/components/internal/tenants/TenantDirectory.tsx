'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../DataTable';
import { FilterChips } from '../FilterChips';
import { Pagination } from '../Pagination';
import { DataSourceBadge } from '../DataSourceBadge';
import { TenantStatusBadge } from './TenantStatusBadge';
import { TenantActions } from './TenantActions';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';
import type { Tenant, TenantPlan, TenantStatus } from '@/lib/internal/types';

const PLANS: ReadonlyArray<TenantPlan> = ['Starter', 'Growth', 'Enterprise'];
const STATUSES: ReadonlyArray<TenantStatus> = ['Active', 'Trial', 'Past due', 'Suspended'];
const PAGE_SIZE = 10;

function formatArr(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRelative(iso: string, now: number = Date.now()): string {
  const diffMs = now - Date.parse(iso);
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function TenantDirectory(): JSX.Element {
  const router = useRouter();
  const query = useTenantsQuery();
  const [planFilter, setPlanFilter] = useState<Set<TenantPlan>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<TenantStatus>>(new Set());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const rows = query.data?.rows ?? [];
  const source = query.data?.source ?? 'mock';

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
        header: 'Tenant',
        cell: (ctx) => <span className="text-foreground font-medium">{ctx.row.original.name}</span>,
      },
      {
        accessorKey: 'plan',
        header: 'Plan',
      },
      {
        accessorKey: 'country',
        header: 'Country',
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (ctx) => <TenantStatusBadge status={ctx.row.original.status} />,
        sortingFn: (a, b) => a.original.status.localeCompare(b.original.status),
      },
      {
        accessorKey: 'arrUsd',
        header: 'ARR',
        cell: (ctx) => <span className="tabular-nums">{formatArr(ctx.row.original.arrUsd)}</span>,
      },
      {
        accessorKey: 'lastActiveAt',
        header: 'Last active',
        cell: (ctx) => <span className="text-xs text-neutral-500">{formatRelative(ctx.row.original.lastActiveAt)}</span>,
        sortingFn: (a, b) => Date.parse(a.original.lastActiveAt) - Date.parse(b.original.lastActiveAt),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: (ctx) => <TenantActions tenant={ctx.row.original} />,
      },
    ],
    []
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
    return <p className="text-sm text-neutral-500">Loading tenants…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">Failed to load tenants: {query.error.message}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips label="Plan" options={PLANS} active={planFilter} onToggle={toggle(setPlanFilter, planFilter)} />
        <FilterChips
          label="Status"
          options={STATUSES}
          active={statusFilter}
          onToggle={toggle(setStatusFilter, statusFilter)}
        />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search by tenant or commodity…"
          aria-label="Search tenants"
          className="flex-1 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-neutral-500"
        />
        <span className="text-xs text-neutral-500 tabular-nums">{filtered.length} match</span>
      </div>

      <DataTable
        ariaLabel="Tenant directory"
        columns={columns}
        rows={paged}
        initialSort={[{ id: 'lastActiveAt', desc: true }]}
        onRowClick={(t) => router.push(`/internal/tenants/${t.id}`)}
        emptyState={<span>No tenants match the current filters.</span>}
      />

      <div className="flex items-center justify-between">
        <DataSourceBadge source={source} />
        <Pagination page={page} pageCount={pageCount} onChange={setPage} />
      </div>
    </div>
  );
}
