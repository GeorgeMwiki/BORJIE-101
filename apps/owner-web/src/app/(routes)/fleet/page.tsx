import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-09 — Assets & fleet. Live data path:
 * GET /api/v1/mining/fleet/units + /fleet/match-factor.
 */
export default function FleetPage() {
  return (
    <>
      <ScreenHeader slug="fleet" />
      <div className="px-8 py-6">
        <EmptyState
          title="Fleet surface not yet wired"
          description="Match factor and predictive-maintenance health scores load from the live fleet API. Sign in to connect."
          hint="GET /api/v1/mining/fleet/units (pending)"
        />
      </div>
    </>
  );
}
