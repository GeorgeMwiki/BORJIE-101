'use client';

import { useState } from 'react';
import {
  useMarketplaceListingsQuery,
  useModerateListing,
  type ListingStatus,
  type ModerationListing,
} from '@/lib/internal/queries/marketplace';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';

/**
 * Live HQ marketplace moderation queue (AD-3).
 *
 * Binds to GET /api/v1/mining/internal/marketplace (real
 * `marketplace_listings` rows) and flips a listing's status via
 * POST /:id/hide | /:id/restore. Cross-tenant, admin-role guarded on the
 * gateway. Replaces the prior hardcoded fixture + disabled button.
 */
function statusTone(status: ListingStatus): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'Live') return 'success';
  if (status === 'Paused') return 'warn';
  if (status === 'Hidden') return 'danger';
  return 'neutral';
}

export function MarketplaceModerationList(): JSX.Element {
  const query = useMarketplaceListingsQuery();
  const moderate = useModerateListing();
  const [toast, setToast] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading listings…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  const onModerate = (listing: ModerationListing): void => {
    const action = listing.status === 'Hidden' ? 'restore' : 'hide';
    setPendingId(listing.id);
    moderate.mutate(
      { id: listing.id, action },
      {
        onSuccess: () => setToast(`${listing.title}: ${action}d`),
        onError: (err) =>
          setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
        onSettled: () => setPendingId(null),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-3 font-medium">Listing</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  No listings.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{row.title}</td>
                  <td className="px-4 py-3 text-neutral-300">{row.category}</td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-400">
                    {row.tenantId}
                  </td>
                  <td className="px-4 py-3">
                    <StubBadge tone={statusTone(row.status)}>{row.status}</StubBadge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={moderate.isPending && pendingId === row.id}
                      onClick={() => onModerate(row)}
                      className="text-xs text-signal-500 hover:underline disabled:opacity-50"
                    >
                      {row.status === 'Hidden' ? 'Restore listing' : 'Hide listing'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
      <Toast
        message={toast}
        tone={moderate.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
