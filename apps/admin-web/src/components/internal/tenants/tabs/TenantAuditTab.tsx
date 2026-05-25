'use client';

import { useMemo } from 'react';
import { useAuditLogQuery } from '@/lib/internal/queries/audit-log';

interface TenantAuditTabProps {
  readonly tenantId: string;
}

export function TenantAuditTab({ tenantId }: TenantAuditTabProps): JSX.Element {
  const { data, isPending, isError, error } = useAuditLogQuery();
  const rows = useMemo(() => (data?.rows ?? []).filter((r) => r.tenantId === tenantId).slice(0, 30), [data, tenantId]);

  if (isPending) return <p className="text-sm text-neutral-500">Loading audit events…</p>;
  if (isError) return <p className="text-sm text-danger">Audit log unavailable: {error.message}</p>;

  return (
    <div className="rounded-lg border border-border bg-surface divide-y divide-border">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-neutral-500">No audit events for this tenant.</p>
      ) : (
        rows.map((evt) => (
          <div key={evt.id} className="px-4 py-3 font-mono text-xs flex items-center gap-3">
            <span className="text-neutral-500 tabular-nums shrink-0">{evt.at.replace('T', ' ').slice(0, 16)}</span>
            <span className="text-signal-500 shrink-0 w-24 truncate">{evt.actor}</span>
            <span className="text-foreground truncate">
              {evt.action}
              {evt.target ? ` — ${evt.target}` : ''}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
