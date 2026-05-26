import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-13 — Sales & pipeline. Live data path:
 * GET /api/v1/mining/marketplace/buyers + /sales/payment-trace. Empty
 * state until the gateway exposes both surfaces.
 */
export default function SalesPage() {
  return (
    <>
      <ScreenHeader slug="sales" />
      <div className="px-8 py-6">
        <EmptyState
          title="Sales pipeline not yet wired"
          description="Net-price comparison and payment trace load from the live marketplace + sales API. Sign in to connect."
          hint="GET /api/v1/mining/marketplace/buyers (pending)"
        />
      </div>
    </>
  );
}
