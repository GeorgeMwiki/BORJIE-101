'use client';

import { useState } from 'react';
import { Store } from 'lucide-react';
import {
  Skeleton,
  Alert,
  Empty,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
} from '@borjie/design-system';
import {
  useMarketplaceListingsQuery,
  useModerateListing,
  type ListingStatus,
  type ModerationListing,
} from '@/lib/internal/queries/marketplace';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { Toast } from '../Toast';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

/**
 * Live HQ marketplace moderation queue (AD-3).
 *
 * Binds to GET /api/v1/mining/internal/marketplace (real
 * `marketplace_listings` rows) and flips a listing's status via
 * POST /:id/hide | /:id/restore. Cross-tenant, admin-role guarded on the
 * gateway.
 */
const S = {
  loading: { en: 'Loading listings…', sw: 'Inapakia matangazo…' },
  emptyTitle: { en: 'No listings', sw: 'Hakuna matangazo' },
  emptyBody: {
    en: 'Marketplace listings appear here once tenants publish them. This queue reflects the live gateway — nothing is fabricated.',
    sw: 'Matangazo ya soko huonekana hapa mara wateja wanapoyachapisha. Foleni hii inaonyesha lango hai — hakuna kinachotungwa.',
  },
  colListing: { en: 'Listing', sw: 'Tangazo' },
  colCategory: { en: 'Category', sw: 'Kategoria' },
  colTenant: { en: 'Tenant', sw: 'Mteja' },
  colStatus: { en: 'Status', sw: 'Hali' },
  colActions: { en: 'Actions', sw: 'Vitendo' },
  hide: { en: 'Hide listing', sw: 'Ficha tangazo' },
  restore: { en: 'Restore listing', sw: 'Rejesha tangazo' },
} as const;

function statusTone(status: ListingStatus): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'Live') return 'success';
  if (status === 'Paused') return 'warn';
  if (status === 'Hidden') return 'danger';
  return 'neutral';
}

export function MarketplaceModerationList({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useMarketplaceListingsQuery();
  const moderate = useModerateListing();
  const [toast, setToast] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <Skeleton
        className="h-64 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{query.error.message}</Alert>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Empty
          icon={<Store className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'live'} />
      </div>
    );
  }

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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pickByLocale(locale, S.colListing)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colCategory)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colTenant)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colStatus)}</TableHead>
              <TableHead>
                <span className="sr-only">{pickByLocale(locale, S.colActions)}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-foreground">{row.title}</TableCell>
                <TableCell className="text-muted-foreground">{row.category}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.tenantId}
                </TableCell>
                <TableCell>
                  <StubBadge tone={statusTone(row.status)}>{row.status}</StubBadge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-signal-500"
                    disabled={moderate.isPending && pendingId === row.id}
                    loading={moderate.isPending && pendingId === row.id}
                    onClick={() => onModerate(row)}
                  >
                    {row.status === 'Hidden'
                      ? pickByLocale(locale, S.restore)
                      : pickByLocale(locale, S.hide)}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DataSourceBadge source={query.data?.source ?? 'live'} />
      <Toast
        message={toast}
        tone={moderate.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
