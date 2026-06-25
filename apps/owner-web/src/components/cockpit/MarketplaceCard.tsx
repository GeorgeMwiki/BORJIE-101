'use client';

import { Card } from '@borjie/design-system';

import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

/**
 * `null` for any field means the marketplace feed is NOT wired in this
 * deployment — the gateway emits `null` (not a fabricated `0`) so the card can
 * render an honest em-dash, distinguishing an absent feed from a genuine zero.
 */
interface MarketplaceCardProps {
  readonly openOffers: number | null;
  readonly newInquiries7d: number | null;
  readonly topBuyer: string | null;
}

const EM_DASH = '—';

export function MarketplaceCard({
  openOffers,
  newInquiries7d,
  topBuyer,
}: MarketplaceCardProps) {
  const locale = useLocale();
  // The whole card has no data to show when the feed is unwired (the gateway
  // sends null across the board). Render the honest em-dash + a single
  // "no activity yet" meta line rather than three fabricated zeros.
  const hasOffers = typeof openOffers === 'number' && Number.isFinite(openOffers);
  const hasInquiries =
    typeof newInquiries7d === 'number' && Number.isFinite(newInquiries7d);
  const hasTopBuyer =
    typeof topBuyer === 'string' && topBuyer.trim().length > 0;
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.marketplace.title)}
      </div>
      <div className="cockpit-card-value">{hasOffers ? openOffers : EM_DASH}</div>
      <div className="cockpit-card-meta">
        {hasInquiries
          ? pickByLocale(locale, S.marketplace.meta(newInquiries7d))
          : pickByLocale(locale, S.marketplace.notWired)}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {pickByLocale(locale, S.marketplace.topBuyer)}:{' '}
        <span className="text-foreground">
          {hasTopBuyer ? topBuyer : EM_DASH}
        </span>
      </div>
    </Card>
  );
}
