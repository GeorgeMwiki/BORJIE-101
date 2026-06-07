'use client';

import {
  useAuditPacksQuery,
  type AuditPack,
} from '@/lib/internal/queries/audit-pack';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';

/**
 * Live issued audit-pack list.
 *
 * Binds to GET /api/v1/mining/internal/audit-pack over the real
 * `audit_packs` table. A pending pack has no signed URL yet — the download
 * link only renders once a real bundling/presign step fills `signedUrl`.
 */
function statusTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  const s = status.toLowerCase();
  if (s === 'ready') return 'success';
  if (s === 'pending') return 'warn';
  if (s === 'revoked' || s === 'expired') return 'danger';
  return 'neutral';
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

export function AuditPackList(): JSX.Element {
  const query = useAuditPacksQuery();

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading issued packs…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Pack</th>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Regulator</th>
              <th className="px-4 py-3 font-medium">Issued</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Download</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center text-xs text-neutral-500"
                >
                  No audit-packs issued yet.
                </td>
              </tr>
            ) : (
              rows.map((row: AuditPack) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    {row.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    {row.tenantId.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-neutral-300">{row.regulator}</td>
                  <td className="px-4 py-3 tabular-nums text-neutral-300">
                    {fmt(row.issuedAt)}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-neutral-300">
                    {fmt(row.expiresAt)}
                  </td>
                  <td className="px-4 py-3">
                    <StubBadge tone={statusTone(row.status)}>
                      {row.status}
                    </StubBadge>
                  </td>
                  <td className="px-4 py-3">
                    {row.signedUrl ? (
                      <a
                        href={row.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-signal-500 hover:underline"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-500">
                        Pending bundle
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <DataSourceBadge source="live" />
    </div>
  );
}
