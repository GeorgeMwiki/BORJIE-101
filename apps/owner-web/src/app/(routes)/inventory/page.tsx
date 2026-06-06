import { ScreenHeader } from '@/components/ScreenHeader';
import { ProcurementPanel } from '@/components/owner-os/panels/ProcurementPanel';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-10 — Inventory & procurement. Wired to the live procurement
 * recommendations surface (GET /api/v1/mining/procurement/recommendations
 * via useProcurementRecommendations). The panel renders its own real
 * loading / empty / error states (no fabricated data).
 */
export default async function InventoryPage() {
  const session = await getOwnerSession();
  return (
    <>
      <ScreenHeader slug="inventory" />
      <div className="px-8 py-6">
        <ProcurementPanel
          tabId="route:inventory"
          context={{}}
          locale={session.languagePreference}
        />
      </div>
    </>
  );
}
