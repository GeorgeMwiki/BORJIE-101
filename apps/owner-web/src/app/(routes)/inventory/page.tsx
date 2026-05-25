import { ScreenHeader } from '@/components/ScreenHeader';
import { PlaceholderCard } from '@/components/PlaceholderCard';

/**
 * O-W-10 — Inventory & procurement.
 *
 * Reorder timeline by SKU + supplier compliance state. Most stockouts
 * for ASM operators are foreseeable from the consumption curve — the
 * Procurement agent pre-fills POs and the owner approves.
 */
export default function InventoryPage() {
  return (
    <>
      <ScreenHeader slug="inventory" />
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-3">
        <PlaceholderCard title="Reorder timeline">
          Per-SKU consumption curve + projected stockout date. Auto-PO
          suggestions in the right-most column.
        </PlaceholderCard>
        <PlaceholderCard title="Supplier ITC compliance">
          TIN, VRN, ITC status per supplier. Non-compliant suppliers blocked
          from new POs.
        </PlaceholderCard>
        <PlaceholderCard title="Open POs">
          PO ledger with delivery ETA and matching against goods-received
          notes.
        </PlaceholderCard>
      </div>
    </>
  );
}
