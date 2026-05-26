'use client';

import { useMemo, useState } from 'react';
import { DataSourceBadge } from '../DataSourceBadge';
import { VirtualList } from '../decision-log/VirtualList';
import { useAuditLogQuery } from '@/lib/internal/queries/audit-log';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';
import type { AuditEvent } from '@/lib/internal/types';

export function AuditLogViewer(): JSX.Element {
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

  if (query.isPending) return <p className="text-sm text-neutral-500">Loading audit log…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-lg border border-border bg-surface p-4">
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          aria-label="Filter by tenant"
          className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          <option value="">All tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Actor or action…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search audit log"
          className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground placeholder:text-neutral-500"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{filtered.length.toLocaleString()} events</span>
        <DataSourceBadge source={query.data?.source ?? 'live'} />
      </div>

      <VirtualList<AuditEvent>
        items={filtered}
        rowHeight={40}
        height={560}
        ariaLabel="Audit events"
        render={(evt) => (
          <div className="px-4 py-2 font-mono text-xs flex items-center gap-3 h-full">
            <span className="text-neutral-500 tabular-nums shrink-0">{evt.at.replace('T', ' ').slice(0, 16)}</span>
            <span className="text-neutral-300 shrink-0 w-48 truncate">{evt.tenant}</span>
            <span className="text-signal-500 shrink-0 w-24 truncate">{evt.actor}</span>
            <span className="text-foreground truncate">
              {evt.action}
              {evt.target ? ` — ${evt.target}` : ''}
            </span>
          </div>
        )}
      />
    </div>
  );
}
