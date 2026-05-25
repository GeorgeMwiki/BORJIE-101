import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-20 — Marketplace & external partners.
 *
 * Dual-direction surface: outbound (offer my product to refiners /
 * buyers / off-takers) and inbound (discover service providers,
 * equipment, consultants). All flows pass through the
 * External-Stakeholder Window with KYC / ITC checks.
 */
export default function MarketplacePage() {
  return (
    <>
      <ScreenHeader slug="marketplace" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Outbound (sell)">
          Listings for stockpiled product. Counter-offers, escrow status,
          settlement currency rules.
        </PlaceholderCard>
        <PlaceholderCard title="Inbound (buy)">
          Discover suppliers and consultants. Filter by region, ITC, prior
          ratings, ESG flags.
        </PlaceholderCard>
        <PlaceholderCard title="Partner reputation">
          Reputation graph based on completed transactions, payment
          punctuality, and dispute history.
        </PlaceholderCard>
      </div>
    </>
  );
}
