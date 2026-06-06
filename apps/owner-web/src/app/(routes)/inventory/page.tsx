import { ScreenHeader } from '@/components/ScreenHeader';
import { ProcurementPanel } from '@/components/owner-os/panels/ProcurementPanel';
import { InventorySurface } from '@/components/inventory/InventorySurface';
import { ProcurementCoordinationSurface } from '@/components/procurement/ProcurementCoordinationSurface';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-10 — Inventory & procurement. Live surfaces:
 *   - InventorySurface → REAL consumables / spares reorder candidates +
 *     on-hand value computed by `@borjie/inventory-management`
 *     (GET /api/v1/mining/inventory/*) over inventory_skus +
 *     inventory_stock_movements.
 *   - ProcurementCoordinationSurface → REAL vendor registry + budget
 *     availability + spend analytics served by
 *     `@borjie/procurement-coordination`
 *     (GET /api/v1/mining/procurement-coordination/*) over procurement_*.
 *   - ProcurementPanel → procurement recommendations
 *     (GET /api/v1/mining/procurement/recommendations).
 * Each surface renders its own real loading / empty / error states.
 */
export default async function InventoryPage() {
  const session = await getOwnerSession();
  return (
    <>
      <ScreenHeader slug="inventory" />
      <div className="space-y-6 px-8 py-6">
        <InventorySurface />
        <ProcurementCoordinationSurface />
        <ProcurementPanel
          tabId="route:inventory"
          context={{}}
          locale={session.languagePreference}
        />
      </div>
    </>
  );
}
