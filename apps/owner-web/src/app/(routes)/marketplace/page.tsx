import { ScreenHeader } from '@/components/ScreenHeader';
import { MarketplaceBoard } from '@/components/marketplace/MarketplaceBoard';

/**
 * O-W-20 — Marketplace & external partners.
 *
 * Page shell is a server component; the board is a client island
 * that pulls live listings via `useMarketplaceListings` and falls
 * back to the bundled mock when the gateway is unreachable.
 */
export default function MarketplacePage() {
  return (
    <>
      <ScreenHeader slug="marketplace" />
      <MarketplaceBoard />
    </>
  );
}
