import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { MarketplaceModerationList } from '@/components/internal/marketplace/MarketplaceModerationList';

const SCREEN = findScreen('marketplace')!;

/**
 * Marketplace moderation (AD-3). Live data path:
 *   GET  /api/v1/mining/internal/marketplace        — real listings
 *   POST /api/v1/mining/internal/marketplace/:id/hide
 *   POST /api/v1/mining/internal/marketplace/:id/restore
 *
 * Cross-tenant HQ surface; admin-role guarded + audited on the gateway.
 */
export default function MarketplacePage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <MarketplaceModerationList />
    </ScreenShell>
  );
}
