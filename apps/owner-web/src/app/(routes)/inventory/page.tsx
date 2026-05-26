import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/shared/EmptyState';

/**
 * O-W-10 — Inventory & procurement. Live data path:
 * GET /api/v1/mining/inventory/consumables + /inventory/suppliers.
 */
export default function InventoryPage() {
  return (
    <>
      <ScreenHeader slug="inventory" />
      <div className="px-8 py-6">
        <EmptyState
          title="Inventory not yet wired"
          description="Reorder timeline and supplier ITC compliance load from the live inventory API. Sign in to connect."
          hint="GET /api/v1/mining/inventory/consumables (pending)"
        />
      </div>
    </>
  );
}
