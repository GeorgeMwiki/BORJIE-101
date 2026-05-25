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
  return (
    <article className="cockpit-card">
      <div className="cockpit-card-title">Marketplace activity</div>
      <div className="cockpit-card-value">{openOffers}</div>
      <div className="cockpit-card-meta">open offers · {newInquiries7d} new inquiries (7d)</div>
      <div className="mt-3 text-xs text-neutral-400">
        Top buyer: <span className="text-foreground">{topBuyer}</span>
      </div>
    </article>
  );
}
