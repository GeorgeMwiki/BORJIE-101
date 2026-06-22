'use client';

import { Card } from '@borjie/design-system';

import { useLocale, pickByLocale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

interface MarketplaceCardProps {
  readonly openOffers: number;
  readonly newInquiries7d: number;
  readonly topBuyer: string;
}

export function MarketplaceCard({
  openOffers,
  newInquiries7d,
  topBuyer,
}: MarketplaceCardProps) {
  const locale = useLocale();
  return (
    <Card hoverable className="p-5">
      <div className="cockpit-card-title">
        {pickByLocale(locale, S.marketplace.title)}
      </div>
      <div className="cockpit-card-value">{openOffers}</div>
      <div className="cockpit-card-meta">
        {pickByLocale(locale, S.marketplace.meta(newInquiries7d))}
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {pickByLocale(locale, S.marketplace.topBuyer)}:{' '}
        <span className="text-foreground">{topBuyer}</span>
      </div>
    </Card>
  );
}
