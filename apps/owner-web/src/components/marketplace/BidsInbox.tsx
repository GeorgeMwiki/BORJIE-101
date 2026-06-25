'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Button, Skeleton, StatusBadge } from '@borjie/design-system';
import {
  useAcceptBid,
  useIncomingBids,
  useRejectBid,
  type IncomingBid,
} from '@/lib/queries/marketplace';
import { formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import { fmtDateForLocale } from '@/lib/format';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { localizeError } from '@/lib/api-client';
import { pickByLocale, type Locale } from '@/lib/locale';
import { marketplaceSellerStrings as S } from '@/i18n/strings/marketplace-seller';

interface BidsInboxProps {
  readonly locale: Locale;
}

/**
 * Seller leg — the incoming-bids inbox.
 *
 * COMPLETION-LAW: the gateway already lists bids on the owner's listings
 * (GET /api/v1/mining/bids/incoming) and exposes seller Accept / Reject
 * (POST …/:id/accept · …/:id/reject). This panel wires the owner cockpit
 * to that surface: PENDING bids surface with Accept / Decline CTAs;
 * accepting crystallizes the binding offtake contract (handled server-side
 * in one transaction). All states render — loading, error, empty, list —
 * and every string resolves to the active locale only (zero-mix).
 */
export function BidsInbox({ locale }: BidsInboxProps): JSX.Element {
  // Action inbox = bids still awaiting a seller decision.
  const query = useIncomingBids('pending');
  const accept = useAcceptBid();
  const reject = useRejectBid();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyBidId, setBusyBidId] = useState<string | null>(null);

  const onAccept = async (bidId: string): Promise<void> => {
    setActionError(null);
    setBusyBidId(bidId);
    try {
      await accept.mutateAsync(bidId);
    } catch (err) {
      setActionError(localizeError(err, locale));
    } finally {
      setBusyBidId(null);
    }
  };

  const onReject = async (bidId: string): Promise<void> => {
    setActionError(null);
    setBusyBidId(bidId);
    try {
      await reject.mutateAsync({
        bidId,
        reason: pickByLocale(locale, S.rejectReasonDefault),
      });
    } catch (err) {
      setActionError(localizeError(err, locale));
    } finally {
      setBusyBidId(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">
          {pickByLocale(locale, S.bidsTitle)}
        </h2>
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.bidsSubtitle)}
        </p>
      </header>

      {query.isPending ? (
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl border border-border" />
          ))}
        </div>
      ) : query.isError ? (
        <div
          role="alert"
          className="px-5 py-6 text-sm text-destructive"
        >
          {pickByLocale(locale, S.bidsLoadError)}
        </div>
      ) : query.data.length === 0 ? (
        <div className="px-5 py-6">
          <ScreenEmptyState
            icon={<CheckCircle2 className="h-6 w-6" />}
            title={pickByLocale(locale, S.bidsEmptyTitle)}
            description={pickByLocale(locale, S.bidsEmptyBody)}
          />
        </div>
      ) : (
        <>
          {actionError ? (
            <p role="alert" className="px-5 pt-3 text-xs text-destructive">
              {actionError}
            </p>
          ) : null}
          <ul className="divide-y divide-border/60">
            {query.data.map((bid) => (
              <BidRow
                key={bid.id}
                bid={bid}
                locale={locale}
                busy={busyBidId === bid.id}
                disabled={busyBidId !== null}
                onAccept={() => void onAccept(bid.id)}
                onReject={() => void onReject(bid.id)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

interface BidRowProps {
  readonly bid: IncomingBid;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onAccept: () => void;
  readonly onReject: () => void;
}

function BidRow({
  bid,
  locale,
  busy,
  disabled,
  onAccept,
  onReject,
}: BidRowProps): JSX.Element {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatMoney(bid.bidPriceTzs, LAUNCH_CURRENCY, locale)}
          </span>
          <BidStatusBadge status={bid.status} locale={locale} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {pickByLocale(locale, S.bidBuyerLabel)}: {bid.buyerId || '—'}
          </span>
          {bid.createdAt ? (
            <span>
              {pickByLocale(locale, S.bidPlacedLabel)}:{' '}
              {fmtDateForLocale(bid.createdAt, locale)}
            </span>
          ) : null}
        </div>
        {bid.notes ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {bid.notes}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onReject}
          disabled={disabled}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {pickByLocale(locale, busy ? S.rejectingLabel : S.rejectButton)}
        </Button>
        <Button type="button" size="sm" onClick={onAccept} disabled={disabled}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {pickByLocale(locale, busy ? S.acceptingLabel : S.acceptButton)}
        </Button>
      </div>
    </li>
  );
}

/** Map a bid status enum token → a localized label + a DS badge tone. */
function BidStatusBadge({
  status,
  locale,
}: {
  readonly status: IncomingBid['status'];
  readonly locale: Locale;
}): JSX.Element {
  switch (status) {
    case 'accepted':
      return (
        <StatusBadge status="success">
          {pickByLocale(locale, S.bidStatusAccepted)}
        </StatusBadge>
      );
    case 'rejected':
      return (
        <StatusBadge status="error">
          {pickByLocale(locale, S.bidStatusRejected)}
        </StatusBadge>
      );
    case 'countered':
      return (
        <StatusBadge status="warning">
          {pickByLocale(locale, S.bidStatusCountered)}
        </StatusBadge>
      );
    case 'withdrawn':
      return (
        <StatusBadge status="inactive">
          {pickByLocale(locale, S.bidStatusWithdrawn)}
        </StatusBadge>
      );
    case 'pending':
    default:
      return (
        <StatusBadge status="pending">
          {pickByLocale(locale, S.bidStatusPending)}
        </StatusBadge>
      );
  }
}
